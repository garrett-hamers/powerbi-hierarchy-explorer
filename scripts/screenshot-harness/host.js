/*
 * Mock Power BI host for offline screenshot capture.
 *
 * Only the surface the visual actually touches is implemented, mirroring the
 * harness already used by tests/visual.test.ts: locale, hostCapabilities,
 * colorPalette, createSelectionManager, createSelectionIdBuilder,
 * createLocalizationManager, tooltipService, eventService and fetchMoreData.
 *
 * The localization manager is backed by the real stringResources/en-US
 * resources.resjson, which the capture script injects as window.ATLYN_STRINGS,
 * so the captured chrome shows the same strings a real host resolves.
 */
(function () {
  "use strict";

  window.powerbi = window.powerbi || {};
  window.powerbi.visuals = window.powerbi.visuals || {};
  window.powerbi.visuals.plugins = window.powerbi.visuals.plugins || {};

  window.__atlynCreateHost = function createHost() {
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
      locale: "en-US",
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
            var strings = window.ATLYN_STRINGS || {};
            return Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : key;
          }
        };
      },
      // Power BI draws tooltips itself, so the harness deliberately renders
      // nothing here: faking host chrome would misrepresent the product.
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
      // The captured datasets are complete, so no further segments exist.
      fetchMoreData: function () {
        return false;
      }
    };
  };
})();
