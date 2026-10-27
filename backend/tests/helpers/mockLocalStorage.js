/**
 * TITech Community Capital — Local Storage Test Helper
 *
 * File: backend/tests/helpers/mockLocalStorage.js
 *
 * Native ESM module with a Node.js CommonJS interoperability export.
 * Compatible with Jest/Vitest and browser-like test environments.
 */

const STORAGE_KEYS = Object.freeze({
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
  USER: 'user',
  TENANT: 'tenant',
  PERMISSIONS: 'permissions',
  THEME: 'theme',
  AUTH_STATE: 'authState',
  LOAN_DRAFT: 'loanDraft',
  MEMBER_DRAFT: 'memberDraft',
  SAVINGS_DRAFT: 'savingsDraft',
  ONBOARDING_PROGRESS: 'onboardingProgress',
});

const SUPPORTED_THEMES = Object.freeze(['light', 'dark', 'system']);
const originalStorageDescriptors = new Map();

/* ============================================================================
   SAFE SERIALIZATION
============================================================================ */

/**
 * Convert a value to JSON without allowing serialization errors to escape.
 */
function safeStringify(value, fallback) {
  const defaultFallback = () => {
    try {
      return String(value);
    } catch {
      return '[unserializable value]';
    }
  };

  try {
    const serialized = JSON.stringify(value);

    if (serialized !== undefined) {
      return serialized;
    }

    return fallback === undefined ? defaultFallback() : fallback;
  } catch {
    return fallback === undefined ? defaultFallback() : fallback;
  }
}

/**
 * Safely parse JSON.
 */
function safeParse(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    if (
      typeof process !== 'undefined' &&
      process.env?.NODE_ENV === 'test' &&
      process.env?.DEBUG_STORAGE === 'true'
    ) {
      console.warn('[mockLocalStorage] Failed to parse JSON', {
        value,
        error: error?.message ?? String(error),
      });
    }

    return fallback;
  }
}

/* ============================================================================
   STORAGE FACTORY
============================================================================ */

/**
 * Create a minimal Web Storage-compatible in-memory store.
 */
function createStorageMock() {
  let store = Object.create(null);

  return {
    getItem(key) {
      const normalizedKey = String(key);

      return Object.prototype.hasOwnProperty.call(store, normalizedKey)
        ? store[normalizedKey]
        : null;
    },

    setItem(key, value) {
      store[String(key)] = String(value);
    },

    removeItem(key) {
      delete store[String(key)];
    },

    clear() {
      store = Object.create(null);
    },

    key(index) {
      if (!Number.isInteger(index) || index < 0) {
        return null;
      }

      return Object.keys(store)[index] ?? null;
    },

    get length() {
      return Object.keys(store).length;
    },

    dump() {
      return { ...store };
    },
  };
}

/* ============================================================================
   MOCK INSTANCES
============================================================================ */

const localStorageMock = createStorageMock();
const sessionStorageMock = createStorageMock();

/**
 * Get browser/Jest storage when available, otherwise use the in-memory mock.
 */
function getStorageObject(kind) {
  const property =
    kind === 'session' ? 'sessionStorage' : 'localStorage';

  const fallback =
    kind === 'session' ? sessionStorageMock : localStorageMock;

  try {
    const candidate = globalThis[property];

    if (
      candidate &&
      typeof candidate.getItem === 'function' &&
      typeof candidate.setItem === 'function' &&
      typeof candidate.removeItem === 'function'
    ) {
      return candidate;
    }
  } catch {
    // Browser storage may throw when the origin or browsing context is restricted.
  }

  return fallback;
}

/* ============================================================================
   INSTALL AND RESTORE MOCKS
============================================================================ */

/**
 * Install localStorage and sessionStorage mocks.
 *
 * Existing global property descriptors are saved so they can be restored.
 */
function installStorageMocks() {
  const definitions = {
    localStorage: localStorageMock,
    sessionStorage: sessionStorageMock,
  };

  for (const [property, value] of Object.entries(definitions)) {
    if (!originalStorageDescriptors.has(property)) {
      originalStorageDescriptors.set(
        property,
        Object.getOwnPropertyDescriptor(globalThis, property),
      );
    }

    Object.defineProperty(globalThis, property, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
  }

  return {
    localStorage: localStorageMock,
    sessionStorage: sessionStorageMock,
  };
}

/**
 * Restore original global storage descriptors.
 */
function uninstallStorageMocks() {
  for (const property of ['localStorage', 'sessionStorage']) {
    if (!originalStorageDescriptors.has(property)) {
      continue;
    }

    const descriptor = originalStorageDescriptors.get(property);

    if (descriptor) {
      Object.defineProperty(globalThis, property, descriptor);
    } else {
      delete globalThis[property];
    }

    originalStorageDescriptors.delete(property);
  }
}

/**
 * Reset the in-memory mock stores without clearing real browser storage.
 */
function resetStorage() {
  localStorageMock.clear();
  sessionStorageMock.clear();
}

/* ============================================================================
   SESSION STORAGE HELPERS
============================================================================ */

function setSessionValue(key, value) {
  try {
    getStorageObject('session').setItem(
      String(key),
      safeStringify(value, 'null'),
    );

    return true;
  } catch {
    return false;
  }
}

function getSessionValue(key) {
  try {
    const value = getStorageObject('session').getItem(String(key));

    if (value === null) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch {
    return null;
  }
}

function removeSessionValue(key) {
  try {
    getStorageObject('session').removeItem(String(key));
    return true;
  } catch {
    return false;
  }
}

/* ============================================================================
   GENERIC LOCAL STORAGE HELPERS
============================================================================ */

/**
 * Store a value safely in localStorage.
 */
function setStorageValue(key, value) {
  try {
    getStorageObject('local').setItem(
      String(key),
      safeStringify(value, 'null'),
    );

    return true;
  } catch (error) {
    if (
      typeof process !== 'undefined' &&
      process.env?.NODE_ENV === 'test' &&
      process.env?.DEBUG_STORAGE === 'true'
    ) {
      console.error('[mockLocalStorage] Failed to store value', {
        key: String(key),
        error: error?.message ?? String(error),
      });
    }

    return false;
  }
}

/**
 * Retrieve a value safely from localStorage.
 */
function getStorageValue(key, fallback = null) {
  try {
    return safeParse(
      getStorageObject('local').getItem(String(key)),
      fallback,
    );
  } catch {
    return fallback;
  }
}

/**
 * Remove a value from localStorage.
 */
function removeStorageValue(key) {
  try {
    getStorageObject('local').removeItem(String(key));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a key exists in localStorage.
 */
function storageHasKey(key) {
  try {
    return getStorageObject('local').getItem(String(key)) !== null;
  } catch {
    return false;
  }
}

/**
 * Get all current localStorage keys.
 */
function getStorageKeys() {
  const storage = getStorageObject('local');
  const keys = [];

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (key !== null && key !== undefined) {
        keys.push(key);
      }
    }
  } catch {
    return [];
  }

  return keys;
}

/**
 * Count localStorage items.
 */
function getStorageSize() {
  try {
    return getStorageObject('local').length;
  } catch {
    return 0;
  }
}

/**
 * Clear known TITech application keys only.
 */
function clearApplicationStorage() {
  let succeeded = true;

  for (const key of Object.values(STORAGE_KEYS)) {
    if (!removeStorageValue(key)) {
      succeeded = false;
    }
  }

  return succeeded;
}

/**
 * Export a snapshot of localStorage.
 */
function exportStorage() {
  const storage = getStorageObject('local');
  const snapshot = {};

  for (const key of getStorageKeys()) {
    try {
      snapshot[key] = storage.getItem(key);
    } catch {
      // Omit a key if the storage provider fails during export.
    }
  }

  return snapshot;
}

/* ============================================================================
   AUTHENTICATION HELPERS
============================================================================ */

/**
 * Store an authenticated user session.
 */
function setAuthSession({
  accessToken,
  refreshToken,
  user,
} = {}) {
  const storage = getStorageObject('local');
  let succeeded = true;

  try {
    if (accessToken === undefined || accessToken === null) {
      storage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    } else {
      storage.setItem(STORAGE_KEYS.ACCESS_TOKEN, String(accessToken));
    }

    if (refreshToken === undefined || refreshToken === null) {
      storage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    } else {
      storage.setItem(STORAGE_KEYS.REFRESH_TOKEN, String(refreshToken));
    }
  } catch {
    succeeded = false;
  }

  if (!setStorageValue(STORAGE_KEYS.USER, user)) {
    succeeded = false;
  }

  return succeeded;
}

/**
 * Retrieve the current authentication session.
 */
function getAuthSession() {
  const storage = getStorageObject('local');

  let accessToken = null;
  let refreshToken = null;

  try {
    accessToken = storage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    refreshToken = storage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
  } catch {
    // Return a consistent empty session if storage access fails.
  }

  return {
    accessToken,
    refreshToken,
    user: getStorageValue(STORAGE_KEYS.USER),
  };
}

/**
 * Determine whether an access token is present.
 */
function isAuthenticated() {
  const token = getAuthSession().accessToken;

  return typeof token === 'string' && token.length > 0;
}

/**
 * Clear authentication state.
 */
function clearAuthSession() {
  const storage = getStorageObject('local');
  let succeeded = removeStorageValue(STORAGE_KEYS.USER);

  for (const key of [
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN,
  ]) {
    try {
      storage.removeItem(key);
    } catch {
      succeeded = false;
    }
  }

  return succeeded;
}

/**
 * Check whether both an access token and user record exist.
 */
function hasAuthSession() {
  return (
    storageHasKey(STORAGE_KEYS.ACCESS_TOKEN) &&
    storageHasKey(STORAGE_KEYS.USER)
  );
}

/* ============================================================================
   TENANT HELPERS
============================================================================ */

function setTenant(tenant) {
  return setStorageValue(STORAGE_KEYS.TENANT, tenant);
}

function getTenant() {
  return getStorageValue(STORAGE_KEYS.TENANT);
}

function clearTenant() {
  return removeStorageValue(STORAGE_KEYS.TENANT);
}

function hasTenant() {
  return storageHasKey(STORAGE_KEYS.TENANT);
}

/* ============================================================================
   PERMISSION HELPERS
============================================================================ */

function setPermissions(permissions = []) {
  return setStorageValue(STORAGE_KEYS.PERMISSIONS, permissions);
}

function getPermissions() {
  const permissions = getStorageValue(STORAGE_KEYS.PERMISSIONS, []);

  return Array.isArray(permissions) ? permissions : [];
}

function clearPermissions() {
  return removeStorageValue(STORAGE_KEYS.PERMISSIONS);
}

function hasPermissions() {
  return storageHasKey(STORAGE_KEYS.PERMISSIONS);
}

function hasPermission(permission) {
  return getPermissions().includes(permission);
}

function hasAllPermissions(permissions = []) {
  return (
    Array.isArray(permissions) &&
    permissions.every((permission) =>
      getPermissions().includes(permission),
    )
  );
}

function hasAnyPermission(permissions = []) {
  return (
    Array.isArray(permissions) &&
    permissions.some((permission) =>
      getPermissions().includes(permission),
    )
  );
}

/* ============================================================================
   THEME HELPERS
============================================================================ */

/**
 * Store a supported application theme.
 */
function setTheme(theme = 'light') {
  if (!SUPPORTED_THEMES.includes(theme)) {
    throw new Error(`Unsupported theme: ${theme}`);
  }

  try {
    getStorageObject('local').setItem(STORAGE_KEYS.THEME, theme);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the active theme.
 *
 * The system theme falls back to light for this test helper.
 */
function getTheme() {
  let storedTheme;

  try {
    storedTheme = getStorageObject('local').getItem(STORAGE_KEYS.THEME);
  } catch {
    return 'light';
  }

  return SUPPORTED_THEMES.includes(storedTheme) && storedTheme !== 'system'
    ? storedTheme
    : 'light';
}

function clearTheme() {
  return removeStorageValue(STORAGE_KEYS.THEME);
}

function hasTheme() {
  return storageHasKey(STORAGE_KEYS.THEME);
}

function toggleTheme() {
  const nextTheme = getTheme() === 'dark' ? 'light' : 'dark';

  setTheme(nextTheme);

  return nextTheme;
}

/* ============================================================================
   DRAFT METADATA AND EXPIRY HELPERS
============================================================================ */

function createDraftMetadata(draftType) {
  const metadata = {
    version: 1,
    savedAt: new Date().toISOString(),
  };

  if (draftType) {
    metadata.draftType = draftType;
  }

  return metadata;
}

/**
 * Return true if a draft timestamp has expired.
 */
function timestampIsExpired(timestamp, maxAgeHours) {
  if (!Number.isFinite(maxAgeHours) || maxAgeHours < 0) {
    throw new RangeError(
      'maxAgeHours must be a finite, non-negative number',
    );
  }

  if (
    timestamp === undefined ||
    timestamp === null ||
    timestamp === ''
  ) {
    return true;
  }

  const milliseconds =
    timestamp instanceof Date
      ? timestamp.getTime()
      : typeof timestamp === 'number'
        ? timestamp
        : Date.parse(timestamp);

  if (!Number.isFinite(milliseconds)) {
    return true;
  }

  return Date.now() - milliseconds > maxAgeHours * 60 * 60 * 1000;
}

function getDraftTimestamp(storageKey) {
  const draft = getStorageValue(storageKey);

  return draft?._metadata?.savedAt ?? null;
}

/**
 * Store a draft together with its metadata.
 */
function saveDraft(storageKey, draft, draftType) {
  const safeDraft =
    draft && typeof draft === 'object' && !Array.isArray(draft)
      ? draft
      : {};

  return setStorageValue(storageKey, {
    ...safeDraft,
    _metadata: createDraftMetadata(draftType),
  });
}

/**
 * Update a draft without discarding unrelated existing fields.
 */
function updateDraft(storageKey, updates, draftType) {
  const existing = getStorageValue(storageKey, {});

  const safeExisting =
    existing &&
    typeof existing === 'object' &&
    !Array.isArray(existing)
      ? existing
      : {};

  const safeUpdates =
    updates &&
    typeof updates === 'object' &&
    !Array.isArray(updates)
      ? updates
      : {};

  saveDraft(
    storageKey,
    {
      ...safeExisting,
      ...safeUpdates,
    },
    draftType,
  );

  return getStorageValue(storageKey);
}

/* ============================================================================
   LOAN DRAFT HELPERS
============================================================================ */

function saveLoanDraft(draft) {
  return saveDraft(STORAGE_KEYS.LOAN_DRAFT, draft);
}

function getLoanDraft() {
  return getStorageValue(STORAGE_KEYS.LOAN_DRAFT);
}

function clearLoanDraft() {
  return removeStorageValue(STORAGE_KEYS.LOAN_DRAFT);
}

function hasLoanDraft() {
  return storageHasKey(STORAGE_KEYS.LOAN_DRAFT);
}

function getLoanDraftTimestamp() {
  return getDraftTimestamp(STORAGE_KEYS.LOAN_DRAFT);
}

function isLoanDraftExpired(maxAgeHours = 168) {
  return timestampIsExpired(
    getLoanDraftTimestamp(),
    maxAgeHours,
  );
}

function updateLoanDraft(updates = {}) {
  return updateDraft(STORAGE_KEYS.LOAN_DRAFT, updates);
}

/* ============================================================================
   MEMBER DRAFT HELPERS
============================================================================ */

function saveMemberDraft(draft) {
  return saveDraft(STORAGE_KEYS.MEMBER_DRAFT, draft, 'MEMBER');
}

function getMemberDraft() {
  return getStorageValue(STORAGE_KEYS.MEMBER_DRAFT);
}

function clearMemberDraft() {
  return removeStorageValue(STORAGE_KEYS.MEMBER_DRAFT);
}

function hasMemberDraft() {
  return storageHasKey(STORAGE_KEYS.MEMBER_DRAFT);
}

function updateMemberDraft(updates = {}) {
  return updateDraft(
    STORAGE_KEYS.MEMBER_DRAFT,
    updates,
    'MEMBER',
  );
}

function getMemberDraftTimestamp() {
  return getDraftTimestamp(STORAGE_KEYS.MEMBER_DRAFT);
}

function isMemberDraftExpired(maxAgeHours = 168) {
  return timestampIsExpired(
    getMemberDraftTimestamp(),
    maxAgeHours,
  );
}

/* ============================================================================
   SAVINGS DRAFT HELPERS
============================================================================ */

function saveSavingsDraft(draft) {
  return saveDraft(STORAGE_KEYS.SAVINGS_DRAFT, draft, 'SAVINGS');
}

function getSavingsDraft() {
  return getStorageValue(STORAGE_KEYS.SAVINGS_DRAFT);
}

function clearSavingsDraft() {
  return removeStorageValue(STORAGE_KEYS.SAVINGS_DRAFT);
}

function hasSavingsDraft() {
  return storageHasKey(STORAGE_KEYS.SAVINGS_DRAFT);
}

function updateSavingsDraft(updates = {}) {
  return updateDraft(
    STORAGE_KEYS.SAVINGS_DRAFT,
    updates,
    'SAVINGS',
  );
}

function getSavingsDraftTimestamp() {
  return getDraftTimestamp(STORAGE_KEYS.SAVINGS_DRAFT);
}

function isSavingsDraftExpired(maxAgeHours = 168) {
  return timestampIsExpired(
    getSavingsDraftTimestamp(),
    maxAgeHours,
  );
}

/* ============================================================================
   ONBOARDING HELPERS
============================================================================ */

function setOnboardingProgress(progress) {
  const safeProgress =
    progress &&
    typeof progress === 'object' &&
    !Array.isArray(progress)
      ? progress
      : {};

  return setStorageValue(STORAGE_KEYS.ONBOARDING_PROGRESS, {
    ...safeProgress,
    _metadata: createDraftMetadata('ONBOARDING'),
  });
}

function getOnboardingProgress() {
  return getStorageValue(STORAGE_KEYS.ONBOARDING_PROGRESS);
}

function updateOnboardingProgress(updates = {}) {
  const existing = getOnboardingProgress();

  const safeExisting =
    existing &&
    typeof existing === 'object' &&
    !Array.isArray(existing)
      ? existing
      : {};

  const safeUpdates =
    updates &&
    typeof updates === 'object' &&
    !Array.isArray(updates)
      ? updates
      : {};

  setOnboardingProgress({
    ...safeExisting,
    ...safeUpdates,
  });

  return getOnboardingProgress();
}

function clearOnboardingProgress() {
  return removeStorageValue(STORAGE_KEYS.ONBOARDING_PROGRESS);
}

function hasOnboardingProgress() {
  return storageHasKey(STORAGE_KEYS.ONBOARDING_PROGRESS);
}

function getOnboardingTimestamp() {
  return getDraftTimestamp(STORAGE_KEYS.ONBOARDING_PROGRESS);
}

function isOnboardingProgressExpired(maxAgeHours = 720) {
  return timestampIsExpired(
    getOnboardingTimestamp(),
    maxAgeHours,
  );
}

/**
 * Calculate onboarding completion percentage.
 */
function getOnboardingCompletionPercentage() {
  const progress = getOnboardingProgress();

  if (!progress || !Array.isArray(progress.completedSteps)) {
    return 0;
  }

  const totalSteps = Number(progress.totalSteps);

  if (!Number.isFinite(totalSteps) || totalSteps <= 0) {
    return 0;
  }

  const completedCount = new Set(progress.completedSteps).size;

  return Math.max(
    0,
    Math.min(
      100,
      Math.round((completedCount / totalSteps) * 100),
    ),
  );
}

/* ============================================================================
   TEST DATA FACTORIES
============================================================================ */

function createMockUser(overrides = {}) {
  return {
    id: 'test-user-id',
    tenantId: 'tenant-001',
    firstName: 'Justine',
    lastName: 'Igune',
    email: 'test@titech.co.ug',
    phone: '+256772123456',
    role: 'MEMBER',
    permissions: [],
    isActive: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockTenant(overrides = {}) {
  return {
    id: 'tenant-001',
    code: 'TITECH001',
    name: 'TITech Demo SACCO',
    country: 'UG',
    currency: 'UGX',
    isActive: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockAdmin(overrides = {}) {
  return createMockUser({
    role: 'ADMIN',
    permissions: [
      'LOAN_APPROVE',
      'LOAN_REJECT',
      'MEMBER_CREATE',
      'MEMBER_UPDATE',
      'TENANT_MANAGE',
    ],
    ...overrides,
  });
}

function createMockLoanOfficer(overrides = {}) {
  return createMockUser({
    role: 'LOAN_OFFICER',
    permissions: [
      'LOAN_CREATE',
      'LOAN_APPROVE',
      'LOAN_VIEW',
    ],
    ...overrides,
  });
}

function createMockTreasurer(overrides = {}) {
  return createMockUser({
    role: 'TREASURER',
    permissions: [
      'SAVINGS_CREATE',
      'SAVINGS_APPROVE',
      'REPORT_VIEW',
    ],
    ...overrides,
  });
}

function createMockLoanDraft(overrides = {}) {
  return {
    amount: 500000,
    interestRate: 12,
    repaymentPeriod: 12,
    loanType: 'PERSONAL',
    ...overrides,
  };
}

function createMockMemberDraft(overrides = {}) {
  return {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+256700000000',
    ...overrides,
  };
}

function createMockSavingsDraft(overrides = {}) {
  return {
    amount: 100000,
    frequency: 'MONTHLY',
    accountType: 'SAVINGS',
    ...overrides,
  };
}

function createMockOnboardingProgress(overrides = {}) {
  return {
    currentStep: 2,
    totalSteps: 5,
    completedSteps: [1, 2],
    ...overrides,
  };
}

/* ============================================================================
   PUBLIC API
============================================================================ */

const mockLocalStorageHelpers = {
  STORAGE_KEYS,
  SUPPORTED_THEMES,

  localStorageMock,
  sessionStorageMock,

  installStorageMocks,
  uninstallStorageMocks,
  resetStorage,

  safeParse,
  safeStringify,

  setStorageValue,
  getStorageValue,
  removeStorageValue,
  storageHasKey,
  getStorageKeys,
  getStorageSize,
  clearApplicationStorage,
  exportStorage,

  setSessionValue,
  getSessionValue,
  removeSessionValue,

  setAuthSession,
  getAuthSession,
  clearAuthSession,
  isAuthenticated,
  hasAuthSession,

  setTenant,
  getTenant,
  clearTenant,
  hasTenant,

  setPermissions,
  getPermissions,
  clearPermissions,
  hasPermissions,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,

  setTheme,
  getTheme,
  clearTheme,
  hasTheme,
  toggleTheme,

  saveLoanDraft,
  getLoanDraft,
  clearLoanDraft,
  hasLoanDraft,
  updateLoanDraft,
  getLoanDraftTimestamp,
  isLoanDraftExpired,

  saveMemberDraft,
  getMemberDraft,
  clearMemberDraft,
  hasMemberDraft,
  updateMemberDraft,
  getMemberDraftTimestamp,
  isMemberDraftExpired,

  saveSavingsDraft,
  getSavingsDraft,
  clearSavingsDraft,
  hasSavingsDraft,
  updateSavingsDraft,
  getSavingsDraftTimestamp,
  isSavingsDraftExpired,

  setOnboardingProgress,
  getOnboardingProgress,
  updateOnboardingProgress,
  clearOnboardingProgress,
  hasOnboardingProgress,
  getOnboardingTimestamp,
  isOnboardingProgressExpired,
  getOnboardingCompletionPercentage,

  createMockUser,
  createMockTenant,
  createMockAdmin,
  createMockLoanOfficer,
  createMockTreasurer,
  createMockLoanDraft,
  createMockMemberDraft,
  createMockSavingsDraft,
  createMockOnboardingProgress,
};

/* ============================================================================
   ESM EXPORTS
============================================================================ */

export {
  STORAGE_KEYS,
  SUPPORTED_THEMES,

  localStorageMock,
  sessionStorageMock,

  installStorageMocks,
  uninstallStorageMocks,
  resetStorage,

  safeParse,
  safeStringify,

  setStorageValue,
  getStorageValue,
  removeStorageValue,
  storageHasKey,
  getStorageKeys,
  getStorageSize,
  clearApplicationStorage,
  exportStorage,

  setSessionValue,
  getSessionValue,
  removeSessionValue,

  setAuthSession,
  getAuthSession,
  clearAuthSession,
  isAuthenticated,
  hasAuthSession,

  setTenant,
  getTenant,
  clearTenant,
  hasTenant,

  setPermissions,
  getPermissions,
  clearPermissions,
  hasPermissions,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,

  setTheme,
  getTheme,
  clearTheme,
  hasTheme,
  toggleTheme,

  saveLoanDraft,
  getLoanDraft,
  clearLoanDraft,
  hasLoanDraft,
  updateLoanDraft,
  getLoanDraftTimestamp,
  isLoanDraftExpired,

  saveMemberDraft,
  getMemberDraft,
  clearMemberDraft,
  hasMemberDraft,
  updateMemberDraft,
  getMemberDraftTimestamp,
  isMemberDraftExpired,

  saveSavingsDraft,
  getSavingsDraft,
  clearSavingsDraft,
  hasSavingsDraft,
  updateSavingsDraft,
  getSavingsDraftTimestamp,
  isSavingsDraftExpired,

  setOnboardingProgress,
  getOnboardingProgress,
  updateOnboardingProgress,
  clearOnboardingProgress,
  hasOnboardingProgress,
  getOnboardingTimestamp,
  isOnboardingProgressExpired,
  getOnboardingCompletionPercentage,

  createMockUser,
  createMockTenant,
  createMockAdmin,
  createMockLoanOfficer,
  createMockTreasurer,
  createMockLoanDraft,
  createMockMemberDraft,
  createMockSavingsDraft,
  createMockOnboardingProgress,
};

export default mockLocalStorageHelpers;

// Node.js versions with ESM/CommonJS interoperability support expose this
// object directly to CommonJS require() consumers.
export { mockLocalStorageHelpers as 'module.exports' };