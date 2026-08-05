# Release checklist

This repository contains the source for the Atlyn Hierarchy Explorer Power BI
custom visual. A release package is generated locally or in CI; generated
packages are intentionally not committed.

1. Update `package.json` and `pbiviz.json` together. The visual version is the
   npm version with a fourth numeric component.
2. Run the exact repository gates:

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

   `npm run package` removes prior package output, creates one fresh
   `dist/*.pbiviz`, normalizes ZIP entry order, timestamps, permissions,
   platform, and compression, verifies publication assets, and verifies its
   generated manifest against the source capabilities, dependencies, and stable
   metadata. It also writes `dist/release-manifest.json` with the package
   filename, byte length, uppercase SHA-256, source commit, visual GUID/version,
   support/privacy URLs, author email, Partner Center logo and screenshot
   metadata (path/hash/bytes/dimensions), EULA and dossier paths, and the
   normalization policy. The reproducibility gate runs two clean packages and
   requires identical bytes and SHA-256.
3. Record `dist/release-manifest.json` with the `.pbiviz` artifact when
   publishing to immutable Blob/AppSource storage. Rebuilds from identical
   source and locked dependencies must produce the same package hash.
4. If the visual's appearance or interaction changed, regenerate the AppSource
   screenshots so the listing matches what ships. This needs a browser, which is
   intentionally not a dependency of this package:

   ```text
   npm install --no-save playwright
   npx playwright install chromium
   npm run package
   npm run screenshots
   ```

   Screenshot bytes are not reproducible across machines because font
   rasterisation differs; the enforced contract is exact 1366x768 dimensions,
   the 1024 KB ceiling, PNG structure, and non-placeholder content. The content
   of each scene is enforced at capture time instead: `npm run screenshots`
   asserts what every scene must contain - counts, interaction state and
   measured geometry - and refuses to write a PNG whose scene did not render,
   deleting the committed image rather than leaving a stale one in place. CI
   runs the same gate as `npm run verify-screenshots`, which writes nothing, so
   the scenes are checked on every push even when no image is regenerated.
5. Review `docs/partner-center-submission.md` before submitting. It holds every
   Partner Center field with its final value and the manual steps that remain.
   If the visual changed, regenerate the offline sample report so it demos the
   build being submitted:

   ```text
   npm run sample-report
   ```

   `npm run verify-package` fails if the copy of the `.pbiviz` embedded in
   `samples/` is stale. The `.pbix` Partner Center uploads is produced from that
   project with one *Save As* in Power BI Desktop; it cannot be generated
   headlessly and is deliberately not committed.
6. After the final change is merged to `main`, create the lowercase
   `certification` branch from that exact commit when a reviewer needs a
   submission snapshot.

Passing these local gates is not Microsoft certification and does not replace
AppSource submission, Microsoft review, or validation in a live Power BI host.
