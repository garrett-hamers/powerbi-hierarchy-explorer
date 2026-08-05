/*
 * Layout containment rules, as pure functions over measurements.
 *
 * Nothing here touches a DOM, a browser or the file system. Every function
 * takes plain numbers that some other layer measured and returns the list of
 * violations those numbers imply. That split is deliberate: tests can drive
 * these rules with deliberately bad measurements and watch them fire, instead
 * of only ever seeing the numbers a correct render happens to produce. A rule
 * that has only ever been shown a correct render has not been shown to work.
 *
 * The measuring layer lives in harness/measure.js and runs inside real
 * Chromium, because a layout rule evaluated in JSDOM is evaluated against a
 * getBoundingClientRect() that returns zeros, and a rule that cannot fail is
 * not a rule.
 */
"use strict";

const DEFAULT_TOLERANCE = 0.5;

const RULES = {
  rootEscapesTile: "root-escapes-tile",
  clippedEscape: "clipped-escape",
  unreachableInScroller: "unreachable-in-scroller",
  screenReaderRegionEscapes: "screen-reader-region-escapes",
  collapsedRegion: "collapsed-region",
  scrollRegionLost: "scroll-region-lost",
  scrollPreconditionUnmet: "scroll-precondition-unmet",
  stickyNotPositioned: "sticky-not-positioned",
  stickyOverlap: "sticky-overlap",
  hiddenScroll: "hidden-scroll",
  focusNotFullyVisible: "focus-not-fully-visible",
  textEscapesOwner: "text-escapes-owner",
  countDrifted: "count-drifted"
};

function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, received ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Accepts either an explicit {left, top, right, bottom} box or the
 * {left, top, width, height} shape getBoundingClientRect hands back, and always
 * returns all six fields so downstream arithmetic never has to branch.
 */
function normalizeRect(rect, name) {
  if (!rect || typeof rect !== "object") {
    throw new TypeError(`${name} must be a rectangle, received ${JSON.stringify(rect)}`);
  }
  const left = finite(rect.left, `${name}.left`);
  const top = finite(rect.top, `${name}.top`);
  const right =
    rect.right === undefined ? left + finite(rect.width, `${name}.width`) : finite(rect.right, `${name}.right`);
  const bottom =
    rect.bottom === undefined ? top + finite(rect.height, `${name}.height`) : finite(rect.bottom, `${name}.bottom`);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function intersectRects(a, b) {
  const first = normalizeRect(a, "a");
  const second = normalizeRect(b, "b");
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.right, second.right);
  const bottom = Math.min(first.bottom, second.bottom);
  return {
    left,
    top,
    right: Math.max(left, right),
    bottom: Math.max(top, bottom),
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

/**
 * How far `inner` pokes out of `outer` on each edge. Zero on an edge means the
 * edge is inside. `worst` is the largest single-edge escape, which is the number
 * worth quoting: it is how much content the host tile silently ate.
 */
function escapeOf(inner, outer, tolerance = DEFAULT_TOLERANCE) {
  const box = normalizeRect(inner, "inner");
  const bounds = normalizeRect(outer, "outer");
  const slack = finite(tolerance, "tolerance");
  const left = Math.max(0, bounds.left - slack - box.left);
  const top = Math.max(0, bounds.top - slack - box.top);
  const right = Math.max(0, box.right - (bounds.right + slack));
  const bottom = Math.max(0, box.bottom - (bounds.bottom + slack));
  return { left, top, right, bottom, worst: Math.max(left, top, right, bottom) };
}

function isContained(inner, outer, tolerance = DEFAULT_TOLERANCE) {
  return escapeOf(inner, outer, tolerance).worst === 0;
}

function edgeSummary(escape) {
  return ["left", "top", "right", "bottom"]
    .filter((edge) => escape[edge] > 0)
    .map((edge) => `${edge} by ${escape[edge].toFixed(2)}px`)
    .join(", ");
}

function violation(rule, target, detail, extra) {
  return Object.assign({ rule, target, detail, escape: 0 }, extra || {});
}

/**
 * The root must fit the tile the host gave it. A root taller than its tile is
 * not "mostly fine": the host clips at the tile edge with no scrollbar and no
 * affordance, so whatever is past that edge is gone.
 */
function checkRootWithinTile(measurement, tolerance = DEFAULT_TOLERANCE) {
  const tile = normalizeRect(measurement.tile, "tile");
  const root = normalizeRect(measurement.root, "root");
  const escape = escapeOf(root, tile, tolerance);
  if (escape.worst === 0) {
    return [];
  }
  return [
    violation(
      RULES.rootEscapesTile,
      measurement.rootPath || ".atlyn-root",
      `the visual root is ${root.width.toFixed(0)}x${root.height.toFixed(0)} inside a ` +
        `${tile.width.toFixed(0)}x${tile.height.toFixed(0)} tile and escapes it ${edgeSummary(escape)}`,
      { escape: escape.worst, escapeEdges: escape }
    )
  ];
}

/**
 * The escape walk. `elements` are pre-measured records:
 *
 *   path          human-readable position in the tree
 *   rect          getBoundingClientRect()
 *   clip          intersection of every clipping ancestor up to the tile
 *   rendered      false for display:none / visibility:hidden / zero-size
 *   scrollExempt  true when a genuine overflow:auto|scroll ancestor sits
 *                 between the element and the clip, so a user can reach it
 *   srOnly        true inside a deliberate screen-reader-only clip region
 *   content       the element's box in the scroll ancestor's content
 *                 coordinates plus that ancestor's scrollWidth/scrollHeight,
 *                 supplied only when scrollExempt
 */
function findEscapes(elements, options = {}) {
  const tolerance = options.tolerance === undefined ? DEFAULT_TOLERANCE : finite(options.tolerance, "tolerance");
  if (!Array.isArray(elements)) {
    throw new TypeError("elements must be an array of measured records");
  }
  const violations = [];
  elements.forEach((element) => {
    if (!element.rendered || element.srOnly) {
      return;
    }
    if (element.scrollExempt) {
      // Inside a scroller the question is not "is it on screen now" but "does
      // any scroll offset bring it on screen". Content laid out at a negative
      // offset, or past the scrollable extent, is unreachable at every offset.
      if (!element.content) {
        return;
      }
      const reach = {
        left: 0,
        top: 0,
        right: finite(element.content.scrollWidth, "content.scrollWidth"),
        bottom: finite(element.content.scrollHeight, "content.scrollHeight")
      };
      const escape = escapeOf(element.content, reach, tolerance);
      if (escape.worst > 0) {
        violations.push(
          violation(
            RULES.unreachableInScroller,
            element.path,
            `lies outside the scrollable extent of ${element.scrollAncestor || "its scroll container"} ` +
              `(${edgeSummary(escape)}), so no scroll offset brings it into view`,
            { escape: escape.worst, escapeEdges: escape }
          )
        );
      }
      return;
    }
    const escape = escapeOf(element.rect, element.clip, tolerance);
    if (escape.worst > 0) {
      violations.push(
        violation(
          RULES.clippedEscape,
          element.path,
          `renders outside ${element.clipPath || "the clipped box"} (${edgeSummary(escape)}) ` +
            "with no scroll container in between, so the pixels are silently discarded",
          { escape: escape.worst, escapeEdges: escape }
        )
      );
    }
  });
  return violations.sort((first, second) => second.escape - first.escape);
}

/**
 * A screen-reader-only region is allowed to clip its own children - that is the
 * whole idiom - but the region itself still belongs to the visual. One that
 * escapes the tile is announced as content of the page rather than content of
 * the visual, which is how a caption ends up outside the visual it describes.
 */
function checkScreenReaderRegions(regions, tile, tolerance = DEFAULT_TOLERANCE) {
  const bounds = normalizeRect(tile, "tile");
  return (regions || []).flatMap((region) => {
    const escape = escapeOf(region.rect, bounds, tolerance);
    if (escape.worst === 0) {
      return [];
    }
    return [
      violation(
        RULES.screenReaderRegionEscapes,
        region.path,
        `the screen-reader-only region sits outside the visual's tile (${edgeSummary(escape)})`,
        { escape: escape.worst, escapeEdges: escape }
      )
    ];
  });
}

/**
 * Regions that must still be worth looking at. A drawing area squeezed to zero
 * is the same defect as one drawn off screen: the visual is on the report and
 * shows nothing.
 */
function checkMinimumSizes(regions, tolerance = DEFAULT_TOLERANCE) {
  return (regions || []).flatMap((region) => {
    const width = finite(region.width, `${region.path}.width`);
    const height = finite(region.height, `${region.path}.height`);
    const minWidth = region.minWidth === undefined ? 0 : finite(region.minWidth, "minWidth");
    const minHeight = region.minHeight === undefined ? 0 : finite(region.minHeight, "minHeight");
    const failures = [];
    if (width + tolerance < minWidth) {
      failures.push(`${width.toFixed(1)}px wide, needs ${minWidth}px`);
    }
    if (height + tolerance < minHeight) {
      failures.push(`${height.toFixed(1)}px tall, needs ${minHeight}px`);
    }
    if (failures.length === 0) {
      return [];
    }
    return [
      violation(
        RULES.collapsedRegion,
        region.path,
        `${region.label || region.path} collapsed to ${failures.join(" and ")}`,
        { escape: Math.max(minHeight - height, minWidth - width) }
      )
    ];
  });
}

/**
 * Two separate failures, kept separate on purpose.
 *
 * A region named in `expected` that is no longer a scroll container is
 * reported, never quietly dropped, because dropping it is how a region stops
 * carrying its own requirement without anyone noticing.
 *
 * A region named in `mustOverflow` that does not overflow cannot exercise
 * scrolling at all - sticky is inert without overflow, and a scroll-time
 * assertion against a fixture that fits its viewport passes while proving
 * nothing. That is a failure of the probe, and it is reported as loudly as a
 * failure of the visual.
 */
function checkScrollRegions(regions, options = {}) {
  const found = new Map((regions || []).map((region) => [region.path, region]));
  const violations = [];
  (options.expected || []).forEach((path) => {
    if (!found.has(path)) {
      violations.push(
        violation(
          RULES.scrollRegionLost,
          path,
          "is no longer an overflow:auto|scroll container, so every scroll-time check that named it " +
            "has silently stopped testing anything"
        )
      );
    }
  });
  (options.mustOverflow || []).forEach((path) => {
    const region = found.get(path);
    if (!region) {
      return;
    }
    const scrollableDown = finite(region.scrollHeight, "scrollHeight") > finite(region.clientHeight, "clientHeight");
    const scrollableAcross = finite(region.scrollWidth, "scrollWidth") > finite(region.clientWidth, "clientWidth");
    if (!scrollableDown && !scrollableAcross) {
      violations.push(
        violation(
          RULES.scrollPreconditionUnmet,
          path,
          `content ${region.scrollWidth}x${region.scrollHeight} fits its ${region.clientWidth}x${region.clientHeight} ` +
            "box, so this state cannot exercise scrolling and any scroll-time assertion here would pass vacuously"
        )
      );
    }
  });
  return violations;
}

/**
 * getComputedStyle().zIndex reports the specified value whether or not the
 * element is positioned, so a stacking comparison across static elements reads
 * an order out of a stacking context that does not exist. The position is
 * therefore checked first, and a failure there is reported instead of the
 * comparison, not alongside it.
 */
function checkStickyStacking(items, options = {}) {
  const expectedPosition = options.position || "sticky";
  const violations = [];
  const positioned = [];
  (items || []).forEach((item) => {
    if (item.position !== expectedPosition) {
      violations.push(
        violation(
          RULES.stickyNotPositioned,
          item.path,
          `computes position: ${item.position}, not ${expectedPosition}, so its z-index of ` +
            `${item.zIndex} orders nothing and any stacking assertion about it passes vacuously`
        )
      );
      return;
    }
    positioned.push(item);
  });
  for (let index = 1; index < positioned.length; index += 1) {
    const previous = positioned[index - 1];
    const current = positioned[index];
    const overlap = intersectRects(previous.rect, current.rect);
    if (overlap.width > 0 && overlap.height > 0) {
      violations.push(
        violation(
          RULES.stickyOverlap,
          current.path,
          `overlaps ${previous.path} by ${overlap.width.toFixed(1)}x${overlap.height.toFixed(1)}px while pinned`,
          { escape: Math.max(overlap.width, overlap.height) }
        )
      );
    }
  }
  return violations;
}

/**
 * Text has to stay inside the shape drawn for it. This is the rule that catches
 * an RTL double flip: direction:rtl on an <svg> inverts what text-anchor start
 * and end mean, so mirroring the x coordinate as well anchors the text on the
 * wrong edge and it runs straight back out of its own card.
 */
function checkTextWithinOwner(pairs, tolerance = DEFAULT_TOLERANCE) {
  return (pairs || []).flatMap((pair) => {
    const textRect = normalizeRect(pair.textRect, "textRect");
    if (textRect.width === 0 && textRect.height === 0) {
      return [];
    }
    const escape = escapeOf(textRect, pair.ownerRect, tolerance);
    if (escape.worst === 0) {
      return [];
    }
    return [
      violation(
        RULES.textEscapesOwner,
        pair.path,
        `"${pair.text}" renders outside ${pair.ownerPath} (${edgeSummary(escape)})`,
        { escape: escape.worst, escapeEdges: escape }
      )
    ];
  });
}

/**
 * Keyboard focus that lands outside the tile is focus on something the user
 * cannot see. The host does not scroll to it, because the host does not scroll.
 */
function checkFocusWithinTile(focus, tile, tolerance = DEFAULT_TOLERANCE) {
  if (!focus || !focus.activeRect || !focus.activePath) {
    return [];
  }
  const escape = escapeOf(focus.activeRect, tile, tolerance);
  if (escape.worst === 0) {
    return [];
  }
  return [
    violation(
      RULES.clippedEscape,
      focus.activePath,
      `holds keyboard focus but sits outside the tile (${edgeSummary(escape)}), ` +
        "so a keyboard user is focused on something the host has clipped away",
      { escape: escape.worst, escapeEdges: escape }
    )
  ];
}

/**
 * Reachable is not the same as visible. A row inside a scroll pane shorter than
 * the row itself can never be shown whole: the browser scrolls one edge of it
 * into view and the other edge stays cut off, whichever way it aligns. Checked
 * only at the offset the browser itself chose after focus moved, because after
 * the probe forces a scroll, a focused row being off screen is what scrolling
 * means.
 */
function checkFocusFullyVisible(focus, tolerance = DEFAULT_TOLERANCE) {
  if (!focus || !focus.activeRect || !focus.activePath || !focus.visibleBox) {
    return [];
  }
  const escape = escapeOf(focus.activeRect, focus.visibleBox, tolerance);
  if (escape.worst === 0) {
    return [];
  }
  return [
    violation(
      RULES.focusNotFullyVisible,
      focus.activePath,
      `holds keyboard focus but does not fit inside ${focus.visibleBoxPath || "the box that clips it"} ` +
        `(${edgeSummary(escape)}), so no scroll offset shows the focused row whole`,
      { escape: escape.worst, escapeEdges: escape }
    )
  ];
}

/**
 * An overflow: hidden box is still scrollable programmatically - focusing a
 * descendant makes the browser scroll it into view - but a user cannot scroll
 * it back, because there is no scrollbar and no gesture that reaches it. So a
 * hidden box that has been scrolled has permanently hidden whatever was above
 * the offset. This is not a hypothetical: it is what a Tab into the accessible
 * tree does the moment the visual's content is taller than its tile.
 */
function checkHiddenScroll(regions, tolerance = DEFAULT_TOLERANCE) {
  return (regions || []).flatMap((region) => {
    const top = finite(region.scrollTop, `${region.path}.scrollTop`);
    const left = finite(region.scrollLeft, `${region.path}.scrollLeft`);
    if (Math.abs(top) <= tolerance && Math.abs(left) <= tolerance) {
      return [];
    }
    return [
      violation(
        RULES.hiddenScroll,
        region.path,
        `is overflow: ${region.overflowY} yet has been scrolled to ${top}px/${left}px, ` +
          "so the content above that offset is unreachable - there is no scrollbar to bring it back",
        { escape: Math.max(Math.abs(top), Math.abs(left)) }
      )
    ];
  });
}

/**
 * Counts that must not drift without someone deciding they should. A visual
 * that grows its first position:sticky element, or its first position:fixed
 * one, has grown a whole class of behaviour this probe would otherwise walk
 * straight past.
 */
function checkDeclaredCounts(actual, expected) {
  return Object.keys(expected || {}).flatMap((key) => {
    if (actual[key] === expected[key]) {
      return [];
    }
    return [
      violation(
        RULES.countDrifted,
        key,
        `expected ${expected[key]}, measured ${actual[key]}; update ` +
          "scripts/layout-probe/expected-regions.json once the new behaviour is probed"
      )
    ];
  });
}

function summarize(violations) {
  const byRule = {};
  let worst = 0;
  let worstTarget = null;
  (violations || []).forEach((item) => {
    byRule[item.rule] = (byRule[item.rule] || 0) + 1;
    if ((item.escape || 0) > worst) {
      worst = item.escape;
      worstTarget = item.target;
    }
  });
  return { total: (violations || []).length, byRule, worstEscape: worst, worstTarget };
}

module.exports = {
  DEFAULT_TOLERANCE,
  RULES,
  normalizeRect,
  intersectRects,
  escapeOf,
  isContained,
  findEscapes,
  checkRootWithinTile,
  checkScreenReaderRegions,
  checkMinimumSizes,
  checkScrollRegions,
  checkStickyStacking,
  checkTextWithinOwner,
  checkFocusWithinTile,
  checkFocusFullyVisible,
  checkHiddenScroll,
  checkDeclaredCounts,
  summarize
};
