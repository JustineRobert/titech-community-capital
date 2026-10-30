/**
 * Canonical access-token version policy.
 *
 * Access tokens carry security/session versions when issued. Protected requests
 * compare those claims with the current persisted identity so logout-all,
 * password/security changes and administrative revocation take effect before
 * the JWT's natural expiry. Missing claims fail closed; this module does not
 * access persistence or decide how a controller returns HTTP errors.
 */
function readVersion(payload, key) {
  const value = payload?.[key] ?? payload?.user?.[key];
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function evaluateTokenVersions(tokenPayload, authoritativeIdentity) {
  const tokenSecurityVersion = readVersion(tokenPayload, 'securityVersion');
  const tokenSessionVersion = readVersion(tokenPayload, 'sessionVersion');
  const currentSecurityVersion = readVersion(authoritativeIdentity, 'securityVersion');
  const currentSessionVersion = readVersion(authoritativeIdentity, 'sessionVersion');

  if (
    tokenSecurityVersion === null ||
    tokenSessionVersion === null ||
    currentSecurityVersion === null ||
    currentSessionVersion === null
  ) {
    return Object.freeze({ valid: false, reason: 'VERSION_MISSING_OR_INVALID' });
  }

  if (tokenSecurityVersion !== currentSecurityVersion || tokenSessionVersion !== currentSessionVersion) {
    return Object.freeze({ valid: false, reason: 'VERSION_REVOKED' });
  }

  return Object.freeze({ valid: true, reason: 'CURRENT' });
}
