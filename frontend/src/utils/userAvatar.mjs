/**
 * TITech Community Capital — authenticated profile presentation helpers.
 *
 * Avatar URLs are display data returned by the authenticated profile API.
 * They are never used for authorization or tenant decisions.
 */

const AVATAR_FIELDS = Object.freeze([
  'avatarUrl',
  'avatar',
  'profileImage',
  'photoURL',
  'photoUrl',
  'picture',
  'imageUrl',
]);

export function getUserAvatarUrl(user) {
  if (!user || typeof user !== 'object') return null;

  for (const field of AVATAR_FIELDS) {
    const candidate = user[field];
    if (typeof candidate !== 'string') continue;

    const value = candidate.trim();
    if (!value || value.length > 2048) continue;

    try {
      const parsed = new URL(value);
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        !parsed.username &&
        !parsed.password
      ) {
        return value;
      }
    } catch {
      // Profile images must be absolute HTTP(S) URLs. Invalid or relative
      // values fall back to initials rather than being injected into the DOM.
    }
  }

  return null;
}

export function getUserDisplayName(user, fallback = 'TITech User') {
  if (!user || typeof user !== 'object') return fallback;

  const direct = [
    user.name,
    user.fullName,
    user.displayName,
    user.username,
  ].find((value) => typeof value === 'string' && value.trim());

  if (direct) return direct.trim();

  const firstName = typeof user.firstName === 'string' ? user.firstName.trim() : '';
  const lastName = typeof user.lastName === 'string' ? user.lastName.trim() : '';
  const combined = `${firstName} ${lastName}`.trim();
  if (combined) return combined;

  if (typeof user.email === 'string' && user.email.trim()) {
    return user.email.trim();
  }

  return fallback;
}

export function getUserInitials(value, fallback = 'TU') {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return fallback;

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
  }

  const localPart = name.includes('@') ? name.split('@', 1)[0] : name;
  const words = localPart.split(/[._-]+/).filter(Boolean);
  if (words.length > 1) {
    return words.slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
  }

  return localPart.slice(0, 2).toUpperCase() || fallback;
}
