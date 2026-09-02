'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * SaaS Billing Consolidation Migration Runner
 * =============================================================================
 *
 * File:
 *   backend/scripts/commercial/runSaasBillingMigration.js
 *
 * Stage:
 *   01C
 *
 * Purpose:
 *   Enterprise CLI entry point for the TITech SaaS billing consolidation
 *   migration.
 *
 * Responsibilities:
 *   - Load backend environment safely.
 *   - Validate runtime and migration prerequisites.
 *   - Establish an explicit MongoDB connection.
 *   - Perform a non-mutating database/source inventory preflight.
 *   - Execute the canonical consolidation migration.
 *   - Support dry-run and strict record-error modes.
 *   - Distinguish empty-source completion from normal data migration.
 *   - Optionally require source data before APPLY mode can succeed.
 *   - Emit deterministic, operator-friendly results.
 *   - Close MongoDB connections on every exit path.
 *   - Never expose database credentials in logs.
 *
 * This runner NEVER:
 *   - mutates wallets directly;
 *   - mutates ledger entries directly;
 *   - settles customer payments;
 *   - rewrites financial transactions;
 *   - drops legacy billing collections.
 *
 * IMPORTANT ARCHITECTURE:
 *   The canonical migration owns:
 *     - source mapping;
 *     - source normalization;
 *     - record transformation;
 *     - canonical upserts;
 *     - migration locking;
 *     - migration state;
 *     - detailed reconciliation.
 *
 * This runner intentionally does NOT duplicate that logic.
 *
 * Usage:
 *
 *   npm run migrate:saas-billing
 *
 * Dry run:
 *
 *   npm run migrate:saas-billing -- --dry-run
 *
 * Strict record-error mode:
 *
 *   npm run migrate:saas-billing -- --strict
 *
 * Combined:
 *
 *   npm run migrate:saas-billing -- --dry-run --strict
 *
 * Require actual source data:
 *
 *   TITECH_SAAS_BILLING_MIGRATION_REQUIRE_SOURCE_DATA=true \
 *   npm run migrate:saas-billing
 *
 * Environment variables:
 *
 *   MONGO_URI / MONGODB_URI
 *   MONGO_URI_FALLBACK / MONGODB_URI_FALLBACK
 *
 *   TITECH_SAAS_BILLING_MIGRATION_DRY_RUN
 *   TITECH_SAAS_BILLING_MIGRATION_FAIL_ON_RECORD_ERRORS
 *   TITECH_SAAS_BILLING_MIGRATION_BATCH_SIZE
 *   TITECH_SAAS_BILLING_MIGRATION_MAX_RECORD_ERRORS
 *
 *   TITECH_SAAS_BILLING_MIGRATION_REQUIRE_CONFIRMATION
 *   TITECH_SAAS_BILLING_MIGRATION_CONFIRMED
 *
 *   TITECH_SAAS_BILLING_MIGRATION_REQUIRE_SOURCE_DATA
 *   TITECH_SAAS_BILLING_MIGRATION_REPORT_COLLECTION_INVENTORY
 *
 *   TITECH_LEGACY_BILLING_PLANS_COLLECTION
 *   TITECH_LEGACY_SUBSCRIPTIONS_COLLECTION
 *   TITECH_LEGACY_INVOICES_COLLECTION
 *   TITECH_LEGACY_USAGE_COLLECTION
 *
 * =============================================================================
 */

const fs = require('fs');
const path = require('path');
const process = require('process');
const mongoose = require('mongoose');

const logger = require('../../utils/logger');

const MIGRATION_PATH =
  '../../migrations/20260830_120000_consolidate_titech_saas_billing';

const MIGRATION_NAME =
  '20260830_120000_consolidate_titech_saas_billing';

const CANONICAL_COLLECTIONS = Object.freeze({
  plans: 'titech_billing_plans',
  subscriptions: 'titech_subscriptions',
  invoices: 'titech_billing_invoices',
  usage: 'titech_usage_records',
  migrationState: 'titech_billing_migration_state',
});

const SOURCE_ENVIRONMENT_VARIABLES = Object.freeze({
  plans: 'TITECH_LEGACY_BILLING_PLANS_COLLECTION',
  subscriptions: 'TITECH_LEGACY_SUBSCRIPTIONS_COLLECTION',
  invoices: 'TITECH_LEGACY_INVOICES_COLLECTION',
  usage: 'TITECH_LEGACY_USAGE_COLLECTION',
});

const DEFAULTS = Object.freeze({
  serverSelectionTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
  socketTimeoutMS: 120_000,
  maxPoolSize: 10,
  minPoolSize: 0,
  batchSize: 500,
  maxRecordErrors: 25,
  requireSourceData: false,
  reportCollectionInventory: true,
});

const LIKELY_BILLING_COLLECTION_PATTERN =
  /(billing|bill|subscription|subscriptions|invoice|invoices|usage|plan|plans|saas)/i;

const SOURCE_CATEGORIES = Object.freeze([
  'plans',
  'subscriptions',
  'invoices',
  'usage',
]);

let shuttingDown = false;
let exitCode = 0;

/**
 * -----------------------------------------------------------------------------
 * Environment loading
 * -----------------------------------------------------------------------------
 */

function loadEnvironment() {
  const dotenv = require('dotenv');

  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];

  const loaded = [];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    dotenv.config({
      path: envPath,
    });

    loaded.push(envPath);
  }

  return loaded;
}

/**
 * -----------------------------------------------------------------------------
 * Parsing helpers
 * -----------------------------------------------------------------------------
 */

function parseBoolean(value, fallback = false) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  return [
    '1',
    'true',
    'yes',
    'on',
  ].includes(
    String(value)
      .trim()
      .toLowerCase()
  );
}

function parsePositiveInteger(
  value,
  fallback,
  maximum = Number.MAX_SAFE_INTEGER
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const parsed = Number.parseInt(
    String(value),
    10
  );

  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    maximum
  );
}

function parseArgs(
  argv = process.argv.slice(2)
) {
  const options = {
    dryRun: parseBoolean(
      process.env
        .TITECH_SAAS_BILLING_MIGRATION_DRY_RUN,
      false
    ),

    strict: parseBoolean(
      process.env
        .TITECH_SAAS_BILLING_MIGRATION_FAIL_ON_RECORD_ERRORS,
      false
    ),

    batchSize: parsePositiveInteger(
      process.env
        .TITECH_SAAS_BILLING_MIGRATION_BATCH_SIZE,
      DEFAULTS.batchSize,
      5000
    ),

    maxRecordErrors: parsePositiveInteger(
      process.env
        .TITECH_SAAS_BILLING_MIGRATION_MAX_RECORD_ERRORS,
      DEFAULTS.maxRecordErrors,
      10_000
    ),

    requireSourceData: parseBoolean(
      process.env
        .TITECH_SAAS_BILLING_MIGRATION_REQUIRE_SOURCE_DATA,
      DEFAULTS.requireSourceData
    ),

    reportCollectionInventory: parseBoolean(
      process.env
        .TITECH_SAAS_BILLING_MIGRATION_REPORT_COLLECTION_INVENTORY,
      DEFAULTS.reportCollectionInventory
    ),

    help: false,
  };

  for (
    let index = 0;
    index < argv.length;
    index += 1
  ) {
    const argument = argv[index];

    switch (argument) {
      case '--dry-run':
        options.dryRun = true;
        break;

      case '--strict':
      case '--fail-on-record-errors':
        options.strict = true;
        break;

      case '--require-source-data':
        options.requireSourceData = true;
        break;

      case '--no-inventory':
        options.reportCollectionInventory = false;
        break;

      case '--batch-size': {
        const value = argv[index + 1];

        if (!value) {
          throw new Error(
            '--batch-size requires a positive integer.'
          );
        }

        options.batchSize = parsePositiveInteger(
          value,
          DEFAULTS.batchSize,
          5000
        );

        index += 1;
        break;
      }

      case '--max-record-errors': {
        const value = argv[index + 1];

        if (!value) {
          throw new Error(
            '--max-record-errors requires a positive integer.'
          );
        }

        options.maxRecordErrors = parsePositiveInteger(
          value,
          DEFAULTS.maxRecordErrors,
          10_000
        );

        index += 1;
        break;
      }

      case '--help':
      case '-h':
        options.help = true;
        break;

      default:
        throw new Error(
          `Unknown argument: ${argument}`
        );
    }
  }

  return options;
}

function printHelp() {
  console.log(`
TITech SaaS Billing Consolidation Migration
============================================

Usage:
  npm run migrate:saas-billing

Options:
  --dry-run
      Inspect and map records without writing canonical data.

  --strict
      Fail the migration if record-level errors occur.

  --require-source-data
      Fail APPLY mode when no likely/explicit legacy billing source collection
      can be identified.

  --no-inventory
      Disable the non-mutating collection inventory preflight.

  --batch-size <number>
      Source cursor batch size (default: ${DEFAULTS.batchSize}).

  --max-record-errors <n>
      Maximum tolerated record errors before strict failure
      (default: ${DEFAULTS.maxRecordErrors}).

  --help, -h
      Show this help message.

Environment:
  MONGO_URI / MONGODB_URI
  MONGO_URI_FALLBACK / MONGODB_URI_FALLBACK

  TITECH_SAAS_BILLING_MIGRATION_DRY_RUN
  TITECH_SAAS_BILLING_MIGRATION_FAIL_ON_RECORD_ERRORS
  TITECH_SAAS_BILLING_MIGRATION_BATCH_SIZE
  TITECH_SAAS_BILLING_MIGRATION_MAX_RECORD_ERRORS

  TITECH_SAAS_BILLING_MIGRATION_REQUIRE_CONFIRMATION
  TITECH_SAAS_BILLING_MIGRATION_CONFIRMED

  TITECH_SAAS_BILLING_MIGRATION_REQUIRE_SOURCE_DATA
  TITECH_SAAS_BILLING_MIGRATION_REPORT_COLLECTION_INVENTORY

  TITECH_LEGACY_BILLING_PLANS_COLLECTION
  TITECH_LEGACY_SUBSCRIPTIONS_COLLECTION
  TITECH_LEGACY_INVOICES_COLLECTION
  TITECH_LEGACY_USAGE_COLLECTION

Examples:
  npm run migrate:saas-billing

  npm run migrate:saas-billing -- --dry-run

  npm run migrate:saas-billing -- --strict

  npm run migrate:saas-billing -- --dry-run --strict

  npm run migrate:saas-billing -- --require-source-data

  npm run migrate:saas-billing -- --batch-size 1000
`);
}

/**
 * -----------------------------------------------------------------------------
 * Configuration
 * -----------------------------------------------------------------------------
 */

function resolveMongoUri() {
  const uri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.MONGO_URI_FALLBACK ||
    process.env.MONGODB_URI_FALLBACK;

  if (
    !uri ||
    !String(uri).trim()
  ) {
    throw new Error(
      '[TITech][SaaS Migration] MONGO_URI, MONGODB_URI, MONGO_URI_FALLBACK, or MONGODB_URI_FALLBACK is required.'
    );
  }

  return String(uri).trim();
}

function maskMongoUri(uri) {
  try {
    const parsed = new URL(uri);

    if (parsed.username) {
      parsed.username = '***';
    }

    if (parsed.password) {
      parsed.password = '***';
    }

    return parsed.toString();
  } catch (_error) {
    return '***MASKED_MONGODB_URI***';
  }
}

function resolveDatabaseName(uri) {
  try {
    const parsed = new URL(uri);

    const databaseName = String(
      parsed.pathname || ''
    ).replace(
      /^\/+/,
      ''
    );

    return (
      databaseName ||
      '(driver/default database)'
    );
  } catch (_error) {
    return '(unknown)';
  }
}

function resolveExplicitSourceCollections() {
  const resolved = {};

  for (const category of SOURCE_CATEGORIES) {
    const envName =
      SOURCE_ENVIRONMENT_VARIABLES[category];

    const value = process.env[envName];

    resolved[category] =
      value && String(value).trim()
        ? String(value).trim()
        : null;
  }

  return resolved;
}

function assertProductionPreflight(options) {
  const nodeMajor = Number.parseInt(
    process.versions.node.split('.')[0],
    10
  );

  if (
    !Number.isInteger(nodeMajor) ||
    nodeMajor < 20
  ) {
    throw new Error(
      `[TITech][SaaS Migration] Node.js 20+ is required. Detected ${process.versions.node}.`
    );
  }

  if (
    process.env.NODE_ENV === 'production' &&
    !options.dryRun &&
    parseBoolean(
      process.env
        .TITECH_SAAS_BILLING_MIGRATION_REQUIRE_CONFIRMATION,
      true
    )
  ) {
    const confirmed = parseBoolean(
      process.env
        .TITECH_SAAS_BILLING_MIGRATION_CONFIRMED,
      false
    );

    if (!confirmed) {
      throw new Error(
        '[TITech][SaaS Migration] Production write requires TITECH_SAAS_BILLING_MIGRATION_CONFIRMED=true.'
      );
    }
  }
}

/**
 * -----------------------------------------------------------------------------
 * MongoDB lifecycle
 * -----------------------------------------------------------------------------
 */

async function connectMongo(mongoUri) {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  await mongoose.connect(
    mongoUri,
    {
      appName:
        'TITech-SaaS-Billing-Consolidation-Migration',

      maxPoolSize:
        DEFAULTS.maxPoolSize,

      minPoolSize:
        DEFAULTS.minPoolSize,

      serverSelectionTimeoutMS:
        DEFAULTS.serverSelectionTimeoutMS,

      connectTimeoutMS:
        DEFAULTS.connectTimeoutMS,

      socketTimeoutMS:
        DEFAULTS.socketTimeoutMS,

      retryWrites:
        true,
    }
  );

  if (
    mongoose.connection.readyState !== 1
  ) {
    throw new Error(
      '[TITech][SaaS Migration] MongoDB connection was not established.'
    );
  }

  return mongoose.connection;
}

async function disconnectMongo() {
  if (
    mongoose.connection.readyState === 0
  ) {
    return;
  }

  try {
    await mongoose.disconnect();
  } catch (error) {
    logger.error?.(
      '[TITech][SaaS Migration] Failed to close MongoDB connection.',
      error
    );

    exitCode = 1;
  }
}

/**
 * -----------------------------------------------------------------------------
 * Signal handling
 * -----------------------------------------------------------------------------
 */

function registerSignalHandlers() {
  const handleSignal = async (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    console.error(
      `\n[TITech][SaaS Migration] Received ${signal}. Stopping safely...`
    );

    await disconnectMongo();

    process.exitCode = 130;
  };

  process.once(
    'SIGINT',
    () => {
      void handleSignal('SIGINT');
    }
  );

  process.once(
    'SIGTERM',
    () => {
      void handleSignal('SIGTERM');
    }
  );
}

/**
 * -----------------------------------------------------------------------------
 * Migration loading
 * -----------------------------------------------------------------------------
 */

function loadMigration() {
  const migrationAbsolutePath =
    path.resolve(
      __dirname,
      MIGRATION_PATH
    );

  const migrationFile =
    `${migrationAbsolutePath}.js`;

  if (!fs.existsSync(migrationFile)) {
    throw new Error(
      `[TITech][SaaS Migration] Migration file not found: ${migrationFile}`
    );
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const migration = require(
    migrationAbsolutePath
  );

  if (
    !migration ||
    typeof migration.up !== 'function'
  ) {
    throw new Error(
      `[TITech][SaaS Migration] ${MIGRATION_NAME} must export an up() function.`
    );
  }

  return migration;
}

/**
 * -----------------------------------------------------------------------------
 * Non-mutating source/database preflight
 * -----------------------------------------------------------------------------
 *
 * IMPORTANT:
 * This is intentionally only inventory.
 *
 * It does not decide which legacy collection should be migrated. That decision
 * remains owned by the canonical migration.
 */

async function inspectDatabaseCollections() {
  const db =
    mongoose.connection.db;

  if (!db) {
    throw new Error(
      '[TITech][SaaS Migration] MongoDB database handle is unavailable.'
    );
  }

  const names =
    await db
      .listCollections(
        {},
        {
          nameOnly: true,
        }
      )
      .toArray();

  return names
    .map((item) => item?.name)
    .filter(Boolean)
    .sort();
}

function buildCollectionInventory(
  collectionNames
) {
  const names = new Set(
    collectionNames
  );

  const canonical = {
    plans: names.has(
      CANONICAL_COLLECTIONS.plans
    ),

    subscriptions: names.has(
      CANONICAL_COLLECTIONS.subscriptions
    ),

    invoices: names.has(
      CANONICAL_COLLECTIONS.invoices
    ),

    usage: names.has(
      CANONICAL_COLLECTIONS.usage
    ),

    migrationState: names.has(
      CANONICAL_COLLECTIONS.migrationState
    ),
  };

  const explicitSources =
    resolveExplicitSourceCollections();

  const explicitPresence = {};

  for (
    const category of SOURCE_CATEGORIES
  ) {
    const sourceName =
      explicitSources[category];

    explicitPresence[category] =
      sourceName
        ? names.has(sourceName)
        : false;
  }

  const likelyLegacyCollections =
    collectionNames.filter(
      (name) => {
        if (
          Object.values(
            CANONICAL_COLLECTIONS
          ).includes(name)
        ) {
          return false;
        }

        return LIKELY_BILLING_COLLECTION_PATTERN.test(
          name
        );
      }
    );

  return {
    totalCollections:
      collectionNames.length,

    canonical,

    explicitSources,

    explicitPresence,

    likelyLegacyCollections,
  };
}

async function runCollectionInventoryPreflight(
  options
) {
  if (
    !options.reportCollectionInventory
  ) {
    return {
      enabled: false,
      totalCollections: null,
      canonical: null,
      explicitSources:
        resolveExplicitSourceCollections(),
      explicitPresence: {},
      likelyLegacyCollections: [],
    };
  }

  const collectionNames =
    await inspectDatabaseCollections();

  const inventory =
    buildCollectionInventory(
      collectionNames
    );

  console.log(
    '\n[TITech][SaaS Migration] Database source inventory'
  );

  console.log(
    `  Total MongoDB collections: ${inventory.totalCollections}`
  );

  console.log(
    `  Canonical billing collections: ${Object.values(
      inventory.canonical
    ).filter(Boolean).length}/5 present`
  );

  if (
    inventory.likelyLegacyCollections.length > 0
  ) {
    console.log(
      `  Likely legacy billing collections: ${inventory.likelyLegacyCollections.join(
        ', '
      )}`
    );
  } else {
    console.log(
      '  Likely legacy billing collections: NONE DETECTED'
    );
  }

  for (
    const category of SOURCE_CATEGORIES
  ) {
    const configured =
      inventory.explicitSources[category];

    if (configured) {
      console.log(
        `  ${category}: configured=${configured} present=${inventory.explicitPresence[category]}`
      );
    } else {
      console.log(
        `  ${category}: no explicit legacy collection configured`
      );
    }
  }

  console.log('');

  return {
    enabled: true,
    collectionNames,
    ...inventory,
  };
}

function hasAnyExplicitSource(
  inventory
) {
  return SOURCE_CATEGORIES.some(
    (category) =>
      Boolean(
        inventory?.explicitSources?.[category]
      )
  );
}

function hasAnyExplicitSourcePresent(
  inventory
) {
  return SOURCE_CATEGORIES.some(
    (category) =>
      Boolean(
        inventory?.explicitPresence?.[category]
      )
  );
}

function hasLikelyLegacyBillingCollections(
  inventory
) {
  return (
    Array.isArray(
      inventory?.likelyLegacyCollections
    ) &&
    inventory.likelyLegacyCollections.length > 0
  );
}

function assertSourcePreflight(
  options,
  inventory
) {
  if (
    !options.requireSourceData ||
    options.dryRun ||
    !inventory?.enabled
  ) {
    return;
  }

  const sourcePresent =
    hasAnyExplicitSourcePresent(
      inventory
    ) ||
    hasLikelyLegacyBillingCollections(
      inventory
    );

  if (!sourcePresent) {
    throw new Error(
      '[TITech][SaaS Migration] REQUIRE_SOURCE_DATA is enabled, but no explicit or likely legacy SaaS billing source collection was detected. Refusing to report a data migration as successful.'
    );
  }
}

/**
 * -----------------------------------------------------------------------------
 * Environment handoff to canonical migration
 * -----------------------------------------------------------------------------
 */

function applyRuntimeOptions(options) {
  process.env
    .TITECH_SAAS_BILLING_MIGRATION_BATCH_SIZE =
      String(options.batchSize);

  process.env
    .TITECH_SAAS_BILLING_MIGRATION_FAIL_ON_RECORD_ERRORS =
      options.strict
        ? 'true'
        : 'false';

  process.env
    .TITECH_SAAS_BILLING_MIGRATION_MAX_RECORD_ERRORS =
      String(options.maxRecordErrors);

  process.env
    .TITECH_SAAS_BILLING_MIGRATION_REQUIRE_SOURCE_DATA =
      options.requireSourceData
        ? 'true'
        : 'false';
}

/**
 * -----------------------------------------------------------------------------
 * Result normalization
 * -----------------------------------------------------------------------------
 */

function toSafeInteger(value) {
  const parsed =
    Number(value);

  return Number.isSafeInteger(parsed) &&
    parsed >= 0
    ? parsed
    : 0;
}

function getTotalScanned(result) {
  return SOURCE_CATEGORIES.reduce(
    (total, category) =>
      total +
      toSafeInteger(
        result?.results?.[category]?.scanned
      ),
    0
  );
}

function getTotalInserted(result) {
  return SOURCE_CATEGORIES.reduce(
    (total, category) =>
      total +
      toSafeInteger(
        result?.results?.[category]?.inserted
      ),
    0
  );
}

function getTotalExisting(result) {
  return SOURCE_CATEGORIES.reduce(
    (total, category) =>
      total +
      toSafeInteger(
        result?.results?.[category]?.existing
      ),
    0
  );
}

function getTotalSkipped(result) {
  return SOURCE_CATEGORIES.reduce(
    (total, category) =>
      total +
      toSafeInteger(
        result?.results?.[category]?.skipped
      ),
    0
  );
}

function getTotalCategoryErrors(result) {
  return SOURCE_CATEGORIES.reduce(
    (total, category) =>
      total +
      toSafeInteger(
        result?.results?.[category]?.errors
      ),
    0
  );
}

function classifyMigrationOutcome(
  result,
  inventory
) {
  const status =
    String(
      result?.status || ''
    ).trim().toUpperCase();

  const recordErrors =
    toSafeInteger(
      result?.recordErrors
    );

  const totalScanned =
    getTotalScanned(result);

  const totalInserted =
    getTotalInserted(result);

  const totalExisting =
    getTotalExisting(result);

  const totalSkipped =
    getTotalSkipped(result);

  const totalCategoryErrors =
    getTotalCategoryErrors(result);

  if (
    status === 'FAILED'
  ) {
    return 'FAILED';
  }

  if (
    recordErrors > 0 ||
    totalCategoryErrors > 0
  ) {
    return 'COMPLETED_WITH_RECORD_ERRORS';
  }

  if (
    totalScanned === 0 &&
    totalInserted === 0 &&
    totalExisting === 0 &&
    totalSkipped === 0
  ) {
    return 'COMPLETED_NO_SOURCE_DATA';
  }

  if (
    status === 'COMPLETED'
  ) {
    return 'COMPLETED_WITH_DATA';
  }

  if (
    inventory?.enabled &&
    !hasAnyExplicitSourcePresent(inventory) &&
    !hasLikelyLegacyBillingCollections(inventory)
  ) {
    return 'COMPLETED_NO_SOURCE_DATA';
  }

  return status || 'UNKNOWN';
}

function printSummary(
  result,
  elapsedMs,
  inventory
) {
  const results =
    result?.results || {};

  const outcome =
    classifyMigrationOutcome(
      result,
      inventory
    );

  const totalScanned =
    getTotalScanned(result);

  const totalInserted =
    getTotalInserted(result);

  const totalExisting =
    getTotalExisting(result);

  const totalSkipped =
    getTotalSkipped(result);

  const recordErrors =
    toSafeInteger(
      result?.recordErrors
    );

  console.log(
    '\n----------------------------------------------------------------'
  );

  console.log(
    ' TITech SaaS Billing Consolidation Result'
  );

  console.log(
    '----------------------------------------------------------------'
  );

  console.log(
    ` Migration:       ${
      result?.migration ||
      MIGRATION_NAME
    }`
  );

  console.log(
    ` Stage:           ${
      result?.stage ||
      '01C'
    }`
  );

  console.log(
    ` Status:          ${
      result?.status ||
      'UNKNOWN'
    }`
  );

  console.log(
    ` Operator outcome:${outcome}`
  );

  console.log(
    ` Dry run:         ${Boolean(result?.dryRun)}`
  );

  console.log(
    ` Duration:        ${elapsedMs}ms`
  );

  console.log(
    ` Records scanned: ${totalScanned}`
  );

  console.log(
    ` Records inserted:${totalInserted}`
  );

  console.log(
    ` Records existing: ${totalExisting}`
  );

  console.log(
    ` Records skipped: ${totalSkipped}`
  );

  console.log(
    ` Record errors:   ${recordErrors}`
  );

  console.log('');

  for (
    const category of SOURCE_CATEGORIES
  ) {
    const categoryResult =
      results[category];

    if (!categoryResult) {
      continue;
    }

    console.log(
      ` ${category.padEnd(16)} ` +
        `scanned=${String(
          categoryResult.scanned ?? 0
        ).padStart(7)} ` +
        `inserted=${String(
          categoryResult.inserted ?? 0
        ).padStart(7)} ` +
        `existing=${String(
          categoryResult.existing ?? 0
        ).padStart(7)} ` +
        `skipped=${String(
          categoryResult.skipped ?? 0
        ).padStart(7)} ` +
        `errors=${String(
          categoryResult.errors ?? 0
        ).padStart(5)}`
    );
  }

  if (
    inventory?.enabled
  ) {
    console.log('');

    console.log(
      ` Legacy source inventory: ${
        inventory.likelyLegacyCollections?.length || 0
      } likely billing collection(s) detected`
    );
  }

  console.log(
    '----------------------------------------------------------------\n'
  );
}

function printStartup(
  options,
  mongoUri
) {
  console.log(`
================================================================
 TITech SaaS Billing Consolidation
================================================================
 Migration:             ${MIGRATION_NAME}
 Mode:                  ${
    options.dryRun
      ? 'DRY RUN'
      : 'APPLY'
  }
 Strict errors:         ${
    options.strict
      ? 'ENABLED'
      : 'DISABLED'
  }
 Require source data:   ${
    options.requireSourceData
      ? 'ENABLED'
      : 'DISABLED'
  }
 Inventory preflight:   ${
    options.reportCollectionInventory
      ? 'ENABLED'
      : 'DISABLED'
  }
 Batch size:            ${options.batchSize}
 Max record errors:     ${options.maxRecordErrors}
 Node.js:               ${process.version}
 Environment:           ${
    process.env.NODE_ENV ||
    'undefined'
  }
 Database:              ${resolveDatabaseName(
    mongoUri
  )}
 Mongo endpoint:        ${maskMongoUri(
    mongoUri
  )}
================================================================
`);
}

/**
 * -----------------------------------------------------------------------------
 * Failure policy
 * -----------------------------------------------------------------------------
 */

function assertSuccessfulOutcome(
  result,
  options,
  inventory
) {
  const status =
    String(
      result?.status || ''
    ).trim().toUpperCase();

  const recordErrors =
    toSafeInteger(
      result?.recordErrors
    );

  const categoryErrors =
    getTotalCategoryErrors(
      result
    );

  const outcome =
    classifyMigrationOutcome(
      result,
      inventory
    );

  if (
    status === 'FAILED'
  ) {
    throw new Error(
      '[TITech][SaaS Migration] Canonical migration returned FAILED status.'
    );
  }

  if (
    options.strict &&
    (
      recordErrors > 0 ||
      categoryErrors > 0
    )
  ) {
    throw new Error(
      `[TITech][SaaS Migration] Strict mode rejected the migration because record/category errors were detected. recordErrors=${recordErrors}, categoryErrors=${categoryErrors}.`
    );
  }

  if (
    options.requireSourceData &&
    !options.dryRun &&
    outcome === 'COMPLETED_NO_SOURCE_DATA'
  ) {
    throw new Error(
      '[TITech][SaaS Migration] Source-data requirement was enabled, but no source records were migrated or already reconciled.'
    );
  }
}

/**
 * -----------------------------------------------------------------------------
 * Main execution
 * -----------------------------------------------------------------------------
 */

async function main() {
  const loadedEnvFiles =
    loadEnvironment();

  const options =
    parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  assertProductionPreflight(
    options
  );

  const mongoUri =
    resolveMongoUri();

  const migration =
    loadMigration();

  printStartup(
    options,
    mongoUri
  );

  if (
    loadedEnvFiles.length > 0
  ) {
    logger.debug?.(
      `[TITech][SaaS Migration] Loaded ${loadedEnvFiles.length} environment file(s).`
    );
  }

  registerSignalHandlers();

  const startedAt =
    Date.now();

  let inventory = {
    enabled: false,
    likelyLegacyCollections: [],
    explicitSources:
      resolveExplicitSourceCollections(),
    explicitPresence: {},
  };

  try {
    await connectMongo(
      mongoUri
    );

    logger.info?.(
      '[TITech][SaaS Migration] MongoDB connection established.'
    );

    inventory =
      await runCollectionInventoryPreflight(
        options
      );

    assertSourcePreflight(
      options,
      inventory
    );

    applyRuntimeOptions(
      options
    );

    /**
     * The canonical migration remains the single owner of:
     *   - source discovery/mapping
     *   - normalization
     *   - locking
     *   - canonical upserts
     *   - migration state
     *   - detailed reconciliation
     */
    const result =
      await migration.up({
        mongoose,
        dryRun:
          options.dryRun,
      });

    const elapsedMs =
      Date.now() -
      startedAt;

    printSummary(
      result,
      elapsedMs,
      inventory
    );

    assertSuccessfulOutcome(
      result,
      options,
      inventory
    );

    const outcome =
      classifyMigrationOutcome(
        result,
        inventory
      );

    if (
      outcome ===
      'COMPLETED_NO_SOURCE_DATA'
    ) {
      logger.warn?.(
        '[TITech][SaaS Migration] Migration completed technically, but no billing source records were discovered/migrated.'
      );
    } else {
      logger.info?.(
        `[TITech][SaaS Migration] Completed successfully. Outcome=${outcome}`
      );
    }
  } finally {
    await disconnectMongo();
  }
}

/**
 * -----------------------------------------------------------------------------
 * Process entry point
 * -----------------------------------------------------------------------------
 */

void main()
  .catch(
    (error) => {
      exitCode = 1;

      console.error(
        '\n================================================================\n' +
          ' TITech SaaS Billing Consolidation FAILED\n' +
          '================================================================'
      );

      console.error(
        error?.stack ||
          error?.message ||
          error
      );

      console.error(
        '================================================================\n'
      );
    }
  )
  .finally(
    async () => {
      await disconnectMongo();

      if (
        exitCode !== 0
      ) {
        process.exitCode =
          exitCode;
      }
    }
  );

/**
 * -----------------------------------------------------------------------------
 * Exports
 * -----------------------------------------------------------------------------
 *
 * Pure helpers are exported for focused unit testing.
 *
 * NOTE:
 * The CLI still executes when launched directly through Node.
 */

module.exports =
  Object.freeze({
    parseArgs,
    parseBoolean,
    parsePositiveInteger,
    resolveMongoUri,
    resolveDatabaseName,
    maskMongoUri,
    resolveExplicitSourceCollections,
    classifyMigrationOutcome,
    getTotalScanned,
    getTotalInserted,
    getTotalExisting,
    getTotalSkipped,
    getTotalCategoryErrors,
    buildCollectionInventory,
    printHelp,
  });