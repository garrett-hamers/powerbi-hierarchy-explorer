/*
 * Offline datasets and per-scene content expectations for the AppSource
 * submission screenshots.
 *
 * Every row is literal, inline data - the harness makes no network or data
 * source connection of any kind. The company and team names are invented for
 * the listing. Subtitle carries the formatted measure so revenue and headcount
 * are legible on the node cards; the Value and Tooltips roles are bound to the
 * real underlying numbers as a report author would bind them.
 *
 * Each scenario also carries an `assert` function. It runs against the measured
 * page a frame before the shutter opens, and the capture refuses to write the
 * PNG unless it passes. The expectations are per scene on purpose: each of the
 * three demonstrates something different, and a check general enough to cover
 * all three would confirm none of them.
 */
(function () {
  "use strict";

  var COLUMNS = [
    { displayName: "Node ID", roles: { NodeId: true }, type: { text: true } },
    { displayName: "Parent ID", roles: { ParentId: true }, type: { text: true } },
    { displayName: "Team", roles: { Label: true }, type: { text: true } },
    { displayName: "Detail", roles: { Subtitle: true }, type: { text: true } },
    { displayName: "Level", roles: { Category: true }, type: { text: true } },
    { displayName: "Revenue", roles: { Value: true }, type: { numeric: true } },
    { displayName: "Headcount", roles: { Tooltips: true }, type: { numeric: true } }
  ];

  // [NodeId, ParentId, Label, Subtitle, Category, Value, Tooltip]
  var ORG = [
    ["ops", null, "Meridian Worldwide", "All regions \u00b7 $48.2M \u00b7 1,284 people", "Company", 48200000, 1284],
    ["na", "ops", "North America", "Region \u00b7 $21.4M \u00b7 512 people", "Region", 21400000, 512],
    ["emea", "ops", "Europe & Middle East", "Region \u00b7 $16.9M \u00b7 448 people", "Region", 16900000, 448],
    ["apac", "ops", "Asia Pacific", "Region \u00b7 $9.9M \u00b7 324 people", "Region", 9900000, 324],
    ["na-ent", "na", "Enterprise Sales", "Division \u00b7 $12.6M \u00b7 214 people", "Division", 12600000, 214],
    ["na-com", "na", "Commercial Sales", "Division \u00b7 $8.8M \u00b7 298 people", "Division", 8800000, 298],
    ["eu-ent", "emea", "Enterprise Sales", "Division \u00b7 $10.1M \u00b7 205 people", "Division", 10100000, 205],
    ["eu-com", "emea", "Commercial Sales", "Division \u00b7 $6.8M \u00b7 243 people", "Division", 6800000, 243],
    ["ap-ent", "apac", "Enterprise Sales", "Division \u00b7 $9.9M \u00b7 324 people", "Division", 9900000, 324],
    ["na-ne", "na-ent", "Northeast Team", "Team \u00b7 $7.1M \u00b7 118 people", "Team", 7100000, 118],
    ["na-w", "na-ent", "West Team", "Team \u00b7 $5.5M \u00b7 96 people", "Team", 5500000, 96],
    ["eu-dach", "eu-ent", "DACH Team", "Team \u00b7 $5.9M \u00b7 112 people", "Team", 5900000, 112],
    ["eu-uki", "eu-ent", "UK & Ireland Team", "Team \u00b7 $4.2M \u00b7 93 people", "Team", 4200000, 93]
  ];

  var PODS = [
    ["na-ne-ren", "na-ne", "Renewals Pod", "Pod \u00b7 $2.4M \u00b7 41 people", "Pod", 2400000, 41],
    ["na-ne-new", "na-ne", "New Business Pod", "Pod \u00b7 $4.7M \u00b7 77 people", "Pod", 4700000, 77]
  ];

  // A ParentId that no row declares. The visual reports it as an orphan and
  // renders it as a disconnected root instead of silently dropping the row.
  var ORPHAN = [
    ["ap-com", "apac-legacy", "Commercial Sales", "Division \u00b7 $3.1M \u00b7 87 people", "Division", 3100000, 87]
  ];

  var dataView = function (rows) {
    return { table: { columns: COLUMNS, rows: rows } };
  };

  window.ATLYN_SCENARIOS = [
    {
      id: "01-hierarchy-overview",
      caption:
        "Five levels of an explicit parent-child table, laid out so every parent sits over its children. Revenue and headcount stay on the card.",
      dataView: dataView(ORG.concat(PODS)),
      input: {},
      /*
       * What this screenshot claims: every row in the table above reached the
       * canvas, joined to its parent, across the five levels the caption
       * promises, with the measure text on each card.
       *
       * Counts come from the data: 15 rows, 14 of them with a parent, and a
       * deepest path of ops > na > na-ent > na-ne > na-ne-ren. Depth runs across
       * the canvas, so five levels means five distinct card columns.
       */
      assert: function (probe, fail) {
        var graph = probe.graph;
        if (graph.cards !== 15) {
          fail("expected all 15 rows on the canvas, found " + graph.cards + " node cards");
        }
        if (graph.edges !== 14) {
          fail(
            "expected 14 parent-child connectors, found " +
              graph.edges +
              "; the hierarchy is not joined up, so the layout claim is not shown"
          );
        }
        if (graph.depthColumns !== 5) {
          fail(
            "expected the five levels the caption promises, found " +
              graph.depthColumns +
              " distinct card columns"
          );
        }
        if (graph.labels !== 15 || graph.subtitles !== 15) {
          fail(
            "expected a label and a measure subtitle on all 15 cards, found " +
              graph.labels +
              " labels and " +
              graph.subtitles +
              " subtitles"
          );
        }
        if (graph.blankLabels.length > 0) {
          fail("node labels laid out to nothing: " + graph.blankLabels.join(", "));
        }
        if (graph.undersizedCards.length > 0) {
          fail("node cards rendered with no visible size: " + graph.undersizedCards.join(", "));
        }
        if (graph.offscreenCards.length > 0) {
          fail(
            "node cards fall outside the canvas the screenshot shows: " + graph.offscreenCards.join(", ")
          );
        }
        if (probe.tree.onScreen) {
          fail("the accessible tree pane is open; this scene is the canvas overview, not the tree");
        }
        if (probe.diagnostics.lines !== 0) {
          fail(
            "this scene binds well-formed data but the visual reported " +
              probe.diagnostics.lines +
              " diagnostics: " +
              probe.diagnostics.texts.join(" | ")
          );
        }
        if (!/(^|\D)15 visible(\D|$)/.test(probe.status)) {
          fail('the status strip does not report 15 visible nodes: "' + probe.status + '"');
        }
      }
    },
    {
      id: "02-expand-collapse",
      caption:
        "The accessible tree opens on keyboard focus. Arrow keys walk the hierarchy and collapse branches in place, and the breadcrumb follows the focused node.",
      dataView: dataView(ORG.concat(PODS)),
      // Tab into the tree, then drive it exactly as a keyboard user would:
      // ArrowDown walks the visible order, ArrowLeft collapses the focused
      // branch. Visible order is depth-first with children sorted by NodeId.
      input: {
        enterTree: true,
        keys: [
          "ArrowDown", // apac
          "ArrowLeft", // collapse apac
          "ArrowDown", // emea
          "ArrowDown", // eu-com
          "ArrowDown", // eu-ent
          "ArrowLeft", // collapse eu-ent
          "ArrowDown", // na
          "ArrowDown", // na-com
          "ArrowDown", // na-ent
          "ArrowLeft", // collapse na-ent
          "ArrowUp" //    settle on na-com
        ]
      },
      /*
       * What this screenshot claims: the tree pane is genuinely open and
       * readable, three named branches are collapsed while others stay open,
       * and the breadcrumb tracks the focused row.
       *
       * The height floor is the assertion that matters most here. The pane is a
       * 1px clipped region until focus pulls it into the flow, so it is present
       * in the DOM, with all its rows, for the entire time it is invisible. Only
       * a measured height separates the open pane from the collapsed one.
       */
      assert: function (probe, fail) {
        var tree = probe.tree;
        if (!tree.onScreen) {
          fail("the accessible tree never opened, so the scene shows the canvas rather than the tree");
        }
        if (tree.height < 80) {
          fail(
            "the tree pane rendered " +
              tree.height +
              "px tall; below 80px it is not legibly open in the screenshot"
          );
        }
        if (!tree.withinVisual) {
          fail("the tree pane is not fully inside the visual's box, so part of it is cut off");
        }
        if (tree.flatRows.length > 0) {
          fail("tree rows present in the DOM but rendered with no height: " + tree.flatRows.join(", "));
        }
        if (tree.offscreenRows.length > 0) {
          fail("tree rows fall outside the visible pane: " + tree.offscreenRows.join(", "));
        }

        var collapsed = tree.collapsedRows.slice().sort().join(", ");
        if (collapsed !== "apac, eu-ent, na-ent") {
          fail(
            "expected the branches apac, eu-ent, na-ent to be collapsed, found [" +
              collapsed +
              "]; the tree is not in the partially expanded state the scene demonstrates"
          );
        }
        if (tree.expandedRows.length === 0) {
          fail("every branch is collapsed, so the screenshot shows no expanded state to contrast against");
        }
        if (tree.rows !== 8) {
          fail(
            "expected 8 visible rows once three branches are collapsed, found " +
              tree.rows +
              " of the 15 nodes bound"
          );
        }
        if (probe.graph.cards !== tree.rows) {
          fail(
            "the canvas shows " +
              probe.graph.cards +
              " cards but the tree shows " +
              tree.rows +
              " rows; the collapse did not reach the canvas"
          );
        }

        if (tree.focusedRow !== "na-com") {
          fail("expected focus to settle on na-com, found " + (tree.focusedRow || "no focused row"));
        }
        if (!tree.focusedRowOnScreen) {
          fail("the focused row is scrolled out of the visible pane, so the screenshot does not show it");
        }
        if (probe.breadcrumb.indexOf("Meridian Worldwide / North America / Commercial Sales") === -1) {
          fail('the breadcrumb did not follow focus into the hierarchy: "' + probe.breadcrumb + '"');
        }
      }
    },
    {
      id: "03-search-diagnostics",
      caption:
        "Search highlights every matching node in place, and malformed rows are reported rather than dropped - here a division whose parent is missing from the table.",
      dataView: dataView(ORG.concat(ORPHAN)),
      input: { type: { selector: ".atlyn-search", text: "enterprise" } },
      /*
       * What this screenshot claims: the typed term reached the visual's own
       * search box, all three Enterprise Sales divisions are highlighted where
       * they sit, and the orphaned row is reported in a legible diagnostics
       * strip instead of being dropped.
       *
       * A tree that renders perfectly proves none of that, so every assertion
       * below is about the search result or the diagnostic output.
       */
      assert: function (probe, fail) {
        var search = probe.search;
        if (search.value !== "enterprise") {
          fail('the search box holds "' + search.value + '" rather than "enterprise"');
        }
        if (search.matches !== 3) {
          fail(
            "expected the three Enterprise Sales divisions to be highlighted, found " +
              search.matches +
              " highlighted cards"
          );
        }
        if (search.undersizedMatches.length > 0) {
          fail("highlighted cards rendered with no visible size: " + search.undersizedMatches.join(", "));
        }
        if (search.offscreenMatches.length > 0) {
          fail(
            "highlighted cards fall outside the canvas the screenshot shows: " +
              search.offscreenMatches.join(", ")
          );
        }

        var diagnostics = probe.diagnostics;
        if (diagnostics.hidden || diagnostics.lines === 0) {
          fail("no diagnostics were reported, so the malformed row this scene exists to show is invisible");
        }
        if (diagnostics.height < 12) {
          fail(
            "the diagnostics strip rendered " + diagnostics.height + "px tall, too short to read in the screenshot"
          );
        }
        if (!diagnostics.withinVisual) {
          fail("the diagnostics strip is not fully inside the visual's box, so part of it is cut off");
        }
        if (diagnostics.unreadableLines > 0) {
          fail(diagnostics.unreadableLines + " diagnostic lines rendered blank or with no height");
        }
        var reportsOrphan = diagnostics.texts.some(function (text) {
          return text.indexOf("ap-com") !== -1;
        });
        if (!reportsOrphan) {
          fail(
            "no diagnostic names the orphaned row ap-com: " +
              (diagnostics.texts.join(" | ") || "(no diagnostic text)")
          );
        }

        if (probe.graph.cards !== 14) {
          fail(
            "expected all 14 rows on the canvas including the orphan, found " + probe.graph.cards + " node cards"
          );
        }
        if (probe.graph.edges !== 12) {
          fail(
            "expected 12 connectors for a two-root forest, found " +
              probe.graph.edges +
              "; the orphan is not being rendered as a disconnected root"
          );
        }
        if (probe.tree.onScreen) {
          fail("the accessible tree pane is open; this scene shows the canvas and the diagnostics strip");
        }
      }
    }
  ];
})();
