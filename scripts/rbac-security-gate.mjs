#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canAssignUserRole, canViewGroup, getPermissionsForRole, normalizeRole } from '../backend/security/rbacPolicy.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'backend/security/rbacPolicy.js',
  'backend/services/rbacService.js',
  'backend/middleware/auth.js',
  'backend/routes/rbac.js',
  'backend/controllers/rbacController.js',
  'frontend/src/pages/VerifyEmail.jsx',
  'frontend/src/pages/admin/AccessGovernance.jsx',
  'branding/TITECH_OFFICIAL_THEME.json',
];
const checks=[]; const blockers=[];
function assertPolicy(id, condition) { checks.push({id, status:condition?'PASS':'BLOCKED'}); if(!condition) blockers.push(id); }
assertPolicy('policy:legacy-admin-normalizes', normalizeRole('admin') === 'platform_admin');
assertPolicy('policy:member-no-role-assign', !getPermissionsForRole('member').includes('ROLE_ASSIGN'));
assertPolicy('policy:self-promotion-denied', !canAssignUserRole({id:'a',role:'member',tenantId:'t1'},{id:'a',role:'member',tenantId:'t1'},'tenant_admin').allowed);
assertPolicy('policy:cross-tenant-role-denied', !canAssignUserRole({id:'a',role:'tenant_admin',tenantId:'t1'},{id:'b',role:'member',tenantId:'t2'},'member').allowed);
assertPolicy('policy:cross-tenant-group-view-denied', !canViewGroup({id:'a',role:'tenant_admin',tenantId:'t1'},{tenantId:'t2',memberRoles:[]}));
for (const file of required) { const ok=fs.existsSync(path.join(ROOT,file)) && fs.statSync(path.join(ROOT,file)).size>0; checks.push({id:`exists:${file}`,status:ok?'PASS':'BLOCKED'}); if(!ok) blockers.push(file); }
const auth = fs.readFileSync(path.join(ROOT,'backend/middleware/auth.js'),'utf8');
for (const needle of ["resolveAuthoritativeIdentity", "getPermissionsForRoles", "AUTH_IDENTITY_STORE_UNAVAILABLE"]) { const ok=auth.includes(needle); checks.push({id:`auth:${needle}`,status:ok?'PASS':'BLOCKED'}); if(!ok) blockers.push(`auth:${needle}`); }
const theme=JSON.parse(fs.readFileSync(path.join(ROOT,'branding/TITECH_OFFICIAL_THEME.json'),'utf8'));
const expected=['deepBlue','electricBlue','brightBlue','cyan','africaGreen','limeGreen','goldYellow','navyInk','white'];
for (const key of expected) { const ok=Boolean(theme.palette?.[key]); checks.push({id:`theme:${key}`,status:ok?'PASS':'BLOCKED'}); if(!ok) blockers.push(`theme:${key}`); }
const report={generatedAt:new Date().toISOString(),status:blockers.length?'BLOCKED':'PASS',checks,blockers};
fs.mkdirSync(path.join(ROOT,'reports'),{recursive:true}); fs.writeFileSync(path.join(ROOT,'reports/rbac-security-gate.json'),JSON.stringify(report,null,2)+'\n');
console.log(`RBAC security gate: ${report.status}`); if(blockers.length) { for(const b of blockers) console.log(`BLOCKER: ${b}`); process.exitCode=1; }
