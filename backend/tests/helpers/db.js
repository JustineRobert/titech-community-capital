/**
 * ============================================================================
 * TITech Community Capital
 * File: backend/tests/helpers/db.js
 * Database Test Helpers — Native ESM
 * ============================================================================
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * - Connect to an explicitly configured test database.
 * - Disconnect through the supported Mongoose lifecycle.
 * - Clear registered test collections without dropping indexes.
 * - Reject unverified or production-style database targets.
 * - Validate conflicting environment configuration.
 * - Prevent duplicate connection attempts within this helper.
 * - Preserve errors while sanitizing diagnostic logging.
 * - Report partial cleanup failures instead of silently ignoring them.
 *
 * SAFETY REQUIREMENTS
 * ----------------------------------------------------------------------------
 * - Backend package must use "type": "module".
 * - Configure MONGO_URI_TEST or MONGO_URI.
 * - Use NODE_ENV=test for automated tests.
 * - If both URI variables are configured, they must identify the same
 *   endpoint and database.
 * - Never use production credentials or production databases for testing.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * clearDatabase() and clearCollections() delete documents.
 * They do not provide an atomic, multi-collection transaction.
 * They do not drop databases or remove collection indexes.
 * ============================================================================
 */

import mongoose from 'mongoose';
import * as loggerModule from '../../utils/logger.js';

/* ============================================================================
 * Configuration
 * ========================================================================== */

const logger =
  loggerModule.default ??
  loggerModule.logger ??
  loggerModule;

const MAX_POOL_SIZE = 10;

/**
 * Recognized test database naming conventions:
 *
 *   test
 *   titech-test
 *   titech_test
 *   titech-test-integration
 *   community_savings_test
 *   titech-test-clearall-123456789
 *
 * Production-style names are explicitly rejected even when they also
 * contain a "test" token.
 */
const TEST_DATABASE_NAME_PATTERN =
  /(?:^|[-_])test(?:$|[-_])/i;

const PRODUCTION_DATABASE_NAME_PATTERN =
  /(?:^|[-_])(?:prod|production|live)(?:$|[-_])/i;

/**
 * Shared promise for connection attempts started through this helper.
 *
 * This prevents concurrent calls from initiating competing connections
 * through the same default Mongoose instance.
 */
let connectionAttempt = null;

/**
 * Set only after the current connection has passed target validation.
 *
 * Used by disconnectDB() to validate the target before closing an
 * established connection.
 */
let validatedDatabaseName = null;

/* ============================================================================
 * Logging and Error Sanitization
 * ========================================================================== */

/**
 * Create safe diagnostic details without including connection strings,
 * database credentials, stack traces, or arbitrary error properties.
 *
 * Original errors are still thrown to callers.
 */
function safeErrorDetails(error) {
  const message = String(
    error?.message ?? error ?? 'Unknown error',
  ).replace(
    /mongodb(?:\+srv)?:\/\/[^\s"'`<>]+/gi,
    '[REDACTED_MONGODB_URI]',
  );

  const details = {
    name:
      typeof error?.name === 'string'
        ? error.name
        : 'Error',

    message,
  };

  if (
    typeof error?.code === 'string' ||
    typeof error?.code === 'number'
  ) {
    details.code = error.code;
  }

  return details;
}

/**
 * Log an error without allowing logger failures to replace the original
 * database error.
 */
function logDatabaseError(message, error) {
  const details = safeErrorDetails(error);

  try {
    if (typeof logger.error === 'function') {
      logger.error(message, details);
    } else {
      console.error(message, details);
    }
  } catch {
    console.error(message, details);
  }
}

/* ============================================================================
 * Environment Validation
 * ========================================================================== */

/**
 * Reject explicitly non-test environments.
 *
 * An unset NODE_ENV is permitted only when a dedicated test database is
 * explicitly configured and its target passes all database-name checks.
 */
function assertTestEnvironment() {
  if (
    process.env.NODE_ENV &&
    process.env.NODE_ENV !== 'test'
  ) {
    throw new Error(
      '[TITech test database] Refusing database operation because ' +
        `NODE_ENV is "${process.env.NODE_ENV}", not "test".`,
    );
  }
}

/**
 * Validate database naming conventions.
 *
 * This is a safety guard, not proof that a remote MongoDB server is
 * physically isolated from production.
 */
function assertSafeTestDatabaseName(
  databaseName,
  variableName,
) {
  if (
    typeof databaseName !== 'string' ||
    databaseName.length === 0 ||
    databaseName !== databaseName.trim() ||
    !TEST_DATABASE_NAME_PATTERN.test(databaseName) ||
    PRODUCTION_DATABASE_NAME_PATTERN.test(databaseName)
  ) {
    throw new Error(
      `[TITech test database] ${variableName} must target a dedicated ` +
        'test database, such as "titech-test". ' +
        'Production/live-style database names are rejected.',
    );
  }
}

/* ============================================================================
 * MongoDB URI Parsing
 * ========================================================================== */

/**
 * Parse a MongoDB URI without exposing its credentials.
 *
 * The database name must be present in the URI path:
 *
 *   mongodb://127.0.0.1:27017/titech-test
 *
 * This helper deliberately rejects a dbName query parameter. Specify the
 * database in the URI path instead of creating ambiguity between URI options
 * and Mongoose connection options.
 */
function parseMongoUri(uri, variableName) {
  if (
    typeof uri !== 'string' ||
    uri.trim() === ''
  ) {
    throw new Error(
      `[TITech test database] ${variableName} must be a non-empty MongoDB URI.`,
    );
  }

  let parsedUri;

  try {
    parsedUri = new URL(uri.trim());
  } catch {
    // Do not attach the parser error because it can include the URI.
    throw new Error(
      `[TITech test database] ${variableName} is not a valid MongoDB URI.`,
    );
  }

  if (
    !['mongodb:', 'mongodb+srv:'].includes(
      parsedUri.protocol,
    ) ||
    !parsedUri.hostname
  ) {
    throw new Error(
      `[TITech test database] ${variableName} must use ` +
        'mongodb:// or mongodb+srv:// and include a host.',
    );
  }

  const hasDbNameQueryParameter =
    [...parsedUri.searchParams.keys()].some(
      (key) => key.toLowerCase() === 'dbname',
    );

  if (hasDbNameQueryParameter) {
    throw new Error(
      `[TITech test database] ${variableName} must specify its database ` +
        'in the URI path, not through a dbName query parameter.',
    );
  }

  let databaseName;

  try {
    const encodedDatabaseName = parsedUri.pathname
      .replace(/^\/+/, '')
      .split('/')[0] ?? '';

    databaseName = encodedDatabaseName
      ? decodeURIComponent(encodedDatabaseName).trim()
      : '';
  } catch {
    throw new Error(
      `[TITech test database] ${variableName} contains an invalid database name.`,
    );
  }

  if (!databaseName) {
    throw new Error(
      `[TITech test database] ${variableName} must include a database ` +
        'name in its URI path.',
    );
  }

  assertSafeTestDatabaseName(
    databaseName,
    variableName,
  );

  return {
    uri: uri.trim(),

    databaseName,

    // The URL host excludes username and password credentials.
    endpoint:
      `${parsedUri.protocol.toLowerCase()}//` +
      parsedUri.host.toLowerCase(),
  };
}

/**
 * Resolve the configured test URI.
 *
 * MONGO_URI_TEST takes precedence. When both MONGO_URI_TEST and MONGO_URI
 * are set, both must identify the same endpoint and database.
 *
 * This catches conflicting environment variables that could otherwise
 * send different TITech modules to different databases.
 */
function resolveTestMongoUri() {
  assertTestEnvironment();

  const testUri =
    process.env.MONGO_URI_TEST?.trim();

  const standardUri =
    process.env.MONGO_URI?.trim();

  if (!testUri && !standardUri) {
    throw new Error(
      '[TITech test database] Configure MONGO_URI_TEST or MONGO_URI.',
    );
  }

  const selected = parseMongoUri(
    testUri || standardUri,
    testUri
      ? 'MONGO_URI_TEST'
      : 'MONGO_URI',
  );

  if (testUri && standardUri) {
    const standard = parseMongoUri(
      standardUri,
      'MONGO_URI',
    );

    if (
      selected.databaseName !== standard.databaseName ||
      selected.endpoint !== standard.endpoint
    ) {
      throw new Error(
        '[TITech test database] MONGO_URI_TEST and MONGO_URI must target ' +
          'the same endpoint and database in the test environment.',
      );
    }
  }

  return selected;
}

/* ============================================================================
 * Connected Database Verification
 * ========================================================================== */

/**
 * Verify that the active default Mongoose connection points to the
 * configured test database.
 *
 * All destructive cleanup operations must pass this check first.
 */
function assertConnectedTestDatabase(
  expectedDatabaseName = null,
) {
  assertTestEnvironment();

  const connection = mongoose.connection;

  if (connection.readyState !== 1) {
    throw new Error(
      '[TITech test database] MongoDB must be connected before clearing data.',
    );
  }

  const configuredDatabaseName =
    expectedDatabaseName ??
    resolveTestMongoUri().databaseName;

  assertSafeTestDatabaseName(
    configuredDatabaseName,
    'Configured database',
  );

  const actualDatabaseName =
    connection.db?.databaseName ??
    connection.name;

  assertSafeTestDatabaseName(
    actualDatabaseName,
    'Connected database',
  );

  if (
    actualDatabaseName !== configuredDatabaseName
  ) {
    throw new Error(
      '[TITech test database] Connected database does not match the ' +
        `configured test database. Expected "${configuredDatabaseName}", ` +
        `received "${actualDatabaseName}".`,
    );
  }

  return connection;
}

/* ============================================================================
 * Connect
 * ========================================================================== */

/**
 * Connect to the configured test database.
 *
 * - Shares a pending helper-owned connection attempt.
 * - Waits for externally initiated connection attempts.
 * - Validates the actual database before returning.
 * - Closes a connection started by this call if validation fails.
 */
export async function connectDB() {
  let openedByThisCall = false;

  try {
    const {
      uri,
      databaseName,
    } = resolveTestMongoUri();

    const connection = mongoose.connection;

    if (connection.readyState === 0) {
      let attempt = connectionAttempt;

      if (!attempt) {
        attempt = mongoose.connect(uri, {
          maxPoolSize: MAX_POOL_SIZE,
        });

        connectionAttempt = attempt;
        openedByThisCall = true;
      }

      try {
        await attempt;
      } finally {
        if (connectionAttempt === attempt) {
          connectionAttempt = null;
        }
      }
    } else if (connection.readyState === 2) {
      // Wait for an existing connection attempt.
      await connection.asPromise();
    } else if (connection.readyState === 3) {
      throw new Error(
        '[TITech test database] MongoDB is disconnecting. ' +
          'Wait for the connection lifecycle to finish before reconnecting.',
      );
    }

    assertConnectedTestDatabase(databaseName);

    validatedDatabaseName = databaseName;

    return connection;
  } catch (error) {
    // Do not leave a connection opened by this call attached to an
    // unverified database if target validation or connection setup fails.
    if (
      openedByThisCall &&
      mongoose.connection.readyState !== 0
    ) {
      try {
        await mongoose.disconnect();
      } catch (cleanupError) {
        logDatabaseError(
          '[TITech test database] Failed to close an unverified connection.',
          cleanupError,
        );
      }

      validatedDatabaseName = null;
    }

    logDatabaseError(
      '[TITech test database] Failed to connect.',
      error,
    );

    throw error;
  }
}

/* ============================================================================
 * Disconnect
 * ========================================================================== */

/**
 * Disconnect from the validated test database.
 *
 * Does not drop a database, delete documents, or remove indexes.
 *
 * A connected database is verified before disconnection so that this
 * test helper cannot silently close an unrelated application connection.
 */
export async function disconnectDB() {
  try {
    const connection = mongoose.connection;

    if (connection.readyState === 0) {
      validatedDatabaseName = null;
      return;
    }

    if (connection.readyState === 2) {
      try {
        await connection.asPromise();
      } catch (error) {
        // Failed connection attempts normally return to readyState 0.
        // Avoid masking the original connection failure during cleanup.
        if (connection.readyState === 0) {
          validatedDatabaseName = null;
          return;
        }

        throw error;
      }
    }

    if (connection.readyState === 1) {
      const expectedDatabaseName =
        validatedDatabaseName ??
        resolveTestMongoUri().databaseName;

      assertConnectedTestDatabase(
        expectedDatabaseName,
      );
    }

    if (connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    validatedDatabaseName = null;
    connectionAttempt = null;
  } catch (error) {
    logDatabaseError(
      '[TITech test database] Failed to disconnect.',
      error,
    );

    throw error;
  }
}

/* ============================================================================
 * Clear All Registered Collections
 * ========================================================================== */

/**
 * Delete documents from all collections registered with the default
 * Mongoose connection.
 *
 * This function:
 * - verifies the database before deleting anything;
 * - preserves collection indexes;
 * - attempts cleanup of every registered collection;
 * - reports failures rather than silently ignoring them.
 *
 * Cleanup is not atomic across collections. If one or more deletions fail,
 * an AggregateError is thrown after the remaining cleanup attempts finish.
 */
export async function clearDatabase() {
  try {
    const connection =
      assertConnectedTestDatabase();

    const collections = Object.entries(
      connection.collections,
    );

    const failures = [];

    for (const [name, collection] of collections) {
      if (
        !collection ||
        typeof collection.deleteMany !== 'function'
      ) {
        continue;
      }

      try {
        await collection.deleteMany({});
      } catch (error) {
        failures.push(error);

        logDatabaseError(
          `[TITech test database] Failed to clear collection "${name}".`,
          error,
        );
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to clear ${failures.length} collection(s); ` +
          'database cleanup may be partial.',
      );
    }
  } catch (error) {
    logDatabaseError(
      '[TITech test database] Failed to clear registered collections.',
      error,
    );

    throw error;
  }
}

/* ============================================================================
 * Clear Selected Registered Collections
 * ========================================================================== */

/**
 * Delete documents from selected registered Mongoose collections.
 *
 * Missing collection names are skipped. Invalid input is rejected before
 * any deletion occurs.
 *
 * If deletions fail, the helper continues attempting the other requested
 * collections and then throws an AggregateError.
 */
export async function clearCollections(
  collectionNames,
) {
  try {
    if (!Array.isArray(collectionNames)) {
      throw new TypeError(
        '[TITech test database] clearCollections expects an array of names.',
      );
    }

    // Validate all supplied names before beginning destructive operations.
    for (const name of collectionNames) {
      if (
        typeof name !== 'string' ||
        name.trim() === '' ||
        name !== name.trim()
      ) {
        throw new TypeError(
          '[TITech test database] Collection names must be non-empty ' +
            'strings without leading or trailing whitespace.',
        );
      }
    }

    const connection =
      assertConnectedTestDatabase();

    const failures = [];

    // Avoid repeating cleanup for duplicate collection names.
    for (const name of new Set(collectionNames)) {
      const collection =
        connection.collections[name];

      // Models that have not registered a collection are skipped.
      if (
        !collection ||
        typeof collection.deleteMany !== 'function'
      ) {
        continue;
      }

      try {
        await collection.deleteMany({});
      } catch (error) {
        failures.push(error);

        logDatabaseError(
          `[TITech test database] Failed to clear collection "${name}".`,
          error,
        );
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to clear ${failures.length} selected collection(s); ` +
          'database cleanup may be partial.',
      );
    }
  } catch (error) {
    logDatabaseError(
      '[TITech test database] Failed to clear selected collections.',
      error,
    );

    throw error;
  }
}