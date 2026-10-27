'use strict';

/**
 * TITech Community Capital — SystemSetting integration tests.
 *
 * File: backend/tests/integration/systemSetting.test.cjs
 *
 * Run from backend/:
 * node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
 *   tests/integration/systemSetting.test.cjs --runInBand --no-cache
 *
 * Module contract:
 * - This test file uses CommonJS (.cjs).
 * - CommonJS dependencies are loaded with require().
 * - Native ESM application modules are loaded with dynamic import().
 * - The canonical ApplicationBootstrap is used; the application is not
 *   recreated or replaced with a test-only Express application.
 *
 * Safety contract:
 * - Destructive fixture cleanup is permitted only on a database whose name
 *   explicitly identifies it as a test database.
 * - Only TITECH.TEST.* SystemSetting fixtures and the exact run-specific
 *   test-user email addresses are eligible for cleanup.
 * - Authentication, tenant isolation, and protected-setting checks must not
 *   be silently skipped.
 */

const request = require('supertest');
const mongoose = require('mongoose');

let app = null;
let integrationBootstrap = null;
let SystemSetting = null;
let User = null;
let tokenA = null;
let tokenB = null;
let settingA = null;

const SYSTEM_TENANT_ID = 'SYSTEM';
const TEST_TENANT_A = resolveTenantId(
  'TITECH_SYSTEM_SETTING_TEST_TENANT_A'
);
const TEST_TENANT_B = resolveTenantId(
  'TITECH_SYSTEM_SETTING_TEST_TENANT_B'
);
const TEST_RUN_ID = `${process.pid}-${Date.now()}`;
const TEST_USER_EMAIL =
  `system-setting-a-${TEST_RUN_ID}@titech.test`;
const TEST_USER_B_EMAIL =
  `system-setting-b-${TEST_RUN_ID}@titech.test`;
const TEST_PASSWORD = 'TITechIntegrationTest!2026';

/**
 * Examples of accepted test database names:
 * community_savings_test
 * titech-test
 * test
 *
 * Production database names such as community_savings do not match.
 */

const TEST_DATABASE_NAME_PATTERN = /(?:^|[-_])test(?:$|[-_])/i;
const TEST_SETTING_KEY_PREFIX = 'TITECH.TEST.';
const SETTING_KEYS = Object.freeze({
  STRING: 'TITECH.TEST.STRING_SETTING',
  NUMBER: 'TITECH.TEST.NUMBER_SETTING',
  BOOLEAN: 'TITECH.TEST.BOOLEAN_SETTING',
  JSON: 'TITECH.TEST.JSON_SETTING',
  ARRAY: 'TITECH.TEST.ARRAY_SETTING',
  OVERRIDE: 'TITECH.TEST.OVERRIDE_SETTING',
  PROTECTED: 'TITECH.TEST.PROTECTED_SETTING',
  DISABLE: 'TITECH.TEST.DISABLE_SETTING',
});
const SYSTEM_SETTING_BASE_PATH = normalizeBasePath(
  process.env.SYSTEM_SETTING_TEST_BASE_PATH || '/api/system-settings'
);

/**
 * Resolve a valid ObjectId for test tenants.
 *
 * The SYSTEM sentinel is deliberately separate from normal tenant IDs.
 */

function resolveTenantId(envName) {
  const configured = process.env[envName];
  const value =
    configured || new mongoose.Types.ObjectId().toHexString();
  if (!mongoose.isValidObjectId(value)) {
    throw new TypeError(
      `${envName} must be a valid MongoDB ObjectId string.`
    );
  }
  return String(value);
}

function normalizeBasePath(value) {
  const path = String(value || '').trim();
  if (!path || !path.startsWith('/')) {
    throw new TypeError(
      'SYSTEM_SETTING_TEST_BASE_PATH must be an absolute application path.'
    );
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function normalizeToken(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const token = value.trim().replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

function objectId(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'object') {
    return String(value._id || value.id || '');
  }
  return String(value);
}

function requestId(prefix = 'system-setting-test') {
  return `${prefix}-${Date.now()}-${new mongoose.Types.ObjectId().toHexString()}`;
}

function testKey(suffix) {
  const normalizedSuffix = String(suffix || '')
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .toUpperCase();
  if (!normalizedSuffix) {
    throw new TypeError('A non-empty test setting key suffix is required.');
  }
  return `${TEST_SETTING_KEY_PREFIX}${normalizedSuffix}`;
}

function api(method, path, token = null) {
  if (typeof app !== 'function') {
    throw new TypeError(
      'The canonical Express application has not been initialized.'
    );
  }
  const verb = String(method).toLowerCase();
  const requestFactory = request(app)[verb];
  if (typeof requestFactory !== 'function') {
    throw new TypeError(`Unsupported Supertest HTTP method: ${verb}`);
  }
  let req = requestFactory(path)
    .set('Accept', 'application/json')
    .set('X-Request-ID', requestId());
  const normalizedToken = normalizeToken(token);
  if (normalizedToken) {
    req = req.set('Authorization', `Bearer ${normalizedToken}`);
  }
  return req;
}

function expectError(response, expectedStatuses = []) {
  expect(response).toBeDefined();
  expect(response.body).toBeDefined();
  if (expectedStatuses.length > 0) {
    expect(expectedStatuses).toContain(response.status);
    return;
  }
  expect(response.status).toBeGreaterThanOrEqual(400);
}

function extractToken(response) {
  const body = response?.body;
  return normalizeToken(
    body?.token ||
      body?.accessToken ||
      body?.access_token ||
      body?.data?.token ||
      body?.data?.accessToken ||
      body?.data?.access_token ||
      response?.headers?.['x-access-token'] ||
      null
  );
}

/**
 * Find the Mongoose model exported by an ESM module without relying on
 * require() for the native ESM file.
 */

function resolveMongooseModel(moduleNamespace, modelName) {
  const candidates = [
    moduleNamespace?.default,
    moduleNamespace?.[modelName],
    mongoose.models[modelName],
  ];
  return (
    candidates.find(
      (candidate) =>
        candidate &&
        candidate.schema &&
        typeof candidate.findOne === 'function' &&
        typeof candidate.deleteMany === 'function'
    ) || null
  );
}

function assertModelsAvailable() {
  if (
    !SystemSetting ||
    !SystemSetting.schema ||
    typeof SystemSetting.create !== 'function' ||
    typeof SystemSetting.deleteMany !== 'function'
  ) {
    throw new TypeError(
      'The native ESM SystemSetting Mongoose model is unavailable or invalid.'
    );
  }
  if (
    !User ||
    !User.schema ||
    typeof User.create !== 'function' ||
    typeof User.deleteMany !== 'function'
  ) {
    throw new TypeError(
      'The native ESM User Mongoose model is unavailable or invalid.'
    );
  }
}

/**
 * Resolve the canonical active status from the actual User schema.
 *
 * This avoids assuming that the enum uses uppercase or lowercase values.
 * If the schema has no status field, leave it out and allow the model's
 * own defaults to apply. If the schema has an enum but no active state,
 * fail explicitly rather than silently creating an unsuitable test user.
 */

function resolveActiveUserStatus(UserModel) {
  const statusPath = UserModel?.schema?.path('status');
  if (!statusPath) {
    return undefined;
  }
  const allowedValues = Array.isArray(statusPath.enumValues)
    ? statusPath.enumValues
    : [];
  const activeStatus = allowedValues.find(
    (value) =>
      typeof value === 'string' &&
      value.trim().toLowerCase() === 'active'
  );
  if (activeStatus !== undefined) {
    return activeStatus;
  }
  const defaultValue =
    typeof statusPath.getDefault === 'function'
      ? statusPath.getDefault()
      : undefined;
  if (
    defaultValue !== undefined &&
    String(defaultValue).trim().toLowerCase() === 'active' &&
    (
      allowedValues.length === 0 ||
      allowedValues.includes(defaultValue)
    )
  ) {
    return defaultValue;
  }
  throw new TypeError(
    'Cannot create active SystemSetting integration-test users. ' +
      'The canonical User.status schema does not expose a valid active ' +
      `enum value. Allowed values: ${
        allowedValues.length > 0
          ? allowedValues.join(', ')
          : '<none declared>'
      }. Inspect models/User.js and use its canonical active status.`
  );
}

async function createTestUser({
  email,
  tenantId,
  role = 'admin',
}) {
  if (
    !User ||
    typeof User.create !== 'function'
  ) {
    throw new TypeError(
      'The native ESM Mongoose User model is unavailable.'
    );
  }
  if (!mongoose.isValidObjectId(tenantId)) {
    throw new TypeError(
      'Cannot create a test user with an invalid tenant ObjectId.'
    );
  }
  const status = resolveActiveUserStatus(User);
  const userData = {
    name: 'TITech SystemSetting Integration Test',
    email,
    password: TEST_PASSWORD,
    tenantId: new mongoose.Types.ObjectId(tenantId),
    role,
    isActive: true,
    isVerified: true,
  };
  // Assign only a status value confirmed by the canonical schema.
  if (status !== undefined) {
    userData.status = status;
  }
  const user = new User(userData);

  /*
   * Preserve the canonical model's password hashing and pre-save hooks.
   * Do not manually hash the test password here.
   */

  await user.save();
  return user;
}

async function loginUser(email) {
  const paths = [
    '/api/auth/login',
    '/api/auth/signin',
    '/api/v1/auth/login',
    '/api/v1/auth/signin',
    '/auth/login',
    '/auth/signin',
  ];
  for (const path of paths) {
    const response = await request(app)
      .post(path)
      .set('Accept', 'application/json')
      .set('X-Request-ID', requestId('system-setting-login'))
      .send({
        email,
        password: TEST_PASSWORD,
      });
    const token = extractToken(response);
    if (
      response.status >= 200 &&
      response.status < 300 &&
      token
    ) {
      return token;
    }
  }
  return null;
}

/**
 * Destructive fixture operations require a dedicated test database.
 *
 * The check deliberately fails closed: if the active database cannot be
 * identified as a test database, no fixture deletion is performed.
 */

function assertDedicatedTestDatabase() {
  const databaseName =
    mongoose.connection?.db?.databaseName ||
    mongoose.connection?.name ||
    '';
  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      'Refusing to delete integration fixtures: expected a dedicated test ' +
        `database, but the active MongoDB database is "${databaseName || '<unknown>'}".`
    );
  }
  return databaseName;
}

async function cleanupSettings() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      'Cannot clean SystemSetting fixtures: MongoDB is not connected.'
    );
  }
  const databaseName = assertDedicatedTestDatabase();
  const result = await SystemSetting.deleteMany({
    key: /^TITECH\.TEST\./,
  });
  return {
    databaseName,
    deletedCount: result.deletedCount || 0,
  };
}

async function cleanupTestUsers() {
  if (!User || typeof User.deleteMany !== 'function') {
    return { deletedCount: 0 };
  }
  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      'Cannot clean integration users: MongoDB is not connected.'
    );
  }
  assertDedicatedTestDatabase();
  const result = await User.deleteMany({
    email: {
      $in: [TEST_USER_EMAIL, TEST_USER_B_EMAIL],
    },
  });
  return {
    deletedCount: result.deletedCount || 0,
  };
}

/**
 * Detect duplicate compound tenant/key values before asking Mongoose to
 * build the declared indexes. This operation does not delete any records.
 */

async function assertNoDuplicateTenantKeys() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      'Cannot inspect SystemSetting indexes: MongoDB is not connected.'
    );
  }
  assertDedicatedTestDatabase();
  const collection = mongoose.connection.db.collection(
    SystemSetting.collection.collectionName
  );
  const duplicates = await collection
    .aggregate([
      {
        $group: {
          _id: {
            tenantId: '$tenantId',
            key: '$key',
          },
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
      { $limit: 20 },
    ])
    .toArray();
  if (duplicates.length > 0) {
    throw new Error(
      'Cannot build the SystemSetting tenant/key uniqueness index: ' +
        'duplicate tenant/key records remain in the test database. ' +
        'No non-test records were deleted. Duplicates: ' +
        JSON.stringify(duplicates)
    );
  }
}

async function startCanonicalApplication() {

  /*
   * Load native ESM models with dynamic import(). Do not change these to
   * require('../../models/SystemSetting.js') or require('../../models/User.js').
   */

  const systemSettingModule = await import(
    '../../models/SystemSetting.js'
  );
  const userModelModule = await import('../../models/User.js');
  SystemSetting = resolveMongooseModel(
    systemSettingModule,
    'SystemSetting'
  );
  User = resolveMongooseModel(userModelModule, 'User');
  assertModelsAvailable();

  /*
   * This must be applied before the application bootstrap connects to
   * MongoDB. Indexes are explicitly checked and created later in setup.
   */

  SystemSetting.schema.set('autoIndex', false);
  const { ApplicationBootstrap } = await import(
    '../../bootstrap/ApplicationBootstrap.js'
  );
  if (typeof ApplicationBootstrap !== 'function') {
    throw new TypeError(
      'ApplicationBootstrap.js does not export a usable ApplicationBootstrap class.'
    );
  }
  integrationBootstrap = new ApplicationBootstrap({
    startServer: false,
    registerServerHooks: false,
    requireApplication: true,
  });
  await integrationBootstrap.initialize();
  await integrationBootstrap.start();
  app = integrationBootstrap.getApplication();
  if (typeof app !== 'function' || typeof app.listen !== 'function') {
    throw new TypeError(
      'Canonical TITech bootstrap did not provide a valid Express application.'
    );
  }
  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      'Canonical application bootstrap did not connect MongoDB.'
    );
  }
  const databaseName = assertDedicatedTestDatabase();
  console.log(
    `[SystemSetting Integration] Connected to dedicated test database "${databaseName}".`
  );
}

async function setupIntegrationFixtures() {
  assertModelsAvailable();
  assertDedicatedTestDatabase();

  /*
   * Clean interrupted-run setting fixtures before index creation. The
   * database guard must run before this destructive operation.
   */

  const cleanupResult = await cleanupSettings();
  console.log(
    `[SystemSetting Integration] Cleaned ${cleanupResult.deletedCount} ` +
      `setting fixtures from ${cleanupResult.databaseName}.`
  );
  await assertNoDuplicateTenantKeys();
  await SystemSetting.createIndexes();
  await cleanupTestUsers();
  await createTestUser({
    email: TEST_USER_EMAIL,
    tenantId: TEST_TENANT_A,
    role: 'admin',
  });
  await createTestUser({
    email: TEST_USER_B_EMAIL,
    tenantId: TEST_TENANT_B,
    role: 'admin',
  });
  tokenA = normalizeToken(
    process.env.TITECH_SYSTEM_SETTING_TEST_TOKEN_A
  ) || (await loginUser(TEST_USER_EMAIL));
  tokenB = normalizeToken(
    process.env.TITECH_SYSTEM_SETTING_TEST_TOKEN_B
  ) || (await loginUser(TEST_USER_B_EMAIL));

  /*
   * Failing setup is intentional. The HTTP tests must never appear to pass
   * when authentication failed or when test principals were unavailable.
   */

  if (!tokenA || !tokenB) {
    throw new Error(
      'SystemSetting HTTP integration tests require working authentication ' +
        'tokens for both tenants. The suite could not log in both seeded test ' +
        'users. Verify the canonical authentication routes and User schema, ' +
        'or provide TITECH_SYSTEM_SETTING_TEST_TOKEN_A and ' +
        'TITECH_SYSTEM_SETTING_TEST_TOKEN_B together with matching ' +
        'TITECH_SYSTEM_SETTING_TEST_TENANT_A and ' +
        'TITECH_SYSTEM_SETTING_TEST_TENANT_B values.'
    );
  }
  console.log(
    '[SystemSetting Integration] Canonical application and test principals initialized.'
  );
}

/**
 * Stop the canonical bootstrap even when fixture cleanup fails.
 * Cleanup errors are not silently swallowed.
 */

async function stopCanonicalApplication() {
  let cleanupError = null;
  try {
    if (
      mongoose.connection.readyState === 1 &&
      SystemSetting &&
      User
    ) {
      await cleanupSettings();
      await cleanupTestUsers();
    }
  } catch (error) {
    cleanupError = error;
  } finally {
    if (integrationBootstrap) {
      try {
        if (typeof integrationBootstrap.stop === 'function') {
          await integrationBootstrap.stop(
            'system-setting-integration-test'
          );
        }
      } catch (error) {
        cleanupError = cleanupError || error;
      }
      try {
        if (typeof integrationBootstrap.destroy === 'function') {
          await integrationBootstrap.destroy();
        }
      } catch (error) {
        cleanupError = cleanupError || error;
      }
    }
  }
  if (cleanupError) {
    throw cleanupError;
  }
}

beforeAll(async () => {
  await startCanonicalApplication();
  await setupIntegrationFixtures();
}, 60000);

beforeEach(async () => {

  /*
   * Every test begins with clean SystemSetting fixtures. This deliberately
   * uses the same strict database guard as initial setup and teardown.
   */

  await cleanupSettings();
});

afterEach(() => {
  settingA = null;
});

afterAll(async () => {
  await stopCanonicalApplication();
}, 60000);

describe('TITech SystemSetting API — Integration', () => {

  describe('API availability', () => {

    test('system-setting router is mounted', async () => {
      const response = await api(
        'get',
        SYSTEM_SETTING_BASE_PATH
      );
      expect([200, 401, 403]).toContain(response.status);
    });
  });

  describe('Authentication', () => {

    test('rejects unauthenticated access', async () => {
      const response = await api(
        'get',
        SYSTEM_SETTING_BASE_PATH
      );
      expect([401, 403]).toContain(response.status);
    });
  });

  describe('Create setting', () => {

    test('creates a tenant-scoped setting through the HTTP API', async () => {
      const response = await api(
        'post',
        SYSTEM_SETTING_BASE_PATH,
        tokenA
      ).send({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.STRING,
        category: 'SYSTEM',
        name: 'TITech Test String',
        description: 'Integration test setting.',
        value: 'enabled',
        valueType: 'STRING',
        enabled: true,
        complianceRelevant: false,
        regulatoryCritical: false,
      });
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(300);
      const body = response.body?.data || response.body;
      const setting = body?.setting || body;
      expect(
        String(setting?.key || '')
      ).toBe(SETTING_KEYS.STRING);
      const stored = await SystemSetting.findOne({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.STRING,
      });
      expect(stored).not.toBeNull();
      expect(stored.value).toBe('enabled');
    });

    test('normalizes setting keys to uppercase', async () => {
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: 'titech.test.normalized',
        category: 'SYSTEM',
        value: 'normalized',
        valueType: 'STRING',
      });
      expect(setting.key).toBe('TITECH.TEST.NORMALIZED');
      const reloaded = await SystemSetting.findById(setting._id);
      expect(reloaded.key).toBe('TITECH.TEST.NORMALIZED');
    });

    test('prevents duplicate tenant/key settings', async () => {
      const payload = {
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.STRING,
        category: 'SYSTEM',
        valueType: 'STRING',
      };
      await SystemSetting.create({
        ...payload,
        value: 'first',
      });
      await expect(
        SystemSetting.create({
          ...payload,
          value: 'second',
        })
      ).rejects.toMatchObject({
        code: 11000,
      });
    });

    test('allows the same key for different tenants', async () => {
      const first = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.STRING,
        category: 'SYSTEM',
        value: 'tenant-a',
        valueType: 'STRING',
      });
      const second = await SystemSetting.create({
        tenantId: TEST_TENANT_B,
        key: SETTING_KEYS.STRING,
        category: 'SYSTEM',
        value: 'tenant-b',
        valueType: 'STRING',
      });
      expect(String(first.tenantId)).toBe(TEST_TENANT_A);
      expect(String(second.tenantId)).toBe(TEST_TENANT_B);
      expect(first.value).toBe('tenant-a');
      expect(second.value).toBe('tenant-b');
    });
  });

  describe('Value type enforcement', () => {

    test('accepts STRING settings', async () => {
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.STRING,
        category: 'SYSTEM',
        value: 'hello',
        valueType: 'STRING',
      });
      expect(setting.valueType).toBe('STRING');
      expect(setting.value).toBe('hello');
    });

    test('accepts NUMBER settings', async () => {
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.NUMBER,
        category: 'SYSTEM',
        value: 25,
        valueType: 'NUMBER',
      });
      expect(setting.value).toBe(25);
    });

    test('accepts BOOLEAN settings', async () => {
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.BOOLEAN,
        category: 'SYSTEM',
        value: true,
        valueType: 'BOOLEAN',
      });
      expect(setting.value).toBe(true);
    });

    test('accepts JSON settings', async () => {
      const value = {
        enabled: true,
        threshold: 50,
      };
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.JSON,
        category: 'SYSTEM',
        value,
        valueType: 'JSON',
      });
      expect(setting.value).toEqual(value);
    });

    test('accepts ARRAY settings', async () => {
      const value = ['A', 'B', 'C'];
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.ARRAY,
        category: 'SYSTEM',
        value,
        valueType: 'ARRAY',
      });
      expect(setting.value).toEqual(value);
    });

    test('rejects mismatched value types', async () => {
      await expect(
        SystemSetting.create({
          tenantId: TEST_TENANT_A,
          key: testKey('INVALID_TYPE'),
          category: 'SYSTEM',
          value: 'not-a-number',
          valueType: 'NUMBER',
        })
      ).rejects.toThrow();
    });
  });

  describe('Tenant isolation', () => {

    beforeEach(async () => {
      await SystemSetting.create([
        {
          tenantId: TEST_TENANT_A,
          key: SETTING_KEYS.OVERRIDE,
          category: 'GENERAL',
          value: 'tenant-a-secret',
          valueType: 'STRING',
          enabled: true,
        },
        {
          tenantId: TEST_TENANT_B,
          key: SETTING_KEYS.OVERRIDE,
          category: 'GENERAL',
          value: 'tenant-b-secret',
          valueType: 'STRING',
          enabled: true,
        },
      ]);
    });

    test('resolves values within their own tenant scope', async () => {
      await expect(
        SystemSetting.getValue(
          SETTING_KEYS.OVERRIDE,
          TEST_TENANT_A
        )
      ).resolves.toBe('tenant-a-secret');
      await expect(
        SystemSetting.getValue(
          SETTING_KEYS.OVERRIDE,
          TEST_TENANT_B
        )
      ).resolves.toBe('tenant-b-secret');
    });

    test('keeps tenant setting documents isolated', async () => {
      const results = await SystemSetting.find({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.OVERRIDE,
      });
      expect(results).toHaveLength(1);
      expect(String(results[0].tenantId)).toBe(TEST_TENANT_A);
      expect(results[0].value).toBe('tenant-a-secret');
    });

    test('does not mutate tenant B when updating within tenant A scope', async () => {
      const tenantBSetting = await SystemSetting.findOne({
        tenantId: TEST_TENANT_B,
        key: SETTING_KEYS.OVERRIDE,
      });
      expect(tenantBSetting).not.toBeNull();
      const updatedA = await SystemSetting.updateSetting(
        SETTING_KEYS.OVERRIDE,
        { value: 'updated-tenant-a' },
        TEST_TENANT_A
      );
      expect(updatedA).toBeTruthy();
      const unchangedB = await SystemSetting.findById(
        tenantBSetting._id
      );
      const reloadedA = await SystemSetting.findOne({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.OVERRIDE,
      });
      expect(unchangedB.value).toBe('tenant-b-secret');
      expect(reloadedA.value).toBe('updated-tenant-a');
    });

    test('rejects cross-tenant HTTP access', async () => {
      const tenantBSetting = await SystemSetting.findOne({
        tenantId: TEST_TENANT_B,
        key: SETTING_KEYS.OVERRIDE,
      });
      const response = await api(
        'get',
        `${SYSTEM_SETTING_BASE_PATH}/${objectId(tenantBSetting)}`,
        tokenA
      );
      expect([403, 404]).toContain(response.status);
    });
  });

  describe('SYSTEM settings', () => {

    test('SYSTEM settings use SYSTEM tenant scope', async () => {
      const setting = await SystemSetting.create({
        tenantId: SYSTEM_TENANT_ID,
        key: SETTING_KEYS.PROTECTED,
        category: 'SECURITY',
        value: true,
        valueType: 'BOOLEAN',
        isSystem: true,
        editable: false,
        regulatoryCritical: true,
      });
      expect(String(setting.tenantId)).toBe(SYSTEM_TENANT_ID);
      expect(setting.isSystem).toBe(true);
      expect(setting.editable).toBe(false);
    });

    test('rejects isSystem settings outside SYSTEM scope', async () => {
      await expect(
        SystemSetting.create({
          tenantId: TEST_TENANT_A,
          key: testKey('INVALID_SYSTEM_SCOPE'),
          category: 'SYSTEM',
          value: true,
          valueType: 'BOOLEAN',
          isSystem: true,
        })
      ).rejects.toThrow();
    });

    test('protected SYSTEM setting cannot be modified by setValue', async () => {
      await SystemSetting.create({
        tenantId: SYSTEM_TENANT_ID,
        key: SETTING_KEYS.PROTECTED,
        category: 'SECURITY',
        value: true,
        valueType: 'BOOLEAN',
        isSystem: true,
        editable: false,
      });
      await expect(
        SystemSetting.setValue(
          SETTING_KEYS.PROTECTED,
          false,
          SYSTEM_TENANT_ID,
          null
        )
      ).rejects.toMatchObject({
        code: 'SYSTEM_SETTING_PROTECTED',
      });
    });
  });

  describe('Effective configuration', () => {

    test('falls back to SYSTEM when a tenant override does not exist', async () => {
      await SystemSetting.create({
        tenantId: SYSTEM_TENANT_ID,
        key: SETTING_KEYS.OVERRIDE,
        category: 'GENERAL',
        value: 'system-default',
        valueType: 'STRING',
        enabled: true,
      });
      await expect(
        SystemSetting.getEffectiveValue(
          SETTING_KEYS.OVERRIDE,
          TEST_TENANT_A
        )
      ).resolves.toBe('system-default');
    });

    test('tenant override takes precedence over SYSTEM value', async () => {
      await SystemSetting.create([
        {
          tenantId: SYSTEM_TENANT_ID,
          key: SETTING_KEYS.OVERRIDE,
          category: 'GENERAL',
          value: 'system-default',
          valueType: 'STRING',
          enabled: true,
        },
        {
          tenantId: TEST_TENANT_A,
          key: SETTING_KEYS.OVERRIDE,
          category: 'GENERAL',
          value: 'tenant-value',
          valueType: 'STRING',
          enabled: true,
        },
      ]);
      await expect(
        SystemSetting.getEffectiveValue(
          SETTING_KEYS.OVERRIDE,
          TEST_TENANT_A
        )
      ).resolves.toBe('tenant-value');
    });

    test('disabled tenant override falls back to SYSTEM value', async () => {
      await SystemSetting.create([
        {
          tenantId: SYSTEM_TENANT_ID,
          key: SETTING_KEYS.OVERRIDE,
          category: 'GENERAL',
          value: 'system-default',
          valueType: 'STRING',
          enabled: true,
        },
        {
          tenantId: TEST_TENANT_A,
          key: SETTING_KEYS.OVERRIDE,
          category: 'GENERAL',
          value: 'tenant-value',
          valueType: 'STRING',
          enabled: false,
        },
      ]);
      await expect(
        SystemSetting.getEffectiveValue(
          SETTING_KEYS.OVERRIDE,
          TEST_TENANT_A
        )
      ).resolves.toBe('system-default');
    });

    test('returns the supplied fallback when no effective setting exists', async () => {
      await expect(
        SystemSetting.getEffectiveValue(
          testKey('MISSING_SETTING'),
          TEST_TENANT_A,
          'safe-default'
        )
      ).resolves.toBe('safe-default');
    });
  });

  describe('Optimistic concurrency', () => {

    test('starts new settings at version 1', async () => {
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: testKey('VERSION_ONE'),
        category: 'SYSTEM',
        value: 'v1',
        valueType: 'STRING',
      });
      expect(setting.version).toBe(1);
    });

    test('increments version on setValue', async () => {
      const key = testKey('VERSION_SET_VALUE');
      await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key,
        category: 'SYSTEM',
        value: 'v1',
        valueType: 'STRING',
      });
      const updated = await SystemSetting.setValue(
        key,
        'v2',
        TEST_TENANT_A
      );
      expect(updated.version).toBe(2);
    });

    test('rejects stale expectedVersion', async () => {
      const key = testKey('VERSION_CONFLICT');
      await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key,
        category: 'SYSTEM',
        value: 'v1',
        valueType: 'STRING',
      });
      await SystemSetting.setValue(
        key,
        'v2',
        TEST_TENANT_A
      );
      await expect(
        SystemSetting.setValue(
          key,
          'v3',
          TEST_TENANT_A,
          null,
          { expectedVersion: 1 }
        )
      ).rejects.toMatchObject({
        code: 'SYSTEM_SETTING_VERSION_CONFLICT',
      });
    });
  });

  describe('Audit trail', () => {

    test('records a CREATE audit entry', async () => {
      const setting = await SystemSetting.setValue(
        testKey('AUDIT_CREATE'),
        'initial',
        TEST_TENANT_A,
        null,
        {
          requestId: requestId('integration-create'),
          source: 'integration-test',
        }
      );
      expect(setting.auditLog).toHaveLength(1);
      expect(setting.auditLog[0].action).toBe('CREATE');
      expect(setting.auditLog[0].requestId).toMatch(
        /^integration-create-/
      );
    });

    test('records VALUE_UPDATE with previous and new values and versions', async () => {
      const key = testKey('AUDIT_UPDATE');
      await SystemSetting.setValue(
        key,
        'before',
        TEST_TENANT_A
      );
      const updated = await SystemSetting.setValue(
        key,
        'after',
        TEST_TENANT_A,
        null,
        { requestId: 'integration-update-001' }
      );
      expect(updated.auditLog.length).toBe(2);
      const audit =
        updated.auditLog[updated.auditLog.length - 1];
      expect(audit.action).toBe('VALUE_UPDATE');
      expect(audit.previousValue).toBe('before');
      expect(audit.newValue).toBe('after');
      expect(audit.previousVersion).toBe(1);
      expect(audit.newVersion).toBe(2);
      expect(audit.requestId).toBe('integration-update-001');
    });

    test('bounds audit history', async () => {
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: testKey('AUDIT_BOUND'),
        category: 'SYSTEM',
        value: '0',
        valueType: 'STRING',
      });
      for (let index = 1; index <= 125; index += 1) {
        setting.value = String(index);
        await setting.save();
      }
      const reloaded = await SystemSetting.findOne({
        tenantId: TEST_TENANT_A,
        key: setting.key,
      });
      expect(reloaded.auditLog.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Enable / disable lifecycle', () => {

    test('disableTenantOverride disables a tenant override and records DISABLE', async () => {
      await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: SETTING_KEYS.DISABLE,
        category: 'GENERAL',
        value: 'enabled',
        valueType: 'STRING',
        enabled: true,
      });
      const disabled = await SystemSetting.disableTenantOverride(
        SETTING_KEYS.DISABLE,
        TEST_TENANT_A,
        null,
        { requestId: 'disable-test-001' }
      );
      expect(disabled.enabled).toBe(false);
      expect(disabled.version).toBe(2);
      expect(
        disabled.auditLog[disabled.auditLog.length - 1].action
      ).toBe('DISABLE');
    });

    test('SYSTEM cannot be disabled as a tenant override', async () => {
      await expect(
        SystemSetting.disableTenantOverride(
          SETTING_KEYS.DISABLE,
          SYSTEM_TENANT_ID
        )
      ).rejects.toThrow();
    });

    test('instance enable increments version', async () => {
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: testKey('ENABLE'),
        category: 'GENERAL',
        value: 'enabled',
        valueType: 'STRING',
        enabled: false,
      });
      const previousVersion = setting.version;
      await setting.enable(null, {
        allowProtectedUpdate: true,
      });
      expect(setting.enabled).toBe(true);
      expect(setting.version).toBe(previousVersion + 1);
    });

    test('instance disable increments version', async () => {
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: testKey('INSTANCE_DISABLE'),
        category: 'GENERAL',
        value: 'enabled',
        valueType: 'STRING',
        enabled: true,
      });
      const previousVersion = setting.version;
      await setting.disable(null, {
        allowProtectedUpdate: true,
      });
      expect(setting.enabled).toBe(false);
      expect(setting.version).toBe(previousVersion + 1);
    });
  });

  describe('Category and collection operations', () => {

    test('getCategory returns enabled settings sorted by key', async () => {
      await SystemSetting.create([
        {
          tenantId: TEST_TENANT_A,
          key: testKey('CATEGORY_Z'),
          category: 'SECURITY',
          value: true,
          valueType: 'BOOLEAN',
          enabled: true,
        },
        {
          tenantId: TEST_TENANT_A,
          key: testKey('CATEGORY_A'),
          category: 'SECURITY',
          value: true,
          valueType: 'BOOLEAN',
          enabled: true,
        },
        {
          tenantId: TEST_TENANT_A,
          key: testKey('CATEGORY_DISABLED'),
          category: 'SECURITY',
          value: true,
          valueType: 'BOOLEAN',
          enabled: false,
        },
      ]);
      const settings = await SystemSetting.getCategory(
        'security',
        TEST_TENANT_A
      );
      expect(settings.map((item) => item.key)).toEqual([
        testKey('CATEGORY_A'),
        testKey('CATEGORY_Z'),
      ]);
    });

    test('getAllSettings excludes disabled settings', async () => {
      await SystemSetting.create([
        {
          tenantId: TEST_TENANT_A,
          key: testKey('ALL_A'),
          category: 'SYSTEM',
          value: 'a',
          valueType: 'STRING',
          enabled: true,
        },
        {
          tenantId: TEST_TENANT_A,
          key: testKey('ALL_B'),
          category: 'SYSTEM',
          value: 'b',
          valueType: 'STRING',
          enabled: false,
        },
      ]);
      const settings = await SystemSetting.getAllSettings(
        TEST_TENANT_A
      );
      expect(
        settings.some((item) => item.key === testKey('ALL_A'))
      ).toBe(true);
      expect(
        settings.some((item) => item.key === testKey('ALL_B'))
      ).toBe(false);
    });
  });

  describe('Health summary', () => {

    test('returns operational configuration health summary', async () => {
      await SystemSetting.create([
        {
          tenantId: TEST_TENANT_A,
          key: testKey('HEALTH_A'),
          category: 'COMPLIANCE',
          value: true,
          valueType: 'BOOLEAN',
          enabled: true,
          complianceRelevant: true,
          regulatoryCritical: true,
        },
        {
          tenantId: TEST_TENANT_A,
          key: testKey('HEALTH_B'),
          category: 'GENERAL',
          value: false,
          valueType: 'BOOLEAN',
          enabled: false,
        },
      ]);
      const summary = await SystemSetting.getHealthSummary(
        TEST_TENANT_A
      );
      expect(String(summary.tenantId)).toBe(TEST_TENANT_A);
      expect(summary.total).toBe(2);
      expect(summary.enabled).toBe(1);
      expect(summary.disabled).toBe(1);
      expect(summary.complianceRelevant).toBe(1);
      expect(summary.regulatoryCritical).toBe(1);
      expect(summary.generatedAt).toBeInstanceOf(Date);
    });
  });

  describe('Serialization', () => {

    test('does not expose MongoDB internals through toJSON', async () => {
      const setting = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: testKey('JSON_SERIALIZATION'),
        category: 'SYSTEM',
        value: 'safe',
        valueType: 'STRING',
      });
      const json = setting.toJSON();
      expect(json.__v).toBeUndefined();
      expect(json._id).toBeUndefined();
      expect(json.id).toBeDefined();
    });
  });

  describe('HTTP validation', () => {

    test('rejects malformed setting key', async () => {
      const response = await api(
        'post',
        SYSTEM_SETTING_BASE_PATH,
        tokenA
      ).send({
        tenantId: TEST_TENANT_A,
        key: 'invalid key with spaces',
        category: 'SYSTEM',
        value: 'test',
        valueType: 'STRING',
      });
      expectError(response, [400, 422]);
    });

    test('rejects unsupported category', async () => {
      const response = await api(
        'post',
        SYSTEM_SETTING_BASE_PATH,
        tokenA
      ).send({
        tenantId: TEST_TENANT_A,
        key: testKey('BAD_CATEGORY'),
        category: 'NOT_A_REAL_CATEGORY',
        value: true,
        valueType: 'BOOLEAN',
      });
      expectError(response, [400, 422]);
    });

    test('rejects invalid valueType', async () => {
      const response = await api(
        'post',
        SYSTEM_SETTING_BASE_PATH,
        tokenA
      ).send({
        tenantId: TEST_TENANT_A,
        key: testKey('BAD_VALUE_TYPE'),
        category: 'SYSTEM',
        value: true,
        valueType: 'NOT_A_VALUE_TYPE',
      });
      expectError(response, [400, 422]);
    });

    test('does not trust arbitrary tenantId supplied by the client', async () => {
      const key = testKey('CLIENT_TENANT_ATTACK');
      const response = await api(
        'post',
        SYSTEM_SETTING_BASE_PATH,
        tokenA
      ).send({
        tenantId: TEST_TENANT_B,
        key,
        category: 'SYSTEM',
        value: 'must-not-cross-boundary',
        valueType: 'STRING',
      });

      /*
       * A secure API may reject the payload, or it may ignore the supplied
       * tenantId and force the authenticated principal's tenant. Both are
       * acceptable only if no setting is created for tenant B.
       */

      const leaked = await SystemSetting.findOne({
        tenantId: TEST_TENANT_B,
        key,
      });
      expect(leaked).toBeNull();
      if (
        response.status >= 200 &&
        response.status < 300
      ) {
        const correctlyScoped = await SystemSetting.findOne({
          tenantId: TEST_TENANT_A,
          key,
        });
        expect(correctlyScoped).not.toBeNull();
        expect(String(correctlyScoped.tenantId)).toBe(TEST_TENANT_A);
        expect(correctlyScoped.value).toBe('must-not-cross-boundary');
      } else {
        expect([400, 403, 409, 422]).toContain(response.status);
      }
    });
  });

  describe('HTTP read operations', () => {

    beforeEach(async () => {
      settingA = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: testKey('HTTP_READ'),
        category: 'GENERAL',
        name: 'HTTP Read Test',
        value: 'read-value',
        valueType: 'STRING',
        enabled: true,
      });
    });

    test('authenticated tenant can read its own setting', async () => {
      const response = await api(
        'get',
        `${SYSTEM_SETTING_BASE_PATH}/${objectId(settingA)}`,
        tokenA
      );
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(300);
    });

    test('tenant B cannot read tenant A setting', async () => {
      const response = await api(
        'get',
        `${SYSTEM_SETTING_BASE_PATH}/${objectId(settingA)}`,
        tokenB
      );
      expect([403, 404]).toContain(response.status);
    });
  });

  describe('HTTP update operations', () => {

    beforeEach(async () => {
      settingA = await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: testKey('HTTP_UPDATE'),
        category: 'GENERAL',
        name: 'Original Name',
        value: 'before',
        valueType: 'STRING',
        enabled: true,
        editable: true,
      });
    });

    test('updates a tenant setting', async () => {
      const response = await api(
        'patch',
        `${SYSTEM_SETTING_BASE_PATH}/${objectId(settingA)}`,
        tokenA
      ).send({
        value: 'after',
        valueType: 'STRING',
        expectedVersion: settingA.version,
      });
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(300);
      const updated = await SystemSetting.findById(settingA._id);
      expect(updated.value).toBe('after');
      expect(updated.version).toBe(settingA.version + 1);
    });

    test('rejects a stale update version', async () => {
      await SystemSetting.updateSetting(
        settingA.key,
        { value: 'intermediate' },
        TEST_TENANT_A
      );
      const response = await api(
        'patch',
        `${SYSTEM_SETTING_BASE_PATH}/${objectId(settingA)}`,
        tokenA
      ).send({
        value: 'stale-write',
        valueType: 'STRING',
        expectedVersion: 1,
      });
      expect([409, 412]).toContain(response.status);
      const unchanged = await SystemSetting.findById(settingA._id);
      expect(unchanged.value).toBe('intermediate');
    });

    test('cannot update another tenant setting', async () => {
      const response = await api(
        'patch',
        `${SYSTEM_SETTING_BASE_PATH}/${objectId(settingA)}`,
        tokenB
      ).send({
        value: 'cross-tenant-write',
      });
      expect([403, 404]).toContain(response.status);
      const unchanged = await SystemSetting.findById(settingA._id);
      expect(unchanged.value).toBe('before');
    });
  });

  describe('HTTP lifecycle protection', () => {

    test('protected SYSTEM settings cannot be physically removed through the standard API', async () => {
      const protectedSetting = await SystemSetting.create({
        tenantId: SYSTEM_TENANT_ID,
        key: testKey('PROTECTED_DELETE'),
        category: 'SECURITY',
        value: true,
        valueType: 'BOOLEAN',
        isSystem: true,
        editable: false,
      });
      const response = await api(
        'delete',
        `${SYSTEM_SETTING_BASE_PATH}/${objectId(protectedSetting)}`,
        tokenA
      );
      expect([403, 404, 405]).toContain(response.status);
      const stillExists = await SystemSetting.findById(
        protectedSetting._id
      );
      expect(stillExists).not.toBeNull();
    });
  });

  describe('HTTP effective configuration', () => {

    test('tenant override takes precedence over SYSTEM default', async () => {
      const key = testKey('HTTP_EFFECTIVE');
      await SystemSetting.create([
        {
          tenantId: SYSTEM_TENANT_ID,
          key,
          category: 'GENERAL',
          value: 'system',
          valueType: 'STRING',
          enabled: true,
        },
        {
          tenantId: TEST_TENANT_A,
          key,
          category: 'GENERAL',
          value: 'tenant',
          valueType: 'STRING',
          enabled: true,
        },
      ]);

      /*
       * This assertion exercises the canonical model's effective-setting
       * resolver. It does not imply that the HTTP API exposes a particular
       * effective-configuration endpoint.
       */

      const effective = await SystemSetting.getEffectiveSetting(
        key,
        TEST_TENANT_A
      );
      expect(effective).not.toBeNull();
      expect(String(effective.tenantId)).toBe(TEST_TENANT_A);
      expect(effective.value).toBe('tenant');
    });
  });

  describe('Security regression protection', () => {

    test('does not permit arbitrary MongoDB operator payloads to cross tenant boundaries', async () => {
      const key = testKey('MONGO_OPERATOR_ATTACK');
      const response = await api(
        'post',
        SYSTEM_SETTING_BASE_PATH,
        tokenA
      ).send({
        tenantId: { $ne: null },
        key,
        category: 'SYSTEM',
        value: 'attack',
        valueType: 'STRING',
      });
      const createdForTenantB = await SystemSetting.findOne({
        tenantId: TEST_TENANT_B,
        key,
      });
      expect(createdForTenantB).toBeNull();
      if (
        response.status >= 200 &&
        response.status < 300
      ) {
        const safelyScoped = await SystemSetting.findOne({
          tenantId: TEST_TENANT_A,
          key,
        });
        expect(safelyScoped).not.toBeNull();
        expect(String(safelyScoped.tenantId)).toBe(TEST_TENANT_A);
      } else {
        expect([400, 403, 422]).toContain(response.status);
      }
    });

    test('does not allow the client to forge SYSTEM-protected settings', async () => {
      const key = testKey('FORGED_SYSTEM');
      const response = await api(
        'post',
        SYSTEM_SETTING_BASE_PATH,
        tokenA
      ).send({
        tenantId: TEST_TENANT_A,
        key,
        category: 'SECURITY',
        value: true,
        valueType: 'BOOLEAN',
        isSystem: true,
      });
      const forgedTenantSetting = await SystemSetting.findOne({
        tenantId: TEST_TENANT_A,
        key,
      });
      const forgedSystemSetting = await SystemSetting.findOne({
        tenantId: SYSTEM_TENANT_ID,
        key,
      });

      /*
       * The API must reject a forged privileged flag or safely ignore it.
       * It must not create a SYSTEM-scoped record on behalf of a tenant.
       */

      expect(forgedSystemSetting).toBeNull();
      if (
        response.status >= 200 &&
        response.status < 300
      ) {
        expect(forgedTenantSetting).not.toBeNull();
        expect(forgedTenantSetting.isSystem).not.toBe(true);
      } else {
        expect([400, 403, 422]).toContain(response.status);
      }
    });

    test('does not expose secret-like setting values in readiness responses', async () => {
      const secretValue = `test-secret-${TEST_RUN_ID}`;
      await SystemSetting.create({
        tenantId: TEST_TENANT_A,
        key: testKey('SECRET_VALUE'),
        category: 'SECURITY',
        value: secretValue,
        valueType: 'STRING',
        enabled: true,
      });
      const response = await request(app)
        .get('/api/v1/ready')
        .set('Accept', 'application/json')
        .set('X-Request-ID', requestId('secret-redaction-test'));
      expect([200, 503]).toContain(response.status);
      expect(
        JSON.stringify(response.body || {})
      ).not.toContain(secretValue);
    });
  });
});
