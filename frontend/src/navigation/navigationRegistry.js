/**
 * Canonical TITech Community Capital navigation registry.
 * Navigation is discovery/presentation only; protected routes and APIs enforce authorization.
 */
import { hasTitechRole, TITECH_ROLES } from '../security/rbacPolicy.js';

export const NAVIGATION_REGISTRY = Object.freeze([
  { id: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: 'LayoutDashboard', access: 'authenticated' },
  { id: 'platformBilling', label: 'Billing Control Centre', to: '/platform/billing', icon: 'CreditCard', access: 'authenticated', roles: [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.FINANCE_OFFICER, TITECH_ROLES.FINANCE_AUDITOR] },
  { id: 'institutionBilling', label: 'My Billing', to: '/settings/billing', icon: 'Receipt', access: 'authenticated', roles: [TITECH_ROLES.TENANT_ADMIN] },
  { id: 'financeBilling', label: 'Finance & Collections', to: '/finance/billing-operations', icon: 'FileText', access: 'authenticated', roles: [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.FINANCE_OFFICER, TITECH_ROLES.FINANCE_AUDITOR] },
  { id: 'bankConnect', label: 'BankConnect', to: '/bankconnect', icon: 'Landmark', access: 'authenticated', roles: [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.TENANT_ADMIN], discovery: { discoveryType: 'service', category: 'Bank connectivity and reconciliation', description: 'Institution-scoped bank-account authorization, encrypted statement evidence and reconciliation investigation. Bank API connections and payment execution require formal external approval.', accessLabel: 'Authenticated · institution-admin workspace', requiresAuthentication: true } },
  { id: 'groups', label: 'Groups', to: '/groups', icon: 'Users', access: 'authenticated', discovery: { discoveryType: 'service', category: 'Community finance', description: 'Manage institution-scoped groups and membership. Financial actions remain subject to tenant permissions and the canonical ledger.', accessLabel: 'Authenticated workspace', requiresAuthentication: true } },
  { id: 'createGroup', label: 'Create Group', to: '/create-group', icon: 'UserPlus', access: 'authenticated', roles: [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.TENANT_ADMIN] },
  { id: 'meetings', label: 'Meetings', to: '/meetings', icon: 'CalendarDays', access: 'authenticated' },
  { id: 'inclusiveOnboarding', label: 'Inclusive onboarding', to: '/inclusive-onboarding', icon: 'ShieldCheck', access: 'authenticated', discovery: { discoveryType: 'service', category: 'Inclusion, insurance and protection', description: 'Institution-led onboarding for refugee and host-community participants through legitimate partners. Authorized insurers and approved intermediaries can use institution-scoped licence review, explicit participant consent, enrolment, premium-evidence and claims-reference workflows; underwriting and coverage decisions remain with the authorized insurer.', accessLabel: 'Authenticated · partner-governed · insurer approval required', requiresAuthentication: true } },
  { id: 'retirementSupport', label: 'Retirement support', to: '/retirement-support', icon: 'ShieldCheck', access: 'authenticated', discovery: { discoveryType: 'service', category: 'Institutional services', description: 'Retirement-support case coordination and contribution review. Scheme determinations, insurance, regulated lending and benefit decisions remain with authorized providers.', accessLabel: 'Authenticated · partner-dependent', requiresAuthentication: true } },
  { id: 'educationSupport', label: 'Education support', to: '/education-support', icon: 'GraduationCap', access: 'public', discovery: { discoveryType: 'service', category: 'Education support', description: 'Discover partner-approved education support campaigns. Campaign information does not imply payment collection, custody, receipts or disbursement.', accessLabel: 'Public campaign directory', requiresAuthentication: false } },
  { id: 'eduFinance', label: 'EduFinance', to: '/edufinance', icon: 'GraduationCap', access: 'public', discovery: { discoveryType: 'product', category: 'Education finance', description: 'Coordinate verified school-fee information and guardian applications with authorized lending partners. An application is not a credit approval or disbursement.', accessLabel: 'Public product information', requiresAuthentication: false } },
  { id: 'agriculture', label: 'Agriculture', to: '/agriculture', icon: 'Sprout', access: 'public', discovery: { discoveryType: 'product', category: 'Agriculture', description: 'Institutional workspace for agriculture programmes and operational evidence. Settlement and financial finality are never inferred from reported activity.', accessLabel: 'Authenticated workspace', requiresAuthentication: true } },
  { id: 'ubuntuFloat', label: 'UbuntuFloat', to: '/ubuntu-float', icon: 'Network', access: 'public', discovery: { discoveryType: 'product', category: 'Liquidity infrastructure', description: 'Partner-governed agent-network capability status. Provider balances, advances and live transfers remain gated and are not inferred from interface state.', accessLabel: 'Authenticated · capability-gated', requiresAuthentication: true } },
  { id: 'partnerSupport', label: 'Partner Support', to: '/partner-support', icon: 'LifeBuoy', access: 'public', discovery: { discoveryType: 'service', category: 'Institutional partnerships', description: 'Authorized partner case management, technical issue reporting and contextual onboarding, subject to institutional and account permissions.', accessLabel: 'Authenticated · partner roles', requiresAuthentication: true } },
  { id: 'donations', label: 'Donations', to: '/donations', icon: 'HeartHandshake', access: 'public', discovery: { discoveryType: 'service', category: 'Community giving', description: 'Explore approved community campaigns and non-binding commitments. Campaign discovery does not imply collection, custody, receipts or disbursement.', accessLabel: 'Public campaign directory', requiresAuthentication: false } },
  { id: 'faithGivingManage', label: 'Giving administration', to: '/faith-community-giving/manage', icon: 'ShieldCheck', access: 'authenticated', roles: [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.TENANT_ADMIN, 'FAITH_GIVING_ADMIN', 'FAITH_GIVING_REVIEWER', 'COMPLIANCE_OFFICER', 'AUDITOR'] },
]);

/**
 * Public catalogue data is derived from the canonical navigation registry.
 * It describes discoverability and access paths only, never permission or
 * operational readiness. Backend authorization remains authoritative.
 */
export const PUBLIC_PRODUCT_DISCOVERY = Object.freeze(
  NAVIGATION_REGISTRY
    .filter((item) => item.discovery)
    .map((item) => Object.freeze({ ...item, ...item.discovery })),
);


export function getNavigationItems(isAuthenticated = false, roles = []) {
  return NAVIGATION_REGISTRY.filter((item) => {
    const accessAllowed = item.access === 'public' || (item.access === 'authenticated' && isAuthenticated);
    const roleAllowed = !item.roles || hasTitechRole(roles, item.roles);
    return accessAllowed && roleAllowed;
  });
}
