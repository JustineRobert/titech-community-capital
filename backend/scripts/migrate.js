#!/usr/bin/env node
/** TITech Community Capital — database migration CLI (native ESM). */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importBackendDependency, loadBackendEnvironment } from '../utils/backendDependencyLoader.js';

const CURRENT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

let mongoose;
let logger;
let MigrationRunner;

async function loadCliDependencies() {
  const [mongooseModule, loggerModule, runnerModule] = await Promise.all([
    importBackendDependency('mongoose'),
    importBackendDependency('../utils/logger.js'),
    importBackendDependency('../utils/migrationRunner.js'),
  ]);
  mongoose = mongooseModule.default;
  logger = loggerModule.default;
  MigrationRunner = runnerModule.default;
}

const MIGRATIONS_DIR = path.resolve(CURRENT_DIRECTORY, '../migrations');

function parseArgs(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (item === '--dry-run') options.dryRun = true;
    else if (item === '--batch') {
      const value = Number(rest[index + 1]);
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('--batch must be a non-negative safe integer.');
      options.batch = value;
      index += 1;
    } else if (item === '--environment') {
      options.environment = rest[index + 1];
      if (!options.environment) throw new TypeError('--environment requires a value.');
      index += 1;
    } else {
      throw new TypeError(`Unknown migration option: ${item}`);
    }
  }
  return { command, options };
}

function printHelp() {
  console.log(`\nTITech Community Capital database migrations\n\nUsage: npm --prefix backend run migrate:<status|verify|up>\n       node scripts/migrate.js <up|down|status|list|verify|help> [options]\n\nOptions:\n  --batch <number>       Select a rollback batch\n  --dry-run              Report the proposed change without executing it\n  --environment <name>   development, test, staging or production\n`);
}

function printTable(migrations) {
  if (!migrations.length) {
    console.log('No migration files found.');
    return;
  }
  console.table(migrations.map((migration) => ({
    version: migration.version,
    status: migration.status,
    batch: migration.batch ?? '',
    durationMs: migration.durationMs ?? '',
    checksumPresent: migration.checksumPresent ?? '',
  })));
}

async function connectDB() {
  const uri = process.env.TITECH_MONGODB_URI || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Database URI is not configured. Set MONGO_URI or MONGODB_URI in backend/.env.');
  await mongoose.connect(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10_000 });
  logger.info('Migration CLI connected to MongoDB', { database: mongoose.connection.name });
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

async function main() {
  let exitCode = 0;
  try {
    const { command, options } = parseArgs();
    if (command === 'help') {
      printHelp();
      return 0;
    }

    await loadBackendEnvironment({ backendDirectory: path.resolve(CURRENT_DIRECTORY, '..') });
    await loadCliDependencies();
    const environment = options.environment || process.env.NODE_ENV || 'development';
    const runner = new MigrationRunner(MIGRATIONS_DIR, { environment });
    await connectDB();
    if (command === 'up') {
      const result = await runner.runPending(options);
      console.log(options.dryRun ? `DRY RUN: ${result.migrationsRun} migration(s) are pending.` : `Migration run: ${result.success ? 'PASS' : 'FAIL'} (${result.migrationsRun} attempted).`);
      if (result.results?.length) console.table(result.results);
      if (!result.success) exitCode = 1;
    } else if (command === 'down') {
      const result = await runner.rollbackBatch(options);
      console.log(options.dryRun ? `DRY RUN: ${result.rolledBack} migration(s) would be rolled back.` : `Rollback: ${result.success ? 'PASS' : 'FAIL'} (${result.rolledBack} completed).`);
      if (result.results?.length) console.table(result.results);
      if (!result.success) exitCode = 1;
    } else if (command === 'status') {
      const result = await runner.getStatus();
      console.log(`Environment: ${result.environment}`);
      console.log(`Total: ${result.total}; pending: ${result.pending}; running: ${result.running}; completed: ${result.completed}; failed: ${result.failed}; rolled back: ${result.rolled_back}`);
      printTable(result.migrations);
    } else if (command === 'list') {
      printTable(await runner.listMigrations());
    } else if (command === 'verify') {
      const result = await runner.verify();
      console.log(`Migration verification: ${result.isHealthy ? 'PASS' : 'FAIL'}`);
      for (const issue of result.issues) console.error(`- ${issue}`);
      printTable(result.summary);
      if (!result.isHealthy) exitCode = 1;
    } else {
      throw new TypeError(`Unknown migration command: ${command}`);
    }
  } catch (error) {
    logger?.error?.('Migration CLI failed', error);
    console.error(`Migration CLI failed: ${error.message}`);
    exitCode = 1;
  } finally {
    if (mongoose && mongoose.connection.readyState !== 0) {
      try {
        await disconnectDB();
        logger?.info?.('Migration CLI disconnected from MongoDB');
      } catch (error) {
        logger?.error?.('Migration CLI database disconnect failed', error);
        console.error(`Migration CLI disconnect failed: ${error.message}`);
        exitCode = 1;
      }
    }
  }

  return exitCode;
}

process.exitCode = await main();
