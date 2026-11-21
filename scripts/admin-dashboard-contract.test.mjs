import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildAdminActivityItem, humanizeAuditAction } from '../backend/utils/adminDashboardPresentation.js';
import {
  getAdminDashboardErrorMessage,
  normalizeAdminActivity,
  normalizeAdminStats,
  unwrapAdminDashboardResponse,
} from '../frontend/src/pages/admin/adminDashboardData.mjs';

test('platform dashboard stats preserve real zero and mark absent metrics unavailable', () => {
  const normalized = normalizeAdminStats({
    totalUsers: 0,
    activeUsers: '2',
    activeGroups: 0,
    pendingApprovals: null,
    activeLoans: 3,
    totalSavings: null,
  });
  assert.deepEqual(normalized, {
    totalUsers: 0,
    activeUsers: 2,
    activeGroups: 0,
    pendingApprovals: null,
    activeLoans: 3,
    totalSavings: null,
  });
});

test('dashboard stats normalizer remains compatible with the previous stats envelope', () => {
  assert.equal(normalizeAdminStats({ stats: { totalUsers: 4 } }).totalUsers, 4);
});

test('response unwrapping reads the stable data envelope', () => {
  assert.deepEqual(unwrapAdminDashboardResponse({ data: { success: true, data: { items: [] } } }), { items: [] });
});

test('audit activity DTO contains safe scalar fields and no raw metadata object', () => {
  const item = buildAdminActivityItem({
    _id: 'evt-1', action: 'GROUP_CREATED', userId: 'user-1', entityType: 'group', entityId: 'group-1',
    createdAt: '2026-11-21T10:00:00.000Z', metadata: { privateToken: 'must-not-leak' },
  }, 'Justine', 'Community SACCO');
  assert.equal(item.action, 'GROUP_CREATED');
  assert.equal(item.actor.displayName, 'Justine');
  assert.equal(item.resource.displayName, 'Community SACCO');
  assert.equal(item.createdAt, '2026-11-21T10:00:00.000Z');
  assert.equal(Object.hasOwn(item, 'metadata'), false);
});

test('unknown or malformed activity values do not render as JavaScript object strings', () => {
  const events = normalizeAdminActivity({ items: [{ action: { nested: true }, description: { private: true }, actor: { displayName: 'Admin' }, occurredAt: '2026-11-21T10:00:00.000Z' }] });
  assert.equal(events[0].action, 'Administrative event');
  assert.equal(events[0].description, 'Administrative Event');
  assert.equal(events[0].actor, 'Admin');
  assert.equal(events[0].description.includes('[object Object]'), false);
});

test('audit action names are humanized without exposing arbitrary objects', () => {
  assert.equal(humanizeAuditAction('PAYMENT_INITIATED'), 'Payment Initiated');
  assert.equal(humanizeAuditAction({ raw: true }), 'System Event');
});

test('structured API errors are converted to display-safe strings', () => {
  assert.equal(getAdminDashboardErrorMessage({ response: { data: { error: { code: 'DENIED', message: 'Access denied.' } } } }), 'Access denied.');
  assert.equal(getAdminDashboardErrorMessage({ response: { data: { error: { private: true } } } }), 'Unable to load dashboard data.');
});


const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('administrative activity endpoint is protected and reads the canonical append-only audit source', () => {
  const routeSource = readFileSync(resolve(repositoryRoot, 'backend/routes/platformDashboard.js'), 'utf8');
  assert.match(routeSource, /router\.use\(authenticate, platformAdmin\)/);
  assert.match(routeSource, /router\.get\('\/activity'/);
  assert.match(routeSource, /AuditLog\.find\(filter\)/);
  assert.match(routeSource, /AuditLog\.countDocuments\(filter\)/);
  assert.match(routeSource, /\.select\('_id action userId tenantId entityType entityId createdAt'\)/);
  assert.doesNotMatch(routeSource, /\.select\([^)]*metadata/);
});

test('admin statistics never turn unavailable ledger or approval metrics into fabricated zeroes', () => {
  const routeSource = readFileSync(resolve(repositoryRoot, 'backend/routes/platformDashboard.js'), 'utf8');
  assert.match(routeSource, /pendingApprovals: null/);
  assert.match(routeSource, /totalSavings: null/);
  assert.match(routeSource, /dataAvailability/);
  assert.match(routeSource, /A verified platform-wide ledger account aggregation is not configured/);
});
