import express from 'express';
import rateLimit from 'express-rate-limit';
import authModule from '../middleware/auth.js';
import {
  createInstitutionalLead,
  listInstitutionalLeads,
  transitionInstitutionalLead,
} from '../services/institutionalLeadService.js';
import {
  CONTACT_CATEGORIES,
  DEMO_INTERESTS,
  INSTITUTIONAL_LEAD_TYPES,
  INSTITUTION_TYPES,
} from '../utils/institutionalLeadValidation.js';

const router = express.Router({ caseSensitive: false, strict: false });
const authenticate = authModule.verifyToken || authModule.authenticate || authModule.verifyAccessToken;
const requireSuperAdmin = authModule.requireRole?.('super_admin');
const production = process.env.NODE_ENV === 'production';
const allowedOrigins = String(process.env.TITECH_PUBLIC_FORM_ALLOWED_ORIGINS || '')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

const publicSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'PUBLIC_FORM_RATE_LIMITED', message: 'Too many requests. Please try again later.' },
  },
});

function validateOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) {
    if (!production) return next();
    return res.status(403).json({
      success: false,
      error: { code: 'PUBLIC_FORM_ORIGIN_REQUIRED', message: 'A trusted website origin is required for this submission.' },
      requestId: req.requestId,
    });
  }
  if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) return next();
  if (!production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return next();
  return res.status(403).json({
    success: false,
    error: { code: 'PUBLIC_FORM_ORIGIN_NOT_ALLOWED', message: 'This website origin is not allowed to submit requests.' },
    requestId: req.requestId,
  });
}

if (typeof authenticate !== 'function' || typeof requireSuperAdmin !== 'function') {
  throw new TypeError('Institutional lead administration requires authentication and super-admin authorization middleware.');
}

router.post('/', validateOrigin, publicSubmitLimiter, async (req, res, next) => {
  try {
    if (String(req.body?.website || '').trim()) {
      // Honeypot: do not persist bot submissions or disclose detection details.
      return res.status(202).json({ success: true, message: 'Request received.' });
    }
    const result = await createInstitutionalLead({
      body: req.body,
      submissionKey: req.get('idempotency-key'),
      requestId: req.requestId,
      correlationId: req.correlationId,
    });
    res.set('Cache-Control', 'no-store');
    return res.status(202).json({
      success: true,
      message: result.duplicate ? 'This request was already received.' : 'Request received and awaiting review; this is not a confirmed appointment.',
      data: result,
      requestId: req.requestId,
    });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 409) {
      return res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message, fields: error.fields || undefined },
        requestId: req.requestId,
      });
    }
    return next(error);
  }
});

router.get('/meta', (_req, res) => res.status(200).json({
  success: true,
  service: 'institutional-lead-intake',
  capabilities: ['DEMO', 'CONTACT', 'CHAT_FOLLOW_UP'],
  organization: 'TITech Capital LTD',
  appointmentBehavior: 'REQUEST_ONLY_AWAITING_CONFIRMATION',
  chatBehavior: 'GUIDED_APPROVED_KNOWLEDGE_BASE_ONLY',
  notes: 'This endpoint does not establish provider availability, calendar booking, live human support, or production approval.',
}));

router.get('/', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    const type = req.query.type ? String(req.query.type).toUpperCase() : undefined;
    if (status && !['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESPONDED', 'RESOLVED'].includes(status)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS_FILTER', message: 'Unsupported status filter.' } });
    }
    if (type && !INSTITUTIONAL_LEAD_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_TYPE_FILTER', message: 'Unsupported request type filter.' } });
    }
    const page = Math.max(1, Math.min(1000000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
    const result = await listInstitutionalLeads({ status, type, page, limit });
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: result, requestId: req.requestId });
  } catch (error) { return next(error); }
});

router.patch('/:leadId/status', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const actorUserId = req.user?._id ?? req.user?.id ?? req.user?.userId ?? null;
    const result = await transitionInstitutionalLead({
      leadId: req.params.leadId,
      body: req.body,
      actorUserId,
      requestId: req.requestId,
      correlationId: req.correlationId,
    });
    return res.status(200).json({ success: true, data: result, requestId: req.requestId });
  } catch (error) {
    if ([400, 404, 409].includes(error.statusCode)) {
      return res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message, fields: error.fields || undefined },
        requestId: req.requestId,
      });
    }
    return next(error);
  }
});


export default router;
export { CONTACT_CATEGORIES, DEMO_INTERESTS, INSTITUTION_TYPES };
