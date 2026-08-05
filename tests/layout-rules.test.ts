/*
 * The layout rules, driven with measurements chosen to break them.
 *
 * These run under JSDOM like the rest of the suite, which is exactly why they
 * assert nothing about geometry the browser produces: JSDOM has no layout
 * engine, getBoundingClientRect returns zeros, and a containment assertion
 * written against it cannot fail. What runs here is the rule module in
 * isolation, fed numbers by hand. The numbers a real render produces are
 * measured in real Chromium by scripts/probe-layout.cjs, and every rule below
 * is shown to fire on a broken build by scripts/prove-layout-regressions.cjs.
 *
 * Each case supplies a measurement no correct render would ever produce, so the
 * rule is shown to catch something rather than merely shown to agree with a
 * render that happened to be fine.
 */
const rules = require("../scripts/layout-probe/rules.cjs");

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

const TILE = box(0, 0, 400, 300);

describe("escape arithmetic", () => {
  test("reports the escaping edges and the worst of them", () => {
    const escape = rules.escapeOf(box(-12, 10, 60, 20), TILE);
    expect(escape.left).toBeCloseTo(11.5);
    expect(escape.right).toBe(0);
    expect(escape.worst).toBeCloseTo(11.5);
  });

  test("absorbs sub-pixel layout without letting a real escape through", () => {
    expect(rules.isContained(box(-0.4, 0, 10, 10), TILE)).toBe(true);
    expect(rules.isContained(box(-0.6, 0, 10, 10), TILE)).toBe(false);
  });

  test("refuses measurements it cannot trust rather than scoring them zero", () => {
    expect(() => rules.escapeOf(box(NaN, 0, 10, 10), TILE)).toThrow(/finite number/);
    expect(() => rules.escapeOf({ left: 0, top: 0 } as any, TILE)).toThrow(/finite number/);
  });

  test("intersects to an empty box when two clips do not overlap", () => {
    const empty = rules.intersectRects(box(0, 0, 10, 10), box(50, 50, 10, 10));
    expect(empty.width).toBe(0);
    expect(empty.height).toBe(0);
  });
});

describe("root within tile", () => {
  test("catches a root taller than the tile the host gave it", () => {
    const found = rules.checkRootWithinTile({ tile: box(0, 0, 80, 80), root: box(0, 0, 80, 96) });
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.rootEscapesTile);
    expect(found[0].escape).toBeCloseTo(15.5);
    expect(found[0].detail).toContain("80x96");
  });

  test("passes a root that fills its tile exactly", () => {
    expect(rules.checkRootWithinTile({ tile: box(0, 0, 80, 80), root: box(0, 0, 80, 80) })).toEqual([]);
  });
});

describe("the escape walk", () => {
  const element = (overrides: Record<string, unknown> = {}) => ({
    path: "div.atlyn-root > nav.atlyn-breadcrumb",
    rect: box(0, 0, 100, 25),
    clip: TILE,
    clipPath: "div.atlyn-root",
    rendered: true,
    scrollExempt: false,
    srOnly: false,
    content: null,
    ...overrides
  });

  test("catches an element pushed past the bottom of its clip", () => {
    const found = rules.findEscapes([element({ rect: box(0, 290, 100, 25) })]);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.clippedEscape);
    expect(found[0].escape).toBeCloseTo(14.5);
  });

  test("ignores what a user can scroll to and catches what they cannot", () => {
    const reachable = element({
      scrollExempt: true,
      scrollAncestor: "div.atlyn-canvas-wrap",
      content: { left: 0, top: 900, right: 100, bottom: 925, scrollWidth: 400, scrollHeight: 1200 }
    });
    const unreachable = element({
      scrollExempt: true,
      scrollAncestor: "div.atlyn-canvas-wrap",
      content: { left: 0, top: 1300, right: 100, bottom: 1325, scrollWidth: 400, scrollHeight: 1200 }
    });
    expect(rules.findEscapes([reachable])).toEqual([]);
    const found = rules.findEscapes([unreachable]);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.unreachableInScroller);
    expect(found[0].detail).toContain("no scroll offset brings it into view");
  });

  test("skips what is not rendered and what is deliberately clipped for a screen reader", () => {
    const offscreen = box(-500, -500, 100, 25);
    expect(rules.findEscapes([element({ rect: offscreen, rendered: false })])).toEqual([]);
    expect(rules.findEscapes([element({ rect: offscreen, srOnly: true })])).toEqual([]);
  });

  test("orders findings by how much was lost", () => {
    const found = rules.findEscapes([
      element({ path: "small", rect: box(0, 305, 10, 10) }),
      element({ path: "large", rect: box(0, 400, 10, 10) })
    ]);
    expect(found.map((item: { target: string }) => item.target)).toEqual(["large", "small"]);
  });

  test("rejects a caller that hands it something other than measurements", () => {
    expect(() => rules.findEscapes(null)).toThrow(/must be an array/);
  });
});

describe("screen-reader-only regions", () => {
  test("catches a hidden region anchored outside the visual", () => {
    const found = rules.checkScreenReaderRegions([{ path: "div.atlyn-semantic-tree", rect: box(-1, -1, 1, 1) }], TILE);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.screenReaderRegionEscapes);
  });

  test("accepts one anchored inside it", () => {
    expect(rules.checkScreenReaderRegions([{ path: "x", rect: box(0, 0, 1, 1) }], TILE)).toEqual([]);
  });
});

describe("regions that must stay worth looking at", () => {
  test("catches a drawing canvas squeezed to nothing", () => {
    const found = rules.checkMinimumSizes([
      { path: "div.atlyn-canvas-wrap", label: "the drawing canvas", width: 258, height: 0, minWidth: 24, minHeight: 24 }
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.collapsedRegion);
    expect(found[0].detail).toContain("0.0px tall, needs 24px");
  });

  test("passes one that still has room", () => {
    expect(
      rules.checkMinimumSizes([{ path: "x", width: 258, height: 39, minWidth: 24, minHeight: 24 }])
    ).toEqual([]);
  });
});

describe("scroll regions", () => {
  const canvas = {
    path: "div.atlyn-canvas-wrap",
    clientWidth: 200,
    clientHeight: 100,
    scrollWidth: 400,
    scrollHeight: 900
  };

  test("reports a region that has stopped being a scroll container instead of dropping it", () => {
    const found = rules.checkScrollRegions([], { expected: ["div.atlyn-canvas-wrap"] });
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.scrollRegionLost);
    expect(found[0].detail).toContain("silently stopped testing anything");
  });

  test("fails loudly, rather than skipping, when a region cannot exercise scrolling at all", () => {
    const found = rules.checkScrollRegions(
      [{ ...canvas, scrollWidth: 200, scrollHeight: 100 }],
      { mustOverflow: ["div.atlyn-canvas-wrap"] }
    );
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.scrollPreconditionUnmet);
    expect(found[0].detail).toContain("pass vacuously");
  });

  test("is satisfied by a region that really does overflow", () => {
    expect(
      rules.checkScrollRegions([canvas], {
        expected: ["div.atlyn-canvas-wrap"],
        mustOverflow: ["div.atlyn-canvas-wrap"]
      })
    ).toEqual([]);
  });
});

describe("sticky stacking", () => {
  test("refuses to read an order out of a stacking context that does not exist", () => {
    const found = rules.checkStickyStacking([
      { path: "div.header", position: "static", zIndex: "5", rect: box(0, 0, 100, 20) }
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.stickyNotPositioned);
    expect(found[0].detail).toContain("passes vacuously");
  });

  test("catches pinned headers collapsing onto one another", () => {
    const found = rules.checkStickyStacking([
      { path: "div.first", position: "sticky", zIndex: "2", rect: box(0, 0, 100, 20) },
      { path: "div.second", position: "sticky", zIndex: "1", rect: box(0, 10, 100, 20) }
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.stickyOverlap);
    expect(found[0].escape).toBeCloseTo(100);
  });

  test("passes headers that are pinned and separate", () => {
    expect(
      rules.checkStickyStacking([
        { path: "a", position: "sticky", zIndex: "2", rect: box(0, 0, 100, 20) },
        { path: "b", position: "sticky", zIndex: "1", rect: box(0, 20, 100, 20) }
      ])
    ).toEqual([]);
  });
});

describe("text against the shape drawn for it", () => {
  const card = box(100, 0, 156, 48);

  test("catches an RTL label anchored on the wrong edge", () => {
    const found = rules.checkTextWithinOwner([
      {
        path: "text.atlyn-node-label",
        ownerPath: "rect.atlyn-node-card",
        text: "North America",
        textRect: box(248, 10, 140, 14),
        ownerRect: card
      }
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.textEscapesOwner);
    expect(found[0].escape).toBeCloseTo(131.5);
  });

  test("passes a label that stays in its card", () => {
    expect(
      rules.checkTextWithinOwner([
        { path: "t", ownerPath: "c", text: "North America", textRect: box(108, 10, 100, 14), ownerRect: card }
      ])
    ).toEqual([]);
  });
});

describe("focus and hidden scrolling", () => {
  test("catches keyboard focus landing outside the tile", () => {
    const found = rules.checkFocusWithinTile(
      { activePath: "div.atlyn-semantic-item", activeRect: box(0, 290, 100, 25) },
      TILE
    );
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("keyboard user");
  });

  test("has nothing to say when nothing holds focus", () => {
    expect(rules.checkFocusWithinTile({ activePath: null, activeRect: null }, TILE)).toEqual([]);
  });

  test("catches a focused row taller than the pane showing it", () => {
    const found = rules.checkFocusFullyVisible({
      activePath: "div.atlyn-semantic-item",
      activeRect: box(0, 250, 80, 36),
      visibleBox: box(0, 256, 80, 30),
      visibleBoxPath: "div.atlyn-semantic-tree"
    });
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.focusNotFullyVisible);
    expect(found[0].detail).toContain("no scroll offset shows the focused row whole");
  });

  test("passes a focused row the pane can show whole", () => {
    expect(
      rules.checkFocusFullyVisible({
        activePath: "div.atlyn-semantic-item",
        activeRect: box(0, 260, 80, 25),
        visibleBox: box(0, 256, 80, 42),
        visibleBoxPath: "div.atlyn-semantic-tree"
      })
    ).toEqual([]);
  });

  test("catches an overflow:hidden box that has been scrolled where no user can scroll it back", () => {
    const found = rules.checkHiddenScroll([
      { path: "div.atlyn-root", overflowX: "hidden", overflowY: "hidden", scrollTop: 81.5, scrollLeft: 0 }
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.hiddenScroll);
    expect(found[0].escape).toBeCloseTo(81.5);
  });

  test("accepts a hidden box sitting at its origin", () => {
    expect(
      rules.checkHiddenScroll([
        { path: "div.atlyn-root", overflowX: "hidden", overflowY: "hidden", scrollTop: 0, scrollLeft: 0 }
      ])
    ).toEqual([]);
  });
});

describe("declared counts", () => {
  test("catches a visual that has grown its first sticky element", () => {
    const found = rules.checkDeclaredCounts({ sticky: 1, fixed: 0 }, { sticky: 0, fixed: 0 });
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe(rules.RULES.countDrifted);
    expect(found[0].target).toBe("sticky");
  });

  test("says nothing while the counts hold", () => {
    expect(rules.checkDeclaredCounts({ sticky: 0, fixed: 0 }, { sticky: 0, fixed: 0 })).toEqual([]);
  });
});

describe("summary", () => {
  test("counts by rule and keeps the worst escape and where it was", () => {
    const summary = rules.summarize([
      { rule: "clipped-escape", target: "a", escape: 4 },
      { rule: "clipped-escape", target: "b", escape: 140.85 },
      { rule: "root-escapes-tile", target: "c", escape: 15.5 }
    ]);
    expect(summary).toEqual({
      total: 3,
      byRule: { "clipped-escape": 2, "root-escapes-tile": 1 },
      worstEscape: 140.85,
      worstTarget: "b"
    });
  });
});
