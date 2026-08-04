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

  window.__atlynMount = function mount(scenarioId) {
    var scenario = (window.ATLYN_SCENARIOS || []).filter(function (candidate) {
      return candidate.id === scenarioId;
    })[0];
    if (!scenario) {
      throw new Error("unknown scenario: " + scenarioId);
    }

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

  window.__atlynSummary = function summary() {
    var element = requireElement("#visual-host");
    var root = element.querySelector(".atlyn-root");
    if (!root) {
      throw new Error("the visual did not render its root element");
    }
    // Guard against a silently unstyled capture: .atlyn-root is a flex column
    // only when the packaged stylesheet actually applied.
    if (getComputedStyle(root).display !== "flex") {
      throw new Error("the packaged stylesheet did not apply to the rendered visual");
    }

    // Everything the visual draws has to sit inside its own clipped bounds, or
    // the screenshot would quietly hide part of the product.
    var rootBottom = Math.round(root.getBoundingClientRect().bottom);
    var tree = element.querySelector(".atlyn-semantic-tree");
    var treeVisible = tree.matches(":focus-within");
    var treeBottom = Math.round(tree.getBoundingClientRect().bottom);
    if (treeVisible && treeBottom > rootBottom) {
      throw new Error(
        "the focused accessible tree overflows the visual bounds (" + treeBottom + " > " + rootBottom + ")"
      );
    }

    return {
      nodes: element.querySelectorAll(".atlyn-node").length,
      treeItems: element.querySelectorAll('[role="treeitem"]').length,
      treeVisible: treeVisible,
      searchMatches: element.querySelectorAll('[data-search-match="true"]').length,
      diagnostics: element.querySelectorAll(".atlyn-diagnostic").length,
      breadcrumb: (element.querySelector(".atlyn-breadcrumb") || {}).textContent || "",
      status: (element.querySelector(".atlyn-status") || {}).textContent || ""
    };
  };
})();
