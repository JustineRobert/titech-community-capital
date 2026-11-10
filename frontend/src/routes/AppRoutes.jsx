'use strict';

/**
 * ============================================================================
 * Product: TITech Community Capital
 * Organization: TITech Capital SMC LTD
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
import Navbar from '../components/Navbar';

import { useAuth } from '../context/AuthContext';
import { normalizeTitechRole, TITECH_ROLES } from '../security/rbacPolicy';

// ============================================================================
// Application routes
// ============================================================================

const ROUTES = Object.freeze({
  ROOT: '/',
  LOGIN: '/login',
  LOGOUT: '/logout',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',
  VERIFY_EMAIL: '/verify-email',
  ACCESS_GOVERNANCE: '/admin/access',

  LEGAL: '/legal',
  TERMS: '/terms',
  PRIVACY: '/privacy',

  DASHBOARD: '/dashboard',
  ADMIN: '/admin',
  MEMBERS: '/members',
  SAVINGS: '/savings',
  LOANS: '/loans',
  TRANSACTIONS: '/transactions',
  REPORTS: '/reports',
  SETTINGS: '/settings',
  PAYROLL: '/payroll',
  BOOK_A_DEMO: '/book-a-demo',
  CONTACT_US: '/contact-us',
  CHAT_WITH_TITECH: '/chat-with-titech',
  EDUCATION_SUPPORT: '/education-support',
  EDUFINANCE: '/edufinance',
  GROUPS: '/groups',
  GROUP_DETAILS: '/groups/:groupId',
  CREATE_GROUP: '/create-group',
  LEGACY_CREATE_GROUP: '/groups/create',
  MEETINGS: '/meetings',
  INCLUSIVE_ONBOARDING: '/inclusive-onboarding',
  RETIREMENT_SUPPORT: '/retirement-support',
  AGRICULTURE: '/agriculture',
  UBUNTU_FLOAT: '/ubuntu-float',
  PARTNER_SUPPORT: '/partner-support',
  EDUCATION_CAMPAIGN_MANAGER: '/education-support/manage',
  FAITH_GIVING: '/faith-community-giving',
  FAITH_GIVING_MANAGE: '/faith-community-giving/manage',
});

// ============================================================================
// Authorization
// ============================================================================

const ADMIN_ROLES = new Set([
  TITECH_ROLES.PLATFORM_ADMIN,
  TITECH_ROLES.TENANT_ADMIN,
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

const EnterpriseAdminDashboard = lazyWithRecovery(
  () => import('../pages/admin/AdminDashboard'),
  'EnterpriseAdminDashboard'
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

const LogoutPage = lazyWithRecovery(
  () => import('../pages/Logout'),
  'LogoutPage'
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

const VerifyEmail = lazyWithRecovery(
  () => import('../pages/VerifyEmail'),
  'VerifyEmail'
);

const AccessGovernance = lazyWithRecovery(
  () => import('../pages/admin/AccessGovernance'),
  'AccessGovernance'
);

const ResetPassword =
  lazyWithRecovery(
    () => import('../pages/ResetPassword'),
    'ResetPassword'
  );

const Legal = lazyWithRecovery(
  () => import('../legal/LegalDocuments.jsx').then((module) => ({ default: module.LegalIndexPage })),
  'Legal'
);

const TermsOfService = lazyWithRecovery(
  () => import('../legal/LegalDocuments.jsx').then((module) => ({ default: module.TermsOfServicePage })),
  'TermsOfService'
);

const PrivacyPolicy = lazyWithRecovery(
  () => import('../legal/LegalDocuments.jsx').then((module) => ({ default: module.PrivacyPolicyPage })),
  'PrivacyPolicy'
);

const Settings = lazyWithRecovery(
  () => import('../pages/Settings'),
  'Settings'
);

const Payroll = lazyWithRecovery(
  () => import('../pages/Payroll'),
  'Payroll'
);

const GroupList = lazyWithRecovery(() => import('../pages/GroupList'), 'GroupList');
const GroupDetails = lazyWithRecovery(() => import('../pages/GroupDetails'), 'GroupDetails');
const CreateGroup = lazyWithRecovery(() => import('../pages/CreateGroupV2'), 'CreateGroup');
const Meetings = lazyWithRecovery(() => import('../pages/meetings/Meetings'), 'Meetings');
const InclusiveOnboardingPage = lazyWithRecovery(() => import('../pages/inclusive-onboarding/InclusiveOnboardingPage'), 'InclusiveOnboardingPage');
const RetirementSupportPage = lazyWithRecovery(() => import('../pages/retirement-support/RetirementSupportPage'), 'RetirementSupportPage');
const EducationSupportPage = lazyWithRecovery(() => import('../pages/education-support/EducationSupportPage'), 'EducationSupportPage');
const EduFinancePage = lazyWithRecovery(() => import('../pages/edufinance/EduFinancePage'), 'EduFinancePage');
const AgriculturePage = lazyWithRecovery(() => import('../pages/agriculture/AgricultureDashboard'), 'AgriculturePage');
const UbuntuFloatPage = lazyWithRecovery(() => import('../pages/ubuntu-float/UbuntuFloatPage'), 'UbuntuFloatPage');
const PartnerSupportPage = lazyWithRecovery(() => import('../pages/PartnerPortal'), 'PartnerSupportPage');
const EducationCampaignManagerPage = lazyWithRecovery(() => import('../pages/education-support/EducationCampaignManagerPage'), 'EducationCampaignManagerPage');
const FaithCommunityGivingPage = lazyWithRecovery(() => import('../pages/faith-community-giving/FaithCommunityGivingPage'), 'FaithCommunityGivingPage');
const FaithGivingManagerPage = lazyWithRecovery(() => import('../pages/faith-community-giving/FaithGivingManagerPage'), 'FaithGivingManagerPage');
const InstitutionalHomePage = lazyWithRecovery(() => import('../pages/public/InstitutionalPublicPages').then((module) => ({ default: module.HomePage })), 'InstitutionalHomePage');
const BookDemoPage = lazyWithRecovery(() => import('../pages/public/InstitutionalPublicPages').then((module) => ({ default: module.BookDemoPage })), 'BookDemoPage');
const ContactUsPage = lazyWithRecovery(() => import('../pages/public/InstitutionalPublicPages').then((module) => ({ default: module.ContactUsPage })), 'ContactUsPage');
const GuidedChatPage = lazyWithRecovery(() => import('../pages/public/InstitutionalPublicPages').then((module) => ({ default: module.GuidedChatPage })), 'GuidedChatPage');

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

function normalizeRole(role) {
  return normalizeTitechRole(role);
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
          from: {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          },
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

const FAITH_GIVING_MANAGER_ROLES = new Set([
  TITECH_ROLES.PLATFORM_ADMIN,
  TITECH_ROLES.TENANT_ADMIN,
  'faith_giving_admin',
  'faith_giving_reviewer',
  'compliance_officer',
  'auditor',
]);

function FaithGivingManagerRoute() {
  const { user, loading } = useAuthentication();
  if (loading) return <RouteLoader />;
  if (!user) return <Navigate to={ROUTES.LOGIN} replace />;
  const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
    .map(normalizeRole)
    .filter(Boolean);
  if (!roles.some((role) => FAITH_GIVING_MANAGER_ROLES.has(role))) {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }
  return <Outlet />;
}

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

  const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
    .map(normalizeRole)
    .filter(Boolean);

  if (!roles.some((role) => ADMIN_ROLES.has(role))) {
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

function PublicSiteLayout() {
  return (
    <>
      <Navbar />
      <Outlet />
    </>
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
      {/* Canonical sign-out route                                            */}
      {/* ================================================================== */}
      {/* Must remain reachable after local sign-out when server revocation is
          unconfirmed, so users can retry without entering protected screens. */}
      <Route
        path={ROUTES.LOGOUT}
        element={<LogoutPage />}
      />

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

        <Route
          path={ROUTES.VERIFY_EMAIL}
          element={<VerifyEmail />}
        />
      </Route>

      {/* ================================================================== */}
      {/* Public legal routes                                                 */}
      {/* ================================================================== */}
      {/*
       * Legal documents remain public even when the user is authenticated.
       */}

      <Route
        path={ROUTES.LEGAL}
        element={<Legal />}
      />

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

      <Route element={<PublicSiteLayout />}>
        <Route path={ROUTES.ROOT} element={<InstitutionalHomePage />} />
        <Route path={ROUTES.BOOK_A_DEMO} element={<BookDemoPage />} />
        <Route path={ROUTES.CONTACT_US} element={<ContactUsPage />} />
        <Route path={ROUTES.CHAT_WITH_TITECH} element={<GuidedChatPage />} />
        <Route path={ROUTES.EDUCATION_SUPPORT} element={<EducationSupportPage />} />
        <Route path={ROUTES.EDUFINANCE} element={<EduFinancePage />} />
        <Route path={ROUTES.FAITH_GIVING} element={<FaithCommunityGivingPage />} />
      </Route>

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

          <Route
            path={ROUTES.PAYROLL}
            element={
              <Payroll />
            }
          />

          <Route path={ROUTES.GROUPS} element={<GroupList />} />
          <Route path={ROUTES.GROUP_DETAILS} element={<GroupDetails />} />
          <Route path={ROUTES.CREATE_GROUP} element={<CreateGroup />} />
          <Route path={ROUTES.LEGACY_CREATE_GROUP} element={<Navigate to={ROUTES.CREATE_GROUP} replace />} />
          <Route path={ROUTES.MEETINGS} element={<Meetings />} />
          <Route path={ROUTES.INCLUSIVE_ONBOARDING} element={<InclusiveOnboardingPage />} />
          <Route path={ROUTES.RETIREMENT_SUPPORT} element={<RetirementSupportPage />} />
          <Route path={ROUTES.AGRICULTURE} element={<AgriculturePage />} />
          <Route path={ROUTES.UBUNTU_FLOAT} element={<UbuntuFloatPage />} />
          <Route path={ROUTES.PARTNER_SUPPORT} element={<PartnerSupportPage />} />
          <Route path={ROUTES.EDUCATION_CAMPAIGN_MANAGER} element={<EducationCampaignManagerPage />} />
          <Route element={<FaithGivingManagerRoute />}><Route path={ROUTES.FAITH_GIVING_MANAGE} element={<FaithGivingManagerPage />} /></Route>

          {/* ============================================================ */}
          {/* Administrative routes                                         */}
          {/* ============================================================ */}

          <Route
            element={
              <AdminRoute />
            }
          >
            <Route
              path={ROUTES.ADMIN}
              element={<EnterpriseAdminDashboard />}
            />

            <Route
              path={ROUTES.SETTINGS}
              element={
                <Settings />
              }
            />

            <Route
              path={ROUTES.ACCESS_GOVERNANCE}
              element={
                <AccessGovernance />
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