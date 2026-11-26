# Dependency and installation report — 24 November 2026

## Package inventory

| Package | Manifest | Lockfile | Active install target |
|---|---|---|---|
| Root | `package.json` | `package-lock.json` | Yes |
| Backend | `backend/package.json` | `backend/package-lock.json` | Yes |
| Frontend | `frontend/package.json` | `frontend/package-lock.json` | Yes |
| Nested backend folder | No `backend/backend/package.json` found | `backend/backend/package-lock.json` exists but has no package root/dependency tree | No; preserved for historical review |

All three active lockfiles are lockfileVersion 3 and root engine metadata was synchronized. No lockfile was deleted or regenerated.

## Runtime/install findings

Current executor: Node `22.16.0`, npm `10.9.2`. Required: Node `>=24.15.0 <25`, npm `>=11.0.0`. `.npmrc` has `engine-strict=true`; `.nvmrc` is `24.15.0`. The backend/frontend packages now also carry the Node pin.

`npm ci` at root does not install independent frontend/backend manifests. Use `npm run install:all` (or `npm run setup`) to call `scripts/safe-install.mjs`, which applies the supported runtime and port/process guard and runs three sequential `npm ci` operations.

No install was attempted under the unsupported runtime. Registry DNS could not be resolved in this execution environment. The current working tree has no package `node_modules` directories.

## Jest and Terser ownership

- Backend Jest `^30.5.2` is a backend devDependency; lock resolves `30.5.2`.
- Frontend Terser `^5.47.1` is a frontend devDependency; lock resolves `5.51.2`.
- Frontend Vite `^8.2.2` is declared/locked. The Vite configuration intentionally requests Terser.

The two reported errors are installation-state issues, not missing package declarations in the supplied manifests.

## Warning ancestry

The backend/frontend lockfiles show:

- `inflight@1.0.6` below legacy `glob@7.2.3`.
- `glob@7.2.3` via older tooling paths and `glob@10.5.0` under backend Google/OpenTelemetry related paths and frontend test-exclude paths.
- `rimraf@3.0.2` under development dependency paths such as flat-cache; other nested rimraf versions also exist.
- `@humanwhocodes/config-array@0.13.0` and `@humanwhocodes/object-schema@2.0.3` are pulled by `eslint@8.57.1`.
- ESLint is a development dependency in the frontend/backend package manifests.

These warnings have not been fully remediated. A safe ESLint 9 migration requires coordinated flat-config and plugin updates plus a clean install/lint test. No blind overrides or `npm audit fix --force` were applied.

## Audit limitations

`npm explain`, `npm outdated`, and network-backed `npm audit` were not completed because no installed tree/registry was available. Security audit outcome: **NOT VERIFIED**, not “zero vulnerabilities”.

## npm cache warning

Project `.npmrc` contains no `cache-dir`; it only sets `engine-strict=true`. The current environment did not expose `NPM_CONFIG_CACHE_DIR` or `npm_config_cache_dir`. The warning's original Vercel/global source remains unconfirmed. The supported npm option is `cache`, not `cache-dir`.
