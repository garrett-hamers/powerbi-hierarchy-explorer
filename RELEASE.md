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
3. Record the package filename and SHA-256 hash from `dist/` in the release
   or pull request description.
4. After the final change is merged to `main`, create the lowercase
   `certification` branch from that exact commit when a reviewer needs a
   submission snapshot.

Passing these local gates is not Microsoft certification and does not replace
AppSource submission, Microsoft review, or validation in a live Power BI host.
