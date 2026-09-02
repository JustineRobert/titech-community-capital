'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/App.jsx
 *
 * Purpose:
 *   Canonical application root and client-side routing boundary.
 *
 * Responsibilities:
 *   - Authentication provider bootstrapping
 *   - Application layout
 *   - Public routes
 *   - Protected application routes
 *   - Protected administrative routes
 *   - Lazy-loaded page boundaries
 *   - Global error boundary
 *   - Route loading fallback
 *   - Scroll restoration
 *   - Global toast notifications
 *   - Production-ready error reporting integration point
 *
 * Design principles:
 *   - Fail safely
 *   - Keep routing deterministic
 *   - Keep financial/application routes protected
 *   - Keep administrative routes role protected
 *   - Avoid unnecessary application-wide state
 *   - Support future observability integrations
 *   - Preserve compatibility with the existing TITech frontend structure
 *
 * ============================================================================
 */

import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
} from 'react';

import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import {
  ToastContainer,
} from 'react-toastify';

import 'react-toastify/dist/ReactToastify.css';

// -----------------------------------------------------------------------------
// Application context
// -----------------------------------------------------------------------------

import {
  AuthProvider,
  useAuth,
} from './context/AuthContext';

// -----------------------------------------------------------------------------
// Route guards
// -----------------------------------------------------------------------------

import ProtectedRoute from './components/ProtectedRoute';
import ProtectedRouteWithRole from './components/ProtectedRouteWithRole';

// -----------------------------------------------------------------------------
// Global application components
// -----------------------------------------------------------------------------

import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ErrorBoundary from './components/ErrorBoundary';

// ============================================================================
// Lazy-loaded application pages
// ============================================================================
//
// Keep route-level code splitting here so that the initial application bundle
// remains small and individual features are loaded only when required.
// ============================================================================

const Dashboard = lazy(() => import('./pages/Dashboard'));

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));

const ForgotPassword = lazy(
  () => import('./pages/ForgotPassword')
);

const ResetPassword = lazy(
  () => import('./pages/ResetPassword')
);

const TermsOfService = lazy(
  () => import('./pages/TermsOfService')
);

const PrivacyPolicy = lazy(
  () => import('./pages/PrivacyPolicy')
);

const Legal = lazy(
  () => import('./pages/Legal')
);

const GroupList = lazy(
  () => import('./pages/GroupList')
);

const GroupDetails = lazy(
  () => import('./pages/GroupDetails')
);

const CreateGroup = lazy(
  () => import('./pages/CreateGroupV2')
);

const NotFound = lazy(
  () => import('./pages/NotFound')
);

// ============================================================================
// Lazy-loaded administrative pages
// ============================================================================

const AdminDashboard = lazy(
  () => import('./pages/admin/AdminDashboard')
);

const AdminSettings = lazy(
  () => import('./pages/admin/AdminSettings')
);

const ManageUsers = lazy(
  () => import('./pages/admin/ManageUsers')
);

const AdminSessions = lazy(
  () => import('./pages/admin/AdminSessions')
);

// ============================================================================
// Application constants
// ============================================================================

const ROUTES = Object.freeze({
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',

  TERMS: '/terms',
  PRIVACY: '/privacy',
  LEGAL: '/legal',

  DASHBOARD: '/dashboard',

  GROUPS: '/groups',
  GROUP_DETAILS: '/groups/:groupId',
  CREATE_GROUP: '/create-group',

  ADMIN: '/admin',
  ADMIN_SETTINGS: '/admin/settings',
  ADMIN_USERS: '/admin/users',
  ADMIN_SESSIONS: '/admin/sessions',

  NOT_FOUND: '*',
});

const PUBLIC_NAVBAR_HIDDEN_ROUTES = Object.freeze([
  ROUTES.LOGIN,
  ROUTES.REGISTER,
  ROUTES.FORGOT_PASSWORD,
  ROUTES.RESET_PASSWORD,
  ROUTES.TERMS,
  ROUTES.PRIVACY,
  ROUTES.LEGAL,
]);

const PUBLIC_FOOTER_HIDDEN_ROUTES = Object.freeze([
  ROUTES.LOGIN,
  ROUTES.REGISTER,
]);

const ADMIN_ROLES = Object.freeze([
  'admin',
]);

// ============================================================================
// Environment helpers
// ============================================================================

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production';

const IS_DEVELOPMENT =
  process.env.NODE_ENV === 'development';

// ============================================================================
// Route loading fallback
// ============================================================================

function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        minHeight: '40vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div>
        <div
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            margin: '0 auto 12px',
            border: '3px solid rgba(37, 99, 235, 0.2)',
            borderTopColor: '#2563eb',
            borderRadius: '50%',
            animation: 'titech-app-spin 0.8s linear infinite',
          }}
        />

        <p
          style={{
            margin: 0,
            color: '#4b5563',
            fontSize: '0.95rem',
          }}
        >
          Loading…
        </p>
      </div>

      <style>
        {`
          @keyframes titech-app-spin {
            from {
              transform: rotate(0deg);
            }

            to {
              transform: rotate(360deg);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            div[aria-hidden="true"] {
              animation: none !important;
            }
          }
        `}
      </style>
    </div>
  );
}

// ============================================================================
// Scroll restoration
// ============================================================================

function ScrollToTop() {
  const location = useLocation();

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;

    window.scrollTo({
      top: 0,
      left: 0,
      behavior: reduceMotion ? 'auto' : 'auto',
    });
  }, [location.pathname]);

  return null;
}

// ============================================================================
// Global error fallback
// ============================================================================

function ErrorFallback({ onReset }) {
  const handleReload = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
          borderRadius: '50%',
          background: '#fee2e2',
          color: '#b91c1c',
          fontSize: 28,
          fontWeight: 700,
        }}
        aria-hidden="true"
      >
        !
      </div>

      <h1
        style={{
          margin: '0 0 8px',
          fontSize: '1.5rem',
          lineHeight: 1.3,
          color: '#111827',
        }}
      >
        Something went wrong
      </h1>

      <p
        style={{
          maxWidth: 560,
          margin: '0 0 20px',
          color: '#4b5563',
          lineHeight: 1.6,
        }}
      >
        An unexpected application error occurred.
        Your account and application data have not been
        intentionally changed by this error.
      </p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          justifyContent: 'center',
        }}
      >
        <button
          type="button"
          onClick={handleReload}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            background: '#fff',
            color: '#111827',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Reload
        </button>

        <button
          type="button"
          onClick={onReset}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#2563eb',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Try Again
        </button>

        <a
          href={ROUTES.DASHBOARD}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '10px 16px',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            background: '#fff',
            color: '#111827',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Dashboard
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// Error reporting
// ============================================================================
//
// This is deliberately kept as an integration boundary.
//
// Later this can be connected to:
//   - Sentry
//   - OpenTelemetry
//   - LogRocket
//   - Datadog
//   - another TITech observability service
//
// Do not expose sensitive financial, authentication, token, or PII data here.
// ============================================================================

function reportError(error, errorInfo) {
  if (IS_DEVELOPMENT) {
    console.error(
      '[TITech UI] Reported application error:',
      error
    );

    console.error(
      '[TITech UI] Error boundary information:',
      errorInfo
    );
  }

  if (!IS_PRODUCTION) {
    return;
  }

  // ---------------------------------------------------------------------------
  // Production observability integration point.
  //
  // Example future integration:
  //
  // Sentry.captureException(error, {
  //   contexts: {
  //     react: errorInfo,
  //   },
  // });
  //
  // Never place secrets or authentication tokens here.
  // ---------------------------------------------------------------------------
}

// ============================================================================
// Home route
// ============================================================================

function HomeRedirect() {
  const {
    user,
    loading,
  } = useAuth();

  if (loading) {
    return <RouteFallback />;
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
    <Navigate
      to={ROUTES.LOGIN}
      replace
    />
  );
}

// ============================================================================
// Route visibility helpers
// ============================================================================

function useLayoutVisibility() {
  const location = useLocation();

  const visibility = useMemo(() => {
    const pathname = location.pathname;

    return {
      showNavbar:
        !PUBLIC_NAVBAR_HIDDEN_ROUTES.includes(pathname),

      showFooter:
        !PUBLIC_FOOTER_HIDDEN_ROUTES.includes(pathname),
    };
  }, [location.pathname]);

  return visibility;
}

// ============================================================================
// Application layout
// ============================================================================

function AppLayout({ children }) {
  const {
    showNavbar,
    showFooter,
  } = useLayoutVisibility();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        width: '100%',
      }}
    >
      {showNavbar && <Navbar />}

      <ScrollToTop />

      <main
        id="main-content"
        style={{
          flex: 1,
          width: '100%',
        }}
      >
        <ErrorBoundary
          onError={reportError}
          fallback={ErrorFallback}
          onReset={() => {
            // The current ErrorBoundary implementation may use this
            // callback to reset internal error state.
            //
            // Keep this intentionally side-effect free. Global application
            // state should not be blindly reset from a generic UI boundary.
          }}
        >
          <Suspense fallback={<RouteFallback />}>
            {children}
          </Suspense>
        </ErrorBoundary>
      </main>

      {showFooter && <Footer />}

      <ToastContainer
        position="top-right"
        autoClose={4000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        pauseOnHover
        draggable
        theme="colored"
        limit={5}
      />
    </div>
  );
}

// ============================================================================
// Administrative layout
// ============================================================================
//
// Every route under this layout is protected by the admin role guard.
//
// Keeping this boundary centralized means future admin routes can be added
// without duplicating the authentication/authorization wrapper.
// ============================================================================

function AdminLayout({ children }) {
  return (
    <ProtectedRouteWithRole
      allowedRoles={ADMIN_ROLES}
    >
      <ErrorBoundary
        onError={reportError}
        fallback={ErrorFallback}
        onReset={() => {
          // Intentionally side-effect free.
        }}
      >
        <Suspense fallback={<RouteFallback />}>
          {children}
        </Suspense>
      </ErrorBoundary>
    </ProtectedRouteWithRole>
  );
}

// ============================================================================
// Public routes
// ============================================================================

function PublicRoutes() {
  return (
    <>
      <Route
        path={ROUTES.HOME}
        element={<HomeRedirect />}
      />

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

      <Route
        path={ROUTES.TERMS}
        element={<TermsOfService />}
      />

      <Route
        path={ROUTES.PRIVACY}
        element={<PrivacyPolicy />}
      />

      <Route
        path={ROUTES.LEGAL}
        element={<Legal />}
      />
    </>
  );
}

// ============================================================================
// Protected application routes
// ============================================================================

function ProtectedApplicationRoutes() {
  return (
    <>
      <Route
        path={ROUTES.DASHBOARD}
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path={ROUTES.GROUPS}
        element={
          <ProtectedRoute>
            <GroupList />
          </ProtectedRoute>
        }
      />

      <Route
        path={ROUTES.GROUP_DETAILS}
        element={
          <ProtectedRoute>
            <GroupDetails />
          </ProtectedRoute>
        }
      />

      <Route
        path={ROUTES.CREATE_GROUP}
        element={
          <ProtectedRoute>
            <CreateGroup />
          </ProtectedRoute>
        }
      />
    </>
  );
}

// ============================================================================
// Administrative routes
// ============================================================================

function AdministrativeRoutes() {
  return (
    <>
      <Route
        path={ROUTES.ADMIN}
        element={
          <AdminLayout>
            <AdminDashboard />
          </AdminLayout>
        }
      />

      <Route
        path={ROUTES.ADMIN_SETTINGS}
        element={
          <AdminLayout>
            <AdminSettings />
          </AdminLayout>
        }
      />

      <Route
        path={ROUTES.ADMIN_USERS}
        element={
          <AdminLayout>
            <ManageUsers />
          </AdminLayout>
        }
      />

      <Route
        path={ROUTES.ADMIN_SESSIONS}
        element={
          <AdminLayout>
            <AdminSessions />
          </AdminLayout>
        }
      />
    </>
  );
}

// ============================================================================
// Application routes
// ============================================================================

function ApplicationRoutes() {
  return (
    <Routes>
      <PublicRoutes />

      <ProtectedApplicationRoutes />

      <AdministrativeRoutes />

      <Route
        path={ROUTES.NOT_FOUND}
        element={<NotFound />}
      />
    </Routes>
  );
}

// ============================================================================
// Application root
// ============================================================================

export default function App() {
  return (
    <AuthProvider>
      <AppLayout>
        <ApplicationRoutes />
      </AppLayout>
    </AuthProvider>
  );
}