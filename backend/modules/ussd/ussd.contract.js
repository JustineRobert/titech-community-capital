/**
 * Provider-neutral USSD contract for TITech Community Capital.
 *
 * Provider adapters must translate their documented payloads into this
 * canonical shape. Network identity is trusted only when supplied by the
 * authenticated provider adapter; it is never inferred from an MSISDN prefix.
 */

export const USSD_NETWORKS = Object.freeze([
  'MTN',
  'AIRTEL',
  'OTHER',
  'UNKNOWN',
]);

export const USSD_ACTIONS = Object.freeze(['CONTINUE', 'END']);

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const PROVIDER_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/i;

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be a string.`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new RangeError(`${field} must contain 1-${maxLength} characters.`);
  }

  return normalized;
}

export function normalizeProviderCode(value) {
  const providerCode = requiredString(value, 'providerCode', 40).toLowerCase();
  if (!PROVIDER_CODE_PATTERN.test(providerCode)) {
    throw new TypeError('providerCode has an invalid format.');
  }
  return providerCode;
}

/**
 * Normalize only the canonical, non-sensitive fields accepted from a trusted
 * provider adapter. Unknown properties such as tenantId/memberId are discarded
 * so a caller cannot select another tenant or member through callback data.
 */
export function normalizeCanonicalUssdRequest(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('USSD callback payload must be an object.');
  }

  const providerCode = normalizeProviderCode(options.providerCode);
  const providerSessionId = requiredString(input.providerSessionId, 'providerSessionId', 128);
  const phoneNumber = requiredString(input.phoneNumber, 'phoneNumber', 16);
  if (!E164_PATTERN.test(phoneNumber)) {
    throw new TypeError('phoneNumber must be normalized to E.164 by the provider adapter.');
  }

  const requestedNetwork = typeof input.network === 'string'
    ? input.network.trim().toUpperCase()
    : 'UNKNOWN';
  const network = USSD_NETWORKS.includes(requestedNetwork)
    ? requestedNetwork
    : 'UNKNOWN';

  const serviceCode = requiredString(input.serviceCode, 'serviceCode', 32);
  const text = input.text === undefined || input.text === null
    ? ''
    : String(input.text);
  const maxTextLength = Number.isSafeInteger(options.maxTextLength)
    ? options.maxTextLength
    : 512;
  if (text.length > maxTextLength) {
    throw new RangeError(`USSD text exceeds the ${maxTextLength}-character limit.`);
  }

  const providerRequestId = requiredString(input.providerRequestId, 'providerRequestId', 128);
  const receivedAt = options.receivedAt instanceof Date
    ? options.receivedAt.toISOString()
    : new Date(options.receivedAt || Date.now()).toISOString();

  return Object.freeze({
    providerCode,
    providerSessionId,
    phoneNumber,
    network,
    serviceCode,
    text,
    providerRequestId,
    receivedAt,
  });
}

export function validateUssdResponse(response, options = {}) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new TypeError('USSD service response must be an object.');
  }

  const action = String(response.action || '').toUpperCase();
  if (!USSD_ACTIONS.includes(action)) {
    throw new TypeError('USSD response action must be CONTINUE or END.');
  }

  const message = requiredString(response.message, 'message', 2048);
  const maxLength = Number.isSafeInteger(options.maxLength)
    ? options.maxLength
    : 160;
  const body = `${action === 'CONTINUE' ? 'CON' : 'END'} ${message}`;

  // Never truncate a financial confirmation or menu silently. Provider
  // adapters can supply a documented, provider-specific maximum.
  if (body.length > maxLength) {
    throw new RangeError(`Serialized USSD response exceeds ${maxLength} characters.`);
  }

  return Object.freeze({ action, message, body });
}

export function serializePlainTextUssdResponse(response, options = {}) {
  return validateUssdResponse(response, options).body;
}


export const USSD_SESSION_STATES = Object.freeze([
  'NEW',
  'ACTIVE',
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATED',
  'WAITING_FOR_EXTERNAL_ACTION',
  'COMPLETED',
  'TERMINATED',
]);

const SESSION_TRANSITIONS = Object.freeze({
  NEW: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['AUTHENTICATION_REQUIRED', 'AUTHENTICATED', 'COMPLETED', 'TERMINATED'],
  AUTHENTICATION_REQUIRED: ['AUTHENTICATED', 'TERMINATED'],
  AUTHENTICATED: ['ACTIVE', 'WAITING_FOR_EXTERNAL_ACTION', 'COMPLETED', 'TERMINATED'],
  WAITING_FOR_EXTERNAL_ACTION: ['ACTIVE', 'COMPLETED', 'TERMINATED'],
  COMPLETED: ['TERMINATED'],
  TERMINATED: [],
});

export function assertUssdSessionTransition(currentState, nextState) {
  const current = String(currentState || '').toUpperCase();
  const next = String(nextState || '').toUpperCase();
  if (!USSD_SESSION_STATES.includes(current) || !USSD_SESSION_STATES.includes(next)) {
    throw new TypeError('Unknown USSD session state.');
  }
  if (!SESSION_TRANSITIONS[current].includes(next)) {
    throw new Error(`Invalid USSD session transition: ${current} -> ${next}.`);
  }
  return Object.freeze({ from: current, to: next });
}
