'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/routes/AppRoutes.jsx
 *
 * Purpose:
 *   Canonical frontend routing boundary.
 *
 * Responsibilities:
 *   - Define public routes
 *   - Define authenticated application routes
 *   - Define administrative routes
 *   - Enforce authentication
 *   - Enforce role-based authorization
 *   - Provide lazy-loaded route boundaries
 *   - Provide deterministic loading states
 *   - Provide safe navigation fallbacks
 *
 * Non-responsibilities:
 *   - Authentication implementation
 *   - API implementation
 *   - Financial transaction logic
 *   - Wallet/ledger mutation logic
 *   - Application-wide state management
 *   - Feature business logic
 *
 * Canonical route architecture:
 *
 *   AppRoutes
 *      │
 *      ├── Public
 *      │    ├── Login
 *      │    ├── Register
 *      │    ├── Forgot Password
 *      │    ├── Reset Password
 *      │    ├── Terms
 *      │    └── Privacy
 *      │
 *      ├── Protected
 *      │    ├── Dashboard
 *      │    ├── Members
 *      │    ├── Savings
 *      │    ├── Loans
 *      │    ├── Transactions
 *      │    ├── Reports
 *      │    └── Settings
 *      │
 *      └── Fallback
 *           └── Not Found
 *
 * ============================================================================
 */

import React, {
  Suspense,
  lazy,
} from 'react';

import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import AdminLayout from '../layouts/AdminLayout';

import { useAuth } from '../context/AuthContext';

// ============================================================================
// Application routes
// ============================================================================

const ROUTES = Object.freeze({
  ROOT: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',

  TERMS: '/terms',
  PRIVACY: '/privacy',

  DASHBOARD: '/dashboard',
  MEMBERS: '/members',
  SAVINGS: '/savings',
  LOANS: '/loans',
  TRANSACTIONS: '/transactions',
  REPORTS: '/reports',
  SETTINGS: '/settings',
});

// ============================================================================
// Authorization
// ============================================================================

const ADMIN_ROLES = new Set([
  'admin',
  'super_admin',
]);

// ============================================================================
// Lazy import helper
// ============================================================================
//
// Deployment systems can occasionally leave a browser holding a stale HTML
// document that references an old chunk after a new deployment.
//
// A single controlled retry can recover from that situation.
//
// The reload marker prevents an infinite reload loop.
// ============================================================================

const CHUNK_RELOAD_KEY =
  '__TITECH_CHUNK_RELOAD__';

function lazyWithRecovery(
  importer,
  name
) {
  return lazy(async () => {
    try {
      return await importer();
    } catch (error) {
      const alreadyRetried =
        sessionStorage.getItem(
          CHUNK_RELOAD_KEY
        ) === 'true';

      if (
        alreadyRetried
      ) {
        throw error;
      }

      sessionStorage.setItem(
        CHUNK_RELOAD_KEY,
        'true'
      );

      /*
       * Give the browser a fresh application document.
       *
       * This is especially useful when a deployment has invalidated an old
       * dynamically imported chunk.
       */
      window.location.reload();

      /*
       * Keep the Promise pending while the browser reloads.
       */
      return new Promise(
        () => {}
      );
    }
  });
}

// ============================================================================
// Clear successful chunk-reload marker
// ============================================================================

function clearChunkReloadMarker() {
  try {
    sessionStorage.removeItem(
      CHUNK_RELOAD_KEY
    );
  } catch {
    // Ignore unavailable session storage.
  }
}

// ============================================================================
// Lazy-loaded pages
// ============================================================================

const Dashboard = lazyWithRecovery(
  () => import('../pages/Dashboard'),
  'Dashboard'
);

const Members = lazyWithRecovery(
  () => import('../pages/Members'),
  'Members'
);

const Savings = lazyWithRecovery(
  () => import('../pages/Savings'),
  'Savings'
);

const Loans = lazyWithRecovery(
  () => import('../pages/Loans'),
  'Loans'
);

const Transactions = lazyWithRecovery(
  () => import('../pages/Transactions'),
  'Transactions'
);

const Reports = lazyWithRecovery(
  () => import('../pages/Reports'),
  'Reports'
);

const Login = lazyWithRecovery(
  () => import('../pages/Login'),
  'Login'
);

const Register = lazyWithRecovery(
  () => import('../pages/Register'),
  'Register'
);

const ForgotPassword =
  lazyWithRecovery(
    () => import('../pages/ForgotPassword'),
    'ForgotPassword'
  );

const ResetPassword =
  lazyWithRecovery(
    () => import('../pages/ResetPassword'),
    'ResetPassword'
  );

const TermsOfService =
  lazyWithRecovery(
    () => import('../pages/TermsOfService'),
    'TermsOfService'
  );

const PrivacyPolicy =
  lazyWithRecovery(
    () => import('../pages/PrivacyPolicy'),
    'PrivacyPolicy'
  );

const Settings = lazyWithRecovery(
  () => import('../pages/Settings'),
  'Settings'
);

const NotFound = lazyWithRecovery(
  () => import('../pages/NotFound'),
  'NotFound'
);

// ============================================================================
// Route loading boundary
// ============================================================================

function RouteLoader() {
  return (
    <div
      className="route-loader"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className="spinner"
        aria-hidden="true"
      />

      <p>
        Loading…
      </p>
    </div>
  );
}

// ============================================================================
// Authentication state
// ============================================================================

function useAuthentication() {
  const auth =
    useAuth();

  return {
    user: auth?.user ?? null,
    loading:
      Boolean(auth?.loading),
  };
}

// ============================================================================
// Role normalization
// ============================================================================

function normalizeRole(
  role
) {
  if (
    typeof role !== 'string'
  ) {
    return null;
  }

  return role
    .trim()
    .toLowerCase();
}

// ============================================================================
// Protected route
// ============================================================================

function ProtectedRoute() {
  const {
    user,
    loading,
  } = useAuthentication();

  const location =
    useLocation();

  if (loading) {
    return (
      <RouteLoader />
    );
  }

  if (!user) {
    return (
      <Navigate
        to={ROUTES.LOGIN}
        replace
        state={{
          from:
            location.pathname +
            location.search +
            location.hash,
        }}
      />
    );
  }

  return (
    <Outlet />
  );
}

// ============================================================================
// Admin route
// ============================================================================

function AdminRoute() {
  const {
    user,
    loading,
  } = useAuthentication();

  if (loading) {
    return (
      <RouteLoader />
    );
  }

  if (!user) {
    return (
      <Navigate
        to={ROUTES.LOGIN}
        replace
      />
    );
  }

  const role =
    normalizeRole(
      user.role
    );

  if (
    !role ||
    !ADMIN_ROLES.has(role)
  ) {
    return (
      <Navigate
        to={ROUTES.DASHBOARD}
        replace
      />
    );
  }

  return (
    <Outlet />
  );
}

// ============================================================================
// Public authentication route
// ============================================================================
//
// Used only for routes that should redirect an already authenticated user,
// such as login/register/password recovery.
//
// Legal documents intentionally DO NOT use this wrapper.
// Authenticated users must still be able to access Terms and Privacy.
//
// ============================================================================

function PublicAuthRoute() {
  const {
    user,
    loading,
  } = useAuthentication();

  if (loading) {
    return (
      <RouteLoader />
    );
  }

  if (user) {
    return (
      <Navigate
        to={ROUTES.DASHBOARD}
        replace
      />
    );
  }

  return (
    <Outlet />
  );
}

// ============================================================================
// Authenticated application layout
// ============================================================================
//
// AdminLayout is retained here for compatibility with the current project.
// It must behave as an application shell/layout and render <Outlet />.
//
// Despite the existing name, authentication is enforced by ProtectedRoute.
// ============================================================================

function ProtectedLayout() {
  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}

// ============================================================================
// Root destination
// ============================================================================

function RootRedirect() {
  const {
    user,
    loading,
  } = useAuthentication();

  if (loading) {
    return (
      <RouteLoader />
    );
  }

  return (
    <Navigate
      to={
        user
          ? ROUTES.DASHBOARD
          : ROUTES.LOGIN
      }
      replace
    />
  );
}

// ============================================================================
// Route tree
// ============================================================================

function ApplicationRouteTree() {
  return (
    <Routes>

      {/* ================================================================== */}
      {/* Public authentication routes                                       */}
      {/* ================================================================== */}

      <Route element={<PublicAuthRoute />}>
        <Route
          path={ROUTES.LOGIN}
          element={<Login />}
        />

        <Route
          path={ROUTES.REGISTER}
          element={<Register />}
        />

        <Route
          path={ROUTES.FORGOT_PASSWORD}
          element={<ForgotPassword />}
        />

        <Route
          path={ROUTES.RESET_PASSWORD}
          element={<ResetPassword />}
        />
      </Route>

      {/* ================================================================== */}
      {/* Public legal routes                                                 */}
      {/* ================================================================== */}
      {/*
       * Legal documents remain public even when the user is authenticated.
       */}

      <Route
        path={ROUTES.TERMS}
        element={
          <TermsOfService />
        }
      />

      <Route
        path={ROUTES.PRIVACY}
        element={
          <PrivacyPolicy />
        }
      />

      {/* ================================================================== */}
      {/* Root                                                                */}
      {/* ================================================================== */}

      <Route
        path={ROUTES.ROOT}
        element={
          <RootRedirect />
        }
      />

      {/* ================================================================== */}
      {/* Protected application routes                                       */}
      {/* ================================================================== */}

      <Route
        element={
          <ProtectedRoute />
        }
      >
        <Route
          element={
            <ProtectedLayout />
          }
        >
          <Route
            path={ROUTES.DASHBOARD}
            element={
              <Dashboard />
            }
          />

          <Route
            path={ROUTES.MEMBERS}
            element={
              <Members />
            }
          />

          <Route
            path={ROUTES.SAVINGS}
            element={
              <Savings />
            }
          />

          <Route
            path={ROUTES.LOANS}
            element={
              <Loans />
            }
          />

          <Route
            path={ROUTES.TRANSACTIONS}
            element={
              <Transactions />
            }
          />

          <Route
            path={ROUTES.REPORTS}
            element={
              <Reports />
            }
          />

          {/* ============================================================ */}
          {/* Administrative routes                                         */}
          {/* ============================================================ */}

          <Route
            element={
              <AdminRoute />
            }
          >
            <Route
              path={ROUTES.SETTINGS}
              element={
                <Settings />
              }
            />
          </Route>

          {/* ============================================================ */}
          {/* Unknown route inside authenticated shell                      */}
          {/* ============================================================ */}

        </Route>
      </Route>

      {/* ================================================================== */}
      {/* Global 404                                                         */}
      {/* ================================================================== */}

      <Route
        path="*"
        element={
          <NotFound />
        }
      />

    </Routes>
  );
}

// ============================================================================
// Application routes
// ============================================================================

export default function AppRoutes() {
  React.useEffect(() => {
    clearChunkReloadMarker();
  }, []);

  return (
    <Suspense
      fallback={
        <RouteLoader />
      }
    >
      <ApplicationRouteTree />
    </Suspense>
  );
}