import http from 'k6/http';
import { check, sleep } from 'k6';

// Read-only capacity workload for a dedicated TITech test/staging environment.
// It deliberately does not create identity records, insurance obligations,
// claims, payment requests, ledger entries, or any other business mutations.

const BASE_URL = String(__ENV.TITECH_PERF_BASE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const ENVIRONMENT = String(__ENV.TITECH_PERF_ENVIRONMENT || 'local').trim().toLowerCase();
const PROFILE_NAME = String(__ENV.TITECH_PERF_PROFILE || 'smoke').trim().toLowerCase();
const APPROVAL_ID = String(__ENV.TITECH_PERF_APPROVAL_ID || '').trim();
const APPROVED_TARGET = String(__ENV.TITECH_PERF_TARGET_APPROVED || '').replace(/\/+$/, '');
const APPROVED_MAX_VUS = Number.parseInt(__ENV.TITECH_PERF_APPROVED_MAX_VUS || '10', 10);
const IS_LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(BASE_URL);

const PROFILES = Object.freeze({
  smoke: Object.freeze({
    maxVUs: 1,
    stages: [
      { duration: '10s', target: 1 },
      { duration: '20s', target: 1 },
      { duration: '5s', target: 0 },
    ],
  }),
  baseline: Object.freeze({
    maxVUs: 10,
    stages: [
      { duration: '20s', target: 1 },
      { duration: '30s', target: 10 },
      { duration: '60s', target: 10 },
      { duration: '20s', target: 0 },
    ],
  }),
  'load-100': Object.freeze({
    maxVUs: 100,
    stages: [
      { duration: '30s', target: 10 },
      { duration: '60s', target: 100 },
      { duration: '120s', target: 100 },
      { duration: '30s', target: 0 },
    ],
  }),
  'load-1000': Object.freeze({
    maxVUs: 1000,
    stages: [
      { duration: '60s', target: 100 },
      { duration: '120s', target: 500 },
      { duration: '120s', target: 1000 },
      { duration: '300s', target: 1000 },
      { duration: '60s', target: 0 },
    ],
  }),
});

if (!/^https?:\/\/[^/\s]+$/i.test(BASE_URL)) {
  throw new Error('TITECH_PERF_BASE_URL must be an absolute HTTP(S) origin without a path.');
}
if (ENVIRONMENT === 'production' || ENVIRONMENT === 'prod' || /(^|[.-])(prod|production)([.-]|$)/i.test(BASE_URL.replace(/^https?:\/\//i, ''))) {
  throw new Error('Performance traffic against a production target is blocked by this test harness.');
}
if (!Object.prototype.hasOwnProperty.call(PROFILES, PROFILE_NAME)) {
  throw new Error(`Unsupported TITECH_PERF_PROFILE. Choose: ${Object.keys(PROFILES).join(', ')}.`);
}
if (!Number.isSafeInteger(APPROVED_MAX_VUS) || APPROVED_MAX_VUS < 1) {
  throw new Error('TITECH_PERF_APPROVED_MAX_VUS must be a positive integer.');
}

const PROFILE = PROFILES[PROFILE_NAME];
if (PROFILE.maxVUs > APPROVED_MAX_VUS) {
  throw new Error(`Profile ${PROFILE_NAME} requires ${PROFILE.maxVUs} VUs, above the approved ceiling (${APPROVED_MAX_VUS}).`);
}
if (!IS_LOOPBACK && (ENVIRONMENT !== 'staging' || APPROVED_TARGET !== BASE_URL || !APPROVAL_ID)) {
  throw new Error('Non-local load requires staging environment, exact approved target, and TITECH_PERF_APPROVAL_ID.');
}
if (PROFILE.maxVUs > 10 && (ENVIRONMENT !== 'staging' || APPROVED_TARGET !== BASE_URL || !APPROVAL_ID)) {
  throw new Error('Profiles above 10 VUs require explicit staging-target approval and an approval ID.');
}

export const options = {
  scenarios: {
    read_only_capacity: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: PROFILE.stages,
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    checks: ['rate>=0.999'],
  },
  userAgent: 'TITech-Capacity-Test/1.0',
};

const TENANT_ID = String(__ENV.TITECH_PERF_TENANT_ID || '').trim();
const endpointList = [
  { name: 'health', domain: 'platform', path: '/api/v1/health' },
  { name: 'readiness', domain: 'platform', path: '/api/v1/ready' },
];

function addAuthenticatedEndpoint(tokenEnvName, name, domain, path) {
  const token = String(__ENV[tokenEnvName] || '').trim();
  if (token) endpointList.push({ name, domain, path, token });
}

addAuthenticatedEndpoint('TITECH_PERF_PARTICIPANT_TOKEN', 'participant_status', 'participant', '/api/v1/participant-onboarding/me');
addAuthenticatedEndpoint('TITECH_PERF_PARTNER_TOKEN', 'refugee_partner_status', 'partner', '/api/v1/refugee-partners/me');
addAuthenticatedEndpoint('TITECH_PERF_INSURER_TOKEN', 'insurance_readiness', 'insurance', '/api/v1/insurance/readiness');
addAuthenticatedEndpoint('TITECH_PERF_INSURER_TOKEN', 'insurance_institution', 'insurance', '/api/v1/insurance/institution');
addAuthenticatedEndpoint('TITECH_PERF_INSURER_TOKEN', 'insurance_products', 'insurance', '/api/v1/insurance/products');
addAuthenticatedEndpoint('TITECH_PERF_INSURER_TOKEN', 'insurance_enrolments', 'insurance', '/api/v1/insurance/enrolments');
addAuthenticatedEndpoint('TITECH_PERF_INSURER_TOKEN', 'insurance_premiums', 'insurance', '/api/v1/insurance/premiums');
addAuthenticatedEndpoint('TITECH_PERF_INSURER_TOKEN', 'insurance_claims', 'insurance', '/api/v1/insurance/claims');

let endpointCursor = 0;

export default function () {
  const endpoint = endpointList[endpointCursor % endpointList.length];
  endpointCursor += 1;

  const headers = { Accept: 'application/json' };
  if (endpoint.token) headers.Authorization = `Bearer ${endpoint.token}`;
  // The header is a tenant-scope consistency assertion only; the server-side
  // authenticated tenant remains authoritative.
  if (TENANT_ID && endpoint.token) headers['X-Tenant-ID'] = TENANT_ID;

  const response = http.get(`${BASE_URL}${endpoint.path}`, {
    headers,
    timeout: '5s',
    tags: { domain: endpoint.domain, route: endpoint.name, method: 'GET' },
  });

  check(response, {
    [`${endpoint.name} returns a 2xx response`]: (result) => result.status >= 200 && result.status < 300,
  });

  // A deterministic request pace reduces accidental request storms. VUs are
  // workload actors, not proof of distinct authenticated human sessions.
  sleep(1);
}
