import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import EduFinanceApplication from './models/EduFinanceApplication.js';
import { createAuditLog } from '../audit/audit.service.js';
import { initialEduFinanceReadiness, validateEduFinanceApplication } from './eduFinance.policy.js';

function eduFinanceError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function required(value, name, maximum = 128) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw eduFinanceError(`${name} is required.`, `EDUFINANCE_${name.toUpperCase()}_REQUIRED`);
  if (normalized.length > maximum) throw eduFinanceError(`${name} exceeds the permitted length.`, `EDUFINANCE_${name.toUpperCase()}_INVALID`);
  return normalized;
}

function contextOf(context = {}) {
  return {
    tenantId: required(context.tenantId, 'tenantId', 100).toLowerCase(),
    actorId: required(context.actorId, 'actorId', 128),
    requestId: context.requestId || null,
    correlationId: context.correlationId || context.requestId || null,
  };
}

function assertIntakeEnabled() {
  if (String(process.env.TITECH_EDUFINANCE_APPLICATIONS_ENABLED || '').trim().toLowerCase() !== 'true') {
    throw eduFinanceError('EduFinance application intake is disabled until institutional, privacy, legal and operational prerequisites are approved.', 'EDUFINANCE_INTAKE_DISABLED', 503);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function toDTO(application) {
  return Object.freeze({
    id: String(application._id ?? application.id),
    schoolTenantId: application.schoolTenantId,
    schoolReference: application.schoolReference,
    applicationType: application.applicationType,
    academicYearReference: application.academicYearReference,
    academicTermReference: application.academicTermReference,
    invoiceReference: application.invoiceReference,
    invoiceVersion: application.invoiceVersion,
    currency: application.currency,
    invoiceAmountMinor: application.invoiceAmountMinor,
    alreadyPaidAmountMinor: application.alreadyPaidAmountMinor,
    declaredOutstandingAmountMinor: application.declaredOutstandingAmountMinor,
    requestedAmountMinor: application.requestedAmountMinor,
    ...initialEduFinanceReadiness(),
    status: application.status,
    schoolVerificationStatus: application.schoolVerificationStatus,
    invoiceVerificationStatus: application.invoiceVerificationStatus,
    guardianAuthorityVerificationStatus: application.guardianAuthorityVerificationStatus,
    lenderDecisionStatus: application.lenderDecisionStatus,
    loanAccountStatus: application.loanAccountStatus,
    disbursementStatus: application.disbursementStatus,
    repaymentStatus: application.repaymentStatus,
    submittedAt: application.submittedAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  });
}

async function writeAudit(context, action, data, session) {
  await createAuditLog({
    tenantId: context.tenantId,
    actorId: context.actorId,
    action,
    data,
    requestId: context.requestId,
    correlationId: context.correlationId,
    session,
  });
}

export async function submitEduFinanceApplication(payload = {}, inputContext = {}) {
  assertIntakeEnabled();
  const ctx = contextOf(inputContext);
  const normalized = validateEduFinanceApplication(payload);
  const idempotencyKey = required(payload.idempotencyKey, 'idempotencyKey', 160);
  if (idempotencyKey.length < 16) throw eduFinanceError('idempotencyKey must contain at least 16 characters.', 'EDUFINANCE_IDEMPOTENCY_KEY_INVALID');

  const requestFingerprint = sha256(JSON.stringify(normalized));
  const duplicateFingerprint = sha256([
    normalized.schoolTenantId,
    normalized.schoolReference,
    normalized.invoiceReference,
    normalized.invoiceVersion,
    normalized.studentBeneficiaryReference,
  ].join('|').toLowerCase());

  const existing = await EduFinanceApplication.findOne({ tenantId: ctx.tenantId, idempotencyKey })
    .select('+requestFingerprint')
    .lean();
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw eduFinanceError('The idempotency key has already been used for a different application payload.', 'EDUFINANCE_IDEMPOTENCY_CONFLICT', 409);
    }
    return toDTO(existing);
  }

  const duplicate = await EduFinanceApplication.findOne({ duplicateFingerprint }).lean();
  if (duplicate) {
    throw eduFinanceError('This school invoice and beneficiary already have an EduFinance application; duplicate financing requests are blocked pending partner review.', 'EDUFINANCE_DUPLICATE_INVOICE', 409);
  }

  const readiness = initialEduFinanceReadiness();
  let application;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      [application] = await EduFinanceApplication.create([{
        ...normalized,
        tenantId: ctx.tenantId,
        applicantUserId: ctx.actorId,
        idempotencyKey,
        requestFingerprint,
        duplicateFingerprint,
        ...readiness,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        history: [{ fromStatus: null, toStatus: 'SUBMITTED', actorId: ctx.actorId, reasonCode: 'APPLICANT_INTAKE', at: new Date() }],
      }], { session });

      await writeAudit(ctx, 'EDUFINANCE.APPLICATION_SUBMITTED', {
        applicationId: String(application._id),
        schoolTenantId: normalized.schoolTenantId,
        schoolReference: normalized.schoolReference,
        invoiceReference: normalized.invoiceReference,
        requestedAmountMinor: normalized.requestedAmountMinor,
        currency: normalized.currency,
        status: application.status,
        verificationStatus: 'PENDING_PARTNER_VERIFICATION',
      }, session);
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const raced = await EduFinanceApplication.findOne({ tenantId: ctx.tenantId, idempotencyKey }).select('+requestFingerprint').lean();
    if (raced?.requestFingerprint === requestFingerprint) return toDTO(raced);
    const invoiceDuplicate = await EduFinanceApplication.findOne({ duplicateFingerprint }).lean();
    if (invoiceDuplicate) throw eduFinanceError('This school invoice and beneficiary already have an EduFinance application.', 'EDUFINANCE_DUPLICATE_INVOICE', 409);
    throw eduFinanceError('The application was concurrently submitted with a conflicting idempotency key.', 'EDUFINANCE_IDEMPOTENCY_CONFLICT', 409);
  } finally {
    await session.endSession();
  }

  return toDTO(application);
}

export async function listMyEduFinanceApplications(inputContext = {}) {
  const ctx = contextOf(inputContext);
  const applications = await EduFinanceApplication.find({ tenantId: ctx.tenantId, applicantUserId: ctx.actorId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return applications.map(toDTO);
}
