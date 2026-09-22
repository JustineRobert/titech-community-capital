/**
 * TITech Community Capital — Consent Domain Public Contract
 * Role: stable export surface for granular consent and withdrawal.
 */

export { default as consentRoutes } from './consent.routes.js';
export { CONSENT_STATUS, default as ConsentRecord } from './models/ConsentRecord.js';
export * from './services/consentService.js';
