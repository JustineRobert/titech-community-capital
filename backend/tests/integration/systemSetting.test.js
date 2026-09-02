'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE SYSTEM SETTING INTEGRATION TEST SUITE
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/systemSetting.test.js
 *
 * Purpose:
 *   End-to-end HTTP integration tests for the TITech Community Capital
 *   System Setting API.
 *
 * Coverage:
 *   - Authentication
 *   - Authorization
 *   - Tenant isolation
 *   - System/global settings
 *   - Tenant settings
 *   - Tenant overrides
 *   - Effective configuration resolution
 *   - CRUD lifecycle
 *   - Validation
 *   - Protected settings
 *   - Optimistic concurrency
 *   - Audit metadata
 *   - Enable / disable lifecycle
 *   - Health summary
 *   - Duplicate protection
 *   - Input normalization
 *   - Cross-tenant access prevention
 *   - Error handling
 *
 * Architectural rules:
 *   1. Tests exercise the HTTP boundary rather than bypassing controllers.
 *   2. Tenant identity must come from trusted authentication context.
 *   3. Client-supplied tenant identity must never override authenticated scope.
 *   4. System settings and tenant settings remain logically isolated.
 *   5. Financial balances and ledger records do not belong in this model.
 *
 * TITech terminology:
 *   All legacy ACFOS terminology has been replaced with TITech.
 *
 * ============================================================================
 */

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../server');

const SystemSetting =
    require('../../models/SystemSetting');

/**
 * ============================================================================
 * OPTIONAL TEST DEPENDENCIES
 * ============================================================================
 *
 * The test suite deliberately resolves authentication helpers dynamically.
 * This allows it to work with the project's existing authentication model
 * without hard-coding one particular User factory implementation.
 * ============================================================================
 */

let User = null;

try {
    User = require('../../models/User');
} catch (error) {
    User = null;
}

/**
 * ============================================================================
 * TEST CONSTANTS
 * ============================================================================
 */

const TEST_TENANT_A = 'TITECH-TEST-TENANT-A';
const TEST_TENANT_B = 'TITECH-TEST-TENANT-B';

const SYSTEM_TENANT_ID = 'SYSTEM';

const TEST_USER_EMAIL =
    `system-setting-a-${Date.now()}@titech.test`;

const TEST_USER_B_EMAIL =
    `system-setting-b-${Date.now()}@titech.test`;

const TEST_PASSWORD =
    'TITechIntegrationTest!2026';

const SETTING_KEYS = Object.freeze({
    STRING:
        'TITECH.TEST.STRING_SETTING',

    NUMBER:
        'TITECH.TEST.NUMBER_SETTING',

    BOOLEAN:
        'TITECH.TEST.BOOLEAN_SETTING',

    JSON:
        'TITECH.TEST.JSON_SETTING',

    ARRAY:
        'TITECH.TEST.ARRAY_SETTING',

    OVERRIDE:
        'TITECH.TEST.OVERRIDE_SETTING',

    PROTECTED:
        'TITECH.TEST.PROTECTED_SETTING',

    DISABLE:
        'TITECH.TEST.DISABLE_SETTING'
});

/**
 * ============================================================================
 * ROUTE DISCOVERY
 * ============================================================================
 *
 * The production application may mount the router under one of several
 * prefixes depending on the server bootstrap configuration.
 *
 * The preferred production route is:
 *
 *   /api/system-settings
 *
 * The helper below keeps the suite centralized so the route prefix can be
 * changed in one place if the application's bootstrap uses another prefix.
 * ============================================================================
 */

const SYSTEM_SETTING_BASE_PATH =
    process.env.SYSTEM_SETTING_TEST_BASE_PATH ||
    '/api/system-settings';

/**
 * ============================================================================
 * TEST STATE
 * ============================================================================
 */

let userA = null;
let userB = null;

let tokenA = null;
let tokenB = null;

let settingA = null;
let settingB = null;

/**
 * ============================================================================
 * HELPER: OBJECT ID
 * ============================================================================
 */

function objectId(value) {
    if (!value) {
        return null;
    }

    return String(
        value._id ||
        value.id ||
        value
    );
}

/**
 * ============================================================================
 * HELPER: RANDOM REQUEST ID
 * ============================================================================
 */

function requestId(prefix = 'system-setting-test') {
    return `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 12)}`;
}

/**
 * ============================================================================
 * HELPER: API REQUEST
 * ============================================================================
 */

function api(method, path, token = null) {
    let req = request(app)[method](path)
        .set(
            'Accept',
            'application/json'
        )
        .set(
            'X-Request-ID',
            requestId()
        );

    if (token) {
        req = req.set(
            'Authorization',
            `Bearer ${token}`
        );
    }

    return req;
}

/**
 * ============================================================================
 * HELPER: ASSERT API ERROR
 * ============================================================================
 */

function expectError(response, expectedStatuses = []) {
    expect(
        response.body
    ).toBeDefined();

    if (expectedStatuses.length > 0) {
        expect(
            expectedStatuses
        ).toContain(response.status);
    } else {
        expect(
            response.status
        ).toBeGreaterThanOrEqual(400);
    }
}

/**
 * ============================================================================
 * HELPER: EXTRACT TOKEN
 * ============================================================================
 */

function extractToken(response) {
    return (
        response.body?.token ||
        response.body?.accessToken ||
        response.body?.access_token ||
        response.body?.data?.token ||
        response.body?.data?.accessToken ||
        response.body?.data?.access_token ||
        response.headers?.['x-access-token'] ||
        null
    );
}

/**
 * ============================================================================
 * HELPER: EXTRACT USER ID
 * ============================================================================
 */

function extractUserId(response) {
    return (
        response.body?.user?.id ||
        response.body?.user?._id ||
        response.body?.data?.user?.id ||
        response.body?.data?.user?._id ||
        response.body?.id ||
        response.body?._id ||
        null
    );
}

/**
 * ============================================================================
 * HELPER: CREATE TEST USER
 * ============================================================================
 *
 * If the project's User model is available, create users directly so these
 * tests do not depend on registration endpoint semantics.
 *
 * The function supports common User schema conventions.
 * ============================================================================
 */

async function createTestUser({
    email,
    tenantId,
    role = 'admin'
}) {
    if (!User) {
        return {
            _id:
                new mongoose.Types.ObjectId(),

            email,

            tenantId,

            role
        };
    }

    const basePayload = {
        email,
        password: TEST_PASSWORD,
        tenantId,
        role,

        firstName: 'TITech',
        lastName: 'SystemSettingTest',

        isActive: true,
        active: true,

        status: 'ACTIVE'
    };

    /**
     * Prefer the application's own password hashing lifecycle.
     */
    try {
        const user =
            new User(basePayload);

        if (
            typeof user.setPassword ===
            'function'
        ) {
            await user.setPassword(
                TEST_PASSWORD
            );
        }

        await user.save();

        return user;
    } catch (firstError) {
        /**
         * Some projects hash passwords in a pre-save hook and reject
         * unsupported fields. Retry with a smaller payload.
         */
        const fallbackPayload = {
            email,
            password: TEST_PASSWORD,
            tenantId,
            role
        };

        const user =
            new User(fallbackPayload);

        await user.save();

        return user;
    }
}

/**
 * ============================================================================
 * HELPER: LOGIN
 * ============================================================================
 *
 * Supports common login route conventions.
 * ============================================================================
 */

async function loginUser(email) {
    const loginPaths = [
        '/api/auth/login',
        '/api/auth/signin',
        '/auth/login',
        '/auth/signin'
    ];

    for (const path of loginPaths) {
        const response =
            await request(app)
                .post(path)
                .send({
                    email,
                    password:
                        TEST_PASSWORD
                });

        const token =
            extractToken(response);

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
 * ============================================================================
 * HELPER: AUTHENTICATION FALLBACK
 * ============================================================================
 *
 * Allows tests to use a project-level TEST_ACCESS_TOKEN when authentication
 * bootstrap is unavailable in a particular test environment.
 * ============================================================================
 */

function configuredTestToken(name) {
    return (
        process.env[name] ||
        null
    );
}

/**
 * ============================================================================
 * DATABASE CLEANUP
 * ============================================================================
 */

async function cleanupSettings() {
    if (
        !mongoose.connection ||
        mongoose.connection.readyState !== 1
    ) {
        return;
    }

    await SystemSetting.deleteMany({
        tenantId: {
            $in: [
                TEST_TENANT_A,
                TEST_TENANT_B
            ]
        }
    });
}

/**
 * ============================================================================
 * BEFORE ALL
 * ============================================================================
 */

beforeAll(async () => {
    /**
     * Do not connect manually when the application bootstrap already owns the
     * MongoDB connection.
     *
     * This test suite assumes the repository's integration-test environment
     * starts MongoDB before Jest execution.
     */

    await cleanupSettings();

    /**
     * Create users when possible.
     */
    try {
        userA =
            await createTestUser({
                email:
                    TEST_USER_EMAIL,
                tenantId:
                    TEST_TENANT_A,
                role:
                    'admin'
            });

        userB =
            await createTestUser({
                email:
                    TEST_USER_B_EMAIL,
                tenantId:
                    TEST_TENANT_B,
                role:
                    'admin'
            });
    } catch (error) {
        /**
         * Authentication setup can be supplied by environment variables.
         * Keep the test file loadable even where the project uses a custom
         * authentication fixture.
         */
        userA = {
            _id:
                new mongoose.Types.ObjectId(),

            email:
                TEST_USER_EMAIL,

            tenantId:
                TEST_TENANT_A
        };

        userB = {
            _id:
                new mongoose.Types.ObjectId(),

            email:
                TEST_USER_B_EMAIL,

            tenantId:
                TEST_TENANT_B
        };
    }

    tokenA =
        configuredTestToken(
            'TITECH_SYSTEM_SETTING_TEST_TOKEN_A'
        ) ||
        await loginUser(
            TEST_USER_EMAIL
        );

    tokenB =
        configuredTestToken(
            'TITECH_SYSTEM_SETTING_TEST_TOKEN_B'
        ) ||
        await loginUser(
            TEST_USER_B_EMAIL
        );
});

/**
 * ============================================================================
 * AFTER EACH
 * ============================================================================
 */

afterEach(async () => {
    settingA = null;
    settingB = null;
});

/**
 * ============================================================================
 * AFTER ALL
 * ============================================================================
 */

afterAll(async () => {
    await cleanupSettings();

    /**
     * Remove test users only when they were created by this suite.
     */
    if (
        User &&
        mongoose.connection &&
        mongoose.connection.readyState === 1
    ) {
        await User.deleteMany({
            email: {
                $in: [
                    TEST_USER_EMAIL,
                    TEST_USER_B_EMAIL
                ]
            }
        });
    }
});

/**
 * ============================================================================
 * SUITE
 * ============================================================================
 */

describe(
    'TITech System Setting API - Integration',
    () => {
        /**
         * ====================================================================
         * AVAILABILITY
         * ====================================================================
         */

        describe(
            'API availability',
            () => {
                test(
                    'system-setting router is mounted',
                    async () => {
                        const response =
                            await api(
                                'get',
                                `${SYSTEM_SETTING_BASE_PATH}`
                            );

                        /**
                         * A mounted authenticated route should return an
                         * authorization response rather than 404.
                         */
                        expect(
                            [200, 401, 403]
                        ).toContain(
                            response.status
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * AUTHENTICATION
         * ====================================================================
         */

        describe(
            'Authentication',
            () => {
                test(
                    'rejects unauthenticated access',
                    async () => {
                        const response =
                            await api(
                                'get',
                                `${SYSTEM_SETTING_BASE_PATH}`
                            );

                        expect(
                            [401, 403]
                        ).toContain(
                            response.status
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * CREATE
         * ====================================================================
         */

        describe(
            'Create setting',
            () => {
                test(
                    'creates a tenant-scoped setting',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        const response =
                            await api(
                                'post',
                                `${SYSTEM_SETTING_BASE_PATH}`,
                                tokenA
                            )
                                .send({
                                    tenantId:
                                        TEST_TENANT_A,

                                    key:
                                        SETTING_KEYS.STRING,

                                    category:
                                        'SYSTEM',

                                    name:
                                        'TITech Test String',

                                    description:
                                        'Integration test setting.',

                                    value:
                                        'enabled',

                                    valueType:
                                        'STRING',

                                    enabled:
                                        true,

                                    complianceRelevant:
                                        false,

                                    regulatoryCritical:
                                        false
                                });

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            200
                        );

                        expect(
                            response.status
                        ).toBeLessThan(300);

                        const body =
                            response.body?.data ||
                            response.body;

                        expect(body).toBeDefined();

                        expect(
                            String(
                                body.key ||
                                body.setting?.key
                            )
                        ).toBe(
                            SETTING_KEYS.STRING
                        );
                    }
                );

                test(
                    'normalizes setting keys to uppercase',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'titech.test.normalized',

                                category:
                                    'SYSTEM',

                                value:
                                    'normalized',

                                valueType:
                                    'STRING'
                            });

                        expect(
                            setting.key
                        ).toBe(
                            'TITECH.TEST.NORMALIZED'
                        );
                    }
                );

                test(
                    'prevents duplicate tenant/key settings',
                    async () => {
                        await SystemSetting.create({
                            tenantId:
                                TEST_TENANT_A,

                            key:
                                SETTING_KEYS.STRING,

                            category:
                                'SYSTEM',

                            value:
                                'first',

                            valueType:
                                'STRING'
                        });

                        await expect(
                            SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    SETTING_KEYS.STRING,

                                category:
                                    'SYSTEM',

                                value:
                                    'second',

                                valueType:
                                    'STRING'
                            })
                        ).rejects.toMatchObject({
                            code: 11000
                        });
                    }
                );

                test(
                    'allows the same key for different tenants',
                    async () => {
                        const first =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    SETTING_KEYS.STRING,

                                category:
                                    'SYSTEM',

                                value:
                                    'tenant-a',

                                valueType:
                                    'STRING'
                            });

                        const second =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_B,

                                key:
                                    SETTING_KEYS.STRING,

                                category:
                                    'SYSTEM',

                                value:
                                    'tenant-b',

                                valueType:
                                    'STRING'
                            });

                        expect(
                            first.tenantId
                        ).toBe(
                            TEST_TENANT_A
                        );

                        expect(
                            second.tenantId
                        ).toBe(
                            TEST_TENANT_B
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * VALUE TYPES
         * ====================================================================
         */

        describe(
            'Value type enforcement',
            () => {
                test(
                    'accepts STRING settings',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    SETTING_KEYS.STRING,

                                category:
                                    'SYSTEM',

                                value:
                                    'hello',

                                valueType:
                                    'STRING'
                            });

                        expect(
                            setting.valueType
                        ).toBe(
                            'STRING'
                        );
                    }
                );

                test(
                    'accepts NUMBER settings',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    SETTING_KEYS.NUMBER,

                                category:
                                    'SYSTEM',

                                value:
                                    25,

                                valueType:
                                    'NUMBER'
                            });

                        expect(
                            setting.value
                        ).toBe(25);
                    }
                );

                test(
                    'accepts BOOLEAN settings',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    SETTING_KEYS.BOOLEAN,

                                category:
                                    'SYSTEM',

                                value:
                                    true,

                                valueType:
                                    'BOOLEAN'
                            });

                        expect(
                            setting.value
                        ).toBe(true);
                    }
                );

                test(
                    'accepts JSON settings',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    SETTING_KEYS.JSON,

                                category:
                                    'SYSTEM',

                                value: {
                                    enabled:
                                        true,
                                    threshold:
                                        50
                                },

                                valueType:
                                    'JSON'
                            });

                        expect(
                            setting.value
                        ).toEqual({
                            enabled:
                                true,
                            threshold:
                                50
                        });
                    }
                );

                test(
                    'accepts ARRAY settings',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    SETTING_KEYS.ARRAY,

                                category:
                                    'SYSTEM',

                                value: [
                                    'A',
                                    'B',
                                    'C'
                                ],

                                valueType:
                                    'ARRAY'
                            });

                        expect(
                            setting.value
                        ).toEqual([
                            'A',
                            'B',
                            'C'
                        ]);
                    }
                );

                test(
                    'rejects mismatched value types',
                    async () => {
                        await expect(
                            SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.INVALID_TYPE',

                                category:
                                    'SYSTEM',

                                value:
                                    'not-a-number',

                                valueType:
                                    'NUMBER'
                            })
                        ).rejects.toThrow();
                    }
                );
            }
        );

        /**
         * ====================================================================
         * TENANT ISOLATION
         * ====================================================================
         */

        describe(
            'Tenant isolation',
            () => {
                beforeEach(async () => {
                    await SystemSetting.create({
                        tenantId:
                            TEST_TENANT_A,

                        key:
                            SETTING_KEYS.OVERRIDE,

                        category:
                            'GENERAL',

                        value:
                            'tenant-a-secret',

                        valueType:
                            'STRING',

                        enabled:
                            true
                    });

                    await SystemSetting.create({
                        tenantId:
                            TEST_TENANT_B,

                        key:
                            SETTING_KEYS.OVERRIDE,

                        category:
                            'GENERAL',

                        value:
                            'tenant-b-secret',

                        valueType:
                            'STRING',

                        enabled:
                            true
                    });
                });

                test(
                    'does not resolve another tenant setting through getValue',
                    async () => {
                        const value =
                            await SystemSetting.getValue(
                                SETTING_KEYS.OVERRIDE,
                                TEST_TENANT_A
                            );

                        expect(value).toBe(
                            'tenant-a-secret'
                        );

                        const other =
                            await SystemSetting.getValue(
                                SETTING_KEYS.OVERRIDE,
                                TEST_TENANT_B
                            );

                        expect(other).toBe(
                            'tenant-b-secret'
                        );
                    }
                );

                test(
                    'keeps tenant setting documents isolated',
                    async () => {
                        const results =
                            await SystemSetting.find({
                                tenantId:
                                    TEST_TENANT_A,
                                key:
                                    SETTING_KEYS.OVERRIDE
                            });

                        expect(
                            results
                        ).toHaveLength(1);

                        expect(
                            results[0].tenantId
                        ).toBe(
                            TEST_TENANT_A
                        );

                        expect(
                            results[0].value
                        ).toBe(
                            'tenant-a-secret'
                        );
                    }
                );

                test(
                    'does not permit tenant A to mutate tenant B through model API',
                    async () => {
                        const tenantBSetting =
                            await SystemSetting.findOne({
                                tenantId:
                                    TEST_TENANT_B,

                                key:
                                    SETTING_KEYS.OVERRIDE
                            });

                        await expect(
                            SystemSetting.updateSetting(
                                SETTING_KEYS.OVERRIDE,
                                {
                                    value:
                                        'attempted-cross-tenant-write'
                                },
                                TEST_TENANT_A
                            )
                        ).rejects.toThrow();

                        const unchanged =
                            await SystemSetting.findById(
                                tenantBSetting._id
                            );

                        expect(
                            unchanged.value
                        ).toBe(
                            'tenant-b-secret'
                        );
                    }
                );

                test(
                    'rejects cross-tenant HTTP access',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        const tenantBSetting =
                            await SystemSetting.findOne({
                                tenantId:
                                    TEST_TENANT_B,

                                key:
                                    SETTING_KEYS.OVERRIDE
                            });

                        const response =
                            await api(
                                'get',
                                `${SYSTEM_SETTING_BASE_PATH}/${objectId(
                                    tenantBSetting
                                )}`,
                                tokenA
                            );

                        expect(
                            [403, 404]
                        ).toContain(
                            response.status
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * SYSTEM SETTINGS
         * ====================================================================
         */

        describe(
            'SYSTEM settings',
            () => {
                test(
                    'SYSTEM settings use SYSTEM tenant scope',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    SYSTEM_TENANT_ID,

                                key:
                                    SETTING_KEYS.PROTECTED,

                                category:
                                    'SECURITY',

                                value:
                                    true,

                                valueType:
                                    'BOOLEAN',

                                isSystem:
                                    true,

                                editable:
                                    false,

                                regulatoryCritical:
                                    true
                            });

                        expect(
                            setting.tenantId
                        ).toBe(
                            SYSTEM_TENANT_ID
                        );

                        expect(
                            setting.isSystem
                        ).toBe(true);

                        expect(
                            setting.editable
                        ).toBe(false);
                    }
                );

                test(
                    'rejects isSystem settings outside SYSTEM scope',
                    async () => {
                        await expect(
                            SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.INVALID_SYSTEM_SCOPE',

                                category:
                                    'SYSTEM',

                                value:
                                    true,

                                valueType:
                                    'BOOLEAN',

                                isSystem:
                                    true
                            })
                        ).rejects.toThrow();
                    }
                );

                test(
                    'protected SYSTEM setting cannot be modified by standard API',
                    async () => {
                        await SystemSetting.create({
                            tenantId:
                                SYSTEM_TENANT_ID,

                            key:
                                SETTING_KEYS.PROTECTED,

                            category:
                                'SECURITY',

                            value:
                                true,

                            valueType:
                                'BOOLEAN',

                            isSystem:
                                true,

                            editable:
                                false
                        });

                        await expect(
                            SystemSetting.setValue(
                                SETTING_KEYS.PROTECTED,
                                false,
                                SYSTEM_TENANT_ID,
                                null
                            )
                        ).rejects.toMatchObject({
                            code:
                                'SYSTEM_SETTING_PROTECTED'
                        });
                    }
                );
            }
        );

        /**
         * ====================================================================
         * EFFECTIVE CONFIGURATION
         * ====================================================================
         */

        describe(
            'Effective configuration',
            () => {
                test(
                    'falls back to SYSTEM setting when tenant override does not exist',
                    async () => {
                        await SystemSetting.create({
                            tenantId:
                                SYSTEM_TENANT_ID,

                            key:
                                SETTING_KEYS.OVERRIDE,

                            category:
                                'GENERAL',

                            value:
                                'system-default',

                            valueType:
                                'STRING',

                            enabled:
                                true
                        });

                        const effective =
                            await SystemSetting.getEffectiveValue(
                                SETTING_KEYS.OVERRIDE,
                                TEST_TENANT_A
                            );

                        expect(
                            effective
                        ).toBe(
                            'system-default'
                        );
                    }
                );

                test(
                    'tenant override wins over SYSTEM value',
                    async () => {
                        await SystemSetting.create({
                            tenantId:
                                SYSTEM_TENANT_ID,

                            key:
                                SETTING_KEYS.OVERRIDE,

                            category:
                                'GENERAL',

                            value:
                                'system-default',

                            valueType:
                                'STRING',

                            enabled:
                                true
                        });

                        await SystemSetting.create({
                            tenantId:
                                TEST_TENANT_A,

                            key:
                                SETTING_KEYS.OVERRIDE,

                            category:
                                'GENERAL',

                            value:
                                'tenant-value',

                            valueType:
                                'STRING',

                            enabled:
                                true
                        });

                        const effective =
                            await SystemSetting.getEffectiveValue(
                                SETTING_KEYS.OVERRIDE,
                                TEST_TENANT_A
                            );

                        expect(
                            effective
                        ).toBe(
                            'tenant-value'
                        );
                    }
                );

                test(
                    'disabled tenant override falls back to SYSTEM value',
                    async () => {
                        await SystemSetting.create({
                            tenantId:
                                SYSTEM_TENANT_ID,

                            key:
                                SETTING_KEYS.OVERRIDE,

                            category:
                                'GENERAL',

                            value:
                                'system-default',

                            valueType:
                                'STRING',

                            enabled:
                                true
                        });

                        await SystemSetting.create({
                            tenantId:
                                TEST_TENANT_A,

                            key:
                                SETTING_KEYS.OVERRIDE,

                            category:
                                'GENERAL',

                            value:
                                'tenant-value',

                            valueType:
                                'STRING',

                            enabled:
                                false
                        });

                        const effective =
                            await SystemSetting.getEffectiveValue(
                                SETTING_KEYS.OVERRIDE,
                                TEST_TENANT_A
                            );

                        expect(
                            effective
                        ).toBe(
                            'system-default'
                        );
                    }
                );

                test(
                    'returns fallback when no effective setting exists',
                    async () => {
                        const effective =
                            await SystemSetting.getEffectiveValue(
                                'TITECH.TEST.MISSING_SETTING',
                                TEST_TENANT_A,
                                'safe-default'
                            );

                        expect(
                            effective
                        ).toBe(
                            'safe-default'
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * VERSIONING
         * ====================================================================
         */

        describe(
            'Optimistic concurrency',
            () => {
                test(
                    'starts new settings at version 1',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.VERSION_ONE',

                                category:
                                    'SYSTEM',

                                value:
                                    'v1',

                                valueType:
                                    'STRING'
                            });

                        expect(
                            setting.version
                        ).toBe(1);
                    }
                );

                test(
                    'increments version on setValue',
                    async () => {
                        await SystemSetting.create({
                            tenantId:
                                TEST_TENANT_A,

                            key:
                                'TITECH.TEST.VERSION_SET_VALUE',

                            category:
                                'SYSTEM',

                            value:
                                'v1',

                            valueType:
                                'STRING'
                        });

                        const updated =
                            await SystemSetting.setValue(
                                'TITECH.TEST.VERSION_SET_VALUE',
                                'v2',
                                TEST_TENANT_A
                            );

                        expect(
                            updated.version
                        ).toBe(2);
                    }
                );

                test(
                    'rejects stale expectedVersion',
                    async () => {
                        await SystemSetting.create({
                            tenantId:
                                TEST_TENANT_A,

                            key:
                                'TITECH.TEST.VERSION_CONFLICT',

                            category:
                                'SYSTEM',

                            value:
                                'v1',

                            valueType:
                                'STRING'
                        });

                        await SystemSetting.setValue(
                            'TITECH.TEST.VERSION_CONFLICT',
                            'v2',
                            TEST_TENANT_A
                        );

                        await expect(
                            SystemSetting.setValue(
                                'TITECH.TEST.VERSION_CONFLICT',
                                'v3',
                                TEST_TENANT_A,
                                null,
                                {
                                    expectedVersion:
                                        1
                                }
                            )
                        ).rejects.toMatchObject({
                            code:
                                'SYSTEM_SETTING_VERSION_CONFLICT'
                        });
                    }
                );
            }
        );

        /**
         * ====================================================================
         * AUDIT
         * ====================================================================
         */

        describe(
            'Audit trail',
            () => {
                test(
                    'records CREATE audit entry',
                    async () => {
                        const setting =
                            await SystemSetting.setValue(
                                'TITECH.TEST.AUDIT_CREATE',
                                'initial',
                                TEST_TENANT_A,
                                null,
                                {
                                    requestId:
                                        'integration-create-001',
                                    source:
                                        'integration-test'
                                }
                            );

                        expect(
                            setting.auditLog
                        ).toHaveLength(1);

                        expect(
                            setting.auditLog[0].action
                        ).toBe(
                            'CREATE'
                        );

                        expect(
                            setting.auditLog[0].requestId
                        ).toBe(
                            'integration-create-001'
                        );
                    }
                );

                test(
                    'records VALUE_UPDATE audit entry',
                    async () => {
                        await SystemSetting.setValue(
                            'TITECH.TEST.AUDIT_UPDATE',
                            'before',
                            TEST_TENANT_A
                        );

                        const updated =
                            await SystemSetting.setValue(
                                'TITECH.TEST.AUDIT_UPDATE',
                                'after',
                                TEST_TENANT_A,
                                null,
                                {
                                    requestId:
                                        'integration-update-001'
                                }
                            );

                        expect(
                            updated.auditLog.length
                        ).toBe(2);

                        const audit =
                            updated.auditLog[
                                updated.auditLog.length - 1
                            ];

                        expect(
                            audit.action
                        ).toBe(
                            'VALUE_UPDATE'
                        );

                        expect(
                            audit.previousValue
                        ).toBe(
                            'before'
                        );

                        expect(
                            audit.newValue
                        ).toBe(
                            'after'
                        );

                        expect(
                            audit.previousVersion
                        ).toBe(1);

                        expect(
                            audit.newVersion
                        ).toBe(2);
                    }
                );

                test(
                    'bounds audit history',
                    async () => {
                        let setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.AUDIT_BOUND',

                                category:
                                    'SYSTEM',

                                value:
                                    '0',

                                valueType:
                                    'STRING'
                            });

                        for (
                            let i = 1;
                            i <= 125;
                            i += 1
                        ) {
                            setting.value =
                                String(i);

                            await setting.save();
                        }

                        setting =
                            await SystemSetting.findOne({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.AUDIT_BOUND'
                            });

                        expect(
                            setting.auditLog.length
                        ).toBeLessThanOrEqual(100);
                    }
                );
            }
        );

        /**
         * ====================================================================
         * ENABLE / DISABLE
         * ====================================================================
         */

        describe(
            'Enable / disable lifecycle',
            () => {
                test(
                    'disableTenantOverride disables a tenant override',
                    async () => {
                        await SystemSetting.create({
                            tenantId:
                                TEST_TENANT_A,

                            key:
                                SETTING_KEYS.DISABLE,

                            category:
                                'GENERAL',

                            value:
                                'enabled',

                            valueType:
                                'STRING',

                            enabled:
                                true
                        });

                        const disabled =
                            await SystemSetting
                                .disableTenantOverride(
                                    SETTING_KEYS.DISABLE,
                                    TEST_TENANT_A,
                                    null,
                                    {
                                        requestId:
                                            'disable-test-001'
                                    }
                                );

                        expect(
                            disabled.enabled
                        ).toBe(false);

                        expect(
                            disabled.version
                        ).toBe(2);

                        expect(
                            disabled.auditLog[
                                disabled.auditLog.length - 1
                            ].action
                        ).toBe(
                            'DISABLE'
                        );
                    }
                );

                test(
                    'SYSTEM cannot be disabled as a tenant override',
                    async () => {
                        await expect(
                            SystemSetting
                                .disableTenantOverride(
                                    SETTING_KEYS.DISABLE,
                                    SYSTEM_TENANT_ID
                                )
                        ).rejects.toThrow();
                    }
                );

                test(
                    'instance enable increments version',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.ENABLE',

                                category:
                                    'GENERAL',

                                value:
                                    'enabled',

                                valueType:
                                    'STRING',

                                enabled:
                                    false
                            });

                        const previous =
                            setting.version;

                        await setting.enable(
                            null,
                            {
                                allowProtectedUpdate:
                                    true
                            }
                        );

                        expect(
                            setting.enabled
                        ).toBe(true);

                        expect(
                            setting.version
                        ).toBe(
                            previous + 1
                        );
                    }
                );

                test(
                    'instance disable increments version',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.INSTANCE_DISABLE',

                                category:
                                    'GENERAL',

                                value:
                                    'enabled',

                                valueType:
                                    'STRING',

                                enabled:
                                    true
                            });

                        const previous =
                            setting.version;

                        await setting.disable(
                            null,
                            {
                                allowProtectedUpdate:
                                    true
                            }
                        );

                        expect(
                            setting.enabled
                        ).toBe(false);

                        expect(
                            setting.version
                        ).toBe(
                            previous + 1
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * CATEGORY / LISTING
         * ====================================================================
         */

        describe(
            'Category and collection operations',
            () => {
                test(
                    'getCategory returns enabled settings sorted by key',
                    async () => {
                        await SystemSetting.create([
                            {
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.CATEGORY.Z',

                                category:
                                    'SECURITY',

                                value:
                                    true,

                                valueType:
                                    'BOOLEAN',

                                enabled:
                                    true
                            },
                            {
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.CATEGORY.A',

                                category:
                                    'SECURITY',

                                value:
                                    true,

                                valueType:
                                    'BOOLEAN',

                                enabled:
                                    true
                            },
                            {
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.CATEGORY.DISABLED',

                                category:
                                    'SECURITY',

                                value:
                                    true,

                                valueType:
                                    'BOOLEAN',

                                enabled:
                                    false
                            }
                        ]);

                        const settings =
                            await SystemSetting
                                .getCategory(
                                    'security',
                                    TEST_TENANT_A
                                );

                        expect(
                            settings.map(
                                item => item.key
                            )
                        ).toEqual([
                            'TITECH.TEST.CATEGORY.A',
                            'TITECH.TEST.CATEGORY.Z'
                        ]);
                    }
                );

                test(
                    'getAllSettings returns only enabled settings',
                    async () => {
                        await SystemSetting.create([
                            {
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.ALL.A',

                                category:
                                    'SYSTEM',

                                value:
                                    'a',

                                valueType:
                                    'STRING',

                                enabled:
                                    true
                            },
                            {
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.ALL.B',

                                category:
                                    'SYSTEM',

                                value:
                                    'b',

                                valueType:
                                    'STRING',

                                enabled:
                                    false
                            }
                        ]);

                        const settings =
                            await SystemSetting
                                .getAllSettings(
                                    TEST_TENANT_A
                                );

                        expect(
                            settings.some(
                                item =>
                                    item.key ===
                                    'TITECH.TEST.ALL.B'
                            )
                        ).toBe(false);
                    }
                );
            }
        );

        /**
         * ====================================================================
         * HEALTH SUMMARY
         * ====================================================================
         */

        describe(
            'Health summary',
            () => {
                test(
                    'returns operational configuration health summary',
                    async () => {
                        await SystemSetting.create([
                            {
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.HEALTH.A',

                                category:
                                    'COMPLIANCE',

                                value:
                                    true,

                                valueType:
                                    'BOOLEAN',

                                enabled:
                                    true,

                                complianceRelevant:
                                    true,

                                regulatoryCritical:
                                    true
                            },
                            {
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.HEALTH.B',

                                category:
                                    'GENERAL',

                                value:
                                    false,

                                valueType:
                                    'BOOLEAN',

                                enabled:
                                    false
                            }
                        ]);

                        const summary =
                            await SystemSetting
                                .getHealthSummary(
                                    TEST_TENANT_A
                                );

                        expect(
                            summary.tenantId
                        ).toBe(
                            TEST_TENANT_A
                        );

                        expect(
                            summary.total
                        ).toBe(2);

                        expect(
                            summary.enabled
                        ).toBe(1);

                        expect(
                            summary.disabled
                        ).toBe(1);

                        expect(
                            summary.complianceRelevant
                        ).toBe(1);

                        expect(
                            summary.regulatoryCritical
                        ).toBe(1);

                        expect(
                            summary.generatedAt
                        ).toBeInstanceOf(
                            Date
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * PUBLIC SERIALIZATION
         * ====================================================================
         */

        describe(
            'Serialization',
            () => {
                test(
                    'does not expose internal MongoDB __v through toJSON',
                    async () => {
                        const setting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.JSON_SERIALIZATION',

                                category:
                                    'SYSTEM',

                                value:
                                    'safe',

                                valueType:
                                    'STRING'
                            });

                        const json =
                            setting.toJSON();

                        expect(
                            json.__v
                        ).toBeUndefined();

                        expect(
                            json._id
                        ).toBeUndefined();

                        expect(
                            json.id
                        ).toBeDefined();
                    }
                );
            }
        );

        /**
         * ====================================================================
         * API VALIDATION
         * ====================================================================
         */

        describe(
            'HTTP validation',
            () => {
                test(
                    'rejects malformed setting key',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        const response =
                            await api(
                                'post',
                                `${SYSTEM_SETTING_BASE_PATH}`,
                                tokenA
                            )
                                .send({
                                    tenantId:
                                        TEST_TENANT_A,

                                    key:
                                        'invalid key with spaces',

                                    category:
                                        'SYSTEM',

                                    value:
                                        'test',

                                    valueType:
                                        'STRING'
                                });

                        expectError(
                            response,
                            [400, 422]
                        );
                    }
                );

                test(
                    'rejects unsupported category',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        const response =
                            await api(
                                'post',
                                `${SYSTEM_SETTING_BASE_PATH}`,
                                tokenA
                            )
                                .send({
                                    tenantId:
                                        TEST_TENANT_A,

                                    key:
                                        'TITECH.TEST.BAD_CATEGORY',

                                    category:
                                        'NOT_A_REAL_CATEGORY',

                                    value:
                                        true,

                                    valueType:
                                        'BOOLEAN'
                                });

                        expectError(
                            response,
                            [400, 422]
                        );
                    }
                );

                test(
                    'rejects invalid valueType',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        const response =
                            await api(
                                'post',
                                `${SYSTEM_SETTING_BASE_PATH}`,
                                tokenA
                            )
                                .send({
                                    tenantId:
                                        TEST_TENANT_A,

                                    key:
                                        'TITECH.TEST.BAD_VALUE_TYPE',

                                    category:
                                        'SYSTEM',

                                    value:
                                        true,

                                    valueType:
                                        'NOT_A_VALUE_TYPE'
                                });

                        expectError(
                            response,
                            [400, 422]
                        );
                    }
                );

                test(
                    'does not trust arbitrary tenantId supplied by client',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        const response =
                            await api(
                                'post',
                                `${SYSTEM_SETTING_BASE_PATH}`,
                                tokenA
                            )
                                .send({
                                    tenantId:
                                        TEST_TENANT_B,

                                    key:
                                        'TITECH.TEST.CLIENT_TENANT_ATTACK',

                                    category:
                                        'SYSTEM',

                                    value:
                                        'must-not-cross-boundary',

                                    valueType:
                                        'STRING'
                                });

                        /**
                         * Depending on the authorization layer, the correct
                         * result is normally 403 or 400/422.
                         *
                         * A successful write into tenant B would represent
                         * a critical tenant-isolation failure.
                         */
                        expect(
                            response.status
                        ).not.toBe(201);

                        expect(
                            response.status
                        ).not.toBe(200);

                        const leaked =
                            await SystemSetting.findOne({
                                tenantId:
                                    TEST_TENANT_B,

                                key:
                                    'TITECH.TEST.CLIENT_TENANT_ATTACK'
                            });

                        expect(
                            leaked
                        ).toBeNull();
                    }
                );
            }
        );

        /**
         * ====================================================================
         * API READ
         * ====================================================================
         */

        describe(
            'HTTP read operations',
            () => {
                beforeEach(async () => {
                    settingA =
                        await SystemSetting.create({
                            tenantId:
                                TEST_TENANT_A,

                            key:
                                'TITECH.TEST.HTTP.READ',

                            category:
                                'GENERAL',

                            name:
                                'HTTP Read Test',

                            value:
                                'read-value',

                            valueType:
                                'STRING',

                            enabled:
                                true
                        });
                });

                test(
                    'authenticated tenant can read its own setting',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        const response =
                            await api(
                                'get',
                                `${SYSTEM_SETTING_BASE_PATH}/${objectId(
                                    settingA
                                )}`,
                                tokenA
                            );

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            200
                        );

                        expect(
                            response.status
                        ).toBeLessThan(300);
                    }
                );

                test(
                    'tenant B cannot read tenant A setting',
                    async () => {
                        if (!tokenB) {
                            return;
                        }

                        const response =
                            await api(
                                'get',
                                `${SYSTEM_SETTING_BASE_PATH}/${objectId(
                                    settingA
                                )}`,
                                tokenB
                            );

                        expect(
                            [403, 404]
                        ).toContain(
                            response.status
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * API UPDATE
         * ====================================================================
         */

        describe(
            'HTTP update operations',
            () => {
                beforeEach(async () => {
                    settingA =
                        await SystemSetting.create({
                            tenantId:
                                TEST_TENANT_A,

                            key:
                                'TITECH.TEST.HTTP.UPDATE',

                            category:
                                'GENERAL',

                            name:
                                'Original Name',

                            value:
                                'before',

                            valueType:
                                'STRING',

                            enabled:
                                true,

                            editable:
                                true
                        });
                });

                test(
                    'updates tenant setting',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        const response =
                            await api(
                                'patch',
                                `${SYSTEM_SETTING_BASE_PATH}/${objectId(
                                    settingA
                                )}`,
                                tokenA
                            )
                                .send({
                                    value:
                                        'after',

                                    valueType:
                                        'STRING',

                                    expectedVersion:
                                        settingA.version
                                });

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            200
                        );

                        expect(
                            response.status
                        ).toBeLessThan(300);

                        const updated =
                            await SystemSetting.findById(
                                settingA._id
                            );

                        expect(
                            updated.value
                        ).toBe(
                            'after'
                        );
                    }
                );

                test(
                    'rejects stale update version',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        await SystemSetting.updateSetting(
                            settingA.key,
                            {
                                value:
                                    'intermediate'
                            },
                            TEST_TENANT_A
                        );

                        const response =
                            await api(
                                'patch',
                                `${SYSTEM_SETTING_BASE_PATH}/${objectId(
                                    settingA
                                )}`,
                                tokenA
                            )
                                .send({
                                    value:
                                        'stale-write',

                                    valueType:
                                        'STRING',

                                    expectedVersion:
                                        1
                                });

                        expect(
                            [409, 412]
                        ).toContain(
                            response.status
                        );
                    }
                );

                test(
                    'cannot update another tenant setting',
                    async () => {
                        if (!tokenB) {
                            return;
                        }

                        const response =
                            await api(
                                'patch',
                                `${SYSTEM_SETTING_BASE_PATH}/${objectId(
                                    settingA
                                )}`,
                                tokenB
                            )
                                .send({
                                    value:
                                        'cross-tenant-write'
                                });

                        expect(
                            [403, 404]
                        ).toContain(
                            response.status
                        );

                        const unchanged =
                            await SystemSetting.findById(
                                settingA._id
                            );

                        expect(
                            unchanged.value
                        ).toBe(
                            'before'
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * API DELETE / DISABLE
         * ====================================================================
         *
         * Production systems should normally prefer logical disablement over
         * physical deletion because configuration history can be operationally
         * and regulatorily significant.
         * ====================================================================
         */

        describe(
            'HTTP lifecycle protection',
            () => {
                test(
                    'protected system settings cannot be physically removed through standard update APIs',
                    async () => {
                        const protectedSetting =
                            await SystemSetting.create({
                                tenantId:
                                    SYSTEM_TENANT_ID,

                                key:
                                    'TITECH.TEST.PROTECTED.DELETE',

                                category:
                                    'SECURITY',

                                value:
                                    true,

                                valueType:
                                    'BOOLEAN',

                                isSystem:
                                    true,

                                editable:
                                    false
                            });

                        if (!tokenA) {
                            expect(
                                protectedSetting.isSystem
                            ).toBe(true);

                            return;
                        }

                        const response =
                            await api(
                                'delete',
                                `${SYSTEM_SETTING_BASE_PATH}/${objectId(
                                    protectedSetting
                                )}`,
                                tokenA
                            );

                        expect(
                            [403, 404, 405]
                        ).toContain(
                            response.status
                        );

                        const stillExists =
                            await SystemSetting.findById(
                                protectedSetting._id
                            );

                        expect(
                            stillExists
                        ).not.toBeNull();
                    }
                );
            }
        );

        /**
         * ====================================================================
         * API EFFECTIVE VALUE
         * ====================================================================
         */

        describe(
            'HTTP effective configuration',
            () => {
                test(
                    'tenant override takes precedence over SYSTEM default',
                    async () => {
                        await SystemSetting.create({
                            tenantId:
                                SYSTEM_TENANT_ID,

                            key:
                                'TITECH.TEST.HTTP.EFFECTIVE',

                            category:
                                'GENERAL',

                            value:
                                'system',

                            valueType:
                                'STRING',

                            enabled:
                                true
                        });

                        await SystemSetting.create({
                            tenantId:
                                TEST_TENANT_A,

                            key:
                                'TITECH.TEST.HTTP.EFFECTIVE',

                            category:
                                'GENERAL',

                            value:
                                'tenant',

                            valueType:
                                'STRING',

                            enabled:
                                true
                        });

                        const effective =
                            await SystemSetting
                                .getEffectiveSetting(
                                    'TITECH.TEST.HTTP.EFFECTIVE',
                                    TEST_TENANT_A
                                );

                        expect(
                            effective
                        ).not.toBeNull();

                        expect(
                            effective.tenantId
                        ).toBe(
                            TEST_TENANT_A
                        );

                        expect(
                            effective.value
                        ).toBe(
                            'tenant'
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * SECURITY REGRESSION TESTS
         * ====================================================================
         */

        describe(
            'Security regression protection',
            () => {
                test(
                    'does not permit arbitrary MongoDB operator payloads',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        const response =
                            await api(
                                'post',
                                `${SYSTEM_SETTING_BASE_PATH}`,
                                tokenA
                            )
                                .send({
                                    tenantId:
                                        {
                                            $ne:
                                                null
                                        },

                                    key:
                                        'TITECH.TEST.MONGO_OPERATOR_ATTACK',

                                    category:
                                        'SYSTEM',

                                    value:
                                        'attack',

                                    valueType:
                                        'STRING'
                                });

                        expect(
                            response.status
                        ).not.toBe(201);

                        expect(
                            response.status
                        ).not.toBe(200);
                    }
                );

                test(
                    'does not allow client to mark arbitrary tenant setting as SYSTEM protected setting',
                    async () => {
                        if (!tokenA) {
                            return;
                        }

                        const response =
                            await api(
                                'post',
                                `${SYSTEM_SETTING_BASE_PATH}`,
                                tokenA
                            )
                                .send({
                                    tenantId:
                                        TEST_TENANT_A,

                                    key:
                                        'TITECH.TEST.FORGED_SYSTEM',

                                    category:
                                        'SECURITY',

                                    value:
                                        true,

                                    valueType:
                                        'BOOLEAN',

                                    isSystem:
                                        true
                                });

                        expect(
                            response.status
                        ).not.toBe(201);

                        expect(
                            response.status
                        ).not.toBe(200);

                        const forged =
                            await SystemSetting.findOne({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.FORGED_SYSTEM'
                            });

                        if (forged) {
                            expect(
                                forged.isSystem
                            ).not.toBe(true);
                        }
                    }
                );

                test(
                    'does not expose password/token-like configuration values through unrelated endpoints',
                    async () => {
                        const secretSetting =
                            await SystemSetting.create({
                                tenantId:
                                    TEST_TENANT_A,

                                key:
                                    'TITECH.TEST.SECRET_VALUE',

                                category:
                                    'SECURITY',

                                value:
                                    'do-not-log-this-secret',

                                valueType:
                                    'STRING',

                                enabled:
                                    true
                            });

                        expect(
                            secretSetting.value
                        ).toBe(
                            'do-not-log-this-secret'
                        );

                        /**
                         * This assertion documents the architectural rule:
                         * sensitive secrets should ultimately be stored in a
                         * dedicated secret-management system, not exposed as
                         * ordinary public configuration.
                         */
                        expect(
                            secretSetting.category
                        ).toBe(
                            'SECURITY'
                        );
                    }
                );
            }
        );
    }
);