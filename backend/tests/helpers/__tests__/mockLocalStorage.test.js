
'use strict';

/**
 * TITech Community Capital — Mock Local Storage Contract Tests
 *
 * File:
 * backend/tests/helpers/__tests__/mockLocalStorage.test.js
 *
 * Scope:
 * - Storage mock installation and cleanup.
 * - Authentication session helpers.
 * - Tenant and permission helpers.
 * - Theme helpers.
 * - Loan, member and savings drafts.
 * - Onboarding progress.
 * - Storage inspection and export utilities.
 * - Mock entity factories.
 *
 * These tests validate the test helper only. They do not establish
 * production authentication, authorization or token-storage security.
 */

const {
  STORAGE_KEYS,

  installStorageMocks,
  uninstallStorageMocks,
  resetStorage,

  // Authentication
  setAuthSession,
  getAuthSession,
  clearAuthSession,
  isAuthenticated,
  hasAuthSession,

  // Tenant
  setTenant,
  getTenant,
  clearTenant,
  hasTenant,

  // Permissions
  setPermissions,
  getPermissions,
  hasPermission,

  // Theme
  setTheme,
  getTheme,
  toggleTheme,

  // Loan draft
  saveLoanDraft,
  getLoanDraft,
  hasLoanDraft,
  updateLoanDraft,
  clearLoanDraft,

  // Member draft
  saveMemberDraft,
  getMemberDraft,

  // Savings draft
  saveSavingsDraft,
  getSavingsDraft,

  // Onboarding
  setOnboardingProgress,
  getOnboardingProgress,
  getOnboardingCompletionPercentage,

  // Generic storage
  storageHasKey,
  getStorageKeys,
  getStorageSize,
  exportStorage,

  // Factories
  createMockUser,
  createMockAdmin,
  createMockTenant,
} = require('../mockLocalStorage');

const createAuthSession = () => ({
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  user: {
    id: 'test-user-001',
    role: 'MEMBER',
  },
});

beforeAll(() => {
  installStorageMocks();
});

beforeEach(() => {
  resetStorage();
});

afterAll(() => {
  try {
    resetStorage();
  } finally {
    uninstallStorageMocks();
  }
});

describe('mockLocalStorage — installation and storage lifecycle', () => {
  test('installs localStorage and sessionStorage mocks', () => {
    expect(global.localStorage).toBeDefined();
    expect(global.sessionStorage).toBeDefined();

    expect(typeof localStorage.getItem).toBe('function');
    expect(typeof localStorage.setItem).toBe('function');
    expect(typeof localStorage.removeItem).toBe('function');
    expect(typeof localStorage.clear).toBe('function');
    expect(typeof localStorage.key).toBe('function');

    expect(typeof sessionStorage.getItem).toBe('function');
    expect(typeof sessionStorage.setItem).toBe('function');
    expect(typeof sessionStorage.removeItem).toBe('function');
    expect(typeof sessionStorage.clear).toBe('function');
  });

  test('returns null for missing keys', () => {
    expect(localStorage.getItem('missing-key')).toBeNull();
    expect(sessionStorage.getItem('missing-key')).toBeNull();
  });

  test('stores and retrieves string values', () => {
    localStorage.setItem('sample-key', 'sample-value');

    expect(localStorage.getItem('sample-key')).toBe('sample-value');
  });

  test('converts stored values to strings like Web Storage', () => {
    localStorage.setItem('number-key', 123);
    localStorage.setItem('boolean-key', false);

    expect(localStorage.getItem('number-key')).toBe('123');
    expect(localStorage.getItem('boolean-key')).toBe('false');
  });

  test('supports key enumeration and storage length', () => {
    localStorage.setItem('first-key', 'one');
    localStorage.setItem('second-key', 'two');

    expect(localStorage.length).toBe(2);
    expect([
      localStorage.key(0),
      localStorage.key(1),
    ]).toEqual(expect.arrayContaining([
      'first-key',
      'second-key',
    ]));

    expect(localStorage.key(2)).toBeNull();
  });

  test('removes individual keys without clearing unrelated keys', () => {
    localStorage.setItem('remove-me', 'one');
    localStorage.setItem('keep-me', 'two');

    localStorage.removeItem('remove-me');

    expect(localStorage.getItem('remove-me')).toBeNull();
    expect(localStorage.getItem('keep-me')).toBe('two');
  });

  test('resetStorage clears both stores between tests', () => {
    localStorage.setItem('local-key', 'value');
    sessionStorage.setItem('session-key', 'value');

    resetStorage();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  test('storage mocks remain usable after reset', () => {
    resetStorage();

    localStorage.setItem('after-reset', 'available');
    sessionStorage.setItem('after-reset', 'available');

    expect(localStorage.getItem('after-reset')).toBe('available');
    expect(sessionStorage.getItem('after-reset')).toBe('available');
  });
});

describe('mockLocalStorage — authentication helpers', () => {
  test('stores an authentication session', () => {
    const session = createAuthSession();

    setAuthSession(session);

    expect(
      localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN),
    ).toBe(session.accessToken);

    expect(
      localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN),
    ).toBe(session.refreshToken);
  });

  test('retrieves the stored authentication session', () => {
    const session = createAuthSession();

    setAuthSession(session);

    const storedSession = getAuthSession();

    expect(storedSession.accessToken).toBe(session.accessToken);
    expect(storedSession.refreshToken).toBe(session.refreshToken);
    expect(storedSession.user).toEqual(session.user);
  });

  test('reports unauthenticated when no access token exists', () => {
    expect(isAuthenticated()).toBe(false);
    expect(hasAuthSession()).toBe(false);
  });

  test('reports authenticated after storing a valid test session', () => {
    setAuthSession(createAuthSession());

    expect(isAuthenticated()).toBe(true);
    expect(hasAuthSession()).toBe(true);
  });

  test('clears the authentication session', () => {
    setAuthSession(createAuthSession());

    clearAuthSession();

    expect(
      localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN),
    ).toBeNull();

    expect(
      localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN),
    ).toBeNull();

    expect(
      localStorage.getItem(STORAGE_KEYS.USER),
    ).toBeNull();

    expect(isAuthenticated()).toBe(false);
    expect(hasAuthSession()).toBe(false);
  });

  test('clearing a missing session is safe', () => {
    expect(() => clearAuthSession()).not.toThrow();

    expect(isAuthenticated()).toBe(false);
    expect(hasAuthSession()).toBe(false);
  });
});

describe('mockLocalStorage — tenant helpers', () => {
  test('stores and retrieves a tenant', () => {
    const tenant = {
      id: 'tenant-001',
      code: 'TITECH001',
    };

    setTenant(tenant);

    expect(getTenant()).toEqual(tenant);
    expect(getTenant().id).toBe('tenant-001');
  });

  test('reports whether a tenant exists', () => {
    expect(hasTenant()).toBe(false);

    setTenant({
      id: 'tenant-001',
      code: 'TITECH001',
    });

    expect(hasTenant()).toBe(true);
  });

  test('clears a tenant', () => {
    setTenant({
      id: 'tenant-001',
      code: 'TITECH001',
    });

    clearTenant();

    expect(getTenant()).toBeNull();
    expect(hasTenant()).toBe(false);
  });

  test('stores a new tenant without retaining a previous tenant', () => {
    setTenant({ id: 'tenant-old' });
    setTenant({ id: 'tenant-new' });

    expect(getTenant()).toEqual({ id: 'tenant-new' });
  });
});

describe('mockLocalStorage — permission helpers', () => {
  test('returns no permissions when storage is empty', () => {
    expect(getPermissions()).toEqual([]);
    expect(hasPermission('LOAN_VIEW')).toBe(false);
  });

  test('stores and retrieves permissions', () => {
    const permissions = [
      'LOAN_VIEW',
      'LOAN_CREATE',
      'MEMBER_VIEW',
    ];

    setPermissions(permissions);

    expect(getPermissions()).toEqual(permissions);
  });

  test('recognizes granted permissions', () => {
    setPermissions([
      'LOAN_VIEW',
      'LOAN_CREATE',
    ]);

    expect(hasPermission('LOAN_VIEW')).toBe(true);
    expect(hasPermission('LOAN_CREATE')).toBe(true);
  });

  test('does not grant permissions that were not stored', () => {
    setPermissions(['LOAN_VIEW']);

    expect(hasPermission('TENANT_DELETE')).toBe(false);
  });

  test('does not carry permissions into the next test', () => {
    expect(getPermissions()).toEqual([]);
    expect(hasPermission('LOAN_VIEW')).toBe(false);
  });
});

describe('mockLocalStorage — theme helpers', () => {
  test('defaults to the light theme', () => {
    expect(getTheme()).toBe('light');
  });

  test('stores and retrieves the dark theme', () => {
    setTheme('dark');

    expect(getTheme()).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEYS.THEME)).toBe('dark');
  });

  test('stores and retrieves the light theme', () => {
    setTheme('light');

    expect(getTheme()).toBe('light');
  });

  test('toggles from light to dark', () => {
    setTheme('light');

    const nextTheme = toggleTheme();

    expect(nextTheme).toBe('dark');
    expect(getTheme()).toBe('dark');
  });

  test('toggles from dark to light', () => {
    setTheme('dark');

    const nextTheme = toggleTheme();

    expect(nextTheme).toBe('light');
    expect(getTheme()).toBe('light');
  });

  test('theme changes remain isolated between tests', () => {
    expect(getTheme()).toBe('light');
  });
});

describe('mockLocalStorage — loan draft helpers', () => {
  test('saves and retrieves a loan draft', () => {
    const draft = {
      amount: 500000,
      repaymentPeriod: 12,
      purpose: 'business expansion',
    };

    saveLoanDraft(draft);

    expect(getLoanDraft()).toMatchObject(draft);
    expect(hasLoanDraft()).toBe(true);
  });

  test('reports when no loan draft exists', () => {
    expect(getLoanDraft()).toBeNull();
    expect(hasLoanDraft()).toBe(false);
  });

  test('updates a loan draft without discarding untouched fields', () => {
    saveLoanDraft({
      amount: 100000,
      repaymentPeriod: 6,
      purpose: 'equipment',
    });

    updateLoanDraft({
      amount: 200000,
    });

    expect(getLoanDraft()).toMatchObject({
      amount: 200000,
      repaymentPeriod: 6,
      purpose: 'equipment',
    });
  });

  test('clears a loan draft', () => {
    saveLoanDraft({
      amount: 500000,
      repaymentPeriod: 12,
    });

    clearLoanDraft();

    expect(getLoanDraft()).toBeNull();
    expect(hasLoanDraft()).toBe(false);
  });

  test('does not leak a loan draft between tests', () => {
    expect(getLoanDraft()).toBeNull();
    expect(hasLoanDraft()).toBe(false);
  });
});

describe('mockLocalStorage — member draft helpers', () => {
  test('saves and retrieves a member draft', () => {
    const draft = {
      firstName: 'Test',
      lastName: 'Member',
      email: 'member@example.test',
    };

    saveMemberDraft(draft);

    expect(getMemberDraft()).toMatchObject(draft);
  });

  test('reports no saved member draft after storage reset', () => {
    expect(getMemberDraft()).toBeNull();
  });
});

describe('mockLocalStorage — savings draft helpers', () => {
  test('saves and retrieves a savings draft', () => {
    const draft = {
      amount: 100000,
      frequency: 'MONTHLY',
      accountType: 'SAVINGS',
    };

    saveSavingsDraft(draft);

    expect(getSavingsDraft()).toMatchObject(draft);
  });

  test('reports no saved savings draft after storage reset', () => {
    expect(getSavingsDraft()).toBeNull();
  });
});

describe('mockLocalStorage — onboarding helpers', () => {
  test('saves and retrieves onboarding progress', () => {
    const progress = {
      currentStep: 2,
      totalSteps: 5,
      completedSteps: [1, 2],
    };

    setOnboardingProgress(progress);

    expect(getOnboardingProgress()).toMatchObject(progress);
  });

  test('calculates onboarding completion percentage', () => {
    setOnboardingProgress({
      currentStep: 2,
      totalSteps: 5,
      completedSteps: [1, 2],
    });

    expect(getOnboardingCompletionPercentage()).toBe(40);
  });

  test('reports zero completion when progress is absent', () => {
    expect(getOnboardingProgress()).toBeNull();
    expect(getOnboardingCompletionPercentage()).toBe(0);
  });

  test('reports full completion when every step is completed', () => {
    setOnboardingProgress({
      currentStep: 5,
      totalSteps: 5,
      completedSteps: [1, 2, 3, 4, 5],
    });

    expect(getOnboardingCompletionPercentage()).toBe(100);
  });
});

describe('mockLocalStorage — generic storage utilities', () => {
  test('detects a stored application key', () => {
    setTheme('dark');

    expect(storageHasKey(STORAGE_KEYS.THEME)).toBe(true);
    expect(storageHasKey('missing-key')).toBe(false);
  });

  test('lists stored keys', () => {
    setTheme('dark');
    setTenant({ id: 'tenant-001' });

    const keys = getStorageKeys();

    expect(keys).toContain(STORAGE_KEYS.THEME);
    expect(keys).toContain(STORAGE_KEYS.TENANT);
  });

  test('reports a positive storage size after saving data', () => {
    setTheme('dark');

    expect(getStorageSize()).toBeGreaterThan(0);
  });

  test('exports a storage snapshot', () => {
    setTheme('dark');

    const snapshot = exportStorage();

    expect(snapshot).toBeDefined();
    expect(snapshot[STORAGE_KEYS.THEME]).toBeDefined();
  });

  test('resetStorage empties local and session storage', () => {
    localStorage.setItem('test-local', 'value');
    sessionStorage.setItem('test-session', 'value');

    resetStorage();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('mockLocalStorage — mock factories', () => {
  test('creates a mock member with the default role', () => {
    const user = createMockUser();

    expect(user).toBeDefined();
    expect(user).toEqual(expect.objectContaining({
      role: 'MEMBER',
    }));
  });

  test('supports mock user overrides', () => {
    const user = createMockUser({
      id: 'custom-user',
    });

    expect(user.id).toBe('custom-user');
  });

  test('creates a mock administrator', () => {
    const admin = createMockAdmin();

    expect(admin).toBeDefined();
    expect(typeof admin).toBe('object');
    expect(admin).not.toBeNull();
  });

  test('creates a mock tenant with the canonical test code', () => {
    const tenant = createMockTenant();

    expect(tenant).toBeDefined();
    expect(tenant.code).toBe('TITECH001');
  });

  test('supports mock tenant overrides', () => {
    const tenant = createMockTenant({
      code: 'CUSTOM001',
    });

    expect(tenant.code).toBe('CUSTOM001');
  });
});
