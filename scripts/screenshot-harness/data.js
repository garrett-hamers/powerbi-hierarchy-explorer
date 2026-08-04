/*
 * Offline datasets for the AppSource submission screenshots.
 *
 * Every row is literal, inline data - the harness makes no network or data
 * source connection of any kind. The company and team names are invented for
 * the listing. Subtitle carries the formatted measure so revenue and headcount
 * are legible on the node cards; the Value and Tooltips roles are bound to the
 * real underlying numbers as a report author would bind them.
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
      input: {}
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
      }
    },
    {
      id: "03-search-diagnostics",
      caption:
        "Search highlights every matching node in place, and malformed rows are reported rather than dropped - here a division whose parent is missing from the table.",
      dataView: dataView(ORG.concat(ORPHAN)),
      input: { type: { selector: ".atlyn-search", text: "enterprise" } }
    }
  ];
})();
