/*
 * Offline datasets for the layout probe. Literal rows, no network, no data
 * source. Two shapes matter to layout:
 *
 *   org        an ordinary four-level hierarchy, enough nodes for the canvas to
 *              exceed every probed tile
 *   longLabels the same shape with labels long enough that node width hits its
 *              clamp, which is where text starts fighting its own card
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

  var ORG = [
    ["ops", null, "Meridian Worldwide", "All regions", "Company", 48200000, 1284],
    ["na", "ops", "North America", "Region", "Region", 21400000, 512],
    ["emea", "ops", "Europe & Middle East", "Region", "Region", 16900000, 448],
    ["apac", "ops", "Asia Pacific", "Region", "Region", 9900000, 324],
    ["na-ent", "na", "Enterprise Sales", "Division", "Division", 12600000, 214],
    ["na-com", "na", "Commercial Sales", "Division", "Division", 8800000, 298],
    ["eu-ent", "emea", "Enterprise Sales", "Division", "Division", 10100000, 205],
    ["eu-com", "emea", "Commercial Sales", "Division", "Division", 6800000, 243],
    ["ap-ent", "apac", "Enterprise Sales", "Division", "Division", 9900000, 324],
    ["na-ne", "na-ent", "Northeast Team", "Team", "Team", 7100000, 118],
    ["na-w", "na-ent", "West Team", "Team", "Team", 5500000, 96],
    ["eu-dach", "eu-ent", "DACH Team", "Team", "Team", 5900000, 112],
    ["eu-uki", "eu-ent", "UK & Ireland Team", "Team", "Team", 4200000, 93],
    ["na-ne-ren", "na-ne", "Renewals Pod", "Pod", "Pod", 2400000, 41],
    ["na-ne-new", "na-ne", "New Business Pod", "Pod", "Pod", 4700000, 77]
  ];

  var LONG = "Global Strategic Enterprise Accounts and Partner Alliances Organisation";
  var LONG_SUB = "Consolidated revenue, headcount and quota attainment for the trailing twelve months";
  var ARABIC = "\u0627\u0644\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0634\u0645\u0627\u0644\u064a\u0629 \u0644\u0644\u0645\u0628\u064a\u0639\u0627\u062a \u0648\u0627\u0644\u062a\u0633\u0648\u064a\u0642";

  var longLabels = ORG.map(function (row, index) {
    var copy = row.slice();
    copy[2] = LONG + " " + (index + 1);
    copy[3] = LONG_SUB;
    return copy;
  });

  var arabicLabels = ORG.map(function (row, index) {
    var copy = row.slice();
    copy[2] = ARABIC + " " + (index + 1);
    copy[3] = ARABIC;
    return copy;
  });

  var dataView = function (rows) {
    return {
      table: {
        columns: COLUMNS,
        rows: rows.map(function (row) {
          return row.slice();
        })
      }
    };
  };

  window.__probeFixtures = {
    org: function () {
      return dataView(ORG);
    },
    longLabels: function () {
      return dataView(longLabels);
    },
    arabicLabels: function () {
      return dataView(arabicLabels);
    },
    // Every node that has children, deepest first, so a caller can collapse the
    // whole tree by walking the list.
    parents: ["na-ne", "na-ent", "eu-ent", "na", "emea", "apac", "ops"]
  };
})();
