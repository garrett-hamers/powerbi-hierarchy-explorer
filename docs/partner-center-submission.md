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
| Version (four-part) | `1.0.1.0` | `pbiviz.json` &rarr; `visual.version` |
| Description | Explore parent-child hierarchies with an accessible tree, search, expand and collapse, breadcrumbs, and diagnostics that surface orphans, cycles, and duplicate IDs instead of hiding them. | `pbiviz.json` &rarr; `visual.description` |
| Support URL | `https://atlyn.io/contact` | `pbiviz.json` &rarr; `visual.supportUrl` |
| Author name | `Atlyn` | `pbiviz.json` &rarr; `author.name` |
| Author email | `atlyn.help@gmail.com` | `pbiviz.json` &rarr; `author.email` |
| API version | `5.11.0` | `pbiviz.json` &rarr; `apiVersion` |
| GitHub URL | `https://github.com/garrett-hamers/powerbi-hierarchy-explorer` | `pbiviz.json` &rarr; `visual.gitHubUrl` |

> **Do not change the GUID.** `atlynHierarchyExplorer` is already recorded in the
> storefront release manifest and in published download paths. Changing it
> creates a different visual as far as Power BI and AppSource are concerned.

### Licensing

**AppSource listing: Free.**

The visual is published to AppSource at no charge. Do **not** configure a paid,
transactable, or "free trial" offer in Partner Center, and do not add licence
checks, entitlement calls, or a paywall to the visual: it declares
`"privileges": []` and makes no network calls, so it could not perform them
anyway.

AppSource licensing is entirely separate from the Atlyn storefront subscription.
Monetisation happens only at <https://atlyn.io> through the Stripe subscription
there. The AppSource listing is a free distribution channel for the visual
itself and confers no storefront entitlement, and a storefront subscription is
not required to use the AppSource build.

The built package is `dist/atlynHierarchyExplorer.1.0.1.0.pbiviz`, named
`{guid}.{version}.pbiviz`. It is reproducible: two clean builds from the same
source and lockfile produce identical bytes and the same SHA-256, which
`npm run verify-reproducible-package` proves. `dist/release-manifest.json`
records the filename, byte length, uppercase SHA-256, source commit, GUID,
version, support and privacy URLs, author email, and every publication asset.

Version `1.0.0.0` was superseded before it was ever published to AppSource. The
submission-readiness work changed `pbiviz.json`, so a build from this source no
longer reproduces the bytes already stored at the storefront's version-keyed
path for `1.0.0.0`. Two different artifacts must never share one version number,
so the version was bumped and the storefront artifact is re-published under
`1.0.1.0`. Upload `1.0.1.0` to Partner Center; `1.0.0.0` is retired.

## 2. Listing assets

| Requirement | Value | Status |
| --- | --- | --- |
| Logo, PNG, exactly 300x300 | `assets/partner-center-logo.png` | Present. 300x300, 8-bit RGBA, 2294 bytes. |
| Screenshots, 1-5, PNG, exactly 1366x768, each <= 1024 KB | `assets/screenshots/01-hierarchy-overview.png`<br>`assets/screenshots/02-expand-collapse.png`<br>`assets/screenshots/03-search-diagnostics.png` | Present. All 1366x768, all well under 1024 KB. |
| Support URL, https | `https://atlyn.io/contact` | Live. |
| Privacy policy URL, https | `https://atlyn.io/legal/privacy` | Live. |
| EULA | `EULA.md` | Present. Grants the same permissive MIT terms as `LICENSE`. |
| Terms of use (reference) | `https://atlyn.io/legal/terms` | Live, referenced from `EULA.md`. |
| Pricing | Free | No transactable offer. See Licensing above. |
| Sample report, fully offline | `samples/AtlynHierarchyExplorerSample.pbip` | Project committed. The `.pbix` itself needs one manual Power BI Desktop step - see section 3. |

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

## 3. Sample report

Partner Center requires a sample report that "works fully offline with no
external connections". This repository ships it as a Power BI Project:

```text
samples/AtlynHierarchyExplorerSample.pbip
samples/AtlynHierarchyExplorerSample.Report/          PBIR report definition
samples/AtlynHierarchyExplorerSample.SemanticModel/   TMDL model, inline data
samples/hierarchy-data.json                           the rows, in one place
```

Rebuild it at any time with `npm run package && npm run sample-report`. The
generator derives the visual GUID from `pbiviz.json` and the data-role bindings
from `capabilities.json`, so the sample cannot drift from the visual it demos,
and `npm run verify-package` fails the build if the embedded copy of the
`.pbiviz` is stale.

### Why it is offline

- The data is a **DAX calculated table** built with `DATATABLE`, not a Power
  Query partition. A calculated table has **no data source at all**, so nothing
  can prompt for credentials, there is no privacy-level or formula-firewall
  surface, and the report carries no refresh dependency.
  `tests/sample-report.test.ts` asserts the partition is `= calculated`, that no
  Power Query construct survives, and that no connector or URL string appears
  anywhere in the model.
- `DATATABLE` accepts literal constants only, so the root row's missing
  `ParentId` is written as an empty string rather than `BLANK()`. That is
  behaviourally identical here: `normalizeId` in `src/graph.ts` trims and
  returns null for an empty string, so the visual already reads an empty
  `ParentId` as a root.
- The visual is embedded as a **private custom visual** under
  `AtlynHierarchyExplorerSample.Report/CustomVisuals/atlynHierarchyExplorer/`,
  registered through `resourcePackages` in `report.json`. Microsoft loads
  AppSource and organisational visuals automatically from the store instead, so
  `publicCustomVisuals` would require a connection; the tests assert it is
  absent.
- All seven data roles are bound: `NodeId`, `ParentId`, `Label`, `Subtitle` and
  `Category` project columns, while `Value` and `Tooltips` use a `Sum`
  aggregation.

### Format versions

`definition.pbir` declares `"version": "4.0"` and `definition.pbism` declares
`"version": "4.2"`. These are not arbitrary. Microsoft documents version `1.0`
as meaning the report definition **must** be PBIR-Legacy in `report.json` and the
semantic model **must** be TMSL in `model.bim`. This project uses the PBIR
`definition\` folder and the TMDL `definition\` folder, both of which require
`4.0` or above. Declaring `1.0` while shipping the folder formats would
contradict the declared format. `tests/sample-report.test.ts` pins both.

### Do not reach for pbi-tools

`pbi-tools compile` cannot produce a PBIT or PBIX against the Power BI Desktop
build on the development machine. It fails with:

```text
System.MissingMethodException: Method not found:
'Void Microsoft.PowerBI.Packaging.PowerBIPackager.Save(...)'
```

pbi-tools 1.2.0 is incompatible with the Desktop 2.150.2102.0 packaging API. Its
`extract` and `convert` verbs still work, but `compile` does not, so nothing in
this repository depends on it. The native PBIP folder format used here needs no
third-party tooling at all: Power BI Desktop opens the `.pbip` directly.

### The one manual step: producing the .pbix

A `.pbix` cannot be generated outside Power BI Desktop. Its model is stored as a
binary Analysis Services backup image - the same reason `pbi-tools compile`
supports PBIX output only for report-only ("thin") projects and PBIT otherwise.
So the project is committed and the `.pbix` is produced once, by hand:

1. In Power BI Desktop, go to **File > Options and settings > Options > Preview
   features** and enable **Power BI Project (.pbip) save option** and **Store
   reports using enhanced metadata format (PBIR)**. Restart Desktop. Both are
   still preview features.
2. Open `samples/AtlynHierarchyExplorerSample.pbip`.
3. Let the model load. There is no data source, so there must be no credential
   prompt and no refresh step; the calculated table is evaluated by the engine.
   If Desktop asks for credentials, something external crept into the model and
   the sample is no longer valid.
4. Confirm the visual renders the hierarchy on the **Hierarchy overview** page.
5. **File > Save As** and choose `.pbix`. Keep it outside the repository - the
   `.pbix` is a build output and is deliberately not committed.
6. Upload that `.pbix` to Partner Center as the sample report.

Desktop may normalise the project files when it saves. That is expected; rerun
`npm run sample-report` to restore the canonical generated state. Opening the
project also writes `.pbi/cache.abf`, an Analysis Services backup containing the
model *and its data* - `.gitignore` already excludes it.

## 4. Privacy and permissions posture

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

## 5. Commands

```text
npm ci
npm test
npm run typecheck
npm run eslint
npm run package                     # build, normalise, verify, validate assets, write manifest
npm run sample-report               # regenerate the offline sample project
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

## 6. Remaining manual steps (owner only)

These cannot be completed from this repository and are not simulated here.

1. **Produce the sample `.pbix`** by opening
   `samples/AtlynHierarchyExplorerSample.pbip` in Power BI Desktop and doing
   *Save As* - the full procedure is in section 3. The project, its offline data
   and the embedded visual are already built and validated; only this one
   Desktop step is left.
2. **Create or confirm the Partner Center account** and complete publisher
   verification for Atlyn.
3. **Upload** `dist/atlynHierarchyExplorer.1.0.1.0.pbiviz` from a clean
   `npm run package`, together with the sample `.pbix`, the logo and the three
   screenshots.
4. **Enter the listing text** - short and long description, category, supported
   languages - and the support, privacy and EULA values from sections 1 and 2.
   Set the offer to **free**; do not configure a transactable offer.
5. **Submit for Microsoft review.** Everything in this repository is
   preparation; approval, certification status and store listing are decided by
   Microsoft and are not claimed here.

## 7. Kept in sync

`scripts/validate-publication-assets.cjs` cross-checks this document against
`pbiviz.json` on every build and fails if the support URL, privacy policy URL,
GUID, version, EULA path, free-listing decision or sample project path recorded
above stops matching the repository. Update both together.
