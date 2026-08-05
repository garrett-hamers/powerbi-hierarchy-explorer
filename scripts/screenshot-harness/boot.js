/*
 * Mounts the packaged visual and exposes the small primitives the capture
 * script drives.
 *
 * The visual is created through the plugin the packaged bundle registers on
 * window.powerbi.visuals.plugins. Beyond entering the accessible tree - the
 * equivalent of a keyboard user pressing Tab - every interaction is native input
 * sent by Playwright, so no state is ever set by reaching into the visual's
 * internals. What gets captured is what a report author would see.
 */
(function () {
  "use strict";

  var mounted = null;

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

  function requireElement(selector) {
    var element = document.querySelector(selector);
    if (!element) {
      throw new Error("expected element " + selector + " to be present");
    }
    return element;
  }

  function findScenario(scenarioId) {
    var scenario = (window.ATLYN_SCENARIOS || []).filter(function (candidate) {
      return candidate.id === scenarioId;
    })[0];
    if (!scenario) {
      throw new Error("unknown scenario: " + scenarioId);
    }
    return scenario;
  }

  window.__atlynMount = function mount(scenarioId) {
    var scenario = findScenario(scenarioId);
    if (mounted) {
      mounted.destroy();
      mounted = null;
    }

    document.getElementById("caption").textContent = scenario.caption;

    var element = requireElement("#visual-host");
    element.replaceChildren();

    var bounds = element.getBoundingClientRect();
    var viewport = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    var visual = findPlugin().create({ element: element, host: window.__atlynCreateHost() });

    visual.update({
      dataViews: [scenario.dataView],
      viewport: viewport,
      type: 2,
      viewMode: 1,
      editMode: 0,
      isInFocus: false
    });
    mounted = visual;
    return viewport;
  };

  // Entering the tree is what Tab does in a real host; from there the capture
  // script sends arrow keys, which the visual handles itself.
  window.__atlynEnterTree = function enterTree() {
    var first = document.querySelector('[role="treeitem"]');
    if (!first) {
      throw new Error("the visual rendered no tree items to focus");
    }
    first.focus();
    return first.getAttribute("data-semantic-node-id");
  };

  /*
   * Measurement, not judgement. __atlynProbe reports what is actually on the
   * screen a frame before the shutter opens; each scenario in data.js decides
   * what that has to look like for the scene it claims to show.
   *
   * Geometry is measured, not inferred from the DOM, because presence in the
   * DOM is not evidence of a render: an element can exist for the whole life of
   * a broken build and still lay out at zero height, and querySelector would
   * find it every time.
   */

  function box(element) {
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

  // Real size, and inside the box the screenshot actually shows. A half-pixel of
  // slack absorbs subpixel layout without letting anything genuinely clipped
  // through.
  function isDrawnWithin(inner, outer) {
    return (
      inner.width > 0 &&
      inner.height > 0 &&
      inner.left >= outer.left - 0.5 &&
      inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5
    );
  }

  function list(scope, selector) {
    return Array.prototype.slice.call(scope.querySelectorAll(selector));
  }

  function distinct(values) {
    return values.filter(function (value, index) {
      return values.indexOf(value) === index;
    }).length;
  }

  function probeGraph(element, viewport) {
    var groups = list(element, ".atlyn-node");
    var cards = [];
    var offscreen = [];
    var undersized = [];
    var lefts = [];
    var tops = [];
    groups.forEach(function (group) {
      var card = group.querySelector(".atlyn-node-card");
      if (!card) {
        return;
      }
      var id = group.getAttribute("data-node-id") || "(unidentified)";
      var measured = box(card);
      cards.push(id);
      lefts.push(Math.round(measured.left));
      tops.push(Math.round(measured.top));
      if (measured.width < 1 || measured.height < 1) {
        undersized.push(id + " " + Math.round(measured.width) + "x" + Math.round(measured.height));
      } else if (!isDrawnWithin(measured, viewport)) {
        offscreen.push(id);
      }
    });

    // A label that laid out to nothing means the text never reached the canvas,
    // even though the <text> node is right there in the markup.
    var blankLabels = [];
    list(element, ".atlyn-node-label").forEach(function (label) {
      var measured = box(label);
      if (measured.width < 1 || measured.height < 1 || (label.textContent || "").trim() === "") {
        blankLabels.push(
          (label.parentNode && label.parentNode.getAttribute("data-node-id")) || "(unidentified)"
        );
      }
    });

    return {
      cards: cards.length,
      edges: list(element, ".atlyn-edge").length,
      labels: list(element, ".atlyn-node-label").length,
      subtitles: list(element, ".atlyn-node-subtitle").length,
      // Depth runs across the canvas, so a distinct left edge is a distinct
      // level of the hierarchy.
      depthColumns: distinct(lefts),
      rows: distinct(tops),
      undersizedCards: undersized,
      offscreenCards: offscreen,
      blankLabels: blankLabels
    };
  }

  function probeTree(element, root) {
    var tree = element.querySelector(".atlyn-semantic-tree");
    if (!tree) {
      return { present: false };
    }
    var treeBox = box(tree);
    var focused = document.activeElement;
    var focusedItem = focused && focused.closest ? focused.closest('[role="treeitem"]') : null;
    var collapsedRows = [];
    var expandedRows = [];
    var flatRows = [];
    var offscreenRows = [];
    list(element, '[role="treeitem"]').forEach(function (item) {
      var id = item.getAttribute("data-semantic-node-id") || "(unidentified)";
      var state = item.getAttribute("aria-expanded");
      if (state === "true") {
        expandedRows.push(id);
      } else if (state === "false") {
        collapsedRows.push(id);
      }
      // Only meaningful once the tree is on screen: off screen it is a 1px
      // clipped region by design, and every row inside it measures zero.
      if (treeBox.height > 1) {
        var measured = box(item);
        if (measured.height < 1 || measured.width < 1) {
          flatRows.push(id);
        } else if (!isDrawnWithin(measured, treeBox)) {
          offscreenRows.push(id);
        }
      }
    });

    return {
      present: true,
      // The tree is a 1px clipped region until focus pulls it into the flow.
      onScreen: tree.matches(":focus-within") && treeBox.height > 1,
      height: Math.round(treeBox.height),
      width: Math.round(treeBox.width),
      withinVisual: treeBox.height <= 1 || isDrawnWithin(treeBox, root),
      rows: list(element, '[role="treeitem"]').length,
      expandedRows: expandedRows,
      collapsedRows: collapsedRows,
      flatRows: flatRows,
      offscreenRows: offscreenRows,
      toggles: list(element, ".atlyn-semantic-toggle").length,
      focusedRow: focusedItem ? focusedItem.getAttribute("data-semantic-node-id") : null,
      focusedRowOnScreen: Boolean(focusedItem) && isDrawnWithin(box(focusedItem), treeBox)
    };
  }

  function probeSearch(element, viewport) {
    var input = element.querySelector(".atlyn-search");
    var offscreen = [];
    var undersized = [];
    var matches = list(element, '[data-search-match="true"]');
    matches.forEach(function (card) {
      var id = (card.parentNode && card.parentNode.getAttribute("data-node-id")) || "(unidentified)";
      var measured = box(card);
      if (measured.width < 1 || measured.height < 1) {
        undersized.push(id);
      } else if (!isDrawnWithin(measured, viewport)) {
        offscreen.push(id);
      }
    });
    return {
      value: input ? input.value : null,
      matches: matches.length,
      undersizedMatches: undersized,
      offscreenMatches: offscreen
    };
  }

  function probeDiagnostics(element, root) {
    var panel = element.querySelector(".atlyn-diagnostics");
    var lines = list(element, ".atlyn-diagnostic");
    var panelBox = panel ? box(panel) : { width: 0, height: 0 };
    return {
      present: Boolean(panel),
      hidden: panel ? panel.hidden : true,
      height: Math.round(panelBox.height),
      withinVisual: Boolean(panel) && isDrawnWithin(panelBox, root),
      lines: lines.length,
      // Height is measured per line: a message the reader cannot see is the
      // same defect as a message that was never written.
      unreadableLines: lines.filter(function (line) {
        var measured = box(line);
        return measured.height < 1 || measured.width < 1 || (line.textContent || "").trim() === "";
      }).length,
      texts: lines.map(function (line) {
        return (line.textContent || "").trim();
      })
    };
  }

  window.__atlynProbe = function probe() {
    var element = requireElement("#visual-host");
    var root = element.querySelector(".atlyn-root");
    if (!root) {
      throw new Error("the visual did not render its root element");
    }
    var rootBox = box(root);
    var canvas = element.querySelector(".atlyn-canvas-wrap");
    // The canvas scrolls, so it - not the root - is what clips the drawing.
    var viewport = canvas ? box(canvas) : rootBox;
    var breadcrumb = element.querySelector(".atlyn-breadcrumb");
    var status = element.querySelector(".atlyn-status");
    var empty = element.querySelector(".atlyn-empty");

    return {
      // .atlyn-root is a flex column only when the packaged stylesheet applied,
      // so an unstyled capture cannot pass itself off as a styled one.
      styled: getComputedStyle(root).display === "flex",
      root: { width: Math.round(rootBox.width), height: Math.round(rootBox.height) },
      canvas: {
        present: Boolean(canvas),
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        scrollableBy: canvas ? Math.max(0, canvas.scrollHeight - canvas.clientHeight) : 0
      },
      graph: probeGraph(element, viewport),
      tree: probeTree(element, rootBox),
      search: probeSearch(element, viewport),
      diagnostics: probeDiagnostics(element, rootBox),
      breadcrumb: breadcrumb ? (breadcrumb.textContent || "").trim() : "",
      status: status ? (status.textContent || "").trim() : "",
      emptyMessage: empty && !empty.hidden ? (empty.textContent || "").trim() : ""
    };
  };

  // Applies to every scene. It is deliberately thin: it only establishes that a
  // styled visual of real size exists, which is the floor beneath every scene's
  // own expectations rather than a substitute for them.
  function assertRendered(probe, fail) {
    if (!probe.styled) {
      fail("the packaged stylesheet did not apply, so the capture would show an unstyled visual");
    }
    if (probe.root.width < 200 || probe.root.height < 200) {
      fail("the visual rendered at " + probe.root.width + "x" + probe.root.height + ", too small to be a screenshot of the product");
    }
    if (probe.emptyMessage) {
      fail('the visual rendered its empty state: "' + probe.emptyMessage + '"');
    }
  }

  window.__atlynAssertScene = function assertScene(scenarioId) {
    var scenario = findScenario(scenarioId);
    var probe = window.__atlynProbe();
    var failures = [];
    var fail = function (message) {
      failures.push(message);
    };

    assertRendered(probe, fail);
    if (typeof scenario.assert !== "function") {
      fail("the scenario declares no content expectations, so nothing about this screenshot is verified");
    } else {
      scenario.assert(probe, fail);
    }

    return { probe: probe, failures: failures };
  };
})();
