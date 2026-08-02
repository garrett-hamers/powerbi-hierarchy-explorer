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
expand are local view state, and descendant selection is explicit. Table
segments are not fetched progressively: the visual exposes a visible 30,000-row
bounded contract and reports segment/reduction diagnostics rather than claiming
that an incomplete parent-child graph is complete.

Formatting uses the API 5.1+ formatting model for direction, node geometry,
colors, typography, edges, interaction behavior, diagnostics, and persisted
values. Matrix data is rejected with an explicit message instead of being
interpreted as a table.

Visual metadata is stable at GUID `atlynHierarchyExplorer` with
`privileges: []`. The package uses no network access, external assets, unsafe
HTML, dynamic code, or user photos. This repository does not claim Microsoft
certification or substitute for validation in a real Power BI host.

## Development

```text
npm ci
npm test
npm run typecheck
npm run lint
npm run package
npm audit --audit-level=high
```
