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

- `assets/partner-center-logo.png` - 300x300 PNG derived from the visual source
  icon.
- `assets/screenshots/*.png` - three 1366x768 PNGs, each under 1024 KB. They are
  real renders of the packaged bundle driven by native browser input, not
  mock-ups; see `scripts/screenshot-harness/`.
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
dependency of this package so CI neither installs nor audits it:

```text
npm install --no-save playwright
npx playwright install chromium
npm run package
npm run screenshots
```

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
