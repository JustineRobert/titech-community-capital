# Vercel build and dependency remediation

**Updated:** 24 November 2026

## Package ownership and reproducible install

TITech has three independently locked npm packages:

1. Repository root — `package.json` / `package-lock.json`.
2. Backend — `backend/package.json` / `backend/package-lock.json`.
3. Frontend — `frontend/package.json` / `frontend/package-lock.json`.

The `backend/backend/package-lock.json` file is retained because it is present in the supplied archive, but no corresponding nested `backend/backend/package.json` exists. It is therefore not an active install target in the current package architecture; it has not been deleted.

A root-only `npm ci` installs only the root package. The supported full-install entry point is `npm run install:all` (or `npm run setup`), which invokes `scripts/safe-install.mjs` and installs root, backend and frontend in sequence using their respective lockfiles. The setup scripts now call this single guarded installer instead of duplicating package installation logic.

## Supported runtime

- Node.js: `>=24.15.0 <25`.
- npm: `>=11.0.0`.
- `.nvmrc`: `24.15.0`.
- `.npmrc`: `engine-strict=true`.

Root, backend and frontend manifests and lockfile root metadata carry the bounded Node engine. Backend and frontend also contain local `.nvmrc` pins. The safe installer refuses to proceed on an unsupported runtime.

## Jest and Terser

The missing Jest and Terser executables were not missing manifest dependencies in the supplied source snapshot:

- Backend declares Jest in `backend/package.json` and locks it in `backend/package-lock.json`.
- Frontend declares Terser in `frontend/package.json` and locks it in `frontend/package-lock.json`; the Vite config explicitly selects Terser.

They were missing from `node_modules` in the observed environment. The corrective action is to execute the complete package installation contract, not install global tools or add duplicated packages. This execution could not install them because the available Node/npm runtime is below the strict engine range and npm registry DNS was unavailable.

## Backend build command

The backend `build` script now performs `node --check server.js` followed by the existing route-module import diagnostic. This validates the backend entry and route graph after backend dependencies are installed. It does not compile Express into a standalone binary and does not prove runtime health or database connectivity.

The root `build` script now runs backend validation and the frontend production build in sequence.

## npm cache configuration and deprecation notices

The project `.npmrc` contains only `engine-strict=true`; no `cache-dir` key was found there. The npm cache setting is the supported `cache` property. The inspected environment contained no `NPM_CONFIG_CACHE_DIR`/`npm_config_cache_dir` variable. The old Vercel warning source cannot be conclusively attributed without access to Vercel's environment and user/global npm configuration at the time of the warning.

The following lockfile entries remain under investigation and were not mass-upgraded without a compatible install/test cycle:

- `inflight@1.0.6` is transitive from legacy `glob@7.2.3`.
- `glob@7.2.3` remains in backend and frontend trees; `glob@10.5.0` appears in backend dependency paths (including Google/OpenTelemetry-related paths) and frontend test-exclude paths.
- `rimraf@3.0.2` remains in the backend and frontend trees, with some newer `rimraf` versions also present in nested paths.
- `@humanwhocodes/config-array@0.13.0` and `@humanwhocodes/object-schema@2.0.3` are pulled by `eslint@8.57.1`.
- ESLint is a development dependency. ESLint 8 is past its supported lifecycle; a coordinated ESLint 9/flat-config and plugin migration needs a Node 24 clean install and full lint/test run.

`npm explain`, `npm outdated`, and a live `npm audit` could not be completed against an installed tree. Registry/network access was unavailable. No claim is made that all deprecation warnings or advisories are resolved.
