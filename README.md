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
  PNG was written, and the SHA-256 of the bytes written for it. The scene
  assertions are otherwise ephemeral, so this is what lets a later build
  re-check that the committed file is still the one they were applied to;
  `npm run validate-publication-assets` and `npm test` both assert it.
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
scene was accepted on, and the SHA-256 of the bytes published for it, are
written to `assets/screenshot-capture.json`, and every build re-checks the
committed PNGs against it - otherwise the assertions would prove only that a
file was right at the moment it was written. `npm run verify-screenshots` runs
the same gate without writing anything, which is what CI does; image bytes are
never compared against a re-render, because they are not reproducible even
between two runs on one machine.

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
