# Contributing

1. Keep the table-mapped `NodeId`/`ParentId`/`Label` contract explicit and
   preserve deterministic first-row identity for duplicate NodeId values.
2. Keep Power BI host interactions on documented typed APIs and preserve
   certification-safe constraints: no network requests, external assets,
   unsafe HTML, dynamic code, or privileges.
3. Run the repository gates before opening a pull request:

   ```text
   npm ci
   npm test
   npm run typecheck
   npm run eslint
   npm run package
   npm run certification-audit
   npm audit
   ```

4. Describe host assumptions and limitations in the pull request. Passing
   local gates is not a claim of Microsoft certification or live-host
   validation.
