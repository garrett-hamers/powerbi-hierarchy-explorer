import powerbi from "powerbi-visuals-api";

export type LayoutDirection = "auto" | "ltr" | "rtl";

export interface FormattingValues {
  direction: LayoutDirection;
  nodeWidth: number;
  nodeHeight: number;
  horizontalGap: number;
  verticalGap: number;
  padding: number;
  zoom: number;
  fitContent: boolean;
  backgroundColor: string;
  nodeColor: string;
  selectedColor: string;
  edgeColor: string;
  labelColor: string;
  subtitleColor: string;
  fontFamily: string;
  fontSize: number;
  subtitleFontSize: number;
  edgeWidth: number;
  showDiagnostics: boolean;
  enableSearch: boolean;
  enableCollapse: boolean;
  enableDescendantSelection: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_FORMATTING: FormattingValues = {
  direction: "auto",
  nodeWidth: 156,
  nodeHeight: 48,
  horizontalGap: 38,
  verticalGap: 14,
  padding: 12,
  zoom: 1,
  fitContent: true,
  backgroundColor: "#ffffff",
  nodeColor: "#ffffff",
  selectedColor: "#2764c4",
  edgeColor: "#d9dce1",
  labelColor: "#242424",
  subtitleColor: "#5f6368",
  fontFamily: "Arial, sans-serif",
  fontSize: 12,
  subtitleFontSize: 10,
  edgeWidth: 1.5,
  showDiagnostics: true,
  enableSearch: true,
  enableCollapse: true,
  enableDescendantSelection: true,
  reducedMotion: false
};

type PropertyValue = powerbi.DataViewPropertyValue | undefined;
type Localize = (key: string, fallback: string) => string;

function objectProperty(
  objects: powerbi.DataViewObjects | undefined,
  objectName: string,
  propertyName: string
): PropertyValue {
  const object = objects?.[objectName];
  return object?.[propertyName];
}

function stringValue(value: PropertyValue, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function numberValue(value: PropertyValue, fallback: number, min: number, max: number): number {
  const candidate = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, candidate));
}

function booleanValue(value: PropertyValue, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function colorValue(value: PropertyValue, fallback: string): string {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const solid = (value as { solid?: unknown }).solid;
  if (!solid || typeof solid !== "object") {
    return fallback;
  }
  const color = (solid as { color?: unknown }).color;
  return typeof color === "string" && color.trim().length > 0 && isSafeCssValue(color) ? color : fallback;
}

function isSafeCssValue(value: string): boolean {
  return !/(?:url\s*\(|expression\s*\(|javascript:|@import|[{};<>\r\n])/i.test(value);
}

function fontFamilyValue(value: PropertyValue, fallback: string): string {
  if (typeof value !== "string" || !value.trim() || !isSafeCssValue(value)) {
    return fallback;
  }
  return /^[\w\s'",-]+$/.test(value) ? value : fallback;
}

function readColor(
  objects: powerbi.DataViewObjects | undefined,
  objectName: string,
  propertyName: string,
  fallback: string
): string {
  return colorValue(objectProperty(objects, objectName, propertyName), fallback);
}

export function readFormattingValues(dataView?: powerbi.DataView): FormattingValues {
  const objects = dataView?.metadata?.objects;
  const values: FormattingValues = {
    ...DEFAULT_FORMATTING,
    direction: stringValue(
      objectProperty(objects, "layout", "direction"),
      DEFAULT_FORMATTING.direction
    ) as LayoutDirection,
    nodeWidth: numberValue(
      objectProperty(objects, "layout", "nodeWidth"),
      DEFAULT_FORMATTING.nodeWidth,
      96,
      320
    ),
    nodeHeight: numberValue(
      objectProperty(objects, "layout", "nodeHeight"),
      DEFAULT_FORMATTING.nodeHeight,
      32,
      140
    ),
    horizontalGap: numberValue(
      objectProperty(objects, "layout", "horizontalGap"),
      DEFAULT_FORMATTING.horizontalGap,
      8,
      160
    ),
    verticalGap: numberValue(
      objectProperty(objects, "layout", "verticalGap"),
      DEFAULT_FORMATTING.verticalGap,
      4,
      96
    ),
    padding: numberValue(
      objectProperty(objects, "layout", "padding"),
      DEFAULT_FORMATTING.padding,
      4,
      64
    ),
    zoom: numberValue(
      objectProperty(objects, "layout", "zoom"),
      DEFAULT_FORMATTING.zoom,
      0.5,
      2.5
    ),
    fitContent: booleanValue(
      objectProperty(objects, "layout", "fitContent"),
      DEFAULT_FORMATTING.fitContent
    ),
    backgroundColor: readColor(
      objects,
      "colors",
      "backgroundColor",
      DEFAULT_FORMATTING.backgroundColor
    ),
    nodeColor: readColor(objects, "colors", "nodeColor", DEFAULT_FORMATTING.nodeColor),
    selectedColor: readColor(
      objects,
      "colors",
      "selectedColor",
      DEFAULT_FORMATTING.selectedColor
    ),
    edgeColor: readColor(objects, "edges", "edgeColor", DEFAULT_FORMATTING.edgeColor),
    labelColor: readColor(objects, "typography", "labelColor", DEFAULT_FORMATTING.labelColor),
    subtitleColor: readColor(
      objects,
      "typography",
      "subtitleColor",
      DEFAULT_FORMATTING.subtitleColor
    ),
    fontFamily: fontFamilyValue(
      objectProperty(objects, "typography", "fontFamily"),
      DEFAULT_FORMATTING.fontFamily
    ),
    fontSize: numberValue(
      objectProperty(objects, "typography", "fontSize"),
      DEFAULT_FORMATTING.fontSize,
      8,
      32
    ),
    subtitleFontSize: numberValue(
      objectProperty(objects, "typography", "subtitleFontSize"),
      DEFAULT_FORMATTING.subtitleFontSize,
      7,
      24
    ),
    edgeWidth: numberValue(
      objectProperty(objects, "edges", "edgeWidth"),
      DEFAULT_FORMATTING.edgeWidth,
      1,
      6
    ),
    showDiagnostics: booleanValue(
      objectProperty(objects, "diagnostics", "showDiagnostics"),
      DEFAULT_FORMATTING.showDiagnostics
    ),
    enableSearch: booleanValue(
      objectProperty(objects, "interaction", "enableSearch"),
      DEFAULT_FORMATTING.enableSearch
    ),
    enableCollapse: booleanValue(
      objectProperty(objects, "interaction", "enableCollapse"),
      DEFAULT_FORMATTING.enableCollapse
    ),
    enableDescendantSelection: booleanValue(
      objectProperty(objects, "interaction", "enableDescendantSelection"),
      DEFAULT_FORMATTING.enableDescendantSelection
    ),
    reducedMotion: booleanValue(
      objectProperty(objects, "interaction", "reducedMotion"),
      DEFAULT_FORMATTING.reducedMotion
    )
  };
  if (!["auto", "ltr", "rtl"].includes(values.direction)) {
    values.direction = DEFAULT_FORMATTING.direction;
  }
  return values;
}

function descriptor(objectName: string, propertyName: string): powerbi.visuals.FormattingDescriptor {
  return { objectName, propertyName };
}

function numberSlice(
  objectName: string,
  propertyName: string,
  displayName: string,
  value: number,
  min: number,
  max: number
): powerbi.visuals.FormattingSlice {
  return {
    uid: `${objectName}_${propertyName}_slice`,
    displayName,
    control: {
      type: powerbi.visuals.FormattingComponent.NumUpDown,
      properties: {
        descriptor: descriptor(objectName, propertyName),
        value,
        options: {
          minValue: { type: powerbi.visuals.ValidatorType.Min, value: min },
          maxValue: { type: powerbi.visuals.ValidatorType.Max, value: max }
        }
      }
    }
  };
}

function colorSlice(
  objectName: string,
  propertyName: string,
  displayName: string,
  value: string
): powerbi.visuals.FormattingSlice {
  return {
    uid: `${objectName}_${propertyName}_slice`,
    displayName,
    control: {
      type: powerbi.visuals.FormattingComponent.ColorPicker,
      properties: {
        descriptor: descriptor(objectName, propertyName),
        value: { value }
      }
    }
  };
}

function toggleSlice(
  objectName: string,
  propertyName: string,
  displayName: string,
  value: boolean
): powerbi.visuals.FormattingSlice {
  return {
    uid: `${objectName}_${propertyName}_slice`,
    displayName,
    control: {
      type: powerbi.visuals.FormattingComponent.ToggleSwitch,
      properties: {
        descriptor: descriptor(objectName, propertyName),
        value
      }
    }
  };
}

function fontPickerSlice(
  objectName: string,
  propertyName: string,
  displayName: string,
  value: string
): powerbi.visuals.FormattingSlice {
  return {
    uid: `${objectName}_${propertyName}_slice`,
    displayName,
    control: {
      type: powerbi.visuals.FormattingComponent.FontPicker,
      properties: {
        descriptor: descriptor(objectName, propertyName),
        value
      }
    }
  };
}

function directionSlice(value: LayoutDirection, localize: Localize): powerbi.visuals.FormattingSlice {
  const items: powerbi.IEnumMember[] = [
    { value: "auto", displayName: localize("Format_Direction_Auto", "Automatic") },
    { value: "ltr", displayName: localize("Format_Direction_Ltr", "Left to right") },
    { value: "rtl", displayName: localize("Format_Direction_Rtl", "Right to left") }
  ];
  return {
    uid: "layout_direction_slice",
    displayName: localize("Format_Direction", "Layout direction"),
    control: {
      type: powerbi.visuals.FormattingComponent.Dropdown,
      properties: {
        descriptor: descriptor("layout", "direction"),
        value: items.find((item) => item.value === value) ?? items[0],
        items
      }
    }
  };
}

function card(
  name: string,
  displayName: string,
  groups: powerbi.visuals.FormattingGroup[],
  propertyNames: string[]
): powerbi.visuals.FormattingCard {
  return {
    uid: `${name}_card`,
    displayName,
    groups,
    revertToDefaultDescriptors: propertyNames.map((propertyName) => descriptor(name, propertyName))
  };
}

export function buildFormattingModel(
  values: FormattingValues,
  localize: Localize
): powerbi.visuals.FormattingModel {
  const layoutProperties = [
    "direction",
    "nodeWidth",
    "nodeHeight",
    "horizontalGap",
    "verticalGap",
    "padding",
    "zoom",
    "fitContent"
  ];
  const colorProperties = ["backgroundColor", "nodeColor", "selectedColor"];
  const typographyProperties = ["labelColor", "subtitleColor", "fontFamily", "fontSize", "subtitleFontSize"];
  const edgeProperties = ["edgeColor", "edgeWidth"];
  const interactionProperties = [
    "enableSearch",
    "enableCollapse",
    "enableDescendantSelection",
    "reducedMotion"
  ];
  return {
    cards: [
      card(
        "layout",
        localize("Format_Layout_Card", "Layout"),
        [
          {
            uid: "layout_geometry_group",
            displayName: localize("Format_Layout_Geometry", "Geometry"),
            slices: [
              directionSlice(values.direction, localize),
              numberSlice("layout", "nodeWidth", localize("Format_NodeWidth", "Node width"), values.nodeWidth, 96, 320),
              numberSlice("layout", "nodeHeight", localize("Format_NodeHeight", "Node height"), values.nodeHeight, 32, 140),
              numberSlice("layout", "horizontalGap", localize("Format_HorizontalGap", "Horizontal spacing"), values.horizontalGap, 8, 160),
              numberSlice("layout", "verticalGap", localize("Format_VerticalGap", "Vertical spacing"), values.verticalGap, 4, 96),
              numberSlice("layout", "padding", localize("Format_Padding", "Canvas padding"), values.padding, 4, 64),
              numberSlice("layout", "zoom", localize("Format_Zoom", "Zoom"), values.zoom, 0.5, 2.5),
              toggleSlice("layout", "fitContent", localize("Format_FitContent", "Fit labels to content"), values.fitContent)
            ]
          }
        ],
        layoutProperties
      ),
      card(
        "colors",
        localize("Format_Colors_Card", "Colors"),
        [
          {
            uid: "colors_nodes_group",
            displayName: localize("Format_Colors_Nodes", "Nodes"),
            slices: [
              colorSlice("colors", "backgroundColor", localize("Format_Background", "Background"), values.backgroundColor),
              colorSlice("colors", "nodeColor", localize("Format_NodeFill", "Node fill"), values.nodeColor),
              colorSlice("colors", "selectedColor", localize("Format_Selected", "Selected outline"), values.selectedColor)
            ]
          }
        ],
        colorProperties
      ),
      card(
        "typography",
        localize("Format_Typography_Card", "Typography"),
        [
          {
            uid: "typography_text_group",
            displayName: localize("Format_Typography_Text", "Text"),
            slices: [
              fontPickerSlice("typography", "fontFamily", localize("Format_FontFamily", "Font family"), values.fontFamily),
              numberSlice("typography", "fontSize", localize("Format_FontSize", "Label size"), values.fontSize, 8, 32),
              numberSlice("typography", "subtitleFontSize", localize("Format_SubtitleSize", "Subtitle size"), values.subtitleFontSize, 7, 24),
              colorSlice("typography", "labelColor", localize("Format_LabelColor", "Label color"), values.labelColor),
              colorSlice("typography", "subtitleColor", localize("Format_SubtitleColor", "Subtitle color"), values.subtitleColor)
            ]
          }
        ],
        typographyProperties
      ),
      card(
        "edges",
        localize("Format_Edges_Card", "Edges"),
        [
          {
            uid: "edges_style_group",
            displayName: localize("Format_Edges_Style", "Edge style"),
            slices: [
              colorSlice("edges", "edgeColor", localize("Format_EdgeColor", "Edge color"), values.edgeColor),
              numberSlice("edges", "edgeWidth", localize("Format_EdgeWidth", "Edge width"), values.edgeWidth, 1, 6)
            ]
          }
        ],
        edgeProperties
      ),
      card(
        "interaction",
        localize("Format_Interaction_Card", "Interaction"),
        [
          {
            uid: "interaction_behavior_group",
            displayName: localize("Format_Interaction_Behavior", "Behavior"),
            slices: [
              toggleSlice("interaction", "enableSearch", localize("Format_EnableSearch", "Enable search"), values.enableSearch),
              toggleSlice("interaction", "enableCollapse", localize("Format_EnableCollapse", "Enable collapse and expand"), values.enableCollapse),
              toggleSlice(
                "interaction",
                "enableDescendantSelection",
                localize("Format_EnableDescendants", "Enable descendant selection"),
                values.enableDescendantSelection
              ),
              toggleSlice("interaction", "reducedMotion", localize("Format_ReducedMotion", "Reduce motion"), values.reducedMotion)
            ]
          }
        ],
        interactionProperties
      ),
      card(
        "diagnostics",
        localize("Format_Diagnostics_Card", "Diagnostics"),
        [
          {
            uid: "diagnostics_display_group",
            displayName: localize("Format_Diagnostics_Display", "Display"),
            slices: [
              toggleSlice("diagnostics", "showDiagnostics", localize("Format_ShowDiagnostics", "Show data diagnostics"), values.showDiagnostics)
            ]
          }
        ],
        ["showDiagnostics"]
      )
    ]
  };
}
