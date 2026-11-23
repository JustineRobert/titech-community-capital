# Migration and index remediation

## Source changes

- `backend/scripts/migrate.js`: converted to native ESM, delayed environment and runtime dependency loading, validates CLI options, retains useful exit codes and disconnects MongoDB after command execution when a connection exists.
- `backend/utils/migrationRunner.js`: native ESM runner; discovers JS/MJS/CJS sources; hashes source with SHA-256; verifies completed checksum; claims and renews a lease; persists completion/failure state through guarded model statics; checks registry records with missing source files.
- `backend/models/Migration.js`: guarded mutation options used by model-owned migration statics; batch claim parameter validated; completion/failure persist duration and completion checksum with state changes.
- `backend/utils/migrationModuleLoader.js`: native ESM loader plus compatibility execution for historical CommonJS migrations without renaming `.js` files or altering their stored source hash.
- `backend/scripts/createIndexes.js` and `backend/utils/indexCreation.js`: native ESM; validated key/options; no swallowed createIndex errors; dependency loading is lazy and the process exits non-zero on failure.

## Verified here

- `node --check` on migration/index entrypoints and utilities: PASS.
- Migration CLI `help`: PASS without runtime packages.
- Historical CommonJS loader, native ESM loader, empty-file rejection, index key validation, successful mocked index creation, index error propagation, runner lease/checksum source contract, atomic state/duration source contract and actionable missing-dependency messages: covered by focused tests.
- Focused suite: 29/29 PASS.

## Blocked

`migrate:status`, `migrate:verify`, `migrate:up`, `index:create` were not run against MongoDB. Current execution reports the actionable missing `dotenv` instruction because the package trees are not installed. No disposable MongoDB database or replica set is available. Index state, migration status/history, rollback behavior, transactional semantics, interruption recovery and real concurrency are not certified. Do not run migrations against the actual `community_savings` production database without a reviewed backup, an isolated rehearsal and authorized change window.
