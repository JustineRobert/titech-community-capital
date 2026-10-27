
/**
 * ============================================================================
 * TITech Community Capital
 * File: backend/tests/helpers/db.test.mjs
 * Database Test Helpers — Enterprise Regression Tests
 * ============================================================================
 *
 * Test runner: Node.js built-in test runner (node:test).
 *
 * Coverage:
 * - Reject non-test runtime environments.
 * - Reject missing or invalid MongoDB configuration.
 * - Reject conflicting MongoDB URIs.
 * - Reject production-style database names.
 * - Reject ambiguous database URI configuration.
 * - Share concurrent connection attempts.
 * - Reject destructive operations against a different database.
 * - Validate collection names before deleting documents.
 * - Verify targeted collection cleanup.
 * - Verify cleanup failure reporting and continued attempts.
 * - Verify full cleanup within an isolated disposable database.
 * - Verify safe disconnection.
 *
 * SAFETY:
 * - This suite permits only a local MongoDB endpoint.
 * - Every run receives a unique database name.
 * - Only the unique database created by this suite is dropped.
 * - Never point this suite at production infrastructure.
 * ============================================================================
 */

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { test } from 'node:test';

/* ============================================================================
 * Isolated Test Environment
 * ========================================================================== */

const ENVIRONMENT_KEYS = [
  'NODE_ENV',
  'MONGO_URI_TEST',
  'MONGO_URI',
];

const originalEnvironment = Object.fromEntries(
  ENVIRONMENT_KEYS.map((key) => [
    key,
    process.env[key],
  ]),
);

/**
 * This suite deliberately uses a local MongoDB endpoint.
 *
 * A remote URI is rejected before the database helper is imported or any
 * database operation can run. A database name containing "test" is not
 * proof that a remote server is isolated from production.
 */
const configuredBaseUri =
  process.env.MONGO_URI_TEST?.trim() ||
  process.env.MONGO_URI?.trim() ||
  'mongodb://127.0.0.1:27017/titech-test';

let baseUrl;

try {
  baseUrl = new URL(configuredBaseUri);
} catch {
  throw new Error(
    '[TITech db helper tests] Invalid base MongoDB URI. ' +
      'Configure a local test database.',
  );
}

const localHostname = baseUrl.hostname
  .toLowerCase()
  .replace(/^\[|\]$/g, '');

if (
  baseUrl.protocol !== 'mongodb:' ||
  ![
    '127.0.0.1',
    'localhost',
    '::1',
  ].includes(localHostname)
) {
  throw new Error(
    '[TITech db helper tests] Refusing a non-local MongoDB endpoint. ' +
      'Use mongodb://127.0.0.1:27017/titech-test.',
  );
}

if (
  [...baseUrl.searchParams.keys()].some(
    (key) => key.toLowerCase() === 'dbname',
  )
) {
  throw new Error(
    '[TITech db helper tests] The base URI must not use a dbName query parameter.',
  );
}

const TEST_DATABASE_NAME =
  `titech-test-db-helper-${process.pid}-${Date.now()}`;

baseUrl.pathname = `/${TEST_DATABASE_NAME}`;

const ISOLATED_TEST_URI = baseUrl.toString();

/**
 * Force deterministic test settings before importing the helper.
 */
process.env.NODE_ENV = 'test';
process.env.MONGO_URI_TEST = ISOLATED_TEST_URI;
process.env.MONGO_URI = ISOLATED_TEST_URI;

/**
 * Import after setting environment variables because the helper resolves
 * its MongoDB configuration when its functions are called.
 */
const {
  connectDB,
  disconnectDB,
  clearDatabase,
  clearCollections,
} = await import('./db.js');

/* ============================================================================
 * Environment Utilities
 * ========================================================================== */

function restoreEnvironment(snapshot) {
  for (const key of ENVIRONMENT_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

async function withEnvironment(overrides, callback) {
  const snapshot = Object.fromEntries(
    ENVIRONMENT_KEYS.map((key) => [
      key,
      process.env[key],
    ]),
  );

  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return await callback();
  } finally {
    restoreEnvironment(snapshot);
  }
}

function uriForDatabase(databaseName) {
  const uri = new URL(ISOLATED_TEST_URI);

  uri.pathname = `/${databaseName}`;

  return uri.toString();
}

function makeCollectionName(prefix) {
  return (
    `titech_db_helper_${prefix}_` +
    `${process.pid}_${Date.now()}_` +
    Math.random().toString(36).slice(2, 8)
  );
}

async function countDocuments(connection, collectionName) {
  return connection.db
    .collection(collectionName)
    .countDocuments({});
}

function setIsolatedEnvironment() {
  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI_TEST = ISOLATED_TEST_URI;
  process.env.MONGO_URI = ISOLATED_TEST_URI;
}

/* ============================================================================
 * Regression Tests
 * ========================================================================== */

test(
  'TITech database helper safety and cleanup contracts',
  async (t) => {
    let connection = null;

    try {
      /* --------------------------------------------------------------------
       * 1. Environment safety
       * ------------------------------------------------------------------ */

      await t.test(
        'rejects explicitly non-test environments',
        async () => {
          await withEnvironment(
            {
              NODE_ENV: 'production',
            },
            async () => {
              await assert.rejects(
                () => connectDB(),
                /NODE_ENV.*not "test"/,
              );
            },
          );
        },
      );

      await t.test(
        'rejects missing MongoDB URI configuration',
        async () => {
          await withEnvironment(
            {
              MONGO_URI_TEST: '',
              MONGO_URI: '',
            },
            async () => {
              await assert.rejects(
                () => connectDB(),
                /Configure MONGO_URI_TEST or MONGO_URI/,
              );
            },
          );
        },
      );

      /* --------------------------------------------------------------------
       * 2. URI validation
       * ------------------------------------------------------------------ */

      await t.test(
        'rejects conflicting MongoDB URI targets',
        async () => {
          const conflictingUri = uriForDatabase(
            `titech-test-conflict-${process.pid}`,
          );

          await withEnvironment(
            {
              MONGO_URI_TEST: ISOLATED_TEST_URI,
              MONGO_URI: conflictingUri,
            },
            async () => {
              await assert.rejects(
                () => connectDB(),
                /MONGO_URI_TEST and MONGO_URI must target the same endpoint and database/,
              );
            },
          );
        },
      );

      await t.test(
        'rejects production-style database names even when they contain test',
        async () => {
          const unsafeUri = uriForDatabase(
            'titech-production-test',
          );

          await withEnvironment(
            {
              MONGO_URI_TEST: unsafeUri,
              MONGO_URI: unsafeUri,
            },
            async () => {
              await assert.rejects(
                () => connectDB(),
                /dedicated test database/,
              );
            },
          );
        },
      );

      await t.test(
        'rejects MongoDB URIs without a database path',
        async () => {
          const uriWithoutDatabase =
            'mongodb://127.0.0.1:27017/';

          await withEnvironment(
            {
              MONGO_URI_TEST: uriWithoutDatabase,
              MONGO_URI: uriWithoutDatabase,
            },
            async () => {
              await assert.rejects(
                () => connectDB(),
                /must include a database name/,
              );
            },
          );
        },
      );

      await t.test(
        'rejects ambiguous dbName query parameters',
        async () => {
          const ambiguousUri = new URL(
            ISOLATED_TEST_URI,
          );

          ambiguousUri.searchParams.set(
            'dbName',
            TEST_DATABASE_NAME,
          );

          await withEnvironment(
            {
              MONGO_URI_TEST: ambiguousUri.toString(),
              MONGO_URI: ambiguousUri.toString(),
            },
            async () => {
              await assert.rejects(
                () => connectDB(),
                /dbName query parameter/,
              );
            },
          );
        },
      );

      /* --------------------------------------------------------------------
       * 3. Concurrent connection behavior
       * ------------------------------------------------------------------ */

      await t.test(
        'shares concurrent connection requests safely',
        async () => {
          const connections = await Promise.all([
            connectDB(),
            connectDB(),
            connectDB(),
          ]);

          connection = connections[0];

          assert.ok(
            connections.every(
              (item) => item === connection,
            ),
            'all callers must receive the same Mongoose connection',
          );

          assert.equal(
            connection.readyState,
            1,
            'the shared connection must be established',
          );

          assert.equal(
            connection.name,
            TEST_DATABASE_NAME,
            'the connection must target the unique disposable database',
          );
        },
      );

      /**
       * Database-backed tests only proceed after a successful local
       * connection. The connection subtest itself will fail if MongoDB
       * is unavailable or connection setup is broken.
       */
      if (
        !connection &&
        mongoose.connection.readyState === 1 &&
        mongoose.connection.name === TEST_DATABASE_NAME
      ) {
        connection = mongoose.connection;
      }

      if (!connection) {
        await t.test(
          'database-backed checks require the local MongoDB connection',
          (subtest) => {
            subtest.skip(
              'The concurrent connection test did not establish a connection.',
            );
          },
        );

        return;
      }

      /* --------------------------------------------------------------------
       * 4. Connected database isolation
       * ------------------------------------------------------------------ */

      await t.test(
        'refuses destructive cleanup when the configured database changes',
        async () => {
          const name = makeCollectionName('target-mismatch');

          await connection.collection(name).insertOne({
            marker: 'must-remain',
          });

          const mismatchUri = uriForDatabase(
            `titech-test-other-${process.pid}`,
          );

          await withEnvironment(
            {
              MONGO_URI_TEST: mismatchUri,
              MONGO_URI: mismatchUri,
            },
            async () => {
              await assert.rejects(
                () => clearCollections([name]),
                /Connected database does not match the configured test database/,
              );
            },
          );

          assert.equal(
            await countDocuments(connection, name),
            1,
            'the safety check must prevent deletion from the connected database',
          );

          await clearCollections([name]);
        },
      );

      /* --------------------------------------------------------------------
       * 5. Invalid collection input
       * ------------------------------------------------------------------ */

      await t.test(
        'validates every collection name before deleting documents',
        async () => {
          const name = makeCollectionName('invalid-input');

          await connection.collection(name).insertOne({
            marker: 'must-remain',
          });

          await assert.rejects(
            () => clearCollections([name, '  ']),
            (error) =>
              error instanceof TypeError &&
              /Collection names must be non-empty strings/.test(
                error.message,
              ),
          );

          assert.equal(
            await countDocuments(connection, name),
            1,
            'invalid input must be rejected before any deletion occurs',
          );

          await clearCollections([name]);
        },
      );

      /* --------------------------------------------------------------------
       * 6. Selective collection cleanup
       * ------------------------------------------------------------------ */

      await t.test(
        'clears only selected collections and tolerates missing collections',
        async () => {
          const selectedName = makeCollectionName('selected');
          const untouchedName = makeCollectionName('untouched');

          await connection.collection(selectedName).insertOne({
            marker: 'selected',
          });

          await connection.collection(untouchedName).insertOne({
            marker: 'untouched',
          });

          await clearCollections([
            selectedName,
            selectedName,
            'titech_missing_test_collection',
          ]);

          assert.equal(
            await countDocuments(connection, selectedName),
            0,
            'the selected collection must be cleared',
          );

          assert.equal(
            await countDocuments(connection, untouchedName),
            1,
            'the unselected collection must remain untouched',
          );

          await clearCollections([untouchedName]);
        },
      );

      /* --------------------------------------------------------------------
       * 7. Deletion error handling
       * ------------------------------------------------------------------ */

      await t.test(
        'reports deletion failures and continues other collection cleanup',
        async () => {
          const failingName = makeCollectionName('failing');
          const successfulName = makeCollectionName('successful');

          await connection.collection(failingName).insertOne({
            marker: 'delete-failure-probe',
          });

          await connection.collection(successfulName).insertOne({
            marker: 'delete-success-probe',
          });

          const failingCollection =
            connection.collections[failingName];

          assert.ok(
            failingCollection,
            'the failing collection must be registered with Mongoose',
          );

          const originalDeleteMany =
            failingCollection.deleteMany;

          failingCollection.deleteMany = async () => {
            throw new Error('Synthetic cleanup failure');
          };

          try {
            await assert.rejects(
              () => clearCollections([
                failingName,
                successfulName,
              ]),
              (error) =>
                error instanceof AggregateError &&
                error.errors.length === 1 &&
                /Synthetic cleanup failure/.test(
                  error.errors[0].message,
                ),
            );
          } finally {
            failingCollection.deleteMany =
              originalDeleteMany;
          }

          assert.equal(
            await countDocuments(connection, failingName),
            1,
            'the failed collection should retain its document',
          );

          assert.equal(
            await countDocuments(connection, successfulName),
            0,
            'other collections must still be processed after a deletion failure',
          );

          await clearCollections([failingName]);
        },
      );

      /* --------------------------------------------------------------------
       * 8. Full cleanup
       * ------------------------------------------------------------------ */

      await t.test(
        'clears all registered collections in the isolated test database',
        async () => {
          const firstName = makeCollectionName('clear-all-a');
          const secondName = makeCollectionName('clear-all-b');

          await connection.collection(firstName).insertOne({
            marker: 'first',
          });

          await connection.collection(secondName).insertOne({
            marker: 'second',
          });

          await clearDatabase();

          assert.equal(
            await countDocuments(connection, firstName),
            0,
            'the first registered collection must be cleared',
          );

          assert.equal(
            await countDocuments(connection, secondName),
            0,
            'the second registered collection must be cleared',
          );
        },
      );

      /* --------------------------------------------------------------------
       * 9. Database cleanup and disconnection
       * ------------------------------------------------------------------ */

      await t.test(
        'disconnects safely after removing the disposable test database',
        async () => {
          assert.equal(
            connection.name,
            TEST_DATABASE_NAME,
            'only the uniquely named test database may be dropped',
          );

          await connection.db.dropDatabase();

          await disconnectDB();

          assert.equal(
            mongoose.connection.readyState,
            0,
            'Mongoose must be disconnected',
          );

          // Database was deliberately dropped before disconnection.
          connection = null;

          // Repeated disconnection must be safe.
          await disconnectDB();

          assert.equal(
            mongoose.connection.readyState,
            0,
            'repeated disconnection must remain safe',
          );
        },
      );
    } finally {
      /*
       * Best-effort safety cleanup.
       *
       * Never drop a database unless the active connection is to the exact
       * unique database created by this test file.
       */
      setIsolatedEnvironment();

      const cleanupErrors = [];

      try {
        const activeConnection = mongoose.connection;

        if (
          activeConnection.readyState === 1 &&
          activeConnection.name === TEST_DATABASE_NAME
        ) {
          await activeConnection.db.dropDatabase();
        }
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        await disconnectDB();
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        restoreEnvironment(originalEnvironment);
      }

      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          '[TITech db helper tests] Test database cleanup failed.',
        );
      }
    }
  },
);
