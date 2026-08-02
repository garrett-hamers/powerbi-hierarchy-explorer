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
   npm run certification-audit
   npm audit
   ```

   `npm run package` removes prior package output, creates one fresh
   `dist/*.pbiviz`, and verifies its generated manifest against the source
   capabilities, dependencies, and stable metadata.
3. `npm run package` normalizes all local and central ZIP entry timestamps to
   `1980-01-01T00:00:00Z`, verifies those normalized fields, and writes
   `dist/release-manifest.json`. The manifest records the package filename,
   byte length, uppercase SHA-256, source commit, visual GUID/version, and the
   normalization policy. The SHA-256 is therefore the hash of the normalized
   `.pbiviz` ZIP, not an unnormalized tool output.
4. Record `dist/release-manifest.json` with the `.pbiviz` artifact when
   publishing to immutable Blob/AppSource storage. Rebuilds from identical
   source and locked dependencies must produce the same package hash.
5. After the final change is merged to `main`, create the lowercase
   `certification` branch from that exact commit when a reviewer needs a
   submission snapshot.

Passing these local gates is not Microsoft certification and does not replace
AppSource submission, Microsoft review, or validation in a live Power BI host.
