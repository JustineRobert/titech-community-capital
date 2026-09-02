"use strict";

const {

    STORAGE_KEYS,

    installStorageMocks,
    uninstallStorageMocks,
    resetStorage,

    /* Auth */
    setAuthSession,
    getAuthSession,
    clearAuthSession,
    isAuthenticated,
    hasAuthSession,

    /* Tenant */
    setTenant,
    getTenant,
    clearTenant,
    hasTenant,

    /* Permissions */
    setPermissions,
    getPermissions,
    hasPermission,

    /* Theme */
    setTheme,
    getTheme,
    toggleTheme,

    /* Loan Draft */
    saveLoanDraft,
    getLoanDraft,
    hasLoanDraft,
    updateLoanDraft,
    clearLoanDraft,

    /* Member Draft */
    saveMemberDraft,
    getMemberDraft,

    /* Savings Draft */
    saveSavingsDraft,
    getSavingsDraft,

    /* Onboarding */
    setOnboardingProgress,
    getOnboardingProgress,
    getOnboardingCompletionPercentage,

    /* Generic Storage */
    storageHasKey,
    getStorageKeys,
    getStorageSize,
    exportStorage,

    /* Factories */
    createMockUser,
    createMockAdmin,
    createMockTenant

} = require(
    "../mockLocalStorage"
);

describe(
    "Mock Local Storage Helper",
    () => {

        beforeAll(() => {

            installStorageMocks();

        });

        beforeEach(() => {

            resetStorage();

        });

        afterAll(() => {

            uninstallStorageMocks();

        });

        /**
         * =====================================================
         * AUTH HELPERS
         * =====================================================
         */

        test(
            "should store auth session",
            () => {

                setAuthSession({

                    accessToken:
                        "token1",

                    refreshToken:
                        "token2",

                    user: {
                        id: 1
                    }
                });

                expect(

                    localStorage.getItem(
                        STORAGE_KEYS.ACCESS_TOKEN
                    )

                ).toBe("token1");

                expect(

                    localStorage.getItem(
                        STORAGE_KEYS.REFRESH_TOKEN
                    )

                ).toBe("token2");

            }
        );

        test(
            "should retrieve auth session",
            () => {

                setAuthSession({

                    accessToken:
                        "token1",

                    refreshToken:
                        "token2",

                    user: {
                        id: 1,
                        name: "Justine"
                    }
                });

                const session =
                    getAuthSession();

                expect(
                    session.accessToken
                ).toBe(
                    "token1"
                );

                expect(
                    session.refreshToken
                ).toBe(
                    "token2"
                );

                expect(
                    session.user.id
                ).toBe(1);

            }
        );

        test(
            "should report authenticated user",
            () => {

                setAuthSession({

                    accessToken:
                        "token1",

                    refreshToken:
                        "token2",

                    user: {
                        id: 1
                    }
                });

                expect(
                    isAuthenticated()
                ).toBe(true);

            }
        );

        test(
            "should report auth session exists",
            () => {

                setAuthSession({

                    accessToken:
                        "token1",

                    refreshToken:
                        "token2",

                    user: {
                        id: 1
                    }
                });

                expect(
                    hasAuthSession()
                ).toBe(true);

            }
        );

        test(
            "should clear auth session",
            () => {

                setAuthSession({

                    accessToken:
                        "token1",

                    refreshToken:
                        "token2",

                    user: {
                        id: 1
                    }
                });

                clearAuthSession();

                expect(

                    localStorage.getItem(
                        STORAGE_KEYS.ACCESS_TOKEN
                    )

                ).toBeNull();

                expect(

                    localStorage.getItem(
                        STORAGE_KEYS.REFRESH_TOKEN
                    )

                ).toBeNull();

                expect(

                    localStorage.getItem(
                        STORAGE_KEYS.USER
                    )

                ).toBeNull();

            }
        );

        test(
            "should report unauthenticated after clear",
            () => {

                setAuthSession({

                    accessToken:
                        "token1",

                    refreshToken:
                        "token2",

                    user: {
                        id: 1
                    }
                });

                clearAuthSession();

                expect(
                    isAuthenticated()
                ).toBe(false);

            }
        );

    }
);
/**
 * =====================================================
 * TENANT HELPERS
 * =====================================================
 */

test(
    "should save tenant",
    () => {

        setTenant({
            id: "tenant1"
        });

        expect(
            getTenant().id
        ).toBe(
            "tenant1"
        );

    }
);

test(
    "should detect tenant exists",
    () => {

        setTenant({
            id: "tenant1"
        });

        expect(
            hasTenant()
        ).toBe(true);

    }
);

test(
    "should clear tenant",
    () => {

        setTenant({
            id: "tenant1"
        });

        clearTenant();

        expect(
            getTenant()
        ).toBeNull();

    }
);

/**
 * =====================================================
 * LOAN DRAFT HELPERS
 * =====================================================
 */

test(
    "should save loan draft",
    () => {

        saveLoanDraft({
            amount: 500000
        });

        expect(
            getLoanDraft()
                .amount
        ).toBe(
            500000
        );

    }
);

test(
    "should detect loan draft",
    () => {

        saveLoanDraft({
            amount: 500000
        });

        expect(
            hasLoanDraft()
        ).toBe(true);

    }
);

test(
    "should update loan draft",
    () => {

        saveLoanDraft({
            amount: 100000
        });

        updateLoanDraft({
            amount: 200000
        });

        expect(
            getLoanDraft()
                .amount
        ).toBe(
            200000
        );

    }
);

test(
    "should clear loan draft",
    () => {

        saveLoanDraft({
            amount: 500000
        });

        clearLoanDraft();

        expect(
            getLoanDraft()
        ).toBeNull();

    }
);

/**
 * =====================================================
 * THEME HELPERS
 * =====================================================
 */

test(
    "should store theme",
    () => {

        setTheme(
            "dark"
        );

        expect(
            getTheme()
        ).toBe(
            "dark"
        );

    }
);

test(
    "should return light theme by default",
    () => {

        expect(
            getTheme()
        ).toBe(
            "light"
        );

    }
);

test(
    "should toggle theme",
    () => {

        setTheme(
            "light"
        );

        expect(
            toggleTheme()
        ).toBe(
            "dark"
        );

        expect(
            getTheme()
        ).toBe(
            "dark"
        );

    }
);

/**
 * =====================================================
 * STORAGE UTILITIES
 * =====================================================
 */

test(
    "should export storage snapshot",
    () => {

        setTheme(
            "dark"
        );

        const snapshot =
            exportStorage();

        expect(
            snapshot[
            STORAGE_KEYS.THEME
            ]
        ).toBeDefined();

    }
);

test(
    "should report existing key",
    () => {

        setTheme(
            "dark"
        );

        expect(
            storageHasKey(
                STORAGE_KEYS.THEME
            )
        ).toBe(true);

    }
);

test(
    "should return storage size",
    () => {

        setTheme("dark");

        expect(
            getStorageSize()
        ).toBeGreaterThan(0);

    }
);

test(
    "should return storage keys",
    () => {

        setTheme("dark");

        expect(
            getStorageKeys()
        ).toContain(
            STORAGE_KEYS.THEME
        );

    }
);

test(
    "should clear storage",
    () => {

        localStorage.setItem(
            "test",
            "value"
        );

        resetStorage();

        expect(
            localStorage.length
        ).toBe(0);

        expect(
            sessionStorage.length
        ).toBe(0);

    }
);

/**
 * =====================================================
 * FACTORY HELPERS
 * =====================================================
 */

test(
    "should create mock user",
    () => {

        const user =
            createMockUser();

        expect(
            user.role
        ).toBe(
            "MEMBER"
        );

    }
);

test(
    "should create mock tenant",
    () => {

        const tenant =
            createMockTenant();

        expect(
            tenant.code
        ).toBe(
            "TITECH001"
        );

    }
);

afterAll(() => {

    uninstallStorageMocks();

});

}); // end describe("Mock Local Storage Helper")