import { hasPermission } from '../../middleware/platformPermissions.js';
import { appealIdentityDecision, getIdentityCapability, getInsuranceConsentRecipient, getMyIdentityStatus, getMyInsuranceEnrolmentConsent, grantMyInsuranceEnrolmentConsent, reviewIdentityCredential, submitIdentityCredential, withdrawMyInsuranceEnrolmentConsent } from './identityOnboarding.service.js';

function requestContext(req) {
  const actorId = req.user?.id || req.user?._id || req.auth?.userId || null;
  return {
    tenantId: req.tenant?.tenantId || req.tenantId || req.tenantContext?.tenantId || req.user?.tenantId,
    actorId,
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
    canAssist: hasPermission(req.user, 'participant:assisted-onboarding:create'),
    canOverrideAssignment: hasPermission(req.user, 'participant:kyc:assignment:override'),
  };
}

function sanitizedError(res, req, error) {
  const statusCode = Number(error?.statusCode) || 500;
  return res.status(statusCode).json({
    success: false,
    error: {
      code: error?.code || 'IDENTITY_ONBOARDING_ERROR',
      message: statusCode < 500 ? error.message : 'Identity onboarding operation is temporarily unavailable.',
    },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  });
}

export async function submitCredential(req, res) {
  try {
    const result = await submitIdentityCredential(req.body || {}, requestContext(req));
    return res.status(202).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) { return sanitizedError(res, req, error); }
}

export async function readMyStatus(req, res) {
  try {
    const result = await getMyIdentityStatus(requestContext(req));
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) { return sanitizedError(res, req, error); }
}

export async function readMyCapability(req, res) {
  try {
    const result = await getIdentityCapability(requestContext(req), req.query.capability || 'COMMUNITY_PRE_REGISTRATION');
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) { return sanitizedError(res, req, error); }
}

export async function reviewCredential(req, res) {
  try {
    const result = await reviewIdentityCredential({ participantUserId: req.params.userId, ...(req.body || {}) }, requestContext(req));
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) { return sanitizedError(res, req, error); }
}

export async function submitAppeal(req, res) {
  try {
    const result = await appealIdentityDecision(req.body || {}, requestContext(req));
    return res.status(202).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) { return sanitizedError(res, req, error); }
}

export async function readInsuranceConsentRecipient(req, res) {
  try {
    const result = await getInsuranceConsentRecipient({ recipientTenantId: req.params.recipientTenantId, language: req.query.language || 'en' }, requestContext(req));
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) { return sanitizedError(res, req, error); }
}

export async function readMyInsuranceConsent(req, res) {
  try {
    const result = await getMyInsuranceEnrolmentConsent({ recipientTenantId: req.query.recipientTenantId }, requestContext(req));
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) { return sanitizedError(res, req, error); }
}

export async function grantInsuranceConsent(req, res) {
  try {
    const result = await grantMyInsuranceEnrolmentConsent(req.body || {}, requestContext(req));
    return res.status(201).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) { return sanitizedError(res, req, error); }
}

export async function withdrawInsuranceConsent(req, res) {
  try {
    const result = await withdrawMyInsuranceEnrolmentConsent(req.params.consentId, requestContext(req));
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) { return sanitizedError(res, req, error); }
}
