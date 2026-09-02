'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Render With Providers Helper
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ React Testing Library
 * ✅ React Router
 * ✅ React Query
 * ✅ Authentication Context
 * ✅ Theme Context
 * ✅ Tenant Context
 * ✅ Permission Context
 * ✅ Redux Ready
 * ✅ Jest Compatible
 * ✅ Vitest Compatible
 * ✅ Enterprise Test Setup
 * ============================================================================
 */

import React from 'react';

import {
    render
} from '@testing-library/react';

import {
    MemoryRouter
} from 'react-router-dom';

import {
    QueryClient,
    QueryClientProvider
} from '@tanstack/react-query';

/* ============================================================================
   DEFAULT TEST USER
============================================================================ */

export const defaultUser = {

    _id:
        'user_001',

    firstName:
        'Test',

    lastName:
        'User',

    email:
        'test@titech.co.ug',

    role:
        'ADMIN',

    permissions: [

        'loan:create',
        'loan:view',
        'loan:approve',
        'savings:view',
        'dashboard:view'
    ],

    tenantId:
        'tenant_001'
};

/* ============================================================================
   DEFAULT TENANT
============================================================================ */

export const defaultTenant = {

    _id:
        'tenant_001',

    code:
        'SACCO001',

    name:
        'TITech Community SACCO',

    currency:
        'UGX',

    country:
        'UG',

    status:
        'ACTIVE'
};

/* ============================================================================
   TEST CONTEXTS
============================================================================ */

export const AuthContext =
    React.createContext(null);

export const ThemeContext =
    React.createContext(null);

export const TenantContext =
    React.createContext(null);

export const PermissionContext =
    React.createContext(null);

/* ============================================================================
   QUERY CLIENT FACTORY
============================================================================ */

export function createTestQueryClient() {

    return new QueryClient({

        defaultOptions: {

            queries: {

                retry: false,

                staleTime:
                    Infinity,

                refetchOnWindowFocus:
                    false,

                refetchOnReconnect:
                    false
            },

            mutations: {

                retry: false
            }
        }
    });
}

/* ============================================================================
   PROVIDERS
============================================================================ */

function Providers({

    children,

    route = '/',

    user = defaultUser,

    tenant = defaultTenant,

    queryClient
}) {

    const client =
        queryClient ||
        createTestQueryClient();

    return (

        <QueryClientProvider
            client={client}
        >

            <MemoryRouter
                initialEntries={[
                    route
                ]}
            >

                <AuthContext.Provider
                    value={{

                        user,

                        isAuthenticated:
                            true,

                        hasRole:
                            role =>
                                user.role ===
                                role,

                        login:
                            () => {},

                        logout:
                            () => {}
                    }}
                >

                    <TenantContext.Provider
                        value={{

                            tenant
                        }}
                    >

                        <PermissionContext.Provider
                            value={{

                                permissions:
                                    user.permissions ||

                                    [],

                                hasPermission:
                                    permission =>
                                        (
                                            user.permissions ||

                                            []
                                        ).includes(
                                            permission
                                        )
                            }}
                        >

                            <ThemeContext.Provider
                                value={{

                                    theme:
                                        'light',

                                    setTheme:
                                        () => {}
                                }}
                            >

                                {children}

                            </ThemeContext.Provider>

                        </PermissionContext.Provider>

                    </TenantContext.Provider>

                </AuthContext.Provider>

            </MemoryRouter>

        </QueryClientProvider>
    );
}

/* ============================================================================
   CUSTOM RENDER
============================================================================ */

export function renderWithProviders(

    ui,

    {

        route = '/',

        user = defaultUser,

        tenant = defaultTenant,

        queryClient,

        ...options

    } = {}
) {

    const client =
        queryClient ||
        createTestQueryClient();

    function Wrapper({
        children
    }) {

        return (

            <Providers

                route={route}

                user={user}

                tenant={tenant}

                queryClient={client}

            >

                {children}

            </Providers>
        );
    }

    return render(
        ui,
        {
            wrapper:
                Wrapper,

            ...options
        }
    );
}

/* ============================================================================
   TEST HELPERS
============================================================================ */

export async function flushPromises() {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                0
            )
    );
}

export async function waitForAsync(
    milliseconds = 100
) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    );
}

/* ============================================================================
   TEST USERS
============================================================================ */

export const users = {

    admin: {

        ...defaultUser
    },

    creditOfficer: {

        ...defaultUser,

        role:
            'CREDIT_OFFICER',

        permissions: [

            'loan:view',
            'loan:approve'
        ]
    },

    cashier: {

        ...defaultUser,

        role:
            'CASHIER',

        permissions: [

            'loan:view',
            'loan:repay'
        ]
    },

    member: {

        ...defaultUser,

        role:
            'MEMBER',

        permissions: [

            'dashboard:view'
        ]
    }
};

/* ============================================================================
   REACT QUERY TEST HELPERS
============================================================================ */

export function createMockQueryResult(
    data
) {

    return {

        data,

        error:
            null,

        isLoading:
            false,

        isFetching:
            false,

        isSuccess:
            true,

        status:
            'success'
    };
}

export function createMockErrorResult(
    error
) {

    return {

        data:
            undefined,

        error,

        isLoading:
            false,

        isFetching:
            false,

        isSuccess:
            false,

        status:
            'error'
    };
}

/* ============================================================================
   RE-EXPORTS
============================================================================ */

export * from '@testing-library/react';

export {
    renderWithProviders as render
};