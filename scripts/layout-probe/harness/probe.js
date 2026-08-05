/*
 * Measurement, not judgement.
 *
 * This file mounts the packaged bundle inside a tile that clips exactly the way
 * a Power BI host tile clips, then reports what is on the screen. It decides
 * nothing: every rule lives in scripts/layout-probe/rules.cjs as a pure
 * function so it can be driven with deliberately bad numbers in a unit test.
 *
 * Geometry is read from getBoundingClientRect in real Chromium. Presence in the
 * DOM proves nothing - an element can exist for the entire life of a broken
 * build and lay out at zero height, and querySelector finds it every time.
 */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var mounted = null;

  function tileElement() {
    var tile = document.getElementById("tile");
    if (!tile) {
      throw new Error("the harness tile is missing");
    }
    return tile;
  }

  function findPlugin() {
    var plugins = (window.powerbi && window.powerbi.visuals && window.powerbi.visuals.plugins) || {};
    var names = Object.keys(plugins);
    if (names.length === 0) {
      throw new Error("no Power BI visual plugin was registered by the packaged bundle");
    }
    if (names.length > 1) {
      throw new Error("expected exactly one registered plugin, found: " + names.join(", "));
    }
    return plugins[names[0]];
  }

  function rectOf(element) {
    var measured = element.getBoundingClientRect();
    return {
      left: measured.left,
      top: measured.top,
      right: measured.right,
      bottom: measured.bottom,
      width: measured.width,
      height: measured.height
    };
  }

  function paddingBoxOf(element, style) {
    var measured = element.getBoundingClientRect();
    var left = measured.left + (parseFloat(style.borderLeftWidth) || 0);
    var top = measured.top + (parseFloat(style.borderTopWidth) || 0);
    var right = measured.right - (parseFloat(style.borderRightWidth) || 0);
    var bottom = measured.bottom - (parseFloat(style.borderBottomWidth) || 0);
    return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
  }

  function intersect(a, b) {
    var left = Math.max(a.left, b.left);
    var top = Math.max(a.top, b.top);
    var right = Math.min(a.right, b.right);
    var bottom = Math.min(a.bottom, b.bottom);
    return {
      left: left,
      top: top,
      right: Math.max(left, right),
      bottom: Math.max(top, bottom),
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  }

  /*
   * Only boxes that actually establish a clip count. In SVG that is the outer
   * <svg> and foreignObject; a <g> reporting overflow:hidden clips nothing, and
   * treating it as a clipper would invent violations for every label.
   */
  function isClipper(element, style) {
    if (element.namespaceURI === SVG_NS) {
      var tag = element.tagName.toLowerCase();
      if (tag !== "svg" && tag !== "foreignobject") {
        return false;
      }
    }
    return style.overflowX !== "visible" || style.overflowY !== "visible";
  }

  function isScroller(element, style) {
    if (!isClipper(element, style)) {
      return false;
    }
    return /^(auto|scroll|overlay)$/.test(style.overflowX) || /^(auto|scroll|overlay)$/.test(style.overflowY);
  }

  // The standard visually-hidden idiom: a 1px box that clips itself away.
  function isScreenReaderOnly(style) {
    var clipPath = style.clipPath || "";
    var clip = style.clip || "";
    return clipPath.indexOf("inset(50%") === 0 || /^rect\(0px,?\s*0px,?\s*0px,?\s*0px\)$/.test(clip.replace(/\s+/g, " "));
  }

  function describe(element) {
    var tag = element.tagName.toLowerCase();
    var className = (element.getAttribute && element.getAttribute("class")) || "";
    var node =
      element.getAttribute &&
      (element.getAttribute("data-node-id") || element.getAttribute("data-semantic-node-id"));
    return (
      tag +
      (className ? "." + className.trim().split(/\s+/).join(".") : "") +
      (node ? "[" + node + "]" : "") +
      (element.id ? "#" + element.id : "")
    );
  }

  /*
   * Paths are relative to the element the host hands the visual, so they read
   * as the visual's own DOM rather than the harness scaffolding around it.
   */
  function pathOf(element) {
    var stop = document.getElementById("visual-host") || tileElement();
    var parts = [];
    var current = element;
    while (current && current !== stop && current !== tileElement()) {
      parts.unshift(describe(current));
      current = current.parentElement;
    }
    return parts.join(" > ") || "#tile";
  }

  /*
   * The element's box in its scroll container's content coordinates, mapped to
   * a 0..scrollWidth/0..scrollHeight space in both writing directions so an
   * RTL container's negative scrollLeft does not read as an escape.
   */
  function contentBoxWithin(scroller, style, box) {
    var padding = paddingBoxOf(scroller, style);
    var minScrollLeft = style.direction === "rtl" ? scroller.clientWidth - scroller.scrollWidth : 0;
    var offsetX = scroller.scrollLeft - minScrollLeft;
    var offsetY = scroller.scrollTop;
    return {
      left: box.left - padding.left + offsetX,
      top: box.top - padding.top + offsetY,
      right: box.right - padding.left + offsetX,
      bottom: box.bottom - padding.top + offsetY,
      scrollWidth: scroller.scrollWidth,
      scrollHeight: scroller.scrollHeight
    };
  }

  function scrollRegionOf(element, style) {
    return {
      path: pathOf(element),
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      maxScrollTop: Math.max(0, element.scrollHeight - element.clientHeight),
      maxScrollLeft: Math.max(0, element.scrollWidth - element.clientWidth),
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      direction: style.direction
    };
  }

  function namedRegion(element, label) {
    if (!element) {
      return null;
    }
    var style = getComputedStyle(element);
    var box = rectOf(element);
    return {
      label: label,
      path: pathOf(element),
      rect: box,
      width: box.width,
      height: box.height,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      display: style.display,
      position: style.position,
      visibility: style.visibility,
      hidden: Boolean(element.hidden)
    };
  }

  window.__probeMount = function mount(options) {
    var settings = options || {};
    var tile = tileElement();
    if (mounted) {
      mounted.destroy();
      mounted = null;
    }
    var element = document.getElementById("visual-host");
    element.replaceChildren();
    document.documentElement.setAttribute("lang", settings.locale || "en-US");

    var bounds = tile.getBoundingClientRect();
    var viewport = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    var visual = findPlugin().create({
      element: element,
      host: window.__probeCreateHost({ locale: settings.locale || "en-US" })
    });
    visual.update({
      dataViews: [window.__probeFixtures[settings.fixture || "org"]()],
      viewport: viewport,
      type: 2,
      viewMode: 1,
      editMode: 0,
      isInFocus: false
    });
    mounted = visual;
    return viewport;
  };

  // Entering the tree is what Tab does in a real host. Everything after that is
  // native input sent by the driver.
  window.__probeFocusTree = function focusTree() {
    var first = document.querySelector('[role="treeitem"]');
    if (!first) {
      throw new Error("the visual rendered no tree items to focus");
    }
    first.focus();
    return first.getAttribute("data-semantic-node-id");
  };

  /*
   * Expansion state is changed through the visual's own double-click handler,
   * the same entry point a report user hits on a node card. The event is
   * dispatched rather than clicked because at an 80x80 tile a card can be
   * scrolled far outside the canvas viewport, and a probe that can only reach
   * the states big tiles allow would never probe the states the bugs live in.
   * scripts/probe-layout.cjs cross-checks this path against a native
   * Playwright double click at the largest tile.
   */
  window.__probeCollapse = function collapse(ids) {
    var tile = tileElement();
    var toggled = [];
    (ids || []).forEach(function (id) {
      var card = tile.querySelector('.atlyn-node[data-node-id="' + id + '"] .atlyn-node-card');
      if (!card) {
        return;
      }
      card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
      toggled.push(id);
    });
    return {
      toggled: toggled,
      expanded: Array.prototype.slice
        .call(tile.querySelectorAll('[role="treeitem"][aria-expanded="true"]'))
        .map(function (item) {
          return item.getAttribute("data-semantic-node-id");
        }),
      collapsed: Array.prototype.slice
        .call(tile.querySelectorAll('[role="treeitem"][aria-expanded="false"]'))
        .map(function (item) {
          return item.getAttribute("data-semantic-node-id");
        })
    };
  };

  window.__probeScrollAll = function scrollAll(where) {
    var tile = tileElement();
    var moved = [];
    Array.prototype.slice.call(tile.querySelectorAll("*")).forEach(function (element) {
      var style = getComputedStyle(element);
      if (!isScroller(element, style)) {
        return;
      }
      var maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
      var maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      var factor = where === "max" ? 1 : where === "middle" ? 0.5 : 0;
      element.scrollTop = Math.round(maxTop * factor);
      element.scrollLeft = Math.round(maxLeft * factor) * (style.direction === "rtl" ? -1 : 1);
      moved.push({ path: pathOf(element), maxScrollTop: maxTop, maxScrollLeft: maxLeft, scrollTop: element.scrollTop });
    });
    return moved;
  };

  /*
   * The box that actually clips the element: the padding box of its nearest
   * clipping ancestor, whether that ancestor scrolls or not. For a focused row
   * this is the pane it lives in, and a row that does not fit inside it cannot
   * be shown whole at any scroll offset.
   */
  function clippingBoxOf(element) {
    var tile = tileElement();
    var ancestor = element && element.parentElement;
    while (ancestor && ancestor !== tile) {
      var style = getComputedStyle(ancestor);
      if (isClipper(ancestor, style)) {
        return { rect: paddingBoxOf(ancestor, style), path: pathOf(ancestor) };
      }
      ancestor = ancestor.parentElement;
    }
    var tileStyle = getComputedStyle(tile);
    return { rect: paddingBoxOf(tile, tileStyle), path: "#tile" };
  }

  window.__probeMeasure = function measure() {
    var tile = tileElement();
    var tileStyle = getComputedStyle(tile);
    var tileClip = paddingBoxOf(tile, tileStyle);
    var root = tile.querySelector(".atlyn-root");
    if (!root) {
      throw new Error("the visual did not render its root element");
    }

    var elements = [];
    var scrollRegions = [];
    var hiddenScrollRegions = [];
    var screenReaderRegions = [];
    var sticky = [];
    var fixed = [];
    var absolute = [];

    // The document itself. body has overflow: hidden here exactly as a host
    // iframe does, and focusing something below the fold still scrolls it -
    // which moves the whole visual up under a tile that cannot scroll back.
    var scrollingElement = document.scrollingElement || document.documentElement;
    hiddenScrollRegions.push({
      path: "the visual's document",
      overflowX: getComputedStyle(document.body).overflowX,
      overflowY: getComputedStyle(document.body).overflowY,
      scrollTop: scrollingElement.scrollTop,
      scrollLeft: scrollingElement.scrollLeft
    });

    Array.prototype.slice.call(tile.querySelectorAll("*")).forEach(function (element) {
      var style = getComputedStyle(element);
      var box = rectOf(element);
      var rendered =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !element.hidden &&
        box.width > 0 &&
        box.height > 0;

      if (isScroller(element, style)) {
        scrollRegions.push(scrollRegionOf(element, style));
      } else if (isClipper(element, style)) {
        hiddenScrollRegions.push({
          path: pathOf(element),
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          scrollTop: element.scrollTop,
          scrollLeft: element.scrollLeft
        });
      }
      if (isScreenReaderOnly(style)) {
        screenReaderRegions.push({ path: pathOf(element), rect: box });
      }
      var entry = { path: pathOf(element), position: style.position, zIndex: style.zIndex, rect: box };
      if (style.position === "sticky") {
        sticky.push(entry);
      } else if (style.position === "fixed") {
        fixed.push(entry);
      } else if (style.position === "absolute") {
        absolute.push(entry);
      }

      var clip = tileClip;
      var clipPath = "#tile";
      var clipFound = false;
      var scrollExempt = false;
      var scrollAncestor = null;
      var content = null;
      var srOnly = false;
      var ancestor = element.parentElement;
      while (ancestor && ancestor !== tile) {
        var ancestorStyle = getComputedStyle(ancestor);
        if (isScreenReaderOnly(ancestorStyle)) {
          srOnly = true;
        }
        if (isClipper(ancestor, ancestorStyle)) {
          if (isScroller(ancestor, ancestorStyle)) {
            scrollExempt = true;
            scrollAncestor = pathOf(ancestor);
            content = contentBoxWithin(ancestor, ancestorStyle, box);
            break;
          }
          clip = intersect(clip, paddingBoxOf(ancestor, ancestorStyle));
          if (!clipFound) {
            clipPath = pathOf(ancestor);
            clipFound = true;
          }
        }
        ancestor = ancestor.parentElement;
      }

      elements.push({
        path: pathOf(element),
        rect: box,
        clip: clip,
        clipPath: clipPath,
        rendered: rendered,
        scrollExempt: scrollExempt,
        scrollAncestor: scrollAncestor,
        content: content,
        srOnly: srOnly
      });
    });

    // Node text against the card drawn for it. This is where an RTL double flip
    // shows up: the x coordinate is mirrored by the layout and the anchor is
    // flipped again by direction:rtl, so the label leaves its own card.
    var textPairs = [];
    Array.prototype.slice.call(tile.querySelectorAll(".atlyn-node")).forEach(function (group) {
      var card = group.querySelector(".atlyn-node-card");
      if (!card) {
        return;
      }
      var ownerRect = rectOf(card);
      Array.prototype.slice
        .call(group.querySelectorAll(".atlyn-node-label, .atlyn-node-subtitle"))
        .forEach(function (text) {
          textPairs.push({
            path: pathOf(text),
            ownerPath: pathOf(card),
            text: (text.textContent || "").slice(0, 40),
            textRect: rectOf(text),
            ownerRect: ownerRect
          });
        });
    });

    var canvas = tile.querySelector(".atlyn-canvas-wrap");
    var rootStyle = getComputedStyle(root);

    // How close the widest drawn label comes to filling the space its card
    // reserves. The card is sized from an estimated glyph advance, so this is
    // the headroom the estimate has left for a font stack with wider metrics -
    // a Linux CI runner without Arial, for instance. Near 1.0 means the next
    // font substitution overflows.
    var worstFill = 0;
    var worstFillPath = null;
    textPairs.forEach(function (pair) {
      var available = pair.ownerRect.width - 16;
      if (available <= 0 || pair.textRect.width <= 0) {
        return;
      }
      var ratio = pair.textRect.width / available;
      if (ratio > worstFill) {
        worstFill = ratio;
        worstFillPath = pair.path;
      }
    });

    var active = document.activeElement && tile.contains(document.activeElement) ? document.activeElement : null;
    var activeClip = active ? clippingBoxOf(active) : null;

    return {
      tile: tileClip,
      root: rectOf(root),
      rootPath: pathOf(root),
      rootPosition: rootStyle.position,
      rootOverflow: rootStyle.overflowX + "/" + rootStyle.overflowY,
      styled: rootStyle.display === "flex",
      density: root.dataset.density || "(unset)",
      counts: {
        elements: elements.length,
        sticky: sticky.length,
        fixed: fixed.length,
        absolute: absolute.length,
        scrollRegions: scrollRegions.length,
        cards: tile.querySelectorAll(".atlyn-node-card").length,
        treeItems: tile.querySelectorAll('[role="treeitem"]').length
      },
      sticky: sticky,
      fixed: fixed,
      absolute: absolute,
      elements: elements,
      scrollRegions: scrollRegions,
      hiddenScrollRegions: hiddenScrollRegions,
      screenReaderRegions: screenReaderRegions,
      textPairs: textPairs,
      textFit: { worstFill: worstFill, worstFillPath: worstFillPath },
      regions: [
        namedRegion(root, "visual root"),
        namedRegion(tile.querySelector(".atlyn-toolbar"), "toolbar"),
        namedRegion(canvas, "drawing canvas"),
        namedRegion(tile.querySelector(".atlyn-graph"), "graph"),
        namedRegion(tile.querySelector(".atlyn-semantic-tree"), "accessible tree"),
        namedRegion(tile.querySelector(".atlyn-status"), "status strip"),
        namedRegion(tile.querySelector(".atlyn-breadcrumb"), "breadcrumb"),
        namedRegion(tile.querySelector(".atlyn-diagnostics"), "diagnostics")
      ].filter(Boolean),
      focus: {
        activePath: active ? pathOf(active) : null,
        activeRect: active ? rectOf(active) : null,
        visibleBox: activeClip ? activeClip.rect : null,
        visibleBoxPath: activeClip ? activeClip.path : null,
        insideTree: Boolean(active && active.closest && active.closest('[role="tree"]'))
      }
    };
  };
})();
