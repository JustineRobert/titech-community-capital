import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertUssdSessionTransition,
  normalizeCanonicalUssdRequest,
  normalizeProviderCode,
  serializePlainTextUssdResponse,
  USSD_NETWORKS,
} from '../ussd.contract.js';
import { renderUssdMenu, resolveUssdSelection } from '../ussd.menu.js';
import {
  UssdProviderRegistry,
  validateUssdProviderAdapter,
} from '../ussd.provider-registry.js';

const canonicalPayload = Object.freeze({
  providerSessionId: 'provider-session-001',
  phoneNumber: '+256771123456',
  network: 'MTN',
  serviceCode: '*272#',
  text: '2*1',
  providerRequestId: 'provider-request-001',
});

test('normalizes a canonical provider callback and discards caller tenant/member fields', () => {
  const request = normalizeCanonicalUssdRequest({
    ...canonicalPayload,
    tenantId: 'tenant-attacker',
    memberId: 'member-attacker',
  }, { providerCode: 'aggregator', receivedAt: new Date('2026-11-07T10:00:00.000Z') });

  assert.equal(request.providerCode, 'aggregator');
  assert.equal(request.network, 'MTN');
  assert.equal(request.receivedAt, '2026-11-07T10:00:00.000Z');
  assert.equal('tenantId' in request, false);
  assert.equal('memberId' in request, false);
});

test('requires E.164 MSISDN and does not guess a network from its prefix', () => {
  assert.throws(() => normalizeCanonicalUssdRequest({
    ...canonicalPayload,
    phoneNumber: '0771123456',
  }, { providerCode: 'aggregator' }), /E\.164/);

  const request = normalizeCanonicalUssdRequest({
    ...canonicalPayload,
    network: 'A NETWORK NOT CONFIRMED BY PROVIDER',
  }, { providerCode: 'aggregator' });
  assert.equal(request.network, 'UNKNOWN');
  assert.deepEqual(USSD_NETWORKS, ['MTN', 'AIRTEL', 'OTHER', 'UNKNOWN']);
});

test('rejects incomplete, oversized and malformed provider callback fields', () => {
  assert.throws(() => normalizeCanonicalUssdRequest({ ...canonicalPayload, providerRequestId: '' }, { providerCode: 'aggregator' }));
  assert.throws(() => normalizeCanonicalUssdRequest({ ...canonicalPayload, text: 'x'.repeat(513) }, { providerCode: 'aggregator' }), /limit/);
  assert.throws(() => normalizeProviderCode('../admin'));
});

test('serializes continuation and termination without silently truncating responses', () => {
  assert.equal(serializePlainTextUssdResponse({ action: 'CONTINUE', message: 'Welcome' }), 'CON Welcome');
  assert.equal(serializePlainTextUssdResponse({ action: 'END', message: 'Thank you' }), 'END Thank you');
  assert.throws(() => serializePlainTextUssdResponse({ action: 'END', message: 'x'.repeat(200) }), /exceeds/);
});

test('renders only institution-enabled main-menu features', () => {
  const message = renderUssdMenu('main', { enabledFeatures: ['accounts', 'statements'] });
  assert.match(message, /1\. My Accounts/);
  assert.match(message, /4\. Statements/);
  assert.match(message, /6\. Help/);
  assert.doesNotMatch(message, /2\. Savings/);
  assert.doesNotMatch(message, /3\. Loans/);
});

test('does not activate unreviewed USSD translations', () => {
  assert.throws(() => renderUssdMenu('main', { language: 'sw', enabledFeatures: ['accounts'] }), /human-reviewed English/);
});

test('renders savings submenu only for enabled product capabilities', () => {
  const message = renderUssdMenu('savings', { enabledFeatures: ['savingsRead'] });
  assert.match(message, /1\. Savings Balance/);
  assert.doesNotMatch(message, /Make Contribution/);
});

test('provider registry requires verification, normalization and response serialization contracts', () => {
  const registry = new UssdProviderRegistry();
  const adapter = {
    verifyCallback: async () => true,
    normalizeCallback: async () => canonicalPayload,
    serializeResponse: (response) => `END ${response.message}`,
  };
  assert.equal(validateUssdProviderAdapter(adapter), true);
  registry.register('test-aggregator', adapter);
  assert.equal(typeof registry.get('test-aggregator').verifyCallback, 'function');
  assert.deepEqual(registry.list(), ['test-aggregator']);
  assert.throws(() => registry.register('test-aggregator', adapter), /already registered/);
  assert.throws(() => registry.register('missing-methods', {}), /missing/);
});


test('menu navigation distinguishes back, exit, disabled actions and enabled actions', () => {
  assert.deepEqual(resolveUssdSelection({ menuKey: 'main', input: '0' }).type, 'EXIT');
  assert.deepEqual(resolveUssdSelection({ menuKey: 'savings', input: '0' }), { type: 'BACK', target: 'main' });
  assert.deepEqual(resolveUssdSelection({ menuKey: 'main', input: '2', enabledFeatures: [] }), { type: 'DISABLED' });
  assert.deepEqual(resolveUssdSelection({ menuKey: 'savings', input: '1', enabledFeatures: ['savingsRead'] }), { type: 'ACTION', action: 'savingsRead' });
  assert.deepEqual(resolveUssdSelection({ menuKey: 'savings', input: '9', enabledFeatures: ['savingsRead'] }), { type: 'INVALID' });
});

test('session lifecycle rejects terminal-state resurrection and invalid transitions', () => {
  assert.deepEqual(assertUssdSessionTransition('NEW', 'ACTIVE'), { from: 'NEW', to: 'ACTIVE' });
  assert.deepEqual(assertUssdSessionTransition('AUTHENTICATION_REQUIRED', 'AUTHENTICATED'), { from: 'AUTHENTICATION_REQUIRED', to: 'AUTHENTICATED' });
  assert.throws(() => assertUssdSessionTransition('TERMINATED', 'ACTIVE'), /Invalid USSD session transition/);
  assert.throws(() => assertUssdSessionTransition('UNKNOWN', 'ACTIVE'), /Unknown USSD session state/);
});
