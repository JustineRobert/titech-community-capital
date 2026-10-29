import crypto from 'node:crypto';

/**
 * Validation and normalization for public institutional conversion requests.
 * This module intentionally has no database or Express dependency so its
 * trust-boundary behavior can be tested with Node's built-in test runner.
 */

export const INSTITUTIONAL_LEAD_TYPES = Object.freeze([
  'DEMO',
  'CONTACT',
  'CHAT_FOLLOW_UP',
]);

export const INSTITUTION_TYPES = Object.freeze([
  'SACCO',
  'COOPERATIVE',
  'MFI',
  'NGO_PROGRAMME',
  'FINANCIAL_SOFTWARE_PROVIDER',
  'PAYMENT_PROVIDER',
  'OTHER',
]);

export const DEMO_INTERESTS = Object.freeze([
  'RECONCILIATION_REPORTING',
  'INSTITUTIONAL_INTEGRATIONS',
  'INSTITUTIONAL_PILOT',
  'INCLUSIVE_ONBOARDING',
  'AUTHORIZED_INSURANCE_ACCESS',
  'RETIREMENT_SUPPORT',
  'EDUCATION_FUNDRAISING',
  'PARTNERSHIP',
  'OTHER',
]);

export const CONTACT_CATEGORIES = Object.freeze([
  'INSTITUTIONAL_SALES',
  'RECONCILIATION_REPORTING',
  'TECHNICAL_INTEGRATION',
  'PARTNERSHIP',
  'CUSTOMER_SUPPORT',
  'PRIVACY_SECURITY',
  'OTHER',
]);

const MAX_LENGTHS = Object.freeze({
  name: 120,
  email: 254,
  organization: 180,
  role: 120,
  country: 80,
  subject: 180,
  message: 2500,
  timezone: 80,
  preferredDate: 10,
});

function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

function fieldError(errors, field, message) {
  (errors[field] ??= []).push(message);
}

function readBoundedText(source, field, errors, { required = false, max = MAX_LENGTHS[field] ?? 120 } = {}) {
  const value = cleanText(source[field]);
  if (required && !value) fieldError(errors, field, 'This field is required.');
  if (value.length > max) fieldError(errors, field, `Must be ${max} characters or fewer.`);
  return value.slice(0, max);
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {{ok: true, data: object} | {ok: false, errors: Record<string,string[]>}}
 */
export function validateInstitutionalLeadSubmission(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: { body: ['A JSON object is required.'] } };
  }

  const type = cleanText(input.type).toUpperCase();
  if (!INSTITUTIONAL_LEAD_TYPES.includes(type)) {
    fieldError(errors, 'type', 'Choose a supported request type.');
  }

  if (input.consentToContact !== true) {
    fieldError(errors, 'consentToContact', 'Consent to be contacted about this request is required.');
  }

  const name = readBoundedText(input, 'name', errors, { required: true });
  const email = readBoundedText(input, 'email', errors, { required: true, max: MAX_LENGTHS.email }).toLowerCase();
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email)) {
    fieldError(errors, 'email', 'Enter a valid work email address.');
  }

  const organization = readBoundedText(input, 'organization', errors, { required: type === 'DEMO' });
  const role = readBoundedText(input, 'role', errors, { required: false });
  const country = readBoundedText(input, 'country', errors, { required: type === 'DEMO' });
  const subject = readBoundedText(input, 'subject', errors, { required: type !== 'DEMO' });
  const message = readBoundedText(input, 'message', errors, { required: type !== 'DEMO' });
  const preferredDate = readBoundedText(input, 'preferredDate', errors, { required: false });
  const timezone = readBoundedText(input, 'timezone', errors, { required: false, max: MAX_LENGTHS.timezone }) || 'Africa/Kampala';

  if (preferredDate && !validCalendarDate(preferredDate)) {
    fieldError(errors, 'preferredDate', 'Use a real calendar date in YYYY-MM-DD format.');
  }
  if (!validTimezone(timezone)) {
    fieldError(errors, 'timezone', 'Choose a valid time zone.');
  }

  const organizationType = cleanText(input.organizationType).toUpperCase();
  if (type === 'DEMO' && !INSTITUTION_TYPES.includes(organizationType)) {
    fieldError(errors, 'organizationType', 'Choose a supported organization type.');
  }

  const primaryInterest = cleanText(input.primaryInterest).toUpperCase();
  if (type === 'DEMO' && !DEMO_INTERESTS.includes(primaryInterest)) {
    fieldError(errors, 'primaryInterest', 'Choose a supported area of interest.');
  }

  const category = cleanText(input.category).toUpperCase();
  if (type !== 'DEMO' && !CONTACT_CATEGORIES.includes(category)) {
    fieldError(errors, 'category', 'Choose a supported enquiry category.');
  }

  const monthlyVolume = cleanText(input.monthlyVolume).toUpperCase();
  const permittedVolumes = ['UNDER_1000', '1000_10000', '10000_100000', 'OVER_100000', 'UNSURE', 'PREFER_NOT_TO_SAY'];
  if (monthlyVolume && !permittedVolumes.includes(monthlyVolume)) {
    fieldError(errors, 'monthlyVolume', 'Choose a supported volume range.');
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      type,
      name,
      email,
      organization,
      role,
      organizationType: organizationType || undefined,
      country,
      primaryInterest: primaryInterest || undefined,
      monthlyVolume: monthlyVolume || undefined,
      preferredDate: preferredDate || undefined,
      timezone,
      category: category || undefined,
      subject,
      message,
      consent: {
        accepted: true,
        purpose: 'Respond to the user-submitted institutional enquiry or demo request.',
        policyVersion: '2026-10-29',
        recordedAt: new Date(),
      },
      source: 'PUBLIC_WEBSITE',
    },
  };
}

export function validateInstitutionalLeadStatusChange(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: { body: ['A JSON object is required.'] } };
  }
  const status = cleanText(input.status).toUpperCase();
  const allowedStatuses = ['TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESPONDED', 'RESOLVED'];
  if (!allowedStatuses.includes(status)) fieldError(errors, 'status', 'Choose an allowed workflow status.');
  const expectedStatus = cleanText(input.expectedStatus).toUpperCase();
  const existingStatuses = ['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESPONDED', 'RESOLVED'];
  if (!existingStatuses.includes(expectedStatus)) fieldError(errors, 'expectedStatus', 'The expected current status is required.');
  const note = cleanText(input.note);
  if (note.length > 1000) fieldError(errors, 'note', 'Must be 1000 characters or fewer.');
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { status, expectedStatus, note } };
}


const STATUS_TRANSITIONS = Object.freeze({
  NEW: Object.freeze(['TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED']),
  TRIAGED: Object.freeze(['ASSIGNED', 'IN_PROGRESS', 'RESPONDED', 'RESOLVED']),
  ASSIGNED: Object.freeze(['TRIAGED', 'IN_PROGRESS', 'RESPONDED', 'RESOLVED']),
  IN_PROGRESS: Object.freeze(['TRIAGED', 'ASSIGNED', 'RESPONDED', 'RESOLVED']),
  RESPONDED: Object.freeze(['TRIAGED', 'IN_PROGRESS', 'RESOLVED']),
  RESOLVED: Object.freeze(['TRIAGED']),
});

export function canTransitionInstitutionalLeadStatus(from, to) {
  return typeof from === 'string' && typeof to === 'string'
    && Array.isArray(STATUS_TRANSITIONS[from])
    && STATUS_TRANSITIONS[from].includes(to);
}

/** A stable fingerprint that excludes server-generated consent timestamps. */
export function fingerprintInstitutionalLeadPayload(data) {
  const stable = {
    ...data,
    consent: data?.consent
      ? { ...data.consent, recordedAt: undefined }
      : data?.consent,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function isValidInstitutionalLeadSubmissionKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}
