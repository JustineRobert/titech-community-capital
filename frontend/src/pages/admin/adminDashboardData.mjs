function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function toSafeNonNegativeNumberOrNull(value) {
  let parsed = null;
  if (typeof value === 'number' && Number.isFinite(value)) parsed = value;
  else if (typeof value === 'string' && value.trim() !== '') {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) parsed = numericValue;
  }
  return parsed !== null && parsed >= 0 ? parsed : null;
}

export function unwrapAdminDashboardResponse(response) {
  const responseData = response?.data;
  if (isObject(responseData) && isObject(responseData.data)) return responseData.data;
  return responseData;
}

export function normalizeAdminStats(payload) {
  const source = isObject(payload?.stats) ? payload.stats : (isObject(payload) ? payload : {});
  const savings = isObject(source.totalSavings)
    ? (String(source.totalSavings.currency || 'UGX').toUpperCase() === 'UGX'
      ? source.totalSavings.amountMinor ?? source.totalSavings.amount ?? null
      : null)
    : source.totalSavings;

  return {
    totalUsers: toSafeNonNegativeNumberOrNull(source.totalUsers),
    activeUsers: toSafeNonNegativeNumberOrNull(source.activeUsers),
    activeGroups: toSafeNonNegativeNumberOrNull(source.activeGroups),
    pendingApprovals: toSafeNonNegativeNumberOrNull(source.pendingApprovals),
    activeLoans: toSafeNonNegativeNumberOrNull(source.activeLoans),
    totalSavings: toSafeNonNegativeNumberOrNull(savings),
  };
}

function safeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function humanize(value) {
  return safeText(value, 'Administrative event')
    .replace(/[_.:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function normalizeAdminActivity(payload) {
  if (Array.isArray(payload)) {
    return payload.filter(isObject).map((event, index) => {
      const action = safeText(event.action, 'Administrative event');
      const actor = isObject(event.actor) ? event.actor : {};
      const resource = isObject(event.resource) ? event.resource : {};
      const createdAt = event.occurredAt || event.createdAt || event.timestamp || event.updatedAt || null;
      return {
        id: safeText(event.id, safeText(event._id, `activity-${index}`)),
        action,
        description: safeText(event.description, humanize(action)),
        actor: safeText(actor.displayName, safeText(actor.name, '')),
        resource: safeText(resource.displayName, ''),
        createdAt,
      };
    });
  }

  if (isObject(payload)) {
    if (Array.isArray(payload.items)) return normalizeAdminActivity(payload.items);
    if (Array.isArray(payload.events)) return normalizeAdminActivity(payload.events);
    if (isObject(payload.data)) return normalizeAdminActivity(payload.data);
  }
  return [];
}

export function getAdminDashboardErrorMessage(error) {
  const body = error?.response?.data;
  const candidates = [
    body?.message,
    body?.error?.message,
    typeof body?.error === 'string' ? body.error : null,
    error?.message,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim()
    || 'Unable to load dashboard data.';
}
