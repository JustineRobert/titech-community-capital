/**
 * Input policy for tenant-scoped TITech support cases.
 * Deliberately framework-free so the validation and redaction rules are easy
 * to unit test without MongoDB or an Express runtime.
 */
const CASE_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'PENDING_EXTERNAL', 'RESOLVED', 'CLOSED']);
const CASE_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const REDACT_PATTERNS = [
  /(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
  /((?:access[_ -]?token|refresh[_ -]?token|token|password|passwd|secret|api[_ -]?key|otp|pin|cookie)\s*[:=]\s*)[^\s,;]+/gi,
  /(set-cookie\s*:\s*)[^\r\n]+/gi,
];
const DIAGNOSTIC_FIELDS = Object.freeze({
  applicationVersion: 60,
  module: 80,
  route: 180,
  timestamp: 40,
  requestId: 128,
  correlationId: 128,
  errorCode: 100,
  errorName: 100,
});
const LINKED_FIELDS = Object.freeze(['memberId', 'groupId', 'paymentId', 'ledgerTransactionId', 'providerTransactionId', 'reconciliationExceptionId']);

function policyError(message, code = 'SUPPORT_CASE_INPUT_INVALID', statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function boundedText(value, field, { min = 1, max } = {}) {
  if (typeof value !== 'string') throw policyError(`${field} must be text.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw policyError(`${field} must contain between ${min} and ${max} characters.`);
  return normalized;
}

export function redactSupportText(value) {
  let text = String(value ?? '');
  for (const pattern of REDACT_PATTERNS) text = text.replace(pattern, '$1[REDACTED]');
  return text;
}

export function sanitizeDiagnosticContext(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const safe = {};
  for (const [key, max] of Object.entries(DIAGNOSTIC_FIELDS)) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const normalized = redactSupportText(value.trim()).slice(0, max);
    if (key === 'route' && (!normalized.startsWith('/') || normalized.includes('?') || normalized.includes('#'))) continue;
    if (key === 'timestamp' && Number.isNaN(Date.parse(normalized))) continue;
    safe[key] = normalized;
  }
  return safe;
}

function sanitizeLinkedReferences(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const linked = {};
  for (const field of LINKED_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.trim().length > 128) throw policyError(`linked.${field} must be a reference of at most 128 characters.`);
    linked[field] = value.trim();
  }
  return linked;
}

export function normalizeCreateCaseInput(payload = {}, context = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw policyError('A support case object is required.');
  const type = boundedText(String(payload.type || 'SUPPORT_REQUEST').toUpperCase(), 'type', { min: 2, max: 64 });
  if (!/^[A-Z][A-Z0-9_]*$/.test(type)) throw policyError('type contains unsupported characters.');
  const priority = String(payload.priority || 'MEDIUM').toUpperCase();
  if (!CASE_PRIORITIES.has(priority)) throw policyError('priority is invalid.');
  const subject = redactSupportText(boundedText(payload.subject, 'subject', { min: 5, max: 300 }));
  let description = redactSupportText(boundedText(payload.description, 'description', { min: 10, max: 9000 }));
  const diagnostics = sanitizeDiagnosticContext(payload.diagnostics);
  if (Object.keys(diagnostics).length) {
    description += `\n\nSanitized diagnostic context:\n${Object.entries(diagnostics).map(([key, value]) => `${key}: ${value}`).join('\n')}`;
  }
  if (description.length > 10000) description = description.slice(0, 10000);
  const requestId = typeof context.requestId === 'string' ? context.requestId.slice(0, 128) : null;
  const correlationId = typeof context.correlationId === 'string' ? context.correlationId.slice(0, 128) : null;
  return {
    type,
    priority,
    subject,
    description,
    linked: sanitizeLinkedReferences(payload.linked),
    requestId,
    correlationId,
  };
}

export function normalizeCaseTransition(nextStatus, note, evidenceRefs = []) {
  const status = String(nextStatus || '').toUpperCase();
  if (!CASE_STATUSES.has(status)) throw policyError('The requested case status is invalid.');
  const safeNote = note === undefined || note === null || note === '' ? null : redactSupportText(boundedText(note, 'note', { min: 1, max: 2000 }));
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length > 20) throw policyError('evidenceRefs must be an array of at most 20 references.');
  const safeEvidenceRefs = evidenceRefs.map((reference) => {
    if (typeof reference !== 'string' || !reference.trim() || reference.trim().length > 200) throw policyError('Each evidence reference must be text of at most 200 characters.');
    return reference.trim();
  });
  return { status, note: safeNote, evidenceRefs: safeEvidenceRefs };
}

export const SUPPORT_CASE_POLICY = Object.freeze({
  statuses: Object.freeze([...CASE_STATUSES]),
  priorities: Object.freeze([...CASE_PRIORITIES]),
  diagnosticFields: Object.freeze(Object.keys(DIAGNOSTIC_FIELDS)),
  linkedFields: LINKED_FIELDS,
});
