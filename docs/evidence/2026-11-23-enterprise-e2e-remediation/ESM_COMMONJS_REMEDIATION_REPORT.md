# ESM/CommonJS compatibility report

The checked-in backend runner design is: `backend/package.json` declares ESM for `.js` source; `backend/jest.config.cjs` is intentionally CommonJS; Jest runs native ESM with `--experimental-vm-modules`, no Babel transform, and `.cjs` for deliberate CommonJS suites. `.mjs` suites are intentionally for Node's native test runner, not Jest. This explicit design was preserved.

The module audit did **not** pass: 2,096 files scanned, 464 ESM, 1,361 CJS, 45 mixed and 226 neutral; 207 unresolved relative `require()` references; 351 CJS→ESM relative boundaries. A separate release gate warns of 208 missing local imports. No package-wide extension or module-format migration was attempted because there are no dependencies/Jest runtime here to reproduce execution and safely establish each consumer contract. Specific historical errors (`jest is not defined`, `require is not defined`, missing default exports, Vitest imported via require) therefore remain **unverified and not claimed fixed**.

Next action: switch to Node 24.15.x/npm 11+, perform clean lockfile-based installs, execute the configured Jest and Vitest runners, then resolve each named boundary with import-order-correct ESM mocks or true CommonJS contracts and regression coverage. Do not mass-add default exports or globally use `createRequire`.
