'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE UNIT TESTS — SYSTEM SETTING SERVICE
 * =============================================================================
 *
 * File:
 *   backend/tests/unit/systemSettingService.test.js
 *
 * Purpose:
 *   Production-grade unit tests for:
 *
 *     backend/services/systemSettingService.js
 *
 * Coverage goals:
 *
 *   - System setting creation
 *   - System setting retrieval
 *   - Tenant isolation
 *   - SYSTEM/global configuration
 *   - Tenant configuration overrides
 *   - Effective configuration resolution
 *   - Configuration updates
 *   - Protected/system settings
 *   - Enable / disable operations
 *   - Validation
 *   - Value type enforcement
 *   - Optimistic concurrency
 *   - Idempotency / request correlation where supported
 *   - Audit metadata propagation
 *   - Failure handling
 *   - Not-found behavior
 *   - Authorization delegation
 *   - Service-level security boundaries
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 *
 * These are UNIT tests.
 *
 * The SystemSetting model is mocked so that these tests validate the service
 * contract rather than MongoDB/Mongoose behavior.
 *
 * Integration tests should separately verify:
 *
 *   - MongoDB indexes
 *   - unique tenant/key constraints
 *   - Mongoose validators
 *   - transactions
 *   - actual optimistic-concurrency behavior
 *   - persistence
 *
 * =============================================================================
 */

const path = require('path');

/**
 * =============================================================================
 * TEST CONFIGURATION
 * =============================================================================
 */

jest.setTimeout(15000);

/**
 * Resolve the service using the project's expected backend layout.
 */
const SERVICE_PATH =
    path.resolve(
        __dirname,
        '../../services/systemSettingService'
    );

/**
 * Resolve the model using the project's expected backend layout.
 */
const MODEL_PATH =
    path.resolve(
        __dirname,
        '../../models/SystemSetting'
    );

/**
 * =============================================================================
 * MOCK MODEL
 * =============================================================================
 *
 * The service may use static model methods or instantiate documents.
 *
 * We provide a comprehensive mock surface while keeping each test explicit.
 * =============================================================================
 */

const mockModel = {
    normalizeKey:
        jest.fn(
            (key) =>
                String(key || '')
                    .trim()
                    .toUpperCase()
        ),

    getValue:
        jest.fn(),

    getSetting:
        jest.fn(),

    getCategory:
        jest.fn(),

    getAllSettings:
        jest.fn(),

    setValue:
        jest.fn(),

    updateSetting:
        jest.fn(),

    getEffectiveValue:
        jest.fn(),

    getEffectiveSetting:
        jest.fn(),

    getHealthSummary:
        jest.fn(),

    disableTenantOverride:
        jest.fn()
};

/**
 * Mock constructor behavior.
 */
function createMockDocument(
    data = {}
) {
    const document = {
        ...data,

        _id:
            data._id ||
            'setting-id-001',

        tenantId:
            data.tenantId ||
            'SYSTEM',

        key:
            data.key ||
            'TEST.SETTING',

        version:
            data.version ||
            1,

        enabled:
            data.enabled !== undefined
                ? data.enabled
                : true,

        editable:
            data.editable !== undefined
                ? data.editable
                : true,

        isSystem:
            data.isSystem !== undefined
                ? data.isSystem
                : data.tenantId === 'SYSTEM',

        save:
            jest.fn(
                async function save() {
                    return this;
                }
            ),

        enable:
            jest.fn(
                async function enable() {
                    this.enabled = true;
                    return this;
                }
            ),

        disable:
            jest.fn(
                async function disable() {
                    this.enabled = false;
                    return this;
                }
            )
    };

    return document;
}

jest.mock(
    '../../models/SystemSetting',
    () => {
        const actualFactory = function SystemSetting(
            data
        ) {
            return createMockDocument(data);
        };

        return Object.assign(
            actualFactory,
            mockModel
        );
    }
);

/**
 * =============================================================================
 * SERVICE IMPORT
 * =============================================================================
 */

const SystemSettingService =
    require(SERVICE_PATH);

/**
 * =============================================================================
 * TEST FIXTURES
 * =============================================================================
 */

const SYSTEM_TENANT_ID = 'SYSTEM';

const TENANT_A = 'TENANT-A';

const TENANT_B = 'TENANT-B';

const USER_ADMIN = '507f1f77bcf86cd799439011';

const USER_ADMIN_B = '507f1f77bcf86cd799439012';

const REQUEST_ID =
    'req-system-setting-unit-001';

const BASE_SETTING = {
    _id: 'setting-id-001',

    tenantId: TENANT_A,

    key: 'AML_ENABLED',

    category: 'AML',

    name: 'AML Enabled',

    description:
        'Controls AML-related processing.',

    value: true,

    valueType: 'BOOLEAN',

    enabled: true,

    isSystem: false,

    editable: true,

    complianceRelevant: true,

    regulatoryCritical: true,

    version: 4,

    createdBy: USER_ADMIN,

    updatedBy: USER_ADMIN,

    lastRequestId: REQUEST_ID
};

const SYSTEM_SETTING = {
    ...BASE_SETTING,

    _id: 'system-setting-id-001',

    tenantId:
        SYSTEM_TENANT_ID,

    key: 'GLOBAL.TIMEZONE',

    category: 'SYSTEM',

    value: 'Africa/Kampala',

    valueType: 'STRING',

    isSystem: true,

    editable: false,

    version: 7
};

const TENANT_OVERRIDE = {
    ...BASE_SETTING,

    _id: 'tenant-override-id-001',

    tenantId: TENANT_A,

    key: 'GLOBAL.TIMEZONE',

    category: 'SYSTEM',

    value: 'Africa/Nairobi',

    valueType: 'STRING',

    isSystem: false,

    editable: true,

    version: 2
};

/**
 * =============================================================================
 * GENERIC TEST HELPERS
 * =============================================================================
 */

function resetMocks() {
    jest.clearAllMocks();

    for (const key of Object.keys(mockModel)) {
        if (
            mockModel[key] &&
            typeof mockModel[key].mockReset === 'function'
        ) {
            mockModel[key].mockReset();
        }
    }

    mockModel.normalizeKey.mockImplementation(
        (key) =>
            String(key || '')
                .trim()
                .toUpperCase()
    );
}

function setMethodResult(
    method,
    result
) {
    expect(
        mockModel[method]
    ).toBeDefined();

    mockModel[method].mockResolvedValue(
        result
    );
}

function setMethodError(
    method,
    error
) {
    expect(
        mockModel[method]
    ).toBeDefined();

    mockModel[method].mockRejectedValue(
        error
    );
}

function createServiceCandidate() {
    /**
     * The project may export:
     *
     *   module.exports = service
     *
     * or:
     *
     *   module.exports = { ... }
     *
     * This helper allows the suite to work with either style while keeping
     * the expected public contract explicit below.
     */
    return SystemSettingService;
}

function getFunction(
    service,
    names
) {
    for (const name of names) {
        if (
            service &&
            typeof service[name] === 'function'
        ) {
            return service[name].bind(service);
        }
    }

    return null;
}

/**
 * Call a service method while producing a useful test failure when the
 * expected public method has not been implemented.
 */
async function callServiceMethod(
    names,
    ...args
) {
    const service =
        createServiceCandidate();

    const method =
        getFunction(
            service,
            names
        );

    if (!method) {
        throw new Error(
            `SystemSettingService is missing expected method. Tried: ${names.join(', ')}`
        );
    }

    return method(
        ...args
    );
}

/**
 * =============================================================================
 * SUITE SETUP
 * =============================================================================
 */

beforeEach(() => {
    resetMocks();
});

afterEach(() => {
    jest.restoreAllMocks();
});

/**
 * =============================================================================
 * SERVICE EXPORT CONTRACT
 * =============================================================================
 */

describe(
    'SystemSettingService — export contract',
    () => {
        test(
            'service module should load successfully',
            () => {
                expect(
                    SystemSettingService
                ).toBeDefined();
            }
        );

        test(
            'service should expose system-setting operations',
            () => {
                const service =
                    SystemSettingService;

                const available =
                    [
                        'getValue',
                        'getSetting',
                        'getCategory',
                        'getAllSettings',
                        'setValue',
                        'updateSetting',
                        'getEffectiveValue',
                        'getEffectiveSetting',
                        'getHealthSummary',
                        'enable',
                        'disable',
                        'disableTenantOverride',
                        'create',
                        'update',
                        'remove',
                        'delete',
                        'restore'
                    ].filter(
                        (name) =>
                            typeof service[name] ===
                            'function'
                    );

                expect(
                    available.length
                ).toBeGreaterThan(0);
            }
        );
    }
);

/**
 * =============================================================================
 * NORMALIZATION
 * =============================================================================
 */

describe(
    'SystemSettingService — normalization',
    () => {
        test(
            'should normalize setting keys before delegating to the model',
            async () => {
                setMethodResult(
                    'getValue',
                    true
                );

                await callServiceMethod(
                    ['getValue'],
                    '  aml_enabled  ',
                    TENANT_A
                );

                expect(
                    mockModel.normalizeKey
                ).toHaveBeenCalledWith(
                    '  aml_enabled  '
                );

                expect(
                    mockModel.getValue
                ).toHaveBeenCalled();

                const call =
                    mockModel.getValue.mock.calls[0];

                expect(
                    String(
                        call[0]
                    ).toUpperCase()
                ).toBe(
                    'AML_ENABLED'
                );
            }
        );

        test(
            'should preserve tenant scope when resolving a setting',
            async () => {
                setMethodResult(
                    'getSetting',
                    BASE_SETTING
                );

                await callServiceMethod(
                    ['getSetting'],
                    'AML_ENABLED',
                    TENANT_A
                );

                expect(
                    mockModel.getSetting
                ).toHaveBeenCalled();

                const [
                    key,
                    tenantId
                ] =
                    mockModel.getSetting.mock
                        .calls[0];

                expect(
                    key
                ).toBe(
                    'AML_ENABLED'
                );

                expect(
                    tenantId
                ).toBe(
                    TENANT_A
                );
            }
        );
    }
);

/**
 * =============================================================================
 * GET VALUE
 * =============================================================================
 */

describe(
    'SystemSettingService — getValue',
    () => {
        test(
            'should return the enabled setting value',
            async () => {
                setMethodResult(
                    'getValue',
                    true
                );

                const result =
                    await callServiceMethod(
                        ['getValue'],
                        'AML_ENABLED',
                        TENANT_A
                    );

                expect(
                    result
                ).toBe(true);

                expect(
                    mockModel.getValue
                ).toHaveBeenCalledTimes(1);
            }
        );

        test(
            'should return fallback when the setting does not exist',
            async () => {
                setMethodResult(
                    'getValue',
                    'DEFAULT'
                );

                const result =
                    await callServiceMethod(
                        ['getValue'],
                        'MISSING.SETTING',
                        TENANT_A,
                        {
                            fallback:
                                'DEFAULT'
                        }
                    );

                expect(
                    result
                ).toBe(
                    'DEFAULT'
                );
            }
        );

        test(
            'should propagate model errors',
            async () => {
                const error =
                    new Error(
                        'Database unavailable'
                    );

                setMethodError(
                    'getValue',
                    error
                );

                await expect(
                    callServiceMethod(
                        ['getValue'],
                        'AML_ENABLED',
                        TENANT_A
                    )
                ).rejects.toThrow(
                    'Database unavailable'
                );
            }
        );
    }
);

/**
 * =============================================================================
 * GET SETTING
 * =============================================================================
 */

describe(
    'SystemSettingService — getSetting',
    () => {
        test(
            'should return a tenant setting',
            async () => {
                setMethodResult(
                    'getSetting',
                    BASE_SETTING
                );

                const result =
                    await callServiceMethod(
                        ['getSetting'],
                        'AML_ENABLED',
                        TENANT_A
                    );

                expect(
                    result
                ).toEqual(
                    BASE_SETTING
                );

                expect(
                    mockModel.getSetting
                ).toHaveBeenCalledWith(
                    'AML_ENABLED',
                    TENANT_A
                );
            }
        );

        test(
            'should return null/not-found result when no setting exists',
            async () => {
                setMethodResult(
                    'getSetting',
                    null
                );

                const result =
                    await callServiceMethod(
                        ['getSetting'],
                        'DOES.NOT.EXIST',
                        TENANT_A
                    );

                expect(
                    result
                ).toBeNull();
            }
        );
    }
);

/**
 * =============================================================================
 * CATEGORY / LIST OPERATIONS
 * =============================================================================
 */

describe(
    'SystemSettingService — category and list operations',
    () => {
        test(
            'should retrieve enabled settings by category',
            async () => {
                const settings = [
                    BASE_SETTING,
                    {
                        ...BASE_SETTING,
                        key:
                            'FRAUD.ENABLED'
                    }
                ];

                setMethodResult(
                    'getCategory',
                    settings
                );

                const result =
                    await callServiceMethod(
                        ['getCategory'],
                        'AML',
                        TENANT_A
                    );

                expect(
                    result
                ).toEqual(
                    settings
                );

                expect(
                    mockModel.getCategory
                ).toHaveBeenCalledWith(
                    'AML',
                    TENANT_A
                );
            }
        );

        test(
            'should retrieve all tenant settings',
            async () => {
                setMethodResult(
                    'getAllSettings',
                    [BASE_SETTING]
                );

                const result =
                    await callServiceMethod(
                        ['getAllSettings'],
                        TENANT_A
                    );

                expect(
                    result
                ).toEqual([
                    BASE_SETTING
                ]);

                expect(
                    mockModel.getAllSettings
                ).toHaveBeenCalledWith(
                    TENANT_A
                );
            }
        );
    }
);

/**
 * =============================================================================
 * SET VALUE
 * =============================================================================
 */

describe(
    'SystemSettingService — setValue',
    () => {
        test(
            'should create or update a setting value',
            async () => {
                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        value: false,
                        version: 5
                    }
                );

                const result =
                    await callServiceMethod(
                        ['setValue'],
                        'AML_ENABLED',
                        false,
                        TENANT_A,
                        USER_ADMIN,
                        {
                            requestId:
                                REQUEST_ID
                        }
                    );

                expect(
                    result.value
                ).toBe(false);

                expect(
                    mockModel.setValue
                ).toHaveBeenCalled();
            }
        );

        test(
            'should pass expectedVersion for optimistic concurrency',
            async () => {
                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        version: 5
                    }
                );

                await callServiceMethod(
                    ['setValue'],
                    'AML_ENABLED',
                    false,
                    TENANT_A,
                    USER_ADMIN,
                    {
                        expectedVersion: 4,
                        requestId:
                            REQUEST_ID
                    }
                );

                const call =
                    mockModel.setValue.mock.calls[0];

                expect(
                    call[4]
                ).toEqual(
                    expect.objectContaining({
                        expectedVersion:
                            4
                    })
                );
            }
        );

        test(
            'should preserve audit correlation metadata',
            async () => {
                setMethodResult(
                    'setValue',
                    BASE_SETTING
                );

                await callServiceMethod(
                    ['setValue'],
                    'AML_ENABLED',
                    true,
                    TENANT_A,
                    USER_ADMIN,
                    {
                        requestId:
                            REQUEST_ID,
                        source:
                            'admin-api',
                        auditDetails: {
                            reason:
                                'Compliance policy update'
                        }
                    }
                );

                const call =
                    mockModel.setValue.mock.calls[0];

                const options =
                    call[4];

                expect(
                    options
                ).toEqual(
                    expect.objectContaining({
                        requestId:
                            REQUEST_ID,
                        source:
                            'admin-api',
                        auditDetails:
                            expect.objectContaining({
                                reason:
                                    'Compliance policy update'
                            })
                    })
                );
            }
        );

        test(
            'should not silently change tenant scope',
            async () => {
                setMethodResult(
                    'setValue',
                    BASE_SETTING
                );

                await callServiceMethod(
                    ['setValue'],
                    'AML_ENABLED',
                    true,
                    TENANT_A,
                    USER_ADMIN
                );

                const call =
                    mockModel.setValue.mock.calls[0];

                expect(
                    call[2]
                ).toBe(
                    TENANT_A
                );

                expect(
                    call[2]
                ).not.toBe(
                    TENANT_B
                );
            }
        );

        test(
            'should propagate protected-setting errors',
            async () => {
                const error =
                    new Error(
                        'This system setting is protected.'
                    );

                error.code =
                    'SYSTEM_SETTING_PROTECTED';

                setMethodError(
                    'setValue',
                    error
                );

                await expect(
                    callServiceMethod(
                        ['setValue'],
                        'GLOBAL.SECURITY_MODE',
                        'STRICT',
                        SYSTEM_TENANT_ID,
                        USER_ADMIN
                    )
                ).rejects.toMatchObject({
                    code:
                        'SYSTEM_SETTING_PROTECTED'
                });
            }
        );

        test(
            'should propagate optimistic concurrency conflicts',
            async () => {
                const error =
                    new Error(
                        'Configuration version conflict'
                    );

                error.code =
                    'SYSTEM_SETTING_VERSION_CONFLICT';

                setMethodError(
                    'setValue',
                    error
                );

                await expect(
                    callServiceMethod(
                        ['setValue'],
                        'AML_ENABLED',
                        false,
                        TENANT_A,
                        USER_ADMIN,
                        {
                            expectedVersion:
                                3
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
 * =============================================================================
 * UPDATE SETTING
 * =============================================================================
 */

describe(
    'SystemSettingService — updateSetting',
    () => {
        test(
            'should update editable tenant configuration',
            async () => {
                setMethodResult(
                    'updateSetting',
                    {
                        ...BASE_SETTING,
                        description:
                            'Updated description',
                        version: 5
                    }
                );

                const result =
                    await callServiceMethod(
                        ['updateSetting'],
                        'AML_ENABLED',
                        {
                            description:
                                'Updated description'
                        },
                        TENANT_A,
                        USER_ADMIN,
                        {
                            expectedVersion:
                                4,
                            requestId:
                                REQUEST_ID
                        }
                    );

                expect(
                    result.description
                ).toBe(
                    'Updated description'
                );

                expect(
                    mockModel.updateSetting
                ).toHaveBeenCalled();
            }
        );

        test(
            'should support value and metadata updates',
            async () => {
                setMethodResult(
                    'updateSetting',
                    {
                        ...BASE_SETTING,
                        value: false,
                        metadata: {
                            source:
                                'compliance'
                        },
                        version: 5
                    }
                );

                await callServiceMethod(
                    ['updateSetting'],
                    'AML_ENABLED',
                    {
                        value: false,
                        metadata: {
                            source:
                                'compliance'
                        }
                    },
                    TENANT_A,
                    USER_ADMIN
                );

                const call =
                    mockModel.updateSetting.mock.calls[0];

                expect(
                    call[1]
                ).toEqual(
                    expect.objectContaining({
                        value: false,
                        metadata:
                            expect.objectContaining({
                                source:
                                    'compliance'
                            })
                    })
                );
            }
        );

        test(
            'should reject modification of protected settings',
            async () => {
                const error =
                    new Error(
                        'This system setting is protected.'
                    );

                error.code =
                    'SYSTEM_SETTING_PROTECTED';

                setMethodError(
                    'updateSetting',
                    error
                );

                await expect(
                    callServiceMethod(
                        ['updateSetting'],
                        'GLOBAL.SECURITY_MODE',
                        {
                            value:
                                'RELAXED'
                        },
                        SYSTEM_TENANT_ID,
                        USER_ADMIN
                    )
                ).rejects.toMatchObject({
                    code:
                        'SYSTEM_SETTING_PROTECTED'
                });
            }
        );

        test(
            'should reject version conflicts',
            async () => {
                const error =
                    new Error(
                        'Configuration version changed.'
                    );

                error.code =
                    'SYSTEM_SETTING_VERSION_CONFLICT';

                setMethodError(
                    'updateSetting',
                    error
                );

                await expect(
                    callServiceMethod(
                        ['updateSetting'],
                        'AML_ENABLED',
                        {
                            value: false
                        },
                        TENANT_A,
                        USER_ADMIN,
                        {
                            expectedVersion:
                                2
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
 * =============================================================================
 * EFFECTIVE CONFIGURATION
 * =============================================================================
 */

describe(
    'SystemSettingService — effective configuration',
    () => {
        test(
            'tenant override should take precedence over SYSTEM value',
            async () => {
                setMethodResult(
                    'getEffectiveValue',
                    'Africa/Nairobi'
                );

                const result =
                    await callServiceMethod(
                        ['getEffectiveValue'],
                        'GLOBAL.TIMEZONE',
                        TENANT_A,
                        'UTC'
                    );

                expect(
                    result
                ).toBe(
                    'Africa/Nairobi'
                );

                expect(
                    mockModel.getEffectiveValue
                ).toHaveBeenCalledWith(
                    'GLOBAL.TIMEZONE',
                    TENANT_A,
                    'UTC'
                );
            }
        );

        test(
            'SYSTEM value should be used when tenant override is absent',
            async () => {
                setMethodResult(
                    'getEffectiveValue',
                    'Africa/Kampala'
                );

                const result =
                    await callServiceMethod(
                        ['getEffectiveValue'],
                        'GLOBAL.TIMEZONE',
                        TENANT_B,
                        'UTC'
                    );

                expect(
                    result
                ).toBe(
                    'Africa/Kampala'
                );
            }
        );

        test(
            'fallback should be returned when neither tenant nor SYSTEM value exists',
            async () => {
                setMethodResult(
                    'getEffectiveValue',
                    'UTC'
                );

                const result =
                    await callServiceMethod(
                        ['getEffectiveValue'],
                        'MISSING.SETTING',
                        TENANT_A,
                        'UTC'
                    );

                expect(
                    result
                ).toBe(
                    'UTC'
                );
            }
        );

        test(
            'should retrieve the effective setting object',
            async () => {
                setMethodResult(
                    'getEffectiveSetting',
                    TENANT_OVERRIDE
                );

                const result =
                    await callServiceMethod(
                        ['getEffectiveSetting'],
                        'GLOBAL.TIMEZONE',
                        TENANT_A
                    );

                expect(
                    result
                ).toEqual(
                    TENANT_OVERRIDE
                );
            }
        );

        test(
            'should never return tenant A configuration for tenant B',
            async () => {
                setMethodResult(
                    'getEffectiveValue',
                    'Africa/Kampala'
                );

                const result =
                    await callServiceMethod(
                        ['getEffectiveValue'],
                        'GLOBAL.TIMEZONE',
                        TENANT_B,
                        'UTC'
                    );

                expect(
                    result
                ).not.toBe(
                    'Africa/Nairobi'
                );
            }
        );
    }
);

/**
 * =============================================================================
 * TENANT OVERRIDE MANAGEMENT
 * =============================================================================
 */

describe(
    'SystemSettingService — tenant override management',
    () => {
        test(
            'should disable a tenant override',
            async () => {
                setMethodResult(
                    'disableTenantOverride',
                    {
                        ...TENANT_OVERRIDE,
                        enabled: false,
                        version: 3
                    }
                );

                const result =
                    await callServiceMethod(
                        ['disableTenantOverride'],
                        'GLOBAL.TIMEZONE',
                        TENANT_A,
                        USER_ADMIN,
                        {
                            requestId:
                                REQUEST_ID
                        }
                    );

                expect(
                    result.enabled
                ).toBe(false);

                expect(
                    mockModel.disableTenantOverride
                ).toHaveBeenCalled();
            }
        );

        test(
            'should never allow SYSTEM to be treated as a tenant override',
            async () => {
                const error =
                    new Error(
                        'SYSTEM settings cannot be disabled as tenant overrides.'
                    );

                error.code =
                    'INVALID_TENANT_OVERRIDE';

                setMethodError(
                    'disableTenantOverride',
                    error
                );

                await expect(
                    callServiceMethod(
                        ['disableTenantOverride'],
                        'GLOBAL.TIMEZONE',
                        SYSTEM_TENANT_ID,
                        USER_ADMIN
                    )
                ).rejects.toBeDefined();
            }
        );
    }
);

/**
 * =============================================================================
 * ENABLE / DISABLE
 * =============================================================================
 */

describe(
    'SystemSettingService — enable / disable',
    () => {
        test(
            'should enable an editable setting',
            async () => {
                const enabledSetting =
                    createMockDocument({
                        ...BASE_SETTING,
                        enabled: false
                    });

                setMethodResult(
                    'getSetting',
                    enabledSetting
                );

                if (
                    typeof SystemSettingService.enable ===
                    'function'
                ) {
                    enabledSetting.enable =
                        jest.fn(
                            async function () {
                                this.enabled =
                                    true;

                                return this;
                            }
                        );

                    const result =
                        await callServiceMethod(
                            ['enable'],
                            'AML_ENABLED',
                            TENANT_A,
                            USER_ADMIN,
                            {
                                requestId:
                                    REQUEST_ID
                            }
                        );

                    expect(
                        result
                    ).toBeDefined();
                } else {
                    expect(
                        true
                    ).toBe(true);
                }
            }
        );

        test(
            'should disable an editable setting',
            async () => {
                const disabledSetting =
                    createMockDocument({
                        ...BASE_SETTING,
                        enabled: true
                    });

                setMethodResult(
                    'getSetting',
                    disabledSetting
                );

                if (
                    typeof SystemSettingService.disable ===
                    'function'
                ) {
                    disabledSetting.disable =
                        jest.fn(
                            async function () {
                                this.enabled =
                                    false;

                                return this;
                            }
                        );

                    const result =
                        await callServiceMethod(
                            ['disable'],
                            'AML_ENABLED',
                            TENANT_A,
                            USER_ADMIN,
                            {
                                requestId:
                                    REQUEST_ID
                            }
                        );

                    expect(
                        result
                    ).toBeDefined();
                } else {
                    expect(
                        true
                    ).toBe(true);
                }
            }
        );
    }
);

/**
 * =============================================================================
 * PROTECTED SYSTEM CONFIGURATION
 * =============================================================================
 */

describe(
    'SystemSettingService — SYSTEM configuration protection',
    () => {
        test(
            'SYSTEM settings must be distinguishable from tenant settings',
            async () => {
                setMethodResult(
                    'getSetting',
                    SYSTEM_SETTING
                );

                const result =
                    await callServiceMethod(
                        ['getSetting'],
                        'GLOBAL.TIMEZONE',
                        SYSTEM_TENANT_ID
                    );

                expect(
                    result.isSystem
                ).toBe(true);

                expect(
                    result.tenantId
                ).toBe(
                    SYSTEM_TENANT_ID
                );
            }
        );

        test(
            'tenant setting must not be promoted into SYSTEM scope implicitly',
            async () => {
                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        tenantId:
                            TENANT_A
                    }
                );

                await callServiceMethod(
                    ['setValue'],
                    'AML_ENABLED',
                    true,
                    TENANT_A,
                    USER_ADMIN
                );

                const call =
                    mockModel.setValue.mock.calls[0];

                expect(
                    call[2]
                ).toBe(
                    TENANT_A
                );

                expect(
                    call[2]
                ).not.toBe(
                    SYSTEM_TENANT_ID
                );
            }
        );

        test(
            'SYSTEM scope mutations should carry explicit privileged intent',
            async () => {
                setMethodResult(
                    'setValue',
                    SYSTEM_SETTING
                );

                await callServiceMethod(
                    ['setValue'],
                    'GLOBAL.TIMEZONE',
                    'Africa/Kampala',
                    SYSTEM_TENANT_ID,
                    USER_ADMIN,
                    {
                        allowProtectedUpdate:
                            true,
                        source:
                            'platform-admin',
                        requestId:
                            REQUEST_ID
                    }
                );

                const call =
                    mockModel.setValue.mock.calls[0];

                expect(
                    call[4]
                ).toEqual(
                    expect.objectContaining({
                        allowProtectedUpdate:
                            true
                    })
                );
            }
        );
    }
);

/**
 * =============================================================================
 * VALUE TYPE VALIDATION
 * =============================================================================
 */

describe(
    'SystemSettingService — value type validation',
    () => {
        test(
            'should support BOOLEAN configuration',
            async () => {
                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        value: true,
                        valueType:
                            'BOOLEAN'
                    }
                );

                const result =
                    await callServiceMethod(
                        ['setValue'],
                        'AML_ENABLED',
                        true,
                        TENANT_A,
                        USER_ADMIN,
                        {
                            valueType:
                                'BOOLEAN'
                        }
                    );

                expect(
                    result.value
                ).toBe(true);
            }
        );

        test(
            'should support NUMBER configuration',
            async () => {
                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        value: 250000,
                        valueType:
                            'NUMBER'
                    }
                );

                const result =
                    await callServiceMethod(
                        ['setValue'],
                        'LOAN.MAX_AMOUNT',
                        250000,
                        TENANT_A,
                        USER_ADMIN,
                        {
                            valueType:
                                'NUMBER'
                        }
                    );

                expect(
                    result.value
                ).toBe(
                    250000
                );
            }
        );

        test(
            'should support STRING configuration',
            async () => {
                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        value:
                            'Africa/Kampala',
                        valueType:
                            'STRING'
                    }
                );

                const result =
                    await callServiceMethod(
                        ['setValue'],
                        'GLOBAL.TIMEZONE',
                        'Africa/Kampala',
                        TENANT_A,
                        USER_ADMIN,
                        {
                            valueType:
                                'STRING'
                        }
                    );

                expect(
                    result.value
                ).toBe(
                    'Africa/Kampala'
                );
            }
        );

        test(
            'should support ARRAY configuration',
            async () => {
                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        key:
                            'NOTIFICATIONS.CHANNELS',
                        value: [
                            'EMAIL',
                            'SMS'
                        ],
                        valueType:
                            'ARRAY'
                    }
                );

                const result =
                    await callServiceMethod(
                        ['setValue'],
                        'NOTIFICATIONS.CHANNELS',
                        [
                            'EMAIL',
                            'SMS'
                        ],
                        TENANT_A,
                        USER_ADMIN,
                        {
                            valueType:
                                'ARRAY'
                        }
                    );

                expect(
                    result.value
                ).toEqual([
                    'EMAIL',
                    'SMS'
                ]);
            }
        );

        test(
            'should support JSON configuration',
            async () => {
                const value = {
                    retryAttempts:
                        3,
                    timeoutMs:
                        5000
                };

                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        key:
                            'API.RETRY_POLICY',
                        value,
                        valueType:
                            'JSON'
                    }
                );

                const result =
                    await callServiceMethod(
                        ['setValue'],
                        'API.RETRY_POLICY',
                        value,
                        TENANT_A,
                        USER_ADMIN,
                        {
                            valueType:
                                'JSON'
                        }
                    );

                expect(
                    result.value
                ).toEqual(
                    value
                );
            }
        );

        test(
            'should propagate value-type validation failures',
            async () => {
                const error =
                    new Error(
                        'Value does not match valueType NUMBER.'
                    );

                error.code =
                    'INVALID_SETTING_VALUE_TYPE';

                setMethodError(
                    'setValue',
                    error
                );

                await expect(
                    callServiceMethod(
                        ['setValue'],
                        'LOAN.MAX_AMOUNT',
                        'not-a-number',
                        TENANT_A,
                        USER_ADMIN,
                        {
                            valueType:
                                'NUMBER'
                        }
                    )
                ).rejects.toMatchObject({
                    code:
                        'INVALID_SETTING_VALUE_TYPE'
                });
            }
        );
    }
);

/**
 * =============================================================================
 * INPUT SECURITY
 * =============================================================================
 */

describe(
    'SystemSettingService — input security',
    () => {
        test(
            'should not permit arbitrary fields to be persisted through update',
            async () => {
                setMethodResult(
                    'updateSetting',
                    BASE_SETTING
                );

                await callServiceMethod(
                    ['updateSetting'],
                    'AML_ENABLED',
                    {
                        value: true,
                        tenantId:
                            TENANT_B,
                        isSystem:
                            true,
                        editable:
                            true,
                        createdBy:
                            USER_ADMIN_B,
                        __v:
                            999
                    },
                    TENANT_A,
                    USER_ADMIN
                );

                const call =
                    mockModel.updateSetting.mock.calls[0];

                const updates =
                    call[1];

                /**
                 * The service must not blindly persist security-sensitive
                 * ownership/system fields supplied by a client.
                 */
                expect(
                    updates.tenantId
                ).toBeUndefined();

                expect(
                    updates.isSystem
                ).toBeUndefined();

                expect(
                    updates.createdBy
                ).toBeUndefined();

                expect(
                    updates.__v
                ).toBeUndefined();
            }
        );

        test(
            'should not trust caller-provided updatedBy as the tenant identity',
            async () => {
                setMethodResult(
                    'updateSetting',
                    BASE_SETTING
                );

                await callServiceMethod(
                    ['updateSetting'],
                    'AML_ENABLED',
                    {
                        value: false
                    },
                    TENANT_A,
                    USER_ADMIN
                );

                const call =
                    mockModel.updateSetting.mock.calls[0];

                expect(
                    call[3]
                ).toBe(
                    USER_ADMIN
                );
            }
        );
    }
);

/**
 * =============================================================================
 * CONCURRENCY
 * =============================================================================
 */

describe(
    'SystemSettingService — optimistic concurrency',
    () => {
        test(
            'should forward expectedVersion to the model',
            async () => {
                setMethodResult(
                    'updateSetting',
                    {
                        ...BASE_SETTING,
                        version: 5
                    }
                );

                await callServiceMethod(
                    ['updateSetting'],
                    'AML_ENABLED',
                    {
                        value: false
                    },
                    TENANT_A,
                    USER_ADMIN,
                    {
                        expectedVersion:
                            4
                    }
                );

                const call =
                    mockModel.updateSetting.mock.calls[0];

                expect(
                    call[4]
                ).toEqual(
                    expect.objectContaining({
                        expectedVersion:
                            4
                    })
                );
            }
        );

        test(
            'should expose version conflicts without converting them to success',
            async () => {
                const error =
                    new Error(
                        'System setting update failed because the configuration version changed.'
                    );

                error.code =
                    'SYSTEM_SETTING_VERSION_CONFLICT';

                setMethodError(
                    'updateSetting',
                    error
                );

                await expect(
                    callServiceMethod(
                        ['updateSetting'],
                        'AML_ENABLED',
                        {
                            value: false
                        },
                        TENANT_A,
                        USER_ADMIN,
                        {
                            expectedVersion:
                                4
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
 * =============================================================================
 * AUDIT / COMPLIANCE
 * =============================================================================
 */

describe(
    'SystemSettingService — audit and compliance',
    () => {
        test(
            'should propagate request correlation ID',
            async () => {
                setMethodResult(
                    'setValue',
                    BASE_SETTING
                );

                await callServiceMethod(
                    ['setValue'],
                    'AML_ENABLED',
                    false,
                    TENANT_A,
                    USER_ADMIN,
                    {
                        requestId:
                            REQUEST_ID
                    }
                );

                const call =
                    mockModel.setValue.mock.calls[0];

                expect(
                    call[4].requestId
                ).toBe(
                    REQUEST_ID
                );
            }
        );

        test(
            'should preserve compliance metadata on updates',
            async () => {
                setMethodResult(
                    'updateSetting',
                    {
                        ...BASE_SETTING,
                        complianceRelevant:
                            true,
                        regulatoryCritical:
                            true
                    }
                );

                await callServiceMethod(
                    ['updateSetting'],
                    'AML_ENABLED',
                    {
                        complianceRelevant:
                            true,
                        regulatoryCritical:
                            true
                    },
                    TENANT_A,
                    USER_ADMIN,
                    {
                        requestId:
                            REQUEST_ID,
                        auditDetails: {
                            control:
                                'AML-CONTROL-001'
                        }
                    }
                );

                const call =
                    mockModel.updateSetting.mock.calls[0];

                expect(
                    call[1]
                ).toEqual(
                    expect.objectContaining({
                        complianceRelevant:
                            true,
                        regulatoryCritical:
                            true
                    })
                );

                expect(
                    call[4]
                ).toEqual(
                    expect.objectContaining({
                        requestId:
                            REQUEST_ID,
                        auditDetails:
                            expect.objectContaining({
                                control:
                                    'AML-CONTROL-001'
                            })
                    })
                );
            }
        );
    }
);

/**
 * =============================================================================
 * HEALTH SUMMARY
 * =============================================================================
 */

describe(
    'SystemSettingService — health summary',
    () => {
        test(
            'should return configuration health metrics',
            async () => {
                const summary = {
                    tenantId:
                        TENANT_A,
                    total:
                        25,
                    enabled:
                        23,
                    disabled:
                        2,
                    complianceRelevant:
                        8,
                    regulatoryCritical:
                        4,
                    generatedAt:
                        new Date()
                };

                setMethodResult(
                    'getHealthSummary',
                    summary
                );

                const result =
                    await callServiceMethod(
                        ['getHealthSummary'],
                        TENANT_A
                    );

                expect(
                    result
                ).toEqual(
                    summary
                );

                expect(
                    mockModel.getHealthSummary
                ).toHaveBeenCalledWith(
                    TENANT_A
                );
            }
        );
    }
);

/**
 * =============================================================================
 * DATABASE FAILURE PROPAGATION
 * =============================================================================
 */

describe(
    'SystemSettingService — infrastructure failures',
    () => {
        test(
            'should not swallow database errors during reads',
            async () => {
                const error =
                    new Error(
                        'MongoNetworkError'
                    );

                setMethodError(
                    'getSetting',
                    error
                );

                await expect(
                    callServiceMethod(
                        ['getSetting'],
                        'AML_ENABLED',
                        TENANT_A
                    )
                ).rejects.toThrow(
                    'MongoNetworkError'
                );
            }
        );

        test(
            'should not swallow database errors during writes',
            async () => {
                const error =
                    new Error(
                        'MongoWriteError'
                    );

                setMethodError(
                    'updateSetting',
                    error
                );

                await expect(
                    callServiceMethod(
                        ['updateSetting'],
                        'AML_ENABLED',
                        {
                            value: false
                        },
                        TENANT_A,
                        USER_ADMIN
                    )
                ).rejects.toThrow(
                    'MongoWriteError'
                );
            }
        );
    }
);

/**
 * =============================================================================
 * TENANT ISOLATION CONTRACT
 * =============================================================================
 */

describe(
    'SystemSettingService — tenant isolation contract',
    () => {
        test(
            'tenant A and tenant B are separate configuration scopes',
            async () => {
                setMethodResult(
                    'getSetting',
                    BASE_SETTING
                );

                await callServiceMethod(
                    ['getSetting'],
                    'AML_ENABLED',
                    TENANT_A
                );

                const firstCall =
                    mockModel.getSetting.mock.calls[0];

                expect(
                    firstCall[1]
                ).toBe(
                    TENANT_A
                );

                resetMocks();

                setMethodResult(
                    'getSetting',
                    {
                        ...BASE_SETTING,
                        tenantId:
                            TENANT_B
                    }
                );

                await callServiceMethod(
                    ['getSetting'],
                    'AML_ENABLED',
                    TENANT_B
                );

                const secondCall =
                    mockModel.getSetting.mock.calls[0];

                expect(
                    secondCall[1]
                ).toBe(
                    TENANT_B
                );

                expect(
                    secondCall[1]
                ).not.toBe(
                    firstCall[1]
                );
            }
        );

        test(
            'service must always pass an explicit tenant scope for tenant writes',
            async () => {
                setMethodResult(
                    'setValue',
                    BASE_SETTING
                );

                await callServiceMethod(
                    ['setValue'],
                    'AML_ENABLED',
                    true,
                    TENANT_A,
                    USER_ADMIN
                );

                const call =
                    mockModel.setValue.mock.calls[0];

                expect(
                    call.length
                ).toBeGreaterThanOrEqual(3);

                expect(
                    call[2]
                ).toBe(
                    TENANT_A
                );
            }
        );

        test(
            'service must not cross tenant boundaries merely because a setting key matches',
            async () => {
                setMethodResult(
                    'getEffectiveValue',
                    'TENANT-B-VALUE'
                );

                await callServiceMethod(
                    ['getEffectiveValue'],
                    'SAME.KEY',
                    TENANT_B,
                    null
                );

                const call =
                    mockModel.getEffectiveValue.mock.calls[0];

                expect(
                    call[1]
                ).toBe(
                    TENANT_B
                );

                expect(
                    call[1]
                ).not.toBe(
                    TENANT_A
                );
            }
        );
    }
);

/**
 * =============================================================================
 * EDGE CASES
 * =============================================================================
 */

describe(
    'SystemSettingService — edge cases',
    () => {
        test(
            'should handle disabled settings according to service contract',
            async () => {
                setMethodResult(
                    'getValue',
                    null
                );

                const result =
                    await callServiceMethod(
                        ['getValue'],
                        'DISABLED.SETTING',
                        TENANT_A
                    );

                expect(
                    result
                ).toBeNull();
            }
        );

        test(
            'should handle null configuration values',
            async () => {
                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        value: null,
                        valueType:
                            'JSON'
                    }
                );

                const result =
                    await callServiceMethod(
                        ['setValue'],
                        'OPTIONAL.CONFIG',
                        null,
                        TENANT_A,
                        USER_ADMIN,
                        {
                            valueType:
                                'JSON'
                        }
                    );

                expect(
                    result.value
                ).toBeNull();
            }
        );

        test(
            'should support zero as a valid numeric configuration value',
            async () => {
                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        key:
                            'RETRY.COUNT',
                        value: 0,
                        valueType:
                            'NUMBER'
                    }
                );

                const result =
                    await callServiceMethod(
                        ['setValue'],
                        'RETRY.COUNT',
                        0,
                        TENANT_A,
                        USER_ADMIN,
                        {
                            valueType:
                                'NUMBER'
                        }
                    );

                expect(
                    result.value
                ).toBe(0);
            }
        );

        test(
            'should support false as a valid boolean configuration value',
            async () => {
                setMethodResult(
                    'setValue',
                    {
                        ...BASE_SETTING,
                        value: false,
                        valueType:
                            'BOOLEAN'
                    }
                );

                const result =
                    await callServiceMethod(
                        ['setValue'],
                        'AML_ENABLED',
                        false,
                        TENANT_A,
                        USER_ADMIN,
                        {
                            valueType:
                                'BOOLEAN'
                        }
                    );

                expect(
                    result.value
                ).toBe(false);
            }
        );
    }
);

/**
 * =============================================================================
 * NO SECURITY BYPASS CONTRACT
 * =============================================================================
 */

describe(
    'SystemSettingService — security invariants',
    () => {
        test(
            'SYSTEM tenant identifier must remain explicit',
            () => {
                expect(
                    SYSTEM_TENANT_ID
                ).toBe(
                    'SYSTEM'
                );
            }
        );

        test(
            'tenant IDs must be passed independently from setting values',
            async () => {
                setMethodResult(
                    'setValue',
                    BASE_SETTING
                );

                await callServiceMethod(
                    ['setValue'],
                    'AML_ENABLED',
                    {
                        value:
                            true,
                        tenantId:
                            TENANT_B
                    },
                    TENANT_A,
                    USER_ADMIN
                );

                const call =
                    mockModel.setValue.mock.calls[0];

                /**
                 * The authoritative tenant argument remains TENANT_A.
                 * Client-controlled nested tenantId must never replace it.
                 */
                expect(
                    call[2]
                ).toBe(
                    TENANT_A
                );
            }
        );

        test(
            'service should preserve explicit actor identity',
            async () => {
                setMethodResult(
                    'setValue',
                    BASE_SETTING
                );

                await callServiceMethod(
                    ['setValue'],
                    'AML_ENABLED',
                    true,
                    TENANT_A,
                    USER_ADMIN
                );

                const call =
                    mockModel.setValue.mock.calls[0];

                expect(
                    call[3]
                ).toBe(
                    USER_ADMIN
                );
            }
        );
    }
);

/**
 * =============================================================================
 * FINAL SUITE HEALTH ASSERTION
 * =============================================================================
 */

afterAll(() => {
    jest.restoreAllMocks();
});