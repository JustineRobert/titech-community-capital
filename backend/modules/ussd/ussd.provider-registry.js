import { normalizeProviderCode } from './ussd.contract.js';

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  'verifyCallback',
  'normalizeCallback',
  'serializeResponse',
]);

export function validateUssdProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('A USSD provider adapter must be an object.');
  }

  const missing = REQUIRED_ADAPTER_METHODS.filter(
    (method) => typeof adapter[method] !== 'function',
  );
  if (missing.length) {
    throw new TypeError(`USSD provider adapter is missing: ${missing.join(', ')}.`);
  }

  return true;
}

/** Registry deliberately contains no fabricated MTN/Airtel implementation. */
export class UssdProviderRegistry {
  #adapters = new Map();

  register(providerCode, adapter) {
    const code = normalizeProviderCode(providerCode);
    validateUssdProviderAdapter(adapter);
    if (this.#adapters.has(code)) {
      throw new Error(`USSD provider adapter already registered: ${code}.`);
    }
    this.#adapters.set(code, Object.freeze(adapter));
    return this;
  }

  get(providerCode) {
    return this.#adapters.get(normalizeProviderCode(providerCode)) || null;
  }

  has(providerCode) {
    return Boolean(this.get(providerCode));
  }

  list() {
    return [...this.#adapters.keys()].sort();
  }
}
