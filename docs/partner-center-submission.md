# Partner Center submission dossier

Everything Microsoft asks for when publishing a Power BI custom visual to
AppSource, with the concrete value this repository ships. Requirements are per
[Publish a Power BI visual to Partner Center](https://learn.microsoft.com/en-us/power-bi/developer/visuals/office-store).

Nothing here asserts that the visual is certified, approved, or listed. It
records what has been prepared and what a human still has to do.

## 1. Package metadata (`pbiviz.json`)

| Partner Center / pbiviz field | Value | Where it lives |
| --- | --- | --- |
| Visual name | `AtlynHierarchyExplorer` | `pbiviz.json` &rarr; `visual.name` |
| Display name | `Atlyn Hierarchy Explorer` | `pbiviz.json` &rarr; `visual.displayName` |
| GUID | `atlynHierarchyExplorer` | `pbiviz.json` &rarr; `visual.guid` |
| Version (four-part) | `1.0.0.0` | `pbiviz.json` &rarr; `visual.version` |
| Description | Explore parent-child hierarchies with an accessible tree, search, expand and collapse, breadcrumbs, and diagnostics that surface orphans, cycles, and duplicate IDs instead of hiding them. | `pbiviz.json` &rarr; `visual.description` |
| Support URL | `https://atlyn.io/contact` | `pbiviz.json` &rarr; `visual.supportUrl` |
| Author name | `Atlyn` | `pbiviz.json` &rarr; `author.name` |
| Author email | `atlyn.help@gmail.com` | `pbiviz.json` &rarr; `author.email` |
| API version | `5.11.0` | `pbiviz.json` &rarr; `apiVersion` |
| GitHub URL | `https://github.com/garrett-hamers/powerbi-hierarchy-explorer` | `pbiviz.json` &rarr; `visual.gitHubUrl` |

> **Do not change the GUID.** `atlynHierarchyExplorer` is already recorded in the
> storefront release manifest and in published download paths. Changing it
> creates a different visual as far as Power BI and AppSource are concerned.

The built package is `dist/atlynHierarchyExplorer.1.0.0.0.pbiviz`, named
`{guid}.{version}.pbiviz`. It is reproducible: two clean builds from the same
source and lockfile produce identical bytes and the same SHA-256, which
`npm run verify-reproducible-package` proves. `dist/release-manifest.json`
records the filename, byte length, uppercase SHA-256, source commit, GUID,
version, support and privacy URLs, author email, and every publication asset.

## 2. Listing assets

| Requirement | Value | Status |
| --- | --- | --- |
| Logo, PNG, exactly 300x300 | `assets/partner-center-logo.png` | Present. 300x300, 8-bit RGBA, 2294 bytes. |
| Screenshots, 1-5, PNG, exactly 1366x768, each <= 1024 KB | `assets/screenshots/01-hierarchy-overview.png`<br>`assets/screenshots/02-expand-collapse.png`<br>`assets/screenshots/03-search-diagnostics.png` | Present. All 1366x768, all well under 1024 KB. |
| Support URL, https | `https://atlyn.io/contact` | Live. |
| Privacy policy URL, https | `https://atlyn.io/legal/privacy` | Live. |
| EULA | `EULA.md` | Present. Grants the same permissive MIT terms as `LICENSE`. |
| Terms of use (reference) | `https://atlyn.io/legal/terms` | Live, referenced from `EULA.md`. |
| Sample `.pbix` report, fully offline | **Not in this repository** | **Blocked - see section 5.** |

Use `https://atlyn.io/legal/privacy` and `https://atlyn.io/legal/terms` exactly.
`https://atlyn.io/privacy`, `/support` and `/terms` return 404 and must not be
entered into the submission form.

### What each screenshot shows

| File | Content |
| --- | --- |
| `01-hierarchy-overview.png` | Five levels of an explicit parent-child table with revenue and headcount on every card. |
| `02-expand-collapse.png` | Two branches collapsed by keyboard, the accessible tree open on focus with expand/collapse toggles, and the breadcrumb on the focused node. |
| `03-search-diagnostics.png` | A search term highlighting three matches in place, plus the diagnostics strip reporting an orphan row whose ParentId is absent from the table. |

### How the screenshots were produced

They are real renders, not mock-ups. `npm run screenshots` loads the compiled
stylesheet and script out of `.tmp/drop/pbiviz.json` - the exact payload embedded
in the `.pbiviz` - into headless Chromium, mounts the visual through the plugin
the bundle registers on `window.powerbi.visuals.plugins`, and drives it with
native browser input: arrow keys through the accessible tree, real typing into
the search box. The page is loaded over `file://` and every non-`file:` request
is aborted, so the capture is provably offline. The only added pixels are the
caption strip around the visual; the visual's own area is untouched.

The harness lives in `scripts/screenshot-harness/` and the data is inlined in
`scripts/screenshot-harness/data.js`. The company and team names are invented
for the listing.

Screenshot bytes are deliberately **not** asserted to be reproducible, because
font rasterisation differs between machines. What is enforced is exact
dimensions, the 1024 KB ceiling, PNG structure, and that the image is not a flat
placeholder.

## 3. Privacy and permissions posture

Useful when answering the Partner Center certification questionnaire:

- `capabilities.json` declares `"privileges": []` - no `WebAccess`, no
  `ExportContent`, no `LocalStorage`.
- No network calls. The source contains no `fetch`, `XMLHttpRequest`,
  `WebSocket`, `eval` or `Function(...)`; `tests/package.test.ts` enforces this.
- No `innerHTML` or `insertAdjacentHTML`; all DOM is built node by node.
- No external assets, no CDN references, no remote fonts, no telemetry.
- No user photos or personal data are read, stored or transmitted.
- `dependencies.json` declares no external dependencies, and the only runtime
  package dependency is `powerbi-visuals-api`.

## 4. Commands

```text
npm ci
npm test
npm run typecheck
npm run eslint
npm run package                     # build, normalise, verify, validate assets, write manifest
npm run verify-reproducible-package # two clean builds must match byte for byte
npm run certification-audit
npm audit
```

`npm run validate-publication-assets` (invoked by both `npm run package` and
`npm run certification-audit`) is the gate for this document. It fails the build
if the logo is not exactly 300x300, if there are not between 1 and 5 screenshots
at exactly 1366x768 and at most 1024 KB, if any image is a flat placeholder, if a
required `pbiviz.json` field is missing, if the version is not four-part, if the
support or privacy URL is not `https://`, if the author email is a placeholder or
`noreply` address, or if `EULA.md` or this dossier is missing. It needs only Node,
so CI runs it without a browser.

Regenerating the screenshots additionally needs a browser, which is intentionally
not a dependency of this package:

```text
npm install --no-save playwright
npx playwright install chromium
npm run package
npm run screenshots
```

## 5. Remaining manual steps (owner only)

These cannot be completed from this repository and are not simulated here.

1. **Produce the sample `.pbix`.** Partner Center requires a sample report that
   works fully offline with no external connections. A `.pbix` embeds a compiled
   tabular model and can only be authored in Power BI Desktop. Build a report
   that imports the hierarchy as static/entered data (no gateway, no live
   connection, no web source), drop in the packaged visual, bind NodeId,
   ParentId, Label, Subtitle, Category, Value and Tooltips, and save it. The
   dataset in `scripts/screenshot-harness/data.js` is a ready-made basis.
2. **Create or confirm the Partner Center account** and complete publisher
   verification for Atlyn.
3. **Upload** `dist/atlynHierarchyExplorer.1.0.0.0.pbiviz` from a clean
   `npm run package`, together with the sample `.pbix`, the logo and the three
   screenshots.
4. **Enter the listing text** - short and long description, category, supported
   languages - and the support, privacy and EULA values from section 1 and 2.
5. **Submit for Microsoft review.** Everything in this repository is
   preparation; approval, certification status and store listing are decided by
   Microsoft and are not claimed here.

## 6. Kept in sync

`scripts/validate-publication-assets.cjs` cross-checks this document against
`pbiviz.json` on every build and fails if the support URL, privacy policy URL,
GUID, version or EULA path recorded above stops matching the repository. Update
both together.
