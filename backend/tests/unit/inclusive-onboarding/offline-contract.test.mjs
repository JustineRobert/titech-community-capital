import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import theme from '../../../../branding/TITECH_OFFICIAL_THEME.json' with { type: 'json' };
import { OfflineSyncService } from '../../../modules/offline/services/offlineSyncService.js';
import { createOfflineEvent } from '../../../../frontend/src/offline/browserOutbox.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const offlineRuntimeFiles = [
  '../../../modules/offline/models/OfflineDevice.js',
  '../../../modules/offline/models/OfflineEvent.js',
  '../../../modules/offline/services/offlineDeviceService.js',
  '../../../modules/offline/services/offlineReceiptService.js',
  '../../../modules/offline/services/offlineSyncService.js',
];

test('offline runtime modules use ESM instead of CommonJS exports inside the ESM backend', async () => {
  const sources = await Promise.all(offlineRuntimeFiles.map(read));
  for (const source of sources) {
    assert.doesNotMatch(source, /^\s*module\.exports\s*=/m);
    assert.doesNotMatch(source, /^\s*(?:const|let|var)\s+\w+\s*=\s*require\(/m);
  }
});

test('offline frontend and backend resolve to one canonical versioned API contract', async () => {
  const registry = await read('../../../routes/index.js');
  const routes = await read('../../../modules/offline/routes/offline-sync.routes.js');
  const hook = await read('../../../../frontend/src/hooks/useOfflineSync.js');
  const controller = await read('../../../modules/offline/controllers/offlineSyncController.js');
  assert.match(registry, /\$\{API_PREFIX\}\/offline[\s\S]{0,100}authenticate[\s\S]{0,100}tenantAuthorization/);
  assert.match(routes, /const SYNC_ENDPOINT\s*=\s*'\/sync'/);
  assert.match(routes, /const STATUS_ENDPOINT\s*=\s*'\/sync\/status'/);
  assert.match(hook, /const SYNC_ENDPOINT = '\/api\/v1\/offline\/sync'/);
  assert.match(hook, /const STATUS_ENDPOINT = '\/api\/v1\/offline\/sync\/status'/);
  assert.match(controller, /const DEFAULT_SYNC_PATH = '\/api\/v1\/offline\/sync'/);
  assert.match(controller, /tenantId: context\.tenantId/);
  assert.match(controller, /deviceToken: getHeader\(req, 'X-Device-Secret'\)/);
  assert.doesNotMatch(controller, /request: req/);
});

test('offline event routes have server-side enablement, action RBAC, device trust and readiness gates', async () => {
  const routes = await read('../../../modules/offline/routes/offline-sync.routes.js');
  assert.match(routes, /requireCapabilityFlag\('TITECH_OFFLINE_SYNC_ENABLED'\)/);
  assert.match(routes, /requirePermission\('offline:sync:submit'\)/);
  assert.match(routes, /function requireOfflineSyncReady\(/);
  assert.match(routes, /service\.authenticateDevice\(/);
  const syncService = await read('../../../modules/offline/services/offlineSyncService.js');
  assert.match(syncService, /deviceFingerprint,\s*keyId: deviceKeyId/);
  assert.match(syncService, /typeof this\.offlineDeviceService\.verifyEventSignature === 'function'/);
  assert.match(routes, /OFFLINE_DEVICE_CREDENTIALS_REQUIRED/);
  assert.match(routes, /OFFLINE_SYNC_TENANT_MISMATCH/);
  assert.doesNotMatch(routes, /const authenticateDevice\s*=\s*optionalMiddleware/);
  assert.doesNotMatch(routes, /const authorizeOfflineSync\s*=\s*optionalMiddleware/);
  assert.match(routes, /readiness\?\.status === 'READY'/);
});

test('browser/server offline event hash conformance excludes only outbox delivery metadata', async () => {
  const event = await createOfflineEvent({
    eventType: 'MEMBER_UPDATED',
    payload: { name: 'Émilie', details: { city: 'Kampala', verified: false } },
    tenantId: 'tenant-a',
    deviceId: 'device-a',
    userId: 'user-a',
    aggregateType: 'member',
    aggregateId: 'member-a',
    sequenceNumber: 7,
    idempotencyKey: 'event-idempotency-a',
  });
  const service = new OfflineSyncService();
  const context = { tenantId: 'tenant-a', deviceId: 'device-a' };
  const reorderedPayload = { verified: false, city: 'Kampala' };
  const withDeliveryChanges = {
    ...event,
    payload: { details: reorderedPayload, name: 'Émilie' },
    status: 'SYNCING',
    attempts: 3,
    createdAt: event.createdAt + 1,
    updatedAt: event.updatedAt + 9,
    lastError: 'network retry',
  };
  assert.equal(service.validateEvent(withDeliveryChanges, context).eventHash, event.eventHash);
  assert.throws(
    () => service.validateEvent({ ...event, payload: { name: 'Tampered', details: { city: 'Kampala', verified: false } } }, context),
    { code: 'OFFLINE_SYNC_EVENT_CONFLICT', statusCode: 409 },
  );
  assert.throws(
    () => service.validateEvent({ ...event, eventVersion: 2 }, context),
    { code: 'OFFLINE_SYNC_EVENT_INVALID', statusCode: 400 },
  );
  assert.throws(
    () => service.validateEvent({ ...event, unexpectedPrivilege: true }, context),
    { code: 'OFFLINE_SYNC_EVENT_CONFLICT', statusCode: 409 },
  );
});

test('an unconfigured offline service reports NOT_READY and financial events fail closed', async () => {
  const service = new OfflineSyncService();
  assert.equal(await service.ready(), false);
  const health = service.health();
  assert.equal(health.status, 'NOT_READY');
  assert.ok(health.blockers.length >= 1);
  assert.ok(health.blockers.includes('offlineDeviceService'));
  await assert.rejects(
    service.validateDevice({ tenantId: 'tenant-test', deviceId: 'device-test' }),
    { code: 'OFFLINE_SYNC_DEVICE_INVALID', statusCode: 503 },
  );
  const noDeviceRegistrationBypass = new OfflineSyncService({ config: { requireDeviceRegistration: false } });
  assert.equal(noDeviceRegistrationBypass.config.requireDeviceRegistration, true);
  await assert.rejects(
    noDeviceRegistrationBypass.validateDevice({ tenantId: 'tenant-test', deviceId: 'device-test' }),
    { code: 'OFFLINE_SYNC_DEVICE_INVALID', statusCode: 503 },
  );
  await assert.rejects(
    service.processFinancialEvent({
      eventType: 'PAYMENT', tenantId: 'tenant-test', deviceId: 'device-test',
      eventId: 'event-test', idempotencyKey: 'idempotency-test',
    }, {}),
    { code: 'OFFLINE_SYNC_FINANCIAL_AUTHORIZATION_REQUIRED', statusCode: 503 },
  );
});

test('official theme identity and palette remain canonical for TITech Capital LTD', () => {
  assert.equal(theme.organization, 'TITech Capital LTD');
  assert.equal(theme.product, 'TITech Community Capital');
  assert.equal(theme.defaultTheme, 'light');
  assert.deepEqual(theme.palette, {
    deepBlue: '#0030A0',
    electricBlue: '#0058D8',
    brightBlue: '#0066E8',
    cyan: '#00B8F8',
    africaGreen: '#008000',
    limeGreen: '#A8F000',
    goldYellow: '#F8D800',
    navyInk: '#082B67',
    white: '#FFFFFF',
  });
});
