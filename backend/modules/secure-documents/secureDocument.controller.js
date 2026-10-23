import { hasPermission } from '../../middleware/platformPermissions.js';
import { capabilityEnabled } from '../../middleware/capabilityFeatureFlag.js';
import { findPrivateDocument, readPrivateDocument, storePrivateDocument } from './secureDocument.service.js';

function actorId(req) {
  return String(req.user?.id || req.user?._id || req.auth?.userId || '').trim();
}
function tenantId(req) {
  return String(req.tenant?.tenantId || req.tenantId || req.tenantContext?.tenantId || req.user?.tenantId || '').trim();
}
function errorResponse(res, req, error) {
  const status = Number(error?.statusCode) || 500;
  return res.status(status).json({
    success: false,
    error: { code: error?.code || 'PRIVATE_DOCUMENT_ERROR', message: status < 500 ? error.message : 'Private document operation is temporarily unavailable.' },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  });
}
function permittedUpload(req, purpose) {
  const permissionByPurpose = {
    IDENTITY_CREDENTIAL: ['participant:credential:submit', 'participant:assisted-onboarding:create'],
    INSURANCE_LICENCE: ['insurance:institution:submit', 'insurance:licence:evidence:submit'],
    INSURANCE_CLAIM: ['insurance:claims:create'],
    CONSENT_EVIDENCE: ['consent:grant', 'participant:assisted-onboarding:create'],
    OTHER_COMPLIANCE_EVIDENCE: ['refugee-partner:submit', 'ubuntu-float:agent:evidence:submit', 'insurance:institution:submit', 'insurance:licence:evidence:submit', 'insurance:product:activate', 'participant:kyc:review'],
    RETIREMENT_SUPPORT_EVIDENCE: ['retirement:case:create:own', 'retirement:case:create', 'retirement:case:review'],
  };
  return (permissionByPurpose[String(purpose || '').trim().toUpperCase()] || []).some((permission) => hasPermission(req.user, permission));
}
function permittedRead(req, purpose) {
  const permissionByPurpose = {
    IDENTITY_CREDENTIAL: ['participant:kyc:review', 'participant:document:read'],
    INSURANCE_LICENCE: ['insurance:licence:review', 'insurance:document:read'],
    INSURANCE_CLAIM: ['insurance:claims:review', 'insurance:documents:read'],
    CONSENT_EVIDENCE: ['consent:read'],
    OTHER_COMPLIANCE_EVIDENCE: ['participant:kyc:review', 'insurance:licence:review', 'insurance:document:read'],
    RETIREMENT_SUPPORT_EVIDENCE: ['retirement:case:read', 'retirement:case:review'],
  };
  return (permissionByPurpose[String(purpose || '').trim().toUpperCase()] || []).some((permission) => hasPermission(req.user, permission));
}

export async function uploadPrivateDocument(req, res) {
  try {
    const tenant = tenantId(req);
    const actor = actorId(req);
    const purpose = String(req.get('x-titech-document-purpose') || '').trim().toUpperCase();
    const allowedByCapability = purpose === 'IDENTITY_CREDENTIAL'
      ? capabilityEnabled('TITECH_REFUGEE_ONBOARDING_ENABLED')
      : purpose === 'INSURANCE_LICENCE'
        ? capabilityEnabled('TITECH_INSURANCE_ONBOARDING_ENABLED')
        : purpose === 'INSURANCE_CLAIM'
          ? capabilityEnabled('TITECH_INSURANCE_OPERATIONS_ENABLED')
          : purpose === 'RETIREMENT_SUPPORT_EVIDENCE'
            ? capabilityEnabled('TITECH_RETIREMENT_SUPPORT_ENABLED')
            : purpose === 'CONSENT_EVIDENCE'
              ? true
              : purpose === 'OTHER_COMPLIANCE_EVIDENCE' && (
                (hasPermission(req.user, 'refugee-partner:submit') && capabilityEnabled('TITECH_REFUGEE_PARTNER_ONBOARDING_ENABLED'))
                || (hasPermission(req.user, 'ubuntu-float:agent:evidence:submit') && capabilityEnabled('TITECH_UBUNTFLOAT_CORE_ENABLED'))
                || ((hasPermission(req.user, 'insurance:institution:submit') || hasPermission(req.user, 'insurance:licence:evidence:submit')) && capabilityEnabled('TITECH_INSURANCE_ONBOARDING_ENABLED'))
                || (hasPermission(req.user, 'insurance:product:activate') && capabilityEnabled('TITECH_INSURANCE_OPERATIONS_ENABLED'))
                || (hasPermission(req.user, 'participant:kyc:review') && capabilityEnabled('TITECH_REFUGEE_ONBOARDING_ENABLED'))
              );
    if (!allowedByCapability) return res.status(503).json({ success: false, error: { code: 'CAPABILITY_DISABLED', message: 'Private evidence uploads for this workflow are disabled until the related capability is configured and approved.' }, requestId: req.requestId || null });
    if (!permittedUpload(req, purpose)) return res.status(403).json({ success: false, error: { code: 'DOCUMENT_UPLOAD_PERMISSION_DENIED', message: 'The actor is not authorised to upload this document purpose.' } });
    const requestedSubject = String(req.get('x-titech-document-subject') || actor).trim();
    if (requestedSubject !== actor && !hasPermission(req.user, 'participant:assisted-onboarding:create') && !hasPermission(req.user, 'insurance:institution:submit') && !hasPermission(req.user, 'retirement:case:create') && !(hasPermission(req.user, 'ubuntu-float:agent:evidence:submit') && capabilityEnabled('TITECH_UBUNTFLOAT_CORE_ENABLED'))) {
      return res.status(403).json({ success: false, error: { code: 'DOCUMENT_SUBJECT_SCOPE_DENIED', message: 'The actor cannot upload evidence for this subject.' } });
    }
    const result = await storePrivateDocument({
      tenantId: tenant,
      subjectId: requestedSubject,
      actorId: actor,
      purpose,
      mimeType: req.get('content-type') || '',
      buffer: req.body,
      requestId: req.requestId,
      correlationId: req.correlationId,
    });
    return res.status(201).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) { return errorResponse(res, req, error); }
}

export async function downloadPrivateDocument(req, res) {
  try {
    const tenant = tenantId(req);
    const actor = actorId(req);
    const reference = String(req.params.documentReference || '').trim();
    const record = await findPrivateDocument({ tenantId: tenant, documentReference: reference });
    if (!record) return res.status(404).json({ success: false, error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document was not found within this tenant.' } });
    const isSubject = String(record.subjectId) === actor && ['IDENTITY_CREDENTIAL', 'CONSENT_EVIDENCE', 'RETIREMENT_SUPPORT_EVIDENCE'].includes(record.purpose);
    if (!isSubject && !permittedRead(req, record.purpose)) return res.status(403).json({ success: false, error: { code: 'DOCUMENT_ACCESS_DENIED', message: 'Document access is not authorized.' } });
    const allowedPurposes = isSubject ? [] : [record.purpose];
    const result = await readPrivateDocument({ tenantId: tenant, documentReference: reference, actorId: actor, subjectId: actor, allowedPurposes, requestId: req.requestId, correlationId: req.correlationId });
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', String(result.buffer.length));
    res.setHeader('Content-Disposition', 'attachment; filename="titech-private-evidence"');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(result.buffer);
  } catch (error) { return errorResponse(res, req, error); }
}
