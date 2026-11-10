/**
 * Canonical TITech Community Capital navigation registry.
 * Navigation is discovery/presentation only; protected routes and APIs enforce authorization.
 */
import { hasTitechRole, TITECH_ROLES } from '../security/rbacPolicy.js';

export const NAVIGATION_REGISTRY = Object.freeze([
  { id: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: 'LayoutDashboard', access: 'authenticated' },
  { id: 'groups', label: 'Groups', to: '/groups', icon: 'Users', access: 'authenticated' },
  { id: 'createGroup', label: 'Create Group', to: '/create-group', icon: 'UserPlus', access: 'authenticated', roles: [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.TENANT_ADMIN] },
  { id: 'meetings', label: 'Meetings', to: '/meetings', icon: 'CalendarDays', access: 'authenticated' },
  { id: 'inclusiveOnboarding', label: 'Inclusive onboarding', to: '/inclusive-onboarding', icon: 'ShieldCheck', access: 'authenticated' },
  { id: 'retirementSupport', label: 'Retirement support', to: '/retirement-support', icon: 'ShieldCheck', access: 'authenticated' },
  { id: 'educationSupport', label: 'Education support', to: '/education-support', icon: 'GraduationCap', access: 'public' },
  { id: 'eduFinance', label: 'EduFinance', to: '/edufinance', icon: 'GraduationCap', access: 'public' },
  { id: 'agriculture', label: 'Agriculture', to: '/agriculture', icon: 'Sprout', access: 'public' },
  { id: 'ubuntuFloat', label: 'UbuntuFloat', to: '/ubuntu-float', icon: 'Network', access: 'public' },
  { id: 'partnerSupport', label: 'Partner Support', to: '/partner-support', icon: 'LifeBuoy', access: 'public' },
  { id: 'faithGiving', label: 'Faith & Community Giving', to: '/faith-community-giving', icon: 'HeartHandshake', access: 'public' },
  { id: 'faithGivingManage', label: 'Giving administration', to: '/faith-community-giving/manage', icon: 'ShieldCheck', access: 'authenticated', roles: [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.TENANT_ADMIN, 'FAITH_GIVING_ADMIN', 'FAITH_GIVING_REVIEWER', 'COMPLIANCE_OFFICER', 'AUDITOR'] },
]);

export function getNavigationItems(isAuthenticated = false, roles = []) {
  return NAVIGATION_REGISTRY.filter((item) => {
    const accessAllowed = item.access === 'public' || (item.access === 'authenticated' && isAuthenticated);
    const roleAllowed = !item.roles || hasTitechRole(roles, item.roles);
    return accessAllowed && roleAllowed;
  });
}
