# Changelog

## 1.0.1.0

Prepares the visual for its Microsoft AppSource / Partner Center submission, and
fixes the packaging and interaction defects that preparing it exposed.

The visual GUID `atlynHierarchyExplorer` is unchanged. This version supersedes
the `1.0.0.0` artifact previously published to storefront Blob storage: the
metadata and stylesheet changes below alter the packaged bytes, so the version
is bumped to keep the version-to-bytes mapping honest.

- Keep every drawn element inside the host tile. A Power BI tile clips at its own
  edge with no scrollbar and no affordance, and a probe of the packaged bundle in
  real Chromium (`npm run probe-layout`, 140 cases across five tile sizes, seven
  expansion and direction states, and four scroll offsets each) found 2,424
  escaping measurements across 132 of those 140 cases, on 15 distinct kinds of
  element. Fixed:
  - In `ar-SA` every node label and subtitle was drawn outside its own card, by
    up to 140.85px, at every tile size. `text-anchor` resolves against the inline
    direction, so under `direction: rtl` "start" already means the right-hand
    edge; the layout mirrors each x coordinate and the renderer flipped the
    anchor as well, and the second flip drew each label back out of its card and
    past the SVG that clips it. The anchor is now `start` in both directions and
    the single mirror in `computeLayout` does the whole job.
  - A `min-height: 96px` floor on the root made the visual 96px tall inside an
    80x80 tile, so the host ate 15.5px of it. The floor is gone: the tile is the
    authority on how much room there is.
  - Every chrome strip was `flex: 0 0 auto`, so on a small tile the toolbar,
    status strip and breadcrumb between them exceeded the tile height and pushed
    each other past the clipped edge - the breadcrumb by 285.5px at 80x80 - while
    the drawing canvas, the only item that could shrink, absorbed the whole
    shortfall and rendered at 0px at three of the five probed tile sizes. The
    visual now publishes the host viewport as a density and drops the chrome that
    does not fit rather than overflowing with it. Strips that carry information a
    screen reader needs, including the `aria-live` status strip, become
    screen-reader-only instead of being removed.
  - Long labels were drawn at full length into a card whose width is clamped, so
    they ran 18.05px past the card and past the SVG's scrollable extent, where no
    scroll offset reaches them. Drawn text is now trimmed to its card using the
    same glyph estimate the card was sized with, so anything that fits is never
    trimmed. The widest label now fills 79.2% of the space its card reserves,
    which is the headroom left for a wider font stack.
  - The focused accessible tree pane had no height floor, so at an 80x80 tile it
    was shorter than the 32px row it was showing and the keyboard user's own row
    could not be brought fully into view at any scroll offset.
  - The screen-reader-only tree carried `margin: -1px` from the visually-hidden
    idiom, which on an absolutely positioned box anchors the region a pixel
    outside the visual's own tile.

  Every one of these is proven by removal: `npm run prove-layout-regressions`
  puts each defect back, rebuilds the `.pbiviz`, re-runs the probe and requires
  the matching rule to go red, and fails on any fix whose removal leaves the
  probe green.

- Harden table contracts, segmented data accumulation, deterministic tidy-tree
  layout, bounded rendering, and accessible interaction state.- Align Power BI packaging and linting gates with the certification-safe
  repository contract.
- Add a deterministic Partner Center publication logo asset contract
  (`assets/partner-center-logo.png`), include its metadata in release manifests,
  and run CI on lowercase `certification` snapshots.
- Render both brand marks properly. `assets/partner-center-logo.png` had been the
  20x20 `assets/icon.png` scaled up, so it held exactly two colours with no
  intermediate tones and every curve stair-stepped at 300x300, against Microsoft's
  guidance that store images must not be poorly rendered. Both marks are now drawn
  by `npm run brand-assets` (`scripts/build-brand-assets.cjs`) as the same
  parent/child tree on the `#2764C4` brand tile, using the Node standard library
  only. They are rendered differently on purpose: the logo is 300x300 with rounded
  tiles and round-capped connectors, supersampled 8x8 so its curves are genuinely
  antialiased, and carries 57 distinct colours; the icon is 20x20 whole-pixel
  axis-aligned rectangles with no curve or diagonal to smooth, so it stays
  pixel-exact and two-tone by construction. The icon's old lopsided blob - the
  left child box fused with the vertical stem - is fixed by spacing.
  `npm run validate-publication-assets` now enforces a minimum distinct-colour
  count on the logo (16), which is what catches an upscaled icon; the icon
  deliberately gets no colour floor, because a colour count measures what a mark
  depicts rather than how well it is made. The icon is instead gated on exact
  dimensions, on `pbiviz.json` packaging the file that was inspected, and on
  pixel-for-pixel re-rendering in `tests/package.test.ts`. The icon is embedded in
  the package as `content.iconBase64`, so the packaged bytes move within
  `1.0.1.0`; that version has not been published, so the version-to-bytes mapping
  stays honest.
- Ship the compiled stylesheet inside the package. `src/visual.ts` never imported
  `style/visual.less`, so powerbi-visuals-tools bundled an empty `content.css`
  and the visual rendered completely unstyled in the host.
- Keep the caret in the search box while typing. Search revealed the first match
  on every keystroke by moving DOM focus into the accessible tree, so no more
  than one character could be entered.
- Render the accessible tree as a sibling panel of the canvas instead of a child
  of it. Nested inside the scrolling canvas it appeared below the full-height
  graph, so focusing it scrolled the graph away and pushed the tree outside the
  clipped bounds of the visual.
- Stop the toolbar, status, diagnostics and breadcrumb strips from being
  squeezed, which sliced data quality messages in half, and align tree leaves
  under their parents by reserving the expand/collapse column on every row.
- Add the remaining AppSource submission assets: real 1366x768 screenshots
  rendered from the packaged bundle (`npm run screenshots`), `EULA.md`, and
  `docs/partner-center-submission.md`, all enforced by
  `npm run validate-publication-assets`.
- Point submission metadata at the storefront: `supportUrl`
  `https://atlyn.io/contact` and author email `atlyn.help@gmail.com`, with a
  listing-quality description.
- Add the offline sample report as a Power BI Project
  (`samples/AtlynHierarchyExplorerSample.pbip`) generated by
  `npm run sample-report`: the data is a DAX `DATATABLE` calculated table, so the
  model declares no data source at all, and this visual is embedded as a private
  custom visual so nothing resolves from AppSource at open time. Packaging fails
  if the embedded copy goes stale.
- Record the AppSource listing as free, separate from the Atlyn storefront
  subscription, and enforce it from `validate-publication-assets`.

## 1.0.0.0

- Initial packaged release.

