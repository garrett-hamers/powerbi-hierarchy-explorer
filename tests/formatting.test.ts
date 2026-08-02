import type powerbi from "powerbi-visuals-api";
import {
  buildFormattingModel,
  DEFAULT_FORMATTING,
  readFormattingValues
} from "../src/formatting";

function isSlice(
  slice: powerbi.visuals.FormattingSlice | powerbi.visuals.FormattingSlicePlaceholder
): slice is powerbi.visuals.FormattingSlice {
  return !("type" in slice);
}

describe("API 5.1 formatting model", () => {
  test("reads persisted formatting values with bounded defaults", () => {
    const values = readFormattingValues({
      metadata: {
        objects: {
          layout: {
            direction: "rtl",
            nodeWidth: 500,
            nodeHeight: 64,
            horizontalGap: 44,
            zoom: 4,
            fitContent: false
          },
          colors: {
            backgroundColor: { solid: { color: "#111111" } },
            nodeColor: { solid: { color: "url(https://example.invalid/font)" } }
          },
          interaction: {
            enableSearch: false
          },
          typography: {
            fontFamily: "url(https://example.invalid/font)"
          }
        }
      }
    } as any);

    expect(values.direction).toBe("rtl");
    expect(values.nodeWidth).toBe(320);
    expect(values.nodeHeight).toBe(64);
    expect(values.horizontalGap).toBe(44);
    expect(values.zoom).toBe(2.5);
    expect(values.fitContent).toBe(false);
    expect(values.backgroundColor).toBe("#111111");
    expect(values.nodeColor).toBe(DEFAULT_FORMATTING.nodeColor);
    expect(values.fontFamily).toBe(DEFAULT_FORMATTING.fontFamily);
    expect(values.enableSearch).toBe(false);
  });

  test("publishes cards and descriptors for all persisted behavior", () => {
    const model = buildFormattingModel(DEFAULT_FORMATTING, (_key, fallback) => fallback);
    const cards = model.cards.filter((card) => "groups" in card);
    expect(cards.map((card) => card.uid)).toEqual([
      "layout_card",
      "colors_card",
      "typography_card",
      "edges_card",
      "interaction_card",
      "diagnostics_card"
    ]);
    const slices = cards.flatMap((card) =>
      card.groups.flatMap((group) => ("type" in group ? [] : group.slices ?? []))
    );
    const descriptors = slices.filter(isSlice).map((slice) => slice.control.properties.descriptor);
    expect(descriptors).toEqual(
      expect.arrayContaining([
        { objectName: "layout", propertyName: "direction" },
        { objectName: "layout", propertyName: "zoom" },
        { objectName: "layout", propertyName: "fitContent" },
        { objectName: "colors", propertyName: "nodeColor" },
        { objectName: "typography", propertyName: "fontFamily" },
        { objectName: "edges", propertyName: "edgeWidth" },
        { objectName: "interaction", propertyName: "enableCollapse" },
        { objectName: "diagnostics", propertyName: "showDiagnostics" }
      ])
    );
  });
});
