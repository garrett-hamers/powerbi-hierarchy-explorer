# powerbi-hierarchy-explorer

Atlyn Hierarchy Explorer is a certification-first Power BI custom visual for
exploring explicit parent-child tables. `NodeId`, `ParentId`, and `Label` are
required; `Subtitle`, `Category`, `Value`, and `Tooltips` are optional. NodeId
is the stable identity, and multiple roots are retained as a forest.

The visual reports malformed data instead of silently dropping it: duplicate
or conflicting IDs, empty values, orphans, cycles, multiple roots, reduction
truncation, and node/depth caps. It provides deterministic bounded rendering,
an accessible semantic tree, local collapse/expand, search, breadcrumbs,
descendant selection, Power BI selection/highlights, context menus, tooltips,
keyboard navigation, RTL, high contrast, reduced motion, and responsive
behavior. Matrix mode is intentionally not implemented.

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
