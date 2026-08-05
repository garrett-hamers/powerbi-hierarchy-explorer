# powerbi-hierarchy-explorer

Atlyn Hierarchy Explorer is a certification-first Power BI custom visual for
exploring explicit parent-child tables. `NodeId`, `ParentId`, and `Label` are
required; `Subtitle`, `Category`, `Value`, and `Tooltips` are optional. NodeId
is the stable identity, and multiple roots are retained as a forest.

The visual reports malformed data instead of silently dropping it: duplicate
or conflicting IDs, empty values, orphans, cycles, multiple roots, reduction
truncation, and node/depth caps. It provides deterministic bounded rendering,
an accessible semantic tree, local collapse/expand, search, breadcrumbs,
descendant selection, Power BI selection, context menus, tooltips,
keyboard navigation, RTL, high contrast, reduced motion, and responsive
behavior. Matrix mode is intentionally not implemented.

Rows are sorted deterministically by NodeId within each forest component. The
visual does not provide drill or host-driven expand operations; collapse and
expand are local view state, and descendant selection is explicit. Segmented
table data is accumulated with stable source identities and requests at most 32
additional segments through the documented `fetchMoreData(false)` contract.
Partial/loading state and a 30,000-row bounded contract remain visible, and
rendering is capped at 2,000 visible nodes with search prioritization so large
forests stay responsive.

Formatting uses the API 5.1+ formatting model for direction, node geometry,
colors, typography, edges, interaction behavior, diagnostics, and persisted
values. Matrix data is rejected with an explicit message instead of being
interpreted as a table.

Visual metadata is stable at GUID `atlynHierarchyExplorer` with
`privileges: []`. The package uses no network access, external assets, unsafe
HTML, dynamic code, or user photos. This repository does not claim Microsoft
certification or substitute for validation in a real Power BI host.

## Publication assets

AppSource / Partner Center submission material lives alongside the source and is
validated on every build by `npm run validate-publication-assets`:

- `assets/partner-center-logo.png` and `assets/icon.png` - the 300x300 listing
  logo and the 20x20 visualization pane icon. Both are the same parent/child tree
  the visual draws, on the same `#2764C4` tile, rendered by `npm run brand-assets`
  from the geometry in `scripts/build-brand-assets.cjs`. They are rendered
  differently on purpose: the logo has rounded tiles and round-capped connectors,
  so it is supersampled 8x8 and its curves are genuinely antialiased, while the
  icon is whole-pixel axis-aligned rectangles with nothing to antialias and stays
  pixel-exact at 20px. The renderer is Node standard library only - no browser and
  no image package - so it produces identical bytes on every machine, and
  `tests/package.test.ts` re-renders both and compares pixels so the committed
  files cannot drift from the script. The icon is embedded in the packaged
  `.pbiviz` as `content.iconBase64`; the listing logo is not.
- `assets/screenshots/*.png` - three 1366x768 PNGs, each under 1024 KB. They are
  real renders of the packaged bundle driven by native browser input, not
  mock-ups; see `scripts/screenshot-harness/`. Each scene declares what it must
  contain - counts, interaction state and measured geometry - and the capture
  refuses to write a PNG whose scene did not actually render.
- `assets/screenshot-capture.json` - what each scene was measured at when its
  PNG was written, the SHA-256 of the bytes written for it, and the SHA-256 of
  the compiled visual they were drawn from. The scene assertions are otherwise
  ephemeral, so this is what lets a later build re-check both that the committed
  file is still the one they were applied to and that the visual has not moved
  underneath it; `npm run validate-publication-assets` and `npm test` assert it.
- `EULA.md` - end user licence, granting the same permissive MIT terms as
  `LICENSE`.
- `samples/AtlynHierarchyExplorerSample.pbip` - the offline sample report, as a
  Power BI Project whose data is a DAX `DATATABLE` calculated table, so the model
  declares no data source, and with this visual embedded as a private custom
  visual. Rebuild it with `npm run package && npm run sample-report`. The
  `.pbix` Partner Center wants is produced from it with one *Save As* in Power BI
  Desktop.
- `docs/partner-center-submission.md` - every Partner Center field with its final
  value, plus the manual steps that remain.

Regenerating the screenshots needs a browser, which is deliberately not a
dependency of this package so `npm ci` neither installs nor audits it:

```text
npm install --no-save playwright
npx playwright install chromium
npm run package
npm run screenshots
```

Every scene is asserted against the live page before its screenshot is taken:
node and connector counts, the interaction state the caption claims, and
measured geometry - content must have real size and lie inside the box the
image shows. A scene that fails is not photographed, and its committed image is
deleted rather than left to pass for a current render. The measurements each
scene was accepted on, the SHA-256 of the bytes published for it, and the
SHA-256 of the compiled visual it was drawn from are written to
`assets/screenshot-capture.json`, and every build re-checks the committed PNGs
against it - otherwise the assertions would prove only that a file was right at
the moment it was written, and nothing would notice the visual changing while
the screenshots stayed behind. Committed bytes are kept when the compiled visual
has not changed, so re-running the capture does not churn the images. `npm run
verify-screenshots` runs the same gate without writing anything, which is what
CI does; image bytes are never compared against a re-render, because they are
not reproducible even between two runs on one machine.

## Development

```text
npm ci
npm test
npm run typecheck
npm run eslint
npm run package
npm run verify-reproducible-package
npm run certification-audit
npm audit
```

## Layout probe

A Power BI host renders a visual inside a tile with `overflow: hidden`. Content
laid out beyond that tile is not scrolled to and not scrollbarred - it is
discarded, and nothing on screen says so. `npm run probe-layout` loads the
packaged `.pbiviz` in headless Chromium and measures every element's
`getBoundingClientRect()` against the box that actually clips it, ignoring
anything a user could reach by scrolling a genuine `overflow: auto` ancestor.

It probes five host tile sizes (1280x620 down to 80x80), nine states (fully
expanded, partially expanded, fully collapsed, accessible tree focused, long
labels, `ar-SA` with both Arabic and Latin labels, and diagnostics present both
with and without the accessible tree focused) and four scroll offsets per state
- the offset the browser itself chose, then every scrollable region forced to
its top, middle and maximum, with the whole escape walk re-run at each. 180
cases in all.

The diagnostics states matter more than their count suggests. The diagnostics
strip is `display: none` until the data has something wrong with it, and the
accessible tree is a 1px clipped region until focus pulls it into the flow, so a
probe fed clean data and never given a focus event never lays either of them out
- and never sees the state where the chrome and the chart compete for a short
tile. The bug lives in the state you did not put the visual into.

Every run reports rendered heights for the graph, the scrollport onto it, the
visible intersection of the two, whether that scrollport still scrolls, and the
tree, toolbar and diagnostics strips, plus `root.scrollTop`, at each tile with
diagnostics present - whether or not any rule fired. The intersection is the
number that matters: `.atlyn-graph` carries `min-height: 170px` and scrolls, so
it never collapses on its own, and a rule asserting the graph's own height would
pass on a 796px chart behind a 0px window. "Does the chart survive" is answered
by a table of measurements, not by a pass.

The rules are pure functions in `scripts/layout-probe/rules.cjs`, so
`tests/layout-rules.test.ts` can drive them with deliberately bad measurements
rather than only ever showing them a correct render. Nothing about geometry is
asserted in JSDOM, which has no layout engine and would return zeros.

`npm run prove-layout-regressions` puts each fixed defect back into the source
one at a time, rebuilds the package, re-runs the probe, and requires the
matching rule to fire with at least the escape the defect originally measured.
A fix whose removal leaves the probe green is reported as unproven and fails the
run.

Both need Playwright, which is deliberately not a dependency of this package so
it stays off the surface `npm audit` and the certification gates inspect:

```text
npm install --no-save playwright
npx playwright install chromium
npm run package
npm run probe-layout
npm run prove-layout-regressions
```

`scripts/layout-probe/expected-regions.json` records what the probe expects to
find - which regions scroll at which density, and that the visual contains no
`position: sticky` or `position: fixed` element. A region that stops being a
scroll container is reported rather than quietly dropped, because a dropped
region silently stops carrying its own requirement.

The probe reads the archive, then checks the compiled bundle inside it against
the staging drop that `npm run screenshots` and the publication gate read, using
the same `scripts/read-visual-bundle.cjs` they use. That turns "read the archive
to avoid the gap between compiled and packaged bytes" into "read the archive and
prove there is no gap". If the two ever disagree, the bytes the host runs are not
the bytes anything else in this repository has looked at.
