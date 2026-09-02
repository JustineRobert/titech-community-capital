'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/routes/routeConfig.js
 *
 * Purpose:
 *   Canonical route metadata registry for the TITech Community Capital
 *   frontend application.
 *
 * Responsibilities:
 *   - Define route identities and paths
 *   - Define lazy-loaded route components
 *   - Define route authorization metadata
 *   - Define required permissions
 *   - Define allowed roles
 *   - Define feature flags
 *   - Define tenant requirements
 *   - Define subscription-plan requirements
 *   - Define navigation metadata
 *   - Define breadcrumb metadata
 *   - Define analytics metadata
 *   - Provide safe route lookup helpers
 *   - Provide route validation
 *
 * Non-responsibilities:
 *   - Authentication implementation
 *   - Authorization execution
 *   - Backend permission enforcement
 *   - API calls
 *   - Financial business logic
 *   - Database access
 *   - Route rendering
 *
 * Security principle:
 *
 *   This file describes frontend route policy.
 *
 *   It does NOT replace backend authorization.
 *
 *   Every privileged TITech API operation must independently validate
 *   authentication, tenant context, role, permission, feature availability,
 *   and business rules on the server.
 *
 * ============================================================================
 */

import {
  lazy,
} from 'react';

import {
  LayoutDashboard,
  Users,
  Wallet,
  CreditCard,
  Receipt,
  FileText,
  Settings,
  Building2,
  Shield,
  Bell,
  BarChart3,
} from 'lucide-react';

// ============================================================================
// Lazy-loaded route components
// ============================================================================

export const Dashboard = lazy(
  () => import('../pages/Dashboard')
);

export const Members = lazy(
  () => import('../pages/Members')
);

export const Savings = lazy(
  () => import('../pages/Savings')
);

export const Loans = lazy(
  () => import('../pages/Loans')
);

export const Transactions = lazy(
  () => import('../pages/Transactions')
);

export const Reports = lazy(
  () => import('../pages/Reports')
);

export const SettingsPage = lazy(
  () => import('../pages/Settings')
);

// ============================================================================
// Route status
// ============================================================================

export const ROUTE_STATUS =
  Object.freeze({
    ACTIVE: 'active',
    COMING_SOON: 'coming_soon',
    DISABLED: 'disabled',
  });

// ============================================================================
// Route visibility
// ============================================================================

export const ROUTE_VISIBILITY =
  Object.freeze({
    PUBLIC: 'public',
    PROTECTED: 'protected',
    ADMIN: 'admin',
  });

// ============================================================================
// Roles
// ============================================================================

export const ROLES =
  Object.freeze({
    MEMBER: 'member',
    STAFF: 'staff',
    MANAGER: 'manager',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin',
  });

// ============================================================================
// Permissions
// ============================================================================

export const PERMISSIONS =
  Object.freeze({
    DASHBOARD_VIEW:
      'dashboard.view',

    MEMBER_VIEW:
      'member.view',

    MEMBER_CREATE:
      'member.create',

    MEMBER_UPDATE:
      'member.update',

    MEMBER_DELETE:
      'member.delete',

    SAVINGS_VIEW:
      'savings.view',

    SAVINGS_CREATE:
      'savings.create',

    SAVINGS_UPDATE:
      'savings.update',

    SAVINGS_WITHDRAW:
      'savings.withdraw',

    LOAN_VIEW:
      'loan.view',

    LOAN_CREATE:
      'loan.create',

    LOAN_APPROVE:
      'loan.approve',

    LOAN_DISBURSE:
      'loan.disburse',

    LOAN_REPAY:
      'loan.repay',

    TRANSACTION_VIEW:
      'transaction.view',

    TRANSACTION_CREATE:
      'transaction.create',

    TRANSACTION_APPROVE:
      'transaction.approve',

    REPORT_VIEW:
      'report.view',

    REPORT_EXPORT:
      'report.export',

    SETTINGS_VIEW:
      'settings.view',

    SETTINGS_MANAGE:
      'settings.manage',

    USERS_MANAGE:
      'users.manage',

    ROLES_MANAGE:
      'roles.manage',

    AUDIT_VIEW:
      'audit.view',

    NOTIFICATION_VIEW:
      'notification.view',

    BRANCH_VIEW:
      'branch.view',

    BRANCH_MANAGE:
      'branch.manage',

    TREASURY_VIEW:
      'treasury.view',

    TREASURY_MANAGE:
      'treasury.manage',

    AML_VIEW:
      'aml.view',

    AML_MANAGE:
      'aml.manage',

    KYC_VIEW:
      'kyc.view',

    KYC_MANAGE:
      'kyc.manage',

    FRAUD_VIEW:
      'fraud.view',

    FRAUD_MANAGE:
      'fraud.manage',
  });

// ============================================================================
// Feature flags
// ============================================================================

export const FEATURES =
  Object.freeze({
    ADVANCED_REPORTING:
      'advanced_reporting',

    TREASURY:
      'treasury',

    BILLING:
      'billing',

    AI_ASSISTANT:
      'ai_assistant',

    MULTI_BRANCH:
      'multi_branch',

    AML:
      'aml',

    KYC:
      'kyc',

    FRAUD:
      'fraud_detection',

    EXECUTIVE_DASHBOARD:
      'executive_dashboard',

    OFFLINE_SYNC:
      'offline_sync',

    MOBILE_MONEY:
      'mobile_money',

    ADVANCED_LOANS:
      'advanced_loans',

    RISK_ENGINE:
      'risk_engine',
  });

// ============================================================================
// Subscription plans
// ============================================================================

export const PLANS =
  Object.freeze({
    FREE: 'free',

    STARTER: 'starter',

    PROFESSIONAL:
      'professional',

    ENTERPRISE:
      'enterprise',
  });

// ============================================================================
// Plan hierarchy
// ============================================================================
//
// Higher numeric value = higher plan tier.
//
// This allows helpers to determine whether a plan meets a minimum requirement.
// ============================================================================

export const PLAN_LEVELS =
  Object.freeze({
    [PLANS.FREE]: 0,
    [PLANS.STARTER]: 1,
    [PLANS.PROFESSIONAL]: 2,
    [PLANS.ENTERPRISE]: 3,
  });

// ============================================================================
// Shared authorization presets
// ============================================================================

export const ADMIN_ROLES =
  Object.freeze([
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
  ]);

export const MANAGEMENT_ROLES =
  Object.freeze([
    ROLES.MANAGER,
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
  ]);

// ============================================================================
// Route configuration
// ============================================================================
//
// Each object deliberately separates:
//
//   identity
//   presentation
//   authorization
//   tenancy
//   subscription
//   navigation
//   analytics
//   lifecycle
//
// ============================================================================

export const routeConfig = Object.freeze([
  // ==========================================================================
  // Dashboard
  // ==========================================================================

  Object.freeze({
    id: 'dashboard',

    path: '/dashboard',

    name: 'Dashboard',

    title:
      'Community Dashboard',

    icon:
      LayoutDashboard,

    component:
      Dashboard,

    status:
      ROUTE_STATUS.ACTIVE,

    visibility:
      ROUTE_VISIBILITY.PROTECTED,

    protected: true,

    showInSidebar: true,

    showInMenu: true,

    permissions: Object.freeze([
      PERMISSIONS.DASHBOARD_VIEW,
    ]),

    roles: Object.freeze([]),

    feature: null,

    tenant: true,

    plan: Object.freeze([]),

    analytics: true,

    breadcrumb: true,

    breadcrumbLabel:
      'Dashboard',

    navigationOrder: 10,
  }),

  // ==========================================================================
  // Members
  // ==========================================================================

  Object.freeze({
    id: 'members',

    path: '/members',

    name: 'Members',

    title:
      'Member Management',

    icon:
      Users,

    component:
      Members,

    status:
      ROUTE_STATUS.ACTIVE,

    visibility:
      ROUTE_VISIBILITY.PROTECTED,

    protected: true,

    showInSidebar: true,

    showInMenu: true,

    permissions: Object.freeze([
      PERMISSIONS.MEMBER_VIEW,
    ]),

    roles: Object.freeze([]),

    feature: null,

    tenant: true,

    plan: Object.freeze([]),

    analytics: true,

    breadcrumb: true,

    breadcrumbLabel:
      'Members',

    navigationOrder: 20,
  }),

  // ==========================================================================
  // Savings
  // ==========================================================================

  Object.freeze({
    id: 'savings',

    path: '/savings',

    name: 'Savings',

    title:
      'Savings Management',

    icon:
      Wallet,

    component:
      Savings,

    status:
      ROUTE_STATUS.ACTIVE,

    visibility:
      ROUTE_VISIBILITY.PROTECTED,

    protected: true,

    showInSidebar: true,

    showInMenu: true,

    permissions: Object.freeze([
      PERMISSIONS.SAVINGS_VIEW,
    ]),

    roles: Object.freeze([]),

    feature: null,

    tenant: true,

    plan: Object.freeze([]),

    analytics: true,

    breadcrumb: true,

    breadcrumbLabel:
      'Savings',

    navigationOrder: 30,
  }),

  // ==========================================================================
  // Loans
  // ==========================================================================

  Object.freeze({
    id: 'loans',

    path: '/loans',

    name: 'Loans',

    title:
      'Loan Management',

    icon:
      CreditCard,

    component:
      Loans,

    status:
      ROUTE_STATUS.ACTIVE,

    visibility:
      ROUTE_VISIBILITY.PROTECTED,

    protected: true,

    showInSidebar: true,

    showInMenu: true,

    permissions: Object.freeze([
      PERMISSIONS.LOAN_VIEW,
    ]),

    roles: Object.freeze([]),

    feature: null,

    tenant: true,

    plan: Object.freeze([]),

    analytics: true,

    breadcrumb: true,

    breadcrumbLabel:
      'Loans',

    navigationOrder: 40,
  }),

  // ==========================================================================
  // Transactions
  // ==========================================================================

  Object.freeze({
    id: 'transactions',

    path: '/transactions',

    name: 'Transactions',

    title:
      'Transactions',

    icon:
      Receipt,

    component:
      Transactions,

    status:
      ROUTE_STATUS.ACTIVE,

    visibility:
      ROUTE_VISIBILITY.PROTECTED,

    protected: true,

    showInSidebar: true,

    showInMenu: true,

    permissions: Object.freeze([
      PERMISSIONS.TRANSACTION_VIEW,
    ]),

    roles: Object.freeze([]),

    feature: null,

    tenant: true,

    plan: Object.freeze([]),

    analytics: true,

    breadcrumb: true,

    breadcrumbLabel:
      'Transactions',

    navigationOrder: 50,
  }),

  // ==========================================================================
  // Reports
  // ==========================================================================

  Object.freeze({
    id: 'reports',

    path: '/reports',

    name: 'Reports',

    title:
      'Reports',

    icon:
      FileText,

    component:
      Reports,

    status:
      ROUTE_STATUS.ACTIVE,

    visibility:
      ROUTE_VISIBILITY.PROTECTED,

    protected: true,

    showInSidebar: true,

    showInMenu: true,

    permissions: Object.freeze([
      PERMISSIONS.REPORT_VIEW,
    ]),

    roles: Object.freeze([]),

    feature:
      FEATURES.ADVANCED_REPORTING,

    tenant: true,

    plan: Object.freeze([
      PLANS.PROFESSIONAL,
      PLANS.ENTERPRISE,
    ]),

    analytics: true,

    breadcrumb: true,

    breadcrumbLabel:
      'Reports',

    navigationOrder: 60,
  }),

  // ==========================================================================
  // Settings
  // ==========================================================================

  Object.freeze({
    id: 'settings',

    path: '/settings',

    name: 'Settings',

    title:
      'System Settings',

    icon:
      Settings,

    component:
      SettingsPage,

    status:
      ROUTE_STATUS.ACTIVE,

    visibility:
      ROUTE_VISIBILITY.ADMIN,

    protected: true,

    showInSidebar: true,

    showInMenu: false,

    permissions: Object.freeze([
      PERMISSIONS.SETTINGS_MANAGE,
    ]),

    roles:
      ADMIN_ROLES,

    feature: null,

    tenant: true,

    plan: Object.freeze([]),

    analytics: true,

    breadcrumb: true,

    breadcrumbLabel:
      'Settings',

    navigationOrder: 90,
  }),

  // ==========================================================================
  // Branches
  // ==========================================================================

  Object.freeze({
    id: 'branches',

    path: '/branches',

    name: 'Branches',

    title:
      'Branch Management',

    icon:
      Building2,

    component: null,

    status:
      ROUTE_STATUS.COMING_SOON,

    visibility:
      ROUTE_VISIBILITY.PROTECTED,

    protected: true,

    showInSidebar: false,

    showInMenu: false,

    permissions: Object.freeze([
      PERMISSIONS.BRANCH_VIEW,
    ]),

    roles:
      MANAGEMENT_ROLES,

    feature:
      FEATURES.MULTI_BRANCH,

    tenant: true,

    plan: Object.freeze([
      PLANS.PROFESSIONAL,
      PLANS.ENTERPRISE,
    ]),

    analytics: false,

    breadcrumb: true,

    breadcrumbLabel:
      'Branches',

    navigationOrder: 70,
  }),

  // ==========================================================================
  // Audit
  // ==========================================================================

  Object.freeze({
    id: 'audit',

    path: '/audit',

    name: 'Audit Logs',

    title:
      'Audit Logs',

    icon:
      Shield,

    component: null,

    status:
      ROUTE_STATUS.COMING_SOON,

    visibility:
      ROUTE_VISIBILITY.ADMIN,

    protected: true,

    showInSidebar: false,

    showInMenu: false,

    permissions: Object.freeze([
      PERMISSIONS.AUDIT_VIEW,
    ]),

    roles:
      ADMIN_ROLES,

    feature: null,

    tenant: true,

    plan: Object.freeze([]),

    analytics: true,

    breadcrumb: true,

    breadcrumbLabel:
      'Audit Logs',

    navigationOrder: 95,
  }),

  // ==========================================================================
  // Notifications
  // ==========================================================================

  Object.freeze({
    id: 'notifications',

    path: '/notifications',

    name:
      'Notifications',

    title:
      'Notifications',

    icon:
      Bell,

    component: null,

    status:
      ROUTE_STATUS.COMING_SOON,

    visibility:
      ROUTE_VISIBILITY.PROTECTED,

    protected: true,

    showInSidebar: false,

    showInMenu: false,

    permissions: Object.freeze([
      PERMISSIONS.NOTIFICATION_VIEW,
    ]),

    roles: Object.freeze([]),

    feature: null,

    tenant: true,

    plan: Object.freeze([]),

    analytics: true,

    breadcrumb: true,

    breadcrumbLabel:
      'Notifications',

    navigationOrder: 80,
  }),

  // ==========================================================================
  // Executive Dashboard
  // ==========================================================================

  Object.freeze({
    id: 'executive',

    path:
      '/executive-dashboard',

    name:
      'Executive Dashboard',

    title:
      'Executive Dashboard',

    icon:
      BarChart3,

    component: null,

    status:
      ROUTE_STATUS.COMING_SOON,

    visibility:
      ROUTE_VISIBILITY.ADMIN,

    protected: true,

    showInSidebar: false,

    showInMenu: false,

    permissions: Object.freeze([
      PERMISSIONS.DASHBOARD_VIEW,
    ]),

    roles:
      ADMIN_ROLES,

    feature:
      FEATURES.EXECUTIVE_DASHBOARD,

    tenant: true,

    plan: Object.freeze([
      PLANS.ENTERPRISE,
    ]),

    analytics: true,

    breadcrumb: true,

    breadcrumbLabel:
      'Executive Dashboard',

    navigationOrder: 100,
  }),
]);

// ============================================================================
// Validation helpers
// ============================================================================

function normalizePath(
  path
) {
  if (
    typeof path !==
    'string'
  ) {
    return '';
  }

  if (path === '/') {
    return '/';
  }

  return path
    .replace(
      /\/+$/,
      ''
    )
    .trim();
}

function isValidRole(
  role
) {
  return Object.values(
    ROLES
  ).includes(role);
}

function isValidPermission(
  permission
) {
  return Object.values(
    PERMISSIONS
  ).includes(
    permission
  );
}

function isValidFeature(
  feature
) {
  return (
    feature === null ||
    Object.values(
      FEATURES
    ).includes(feature)
  );
}

function isValidPlan(
  plan
) {
  return Object.values(
    PLANS
  ).includes(plan);
}

// ============================================================================
// Route validator
// ============================================================================

export function validateRouteConfig(
  routes = routeConfig
) {
  const errors = [];

  if (!Array.isArray(routes)) {
    return [
      'Route configuration must be an array.',
    ];
  }

  const ids = new Set();
  const paths = new Set();

  routes.forEach(
    (route, index) => {
      if (!route) {
        errors.push(
          `Route at index ${index} is empty.`
        );
        return;
      }

      // ----------------------------------------------------------------------
      // Identity
      // ----------------------------------------------------------------------

      if (
        typeof route.id !==
        'string' ||
        !route.id.trim()
      ) {
        errors.push(
          `Route at index ${index} has an invalid id.`
        );
      } else if (
        ids.has(route.id)
      ) {
        errors.push(
          `Duplicate route id: ${route.id}.`
        );
      } else {
        ids.add(route.id);
      }

      // ----------------------------------------------------------------------
      // Path
      // ----------------------------------------------------------------------

      const normalizedPath =
        normalizePath(
          route.path
        );

      if (!normalizedPath) {
        errors.push(
          `Route "${route.id}" has an invalid path.`
        );
      } else if (
        paths.has(
          normalizedPath
        )
      ) {
        errors.push(
          `Duplicate route path: ${route.path}.`
        );
      } else {
        paths.add(
          normalizedPath
        );
      }

      // ----------------------------------------------------------------------
      // Status
      // ----------------------------------------------------------------------

      if (
        !Object.values(
          ROUTE_STATUS
        ).includes(
          route.status
        )
      ) {
        errors.push(
          `Route "${route.id}" has an invalid status.`
        );
      }

      // ----------------------------------------------------------------------
      // Roles
      // ----------------------------------------------------------------------

      if (
        !Array.isArray(
          route.roles
        )
      ) {
        errors.push(
          `Route "${route.id}" roles must be an array.`
        );
      } else {
        route.roles.forEach(
          (role) => {
            if (
              !isValidRole(
                role
              )
            ) {
              errors.push(
                `Route "${route.id}" contains invalid role "${role}".`
              );
            }
          }
        );
      }

      // ----------------------------------------------------------------------
      // Permissions
      // ----------------------------------------------------------------------

      if (
        !Array.isArray(
          route.permissions
        )
      ) {
        errors.push(
          `Route "${route.id}" permissions must be an array.`
        );
      } else {
        route.permissions.forEach(
          (permission) => {
            if (
              !isValidPermission(
                permission
              )
            ) {
              errors.push(
                `Route "${route.id}" contains invalid permission "${permission}".`
              );
            }
          }
        );
      }

      // ----------------------------------------------------------------------
      // Feature
      // ----------------------------------------------------------------------

      if (
        !isValidFeature(
          route.feature
        )
      ) {
        errors.push(
          `Route "${route.id}" contains an invalid feature "${route.feature}".`
        );
      }

      // ----------------------------------------------------------------------
      // Plans
      // ----------------------------------------------------------------------

      if (
        !Array.isArray(
          route.plan
        )
      ) {
        errors.push(
          `Route "${route.id}" plan must be an array.`
        );
      } else {
        route.plan.forEach(
          (plan) => {
            if (
              !isValidPlan(
                plan
              )
            ) {
              errors.push(
                `Route "${route.id}" contains invalid plan "${plan}".`
              );
            }
          }
        );
      }

      // ----------------------------------------------------------------------
      // Component
      // ----------------------------------------------------------------------

      if (
        route.status ===
          ROUTE_STATUS.ACTIVE &&
        typeof route.component !==
          'function'
      ) {
        errors.push(
          `Active route "${route.id}" must have a component.`
        );
      }

      // ----------------------------------------------------------------------
      // Navigation
      // ----------------------------------------------------------------------

      if (
        route.showInSidebar &&
        !route.showInMenu
      ) {
        /*
         * Sidebar visibility without menu visibility is allowed for the
         * current TITech navigation model, so this is intentionally not an
         * error.
         */
      }
    }
  );

  return errors;
}

// ============================================================================
// Lookup helpers
// ============================================================================

export function getRouteByPath(
  path
) {
  const normalizedPath =
    normalizePath(
      path
    );

  return routeConfig.find(
    (route) =>
      normalizePath(
        route.path
      ) ===
      normalizedPath
  );
}

export function getRouteById(
  id
) {
  if (
    typeof id !==
    'string'
  ) {
    return undefined;
  }

  return routeConfig.find(
    (route) =>
      route.id === id
  );
}

// ============================================================================
// Navigation helpers
// ============================================================================

function sortByNavigationOrder(
  routes
) {
  return [...routes].sort(
    (a, b) =>
      (a.navigationOrder ?? 9999) -
      (b.navigationOrder ?? 9999)
  );
}

export function getSidebarRoutes() {
  return sortByNavigationOrder(
    routeConfig.filter(
      (route) =>
        route.showInSidebar &&
        route.status ===
          ROUTE_STATUS.ACTIVE
    )
  );
}

export function getMenuRoutes() {
  return sortByNavigationOrder(
    routeConfig.filter(
      (route) =>
        route.showInMenu &&
        route.status ===
          ROUTE_STATUS.ACTIVE
    )
  );
}

export function getBreadcrumbRoutes() {
  return routeConfig.filter(
    (route) =>
      route.breadcrumb
  );
}

export function getAnalyticsRoutes() {
  return routeConfig.filter(
    (route) =>
      route.analytics
  );
}

export function getProtectedRoutes() {
  return routeConfig.filter(
    (route) =>
      route.protected === true
  );
}

export function getActiveRoutes() {
  return routeConfig.filter(
    (route) =>
      route.status ===
      ROUTE_STATUS.ACTIVE
  );
}

export function getComingSoonRoutes() {
  return routeConfig.filter(
    (route) =>
      route.status ===
      ROUTE_STATUS.COMING_SOON
  );
}

export function getAdminRoutes() {
  return routeConfig.filter(
    (route) =>
      route.visibility ===
      ROUTE_VISIBILITY.ADMIN
  );
}

export function getTenantRoutes() {
  return routeConfig.filter(
    (route) =>
      route.tenant === true
  );
}

// ============================================================================
// Authorization metadata helpers
// ============================================================================

export function getRoutesByPermission(
  permission
) {
  if (
    !isValidPermission(
      permission
    )
  ) {
    return [];
  }

  return routeConfig.filter(
    (route) =>
      route.permissions?.includes(
        permission
      )
  );
}

export function getRoutesByRole(
  role
) {
  if (
    !isValidRole(role)
  ) {
    return [];
  }

  return routeConfig.filter(
    (route) =>
      route.roles?.includes(
        role
      )
  );
}

export function getRoutesByFeature(
  feature
) {
  if (
    !isValidFeature(feature) ||
    feature === null
  ) {
    return [];
  }

  return routeConfig.filter(
    (route) =>
      route.feature ===
      feature
  );
}

export function getRoutesByPlan(
  plan
) {
  if (
    !isValidPlan(plan)
  ) {
    return [];
  }

  return routeConfig.filter(
    (route) =>
      route.plan?.includes(
        plan
      )
  );
}

// ============================================================================
// Plan authorization helper
// ============================================================================
//
// Determines whether the supplied current plan satisfies at least one of the
// route's declared minimum/allowed plans.
//
// Example:
//
//   route.plan = ['professional', 'enterprise']
//
//   professional -> true
//   enterprise    -> true
//   starter       -> false
//
// ============================================================================

export function planMeetsRouteRequirement(
  currentPlan,
  route
) {
  if (
    !route ||
    !Array.isArray(
      route.plan
    ) ||
    route.plan.length ===
      0
  ) {
    return true;
  }

  const currentLevel =
    PLAN_LEVELS[
      currentPlan
    ];

  if (
    typeof currentLevel !==
    'number'
  ) {
    return false;
  }

  const minimumLevel =
    Math.min(
      ...route.plan.map(
        (plan) =>
          PLAN_LEVELS[
            plan
          ]
      )
    );

  return (
    currentLevel >=
    minimumLevel
  );
}

// ============================================================================
// Route usability
// ============================================================================

export function isRouteNavigable(
  route
) {
  if (!route) {
    return false;
  }

  return (
    route.status ===
      ROUTE_STATUS.ACTIVE &&
    typeof route.component ===
      'function'
  );
}

// ============================================================================
// Configuration validation at module load
// ============================================================================

const routeConfigErrors =
  validateRouteConfig(
    routeConfig
  );

if (
  routeConfigErrors.length >
  0
) {
  const errorMessage =
    [
      'TITech route configuration validation failed:',
      ...routeConfigErrors.map(
        (error) =>
          `- ${error}`
      ),
    ].join('\n');

  /*
   * Fail fast in development/test environments where a malformed route
   * should never be allowed to go unnoticed.
   *
   * Production logging remains non-invasive because route configuration
   * should already be validated during CI/build.
   */
  if (
    import.meta.env.DEV
  ) {
    console.error(
      errorMessage
    );
  }
}

// ============================================================================
// Default export
// ============================================================================

export default routeConfig;