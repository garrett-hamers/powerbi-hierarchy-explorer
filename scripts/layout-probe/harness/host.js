/*
 * Minimal Power BI host for the layout probe.
 *
 * Deliberately a separate copy from scripts/screenshot-harness/host.js: the
 * probe must be able to vary locale and interaction capability per case, and
 * the screenshot harness is owned by the capture pipeline. Only the surface the
 * visual actually touches is implemented.
 */
(function () {
  "use strict";

  window.powerbi = window.powerbi || {};
  window.powerbi.visuals = window.powerbi.visuals || {};
  window.powerbi.visuals.plugins = window.powerbi.visuals.plugins || {};

  window.__probeCreateHost = function createHost(options) {
    var settings = options || {};
    var selectionManager = {
      select: function () {
        return Promise.resolve();
      },
      clear: function () {
        return Promise.resolve();
      },
      getSelectionIds: function () {
        return [];
      },
      showContextMenu: function () {
        return Promise.resolve();
      },
      registerOnSelectCallback: function () {}
    };

    return {
      locale: settings.locale || "en-US",
      hostCapabilities: { allowInteractions: true },
      colorPalette: {
        isHighContrast: false,
        foreground: { value: "#242424" },
        background: { value: "#ffffff" },
        foregroundSelected: { value: "#2764c4" }
      },
      createSelectionManager: function () {
        return selectionManager;
      },
      createSelectionIdBuilder: function () {
        var rowIndex;
        var builder = {
          withTable: function (table, index) {
            rowIndex = index;
            return builder;
          },
          createSelectionId: function () {
            return { key: rowIndex === undefined ? "empty" : "row-" + rowIndex };
          }
        };
        return builder;
      },
      createLocalizationManager: function () {
        return {
          getDisplayName: function (key) {
            return key;
          }
        };
      },
      tooltipService: {
        enabled: function () {
          return false;
        },
        show: function () {},
        move: function () {},
        hide: function () {}
      },
      eventService: {
        renderingStarted: function () {},
        renderingFinished: function () {},
        renderingFailed: function () {}
      },
      fetchMoreData: function () {
        return false;
      }
    };
  };
})();
