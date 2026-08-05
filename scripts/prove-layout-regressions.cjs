/*
 * Proves each layout fix by removing it.
 *
 * A check that has only ever been run against a correct render has not been
 * shown to catch anything. For every fix in this file the script puts the
 * original defect back into the source, rebuilds the .pbiviz, re-runs the full
 * layout probe against that packaged artifact, and requires the matching rule
 * to fire with at least the escape the defect originally produced. A fix whose
 * revert leaves the probe green is not a proven fix, and this script fails on
 * it just as loudly as it fails on a defect.
 *
 * The working tree is restored in a finally block and the package is rebuilt at
 * the end, so a failed or interrupted run leaves the repository as it found it.
 *
 * Needs the same Playwright install the probe needs:
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   npm run prove-layout-regressions
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { collectResults } = require("./probe-layout.cjs");

const root = path.resolve(__dirname, "..");

/*
 * Each entry names the defect, the exact source it lived in, and the rule that
 * has to catch it. `minEscape` is set from the escape the defect measured
 * before it was fixed, so a rule that fires with a token half-pixel does not
 * count as having caught it.
 */
const FIXES = [
  {
    id: "rtl-text-anchor",
    summary:
      "RTL double flip: the layout mirrors x and the renderer flipped text-anchor as well, " +
      "so every node label and subtitle was drawn out of its own card",
    revert: [
      {
        file: "src/visual.ts",
        from: '    const textAnchor = "start";',
        to: '    const textAnchor = this.direction === "rtl" ? "end" : "start";'
      }
    ],
    expect: { rule: "text-escapes-owner", minEscape: 100, states: ["rtl", "rtl-latin"] }
  },
  {
    id: "label-fits-card",
    summary:
      "Node text was drawn at full length into a card whose width is clamped, so long labels " +
      "ran past the card and past the SVG's scrollable extent, where no scroll offset reaches them",
    revert: [
      {
        file: "src/visual.ts",
        from: "    label.textContent = fitToCard(node.label, point.width, this.formatting.fontSize);",
        to: "    label.textContent = node.label;"
      },
      {
        file: "src/visual.ts",
        from:
          "      subtitle.textContent = fitToCard(node.subtitle, point.width, this.formatting.subtitleFontSize);",
        to: "      subtitle.textContent = node.subtitle;"
      }
    ],
    expect: { rule: "text-escapes-owner", minEscape: 15, states: ["long-labels"] }
  },
  {
    id: "root-has-no-height-floor",
    summary: "A 96px floor on the root made the visual taller than an 80x80 tile, and the host clipped the difference",
    revert: [
      {
        file: "style/visual.less",
        from: "  height: 100%;\n  overflow: hidden;\n  position: relative;\n  width: 100%;\n}",
        to: "  height: 100%;\n  min-height: 96px;\n  overflow: hidden;\n  position: relative;\n  width: 100%;\n}"
      }
    ],
    expect: { rule: "root-escapes-tile", minEscape: 15, tiles: ["80x80"] }
  },
  {
    id: "density-drops-chrome",
    summary:
      "Every chrome strip was flex: 0 0 auto, so on a small tile the toolbar, status strip and " +
      "breadcrumb between them exceeded the tile height and pushed each other past the clipped edge",
    revert: [
      {
        file: "src/visual.ts",
        from: '    this.root.dataset.density = width > 0 && height > 0 ? resolveDensity(width, height) : "comfortable";',
        to: '    this.root.dataset.density = "comfortable";'
      }
    ],
    expect: { rule: "clipped-escape", minEscape: 50, tiles: ["178x138", "80x80"] }
  },
  {
    id: "density-keeps-the-canvas-alive",
    summary:
      "With the chrome unable to shrink and the canvas able to, the canvas absorbed every " +
      "shortfall and rendered at zero height: a visual on a report drawing nothing at all",
    revert: [
      {
        file: "src/visual.ts",
        from: '    this.root.dataset.density = width > 0 && height > 0 ? resolveDensity(width, height) : "comfortable";',
        to: '    this.root.dataset.density = "comfortable";'
      }
    ],
    expect: { rule: "collapsed-region", minEscape: 20, tiles: ["258x198", "178x138", "80x80"] }
  },
  {
    id: "tree-pane-fits-a-row",
    summary:
      "The focused tree pane took 38% of the tile with no floor, so at an 80x80 tile it was " +
      "shorter than the 32px row it was showing and the keyboard user's own row could not be " +
      "brought fully into view at any scroll offset",
    revert: [
      {
        file: "style/visual.less",
        from: "  min-height: 42px;\n  overflow: auto;\n  padding: 4px 8px;\n  position: relative;",
        to: "  min-height: 0;\n  overflow: auto;\n  padding: 4px 8px;\n  position: relative;"
      }
    ],
    expect: { rule: "focus-not-fully-visible", minEscape: 1, tiles: ["80x80"], states: ["tree-focused"] }
  },
  {
    id: "minimal-yields-the-toolbar-to-the-tree",
    summary:
      "At an 80x80 tile the toolbar and a focused tree pane do not both fit; keeping both " +
      "left no room at all for the drawing canvas, so the visual sat on the report showing nothing",
    revert: [
      {
        file: "style/visual.less",
        from:
          '.atlyn-root[data-density="minimal"][data-tree-focused="true"] .atlyn-toolbar {\n  display: none;\n}',
        to: '.atlyn-root[data-density="minimal"][data-tree-focused="never"] .atlyn-toolbar {\n  display: none;\n}'
      }
    ],
    expect: { rule: "collapsed-region", minEscape: 20, tiles: ["80x80"], states: ["tree-focused"] }
  },
  {
    id: "screen-reader-region-stays-inside",
    summary:
      "The screen-reader-only tree carried margin: -1px from the visually-hidden idiom, which on an " +
      "absolutely positioned box anchors the region a pixel outside the visual's own tile",
    revert: [
      {
        file: "style/visual.less",
        from: ".atlyn-visually-hidden() {\n  clip: rect(0 0 0 0);\n  clip-path: inset(50%);\n  height: 1px;\n  margin: 0;",
        to: ".atlyn-visually-hidden() {\n  clip: rect(0 0 0 0);\n  clip-path: inset(50%);\n  height: 1px;\n  margin: -1px;"
      }
    ],
    expect: { rule: "screen-reader-region-escapes", minEscape: 0.4 }
  }
];

const run = (command, args) => {
  execFileSync(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
};

/*
 * The CLI is invoked through node against its own entry point rather than
 * through npx: Node refuses to spawn a .cmd shim without a shell on Windows,
 * and running it through a shell would make this script's behaviour depend on
 * which shell happened to be there.
 */
const pbivizEntry = path.join(root, "node_modules", "powerbi-visuals-tools", "bin", "pbiviz.js");

/*
 * Only the steps that produce the artifact. The full `npm run package` also
 * verifies the sample report embeds the current bundle, which is exactly what a
 * deliberately broken build does not do.
 */
const buildPackage = () => {
  run(process.execPath, [path.join("scripts", "clean-package-artifacts.cjs")]);
  run(process.execPath, [pbivizEntry, "package"]);
  run(process.execPath, [path.join("scripts", "normalize-package.cjs")]);
};

const applyRevert = (fix) => {
  const originals = new Map();
  fix.revert.forEach((patch) => {
    const filePath = path.join(root, patch.file);
    const before = fs.readFileSync(filePath, "utf8");
    if (!originals.has(filePath)) {
      originals.set(filePath, before);
    }
    const occurrences = before.split(patch.from).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `${fix.id}: expected exactly one occurrence of the fixed source in ${patch.file}, found ${occurrences}. ` +
          "The fix has moved, so this proof is no longer proving anything - update scripts/prove-layout-regressions.cjs."
      );
    }
    fs.writeFileSync(filePath, before.replace(patch.from, patch.to));
  });
  return originals;
};

const restore = (originals) => {
  originals.forEach((contents, filePath) => fs.writeFileSync(filePath, contents));
};

const matches = (fix, caseResult, violation) => {
  if (violation.rule !== fix.expect.rule) {
    return false;
  }
  if (fix.expect.tiles && !fix.expect.tiles.includes(caseResult.tile)) {
    return false;
  }
  if (fix.expect.states && !fix.expect.states.includes(caseResult.state)) {
    return false;
  }
  return (violation.escape || 0) >= fix.expect.minEscape;
};

const describeExpectation = (fix) =>
  [
    fix.expect.rule,
    `escape >= ${fix.expect.minEscape}px`,
    fix.expect.tiles ? `tiles ${fix.expect.tiles.join(", ")}` : null,
    fix.expect.states ? `states ${fix.expect.states.join(", ")}` : null
  ]
    .filter(Boolean)
    .join(", ");

const proveOne = async (fix) => {
  const originals = applyRevert(fix);
  try {
    buildPackage();
    const { results } = await collectResults();
    const hits = [];
    results.forEach((caseResult) => {
      caseResult.violations.forEach((violation) => {
        if (matches(fix, caseResult, violation)) {
          hits.push({ caseResult, violation });
        }
      });
    });
    hits.sort((first, second) => (second.violation.escape || 0) - (first.violation.escape || 0));
    return {
      id: fix.id,
      summary: fix.summary,
      expectation: describeExpectation(fix),
      caught: hits.length > 0,
      hitCount: hits.length,
      worst: hits[0]
        ? {
            case: `${hits[0].caseResult.tile} / ${hits[0].caseResult.state} / scroll:${hits[0].caseResult.offset}`,
            rule: hits[0].violation.rule,
            target: hits[0].violation.target,
            detail: hits[0].violation.detail,
            escape: hits[0].violation.escape
          }
        : null
    };
  } finally {
    restore(originals);
  }
};

const main = async () => {
  const only = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  const selected = only.length > 0 ? FIXES.filter((fix) => only.includes(fix.id)) : FIXES;
  if (selected.length === 0) {
    throw new Error(`no fix matched ${JSON.stringify(only)}; known ids: ${FIXES.map((fix) => fix.id).join(", ")}`);
  }
  const proofs = [];
  try {
    for (const fix of selected) {
      process.stdout.write(`Reverting ${fix.id} ...\n`);
      const proof = await proveOne(fix);
      proofs.push(proof);
      process.stdout.write(
        proof.caught
          ? `  RED as required: ${proof.hitCount} matching violations, worst ${proof.worst.escape.toFixed(2)}px\n` +
              `    ${proof.worst.case}\n` +
              `    ${proof.worst.rule}: ${proof.worst.target}\n` +
              `      ${proof.worst.detail}\n`
          : `  STILL GREEN. Expected ${proof.expectation} and got nothing.\n` +
              "    A fix that cannot be shown to fail without its patch is not a proven fix.\n"
      );
    }
  } finally {
    process.stdout.write("Restoring the packaged artifact ...\n");
    buildPackage();
  }

  const unproven = proofs.filter((proof) => !proof.caught);
  process.stdout.write(`\n${proofs.length - unproven.length}/${proofs.length} fixes proven.\n`);
  if (unproven.length > 0) {
    process.stdout.write(`Unproven: ${unproven.map((proof) => proof.id).join(", ")}\n`);
    process.exitCode = 1;
  }
  return proofs;
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { FIXES, main };
