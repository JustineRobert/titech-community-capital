const toSafeString = (value, fallback = '') => {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value && typeof value.toString === 'function' && value.constructor?.name === 'ObjectId') {
    return value.toString();
  }
  return fallback;
};

export function humanizeAuditAction(value) {
  const action = toSafeString(value, 'SYSTEM_EVENT');
  return action
    .replace(/[.:-]+/g, '_')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'System event';
}

export function buildAdminActivityItem(event, actorName = 'System', resourceName = null) {
  const id = toSafeString(event?._id ?? event?.id, '');
  const action = toSafeString(event?.action, 'SYSTEM_EVENT').toUpperCase();
  const entityType = toSafeString(event?.entityType, 'record').toLowerCase();
  const entityId = toSafeString(event?.entityId, '');
  const timestamp = event?.createdAt ? new Date(event.createdAt) : null;
  const occurredAt = timestamp && Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString()
    : null;
  const displayName = toSafeString(resourceName, '') || (entityId ? `${humanizeAuditAction(entityType)} ${entityId}` : humanizeAuditAction(entityType));
  const description = `${humanizeAuditAction(action)} · ${humanizeAuditAction(entityType)}`;

  return {
    id,
    action,
    description,
    actor: {
      id: toSafeString(event?.userId, '') || null,
      displayName: toSafeString(actorName, 'System') || 'System',
    },
    resource: {
      type: entityType,
      id: entityId || null,
      displayName,
    },
    occurredAt,
    createdAt: occurredAt,
  };
}
