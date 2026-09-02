// scripts/migrate.js
// ============================================================================
// Database Migration CLI
// Usage: node scripts/migrate.js <command> [options]
// Commands: up, down, status, list, verify
// ============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const logger = require('../utils/logger');
const MigrationRunner = require('../utils/migrationRunner');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

/**
 * Connect to database
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
    });
    logger.info('✓ Connected to MongoDB');
  } catch (error) {
    logger.error('✗ Failed to connect to MongoDB', error);
    process.exit(1);
  }
}

/**
 * Disconnect from database
 */
async function disconnectDB() {
  try {
    await mongoose.disconnect();
    logger.info('✓ Disconnected from MongoDB');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB', error);
  }
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Database Migration CLI
======================

Usage: node scripts/migrate.js <command> [options]

Commands:
  up                Run pending migrations
  down              Rollback last batch of migrations
  status            Show migration status
  list              List all migrations
  verify            Verify migration integrity
  help              Show this help message

Options:
  --batch <number>  Specific batch to rollback
  --dry-run         Don't actually run migrations
  --environment     Override NODE_ENV

Examples:
  node scripts/migrate.js up
  node scripts/migrate.js down --batch 1
  node scripts/migrate.js status
  node scripts/migrate.js up --dry-run
  `);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const options = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--batch' && args[i + 1]) {
      options.batch = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--environment' && args[i + 1]) {
      options.environment = args[i + 1];
      i++;
    }
  }

  return { command, options };
}

/**
 * Format table output
 */
function printTable(migrations) {
  if (migrations.length === 0) {
    console.log('No migrations found');
    return;
  }

  console.log(
    '\n┌─────────────────────────────────────────────────────┬───────────────┬──────────────────┬──────────┐'
  );
  console.log(
    '│ Version                                             │ Status        │ Duration         │ Batch    │'
  );
  console.log(
    '├─────────────────────────────────────────────────────┼───────────────┼──────────────────┼──────────┤'
  );

  for (const m of migrations) {
    const version = (m.version || '').padEnd(53);
    const status = (m.status || 'pending').padEnd(15);
    const duration = (m.duration ? `${m.duration}ms` : '-').padEnd(18);
    const batch = (m.batch || '-').toString().padEnd(8);

    console.log(`│ ${version} │ ${status} │ ${duration} │ ${batch} │`);
  }

  console.log(
    '└─────────────────────────────────────────────────────┴───────────────┴──────────────────┴──────────┘'
  );
}

/**
 * Main CLI execution
 */
async function main() {
  const { command, options } = parseArgs();

  try {
    await connectDB();

    const runner = new MigrationRunner(MIGRATIONS_DIR);

    switch (command) {
      case 'up': {
        console.log('\n📦 Running pending migrations...\n');
        const result = await runner.runPending({
          dryRun: options.dryRun,
          environment: options.environment || process.env.NODE_ENV,
        });

        if (options.dryRun) {
          console.log(`\n[DRY RUN] Would have run ${result.migrationsRun} migration(s)`);
        } else {
          const status = result.success ? '✓ SUCCESS' : '✗ FAILED';
          console.log(`\n${status}: ${result.migrationsRun} migration(s) executed`);

          if (result.results) {
            for (const res of result.results) {
              const icon = res.success ? '✓' : '✗';
              console.log(`${icon} ${res.version} (${res.duration || 'error'}ms)`);
            }
          }
        }
        break;
      }

      case 'down': {
        console.log('\n📦 Rolling back migrations...\n');
        const result = await runner.rollbackBatch({
          batch: options.batch,
          dryRun: options.dryRun,
        });

        if (options.dryRun) {
          console.log(`\n[DRY RUN] Would have rolled back ${result.rolledBack} migration(s)`);
        } else {
          const status = result.success ? '✓ SUCCESS' : '✗ FAILED';
          console.log(`\n${status}: ${result.rolledBack} migration(s) rolled back`);

          if (result.results) {
            for (const res of result.results) {
              const icon = res.success ? '✓' : '✗';
              console.log(`${icon} ${res.version} (${res.duration || 'error'}ms)`);
            }
          }
        }
        break;
      }

      case 'status': {
        console.log('\n📊 Migration Status\n');
        const status = await runner.getStatus();

        console.log(`Total Migrations: ${status.total}`);
        console.log(`Completed: ${status.completed}`);
        console.log(`Pending: ${status.pending}`);
        console.log(`Failed: ${status.failed}`);

        printTable(status.migrations);
        break;
      }

      case 'list': {
        console.log('\n📋 All Migrations\n');
        const migrations = await runner.listMigrations();
        printTable(migrations);
        break;
      }

      case 'verify': {
        console.log('\n🔍 Verifying migrations...\n');
        const verify = await runner.verify();

        if (verify.isHealthy) {
          console.log('✓ All migrations are healthy');
        } else {
          console.log('✗ Issues found:');
          for (const issue of verify.issues) {
            console.log(`  - ${issue}`);
          }
        }

        console.log('\nSummary:');
        printTable(verify.summary);
        break;
      }

      case 'help':
      default:
        printHelp();
        break;
    }

    await disconnectDB();
  } catch (error) {
    logger.error('Migration failed', error);
    await disconnectDB();
    process.exit(1);
  }
}

main();
