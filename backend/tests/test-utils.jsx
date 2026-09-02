'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Test Utilities
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ React Testing Library Wrapper
 * ✅ React Query Support
 * ✅ React Router Support
 * ✅ Custom Providers
 * ✅ Auth Context Support
 * ✅ Theme Context Support
 * ✅ Redux Ready
 * ✅ MSW Compatible
 * ✅ Jest Compatible
 * ✅ Vitest Compatible
 * ✅ Enterprise Test Configuration
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
   TEST QUERY CLIENT
============================================================================ */

export const createTestQueryClient =
    () =>
        new QueryClient({

            defaultOptions: {

                queries: {

                    retry: false,

                    refetchOnWindowFocus:
                        false,

                    staleTime:
                        Infinity
                },

                mutations: {

                    retry: false
                }
            },

            logger: {

                log:
                    console.log,

                warn:
                    console.warn,

                error:
                    process.env.NODE_ENV ===
                    'test'
                        ? () => {}
                        : console.error
            }
        });

/* ============================================================================
   DEFAULT MOCK USER
============================================================================ */

export const mockUser = {

    id:
        'user-001',

    firstName:
        'Test',

    lastName:
        'User',

    email:
        'test@titech.co.ug',

    role:
        'ADMIN',

    tenantId:
        'tenant-001'
};

/* ============================================================================
   MOCK AUTH CONTEXT
============================================================================ */

export const AuthContext =
    React.createContext({

        user:
            mockUser,

        isAuthenticated:
            true,

        loading:
            false,

        login:
            jest?.fn?.() ||
            (() => {}),

        logout:
            jest?.fn?.() ||
            (() => {})
    });

export const MockAuthProvider =
    ({
        children,
        user = mockUser
    }) => {

        const value = {

            user,

            isAuthenticated:
                true,

            loading:
                false,

            login:
                () => {},

            logout:
                () => {}
        };

        return (

            <AuthContext.Provider
                value={value}
            >
                {children}
            </AuthContext.Provider>
        );
    };

/* ============================================================================
   MOCK THEME PROVIDER
============================================================================ */

export const ThemeContext =
    React.createContext({

        theme:
            'light',

        toggleTheme:
            () => {}
    });

export const MockThemeProvider =
    ({ children }) => (

        <ThemeContext.Provider
            value={{
                theme:
                    'light',

                toggleTheme:
                    () => {}
            }}
        >
            {children}
        </ThemeContext.Provider>
    );