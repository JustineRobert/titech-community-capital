# Jest/Vitest configuration report

- Backend Jest config: `backend/jest.config.cjs`, CommonJS config, Node environment, native ESM tests supported via `--experimental-vm-modules`, transform disabled, `.js`/`.cjs` patterns; `.mjs` deliberately excluded for Node-native tests.
- Backend test command: `node --experimental-vm-modules ... ./node_modules/jest/bin/jest.js`.
- Frontend config and scripts were inspected; frontend dependencies are absent, so Vitest discovery and run were not verified.
- Root `test:ci` runs its native test preflight first, then backend Jest, then frontend CI. Actual execution passed the 24 native groups (292/292) and failed when launching the absent Jest binary. This is a dependency/environment launch failure, not a result of 484 current tests failing.
- No `--forceExit`, `passWithNoTests`, global coverage exclusion or broad test path suppression was introduced.
