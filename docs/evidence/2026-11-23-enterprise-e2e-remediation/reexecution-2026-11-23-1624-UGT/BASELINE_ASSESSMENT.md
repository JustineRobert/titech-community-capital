# Baseline assessment — 23 November 2026

## Input and provenance

- Input artifact: `titech-community-capital-main.zip` (user-uploaded source snapshot).
- SHA-256 of uploaded archive: `7c52234346c1ef2d2de7e9671ef86e968c653363959cac9857b307c75742bf7f`.
- Archive entries: 4,718 entries including directories; 4,054 original files after excluding directory entries.
- Extracted working directory: `/mnt/data/titech-work/titech-community-capital-main`.
- `.git` directory: **absent**. Branch, HEAD, remotes, Git working-tree status, source commit, base-branch comparison, commit and push cannot be established from this archive.
- No original application source file was intentionally discarded. The U+202F narrow no-break space in the original circular seal asset filename was restored exactly; its file SHA-256 remains `dad4787284cfeff72eb1a3295c1c5ca7aba820c2e6575e45153fe1a8879f2826`.

## Runtime and infrastructure

- Observed Node.js: `v22.16.0`.
- Observed npm: `10.9.2`.
- Observed GNU Make: `4.4.1`.
- Repository `.nvmrc`: `24.15.0`.
- Root/backend/frontend engine contract: Node `>=24.15.0`, npm `>=11.0.0`.
- `node_modules`: absent at root, backend and frontend.
- MongoDB, Redis, Docker CLI/daemon, Vercel CLI, `mongod`, and `redis-server`: unavailable.
- Ports 3000, 5000, 9090, 27017 and 6379: no listeners observed during inspection.
- npm registry access: `EAI_AGAIN registry.npmjs.org` and request timeouts during independent audit attempts.
- No local `.env` or `.env.local` was found; no credentials were copied into evidence.

## Architecture and package baseline

- Root, backend and frontend each have a package manifest and lockfile.
- Backend is declared as ES modules; the legacy migration and index CLI entrypoints contained CommonJS `require` assumptions.
- `dotenv` is already a direct backend dependency and present in the backend lockfile; `bcrypt` is declared as `6.0.0`; `moment@2.30.1` is present in the backend lockfile transitively. No dependency declaration or lockfile was changed in this run.
- Existing same-origin Vercel API bridge and established React/Vite/Express/Mongoose/Redis/authentication/tenant/ledger architecture were preserved.
- Existing official theme and brand profile passed their current automated gates; no replacement design system or palette was introduced.

## Baseline risk statement

The archive can support source-level remediation and dependency-free tests, but it cannot supply Git history or live operations. Runtime incompatibility prevents the prescribed clean `npm ci`; this blocks all dependency-backed work and must be corrected before claiming reproducible installation or a running application. The machine-readable summary is `baseline-assessment.json`.
