/**
 * TITech Community Capital — tenant-scoped Member read API.
 *
 * This router deliberately owns read operations only. Registration and member
 * mutations remain disabled until the canonical consent/KYC/onboarding and
 * audit workflow is connected. It never reads authentication User documents
 * as a substitute for the Member domain model.
 */
import express from 'express';
import mongoose from 'mongoose';
import Member from '../models/Member.js';
import authModule from '../middleware/auth.js';

const router = express.Router();
const requirePermission = authModule.requirePermission;
const MEMBER_PERMISSION = 'MEMBER_VIEW';
const MEMBER_SEARCH_FIELDS = [
  'memberNumber',
  'firstName',
  'otherNames',
  'lastName',
  'email',
  'phoneNumber',
];
const MEMBER_STATUSES = new Set([
  'PENDING', 'ACTIVE', 'DORMANT', 'SUSPENDED', 'EXITED', 'DECEASED',
]);

function getTenantObjectId(req) {
  // The canonical tenant middleware attaches the Tenant document as req.tenant
  // and its public/string tenant key as req.tenantId. Member and Savings
  // schemas reference Tenant._id (ObjectId), so prefer the trusted document ID.
  const candidates = [
    req.tenant?._id,
    req.tenantObjectId,
    req.tenantContext?._id,
    req.titechTenant?._id,
    req.tenantId,
  ];
  const value = candidates.find((candidate) => mongoose.isValidObjectId(candidate));
  if (!value) return null;
  return new mongoose.Types.ObjectId(String(value));
}

function safeSearchRegex(value) {
  return new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function memberDto(member) {
  const id = String(member._id);
  const name = [member.firstName, member.otherNames, member.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    id,
    _id: id,
    memberId: id,
    memberNumber: member.memberNumber ?? null,
    firstName: member.firstName ?? null,
    otherNames: member.otherNames ?? null,
    middleName: member.otherNames ?? null,
    lastName: member.lastName ?? null,
    fullName: name || null,
    name: name || null,
    email: member.email ?? null,
    phoneNumber: member.phoneNumber ?? null,
    alternatePhoneNumber: member.alternatePhoneNumber ?? null,
    gender: member.gender ?? null,
    dateOfBirth: member.dateOfBirth ?? null,
    address: member.address ?? null,
    district: member.district ?? null,
    subCounty: member.subCounty ?? null,
    village: member.village ?? null,
    occupation: member.occupation ?? null,
    employer: member.employer ?? null,
    memberStatus: member.memberStatus ?? 'PENDING',
    status: member.memberStatus ?? 'PENDING',
    kycStatus: member.kycStatus ?? 'PENDING',
    kycVerified: member.kycVerified === true,
    joinedAt: member.joinedAt ?? null,
    createdAt: member.createdAt ?? null,
    updatedAt: member.updatedAt ?? null,
  };
}

router.get('/', requirePermission(MEMBER_PERMISSION), async (req, res) => {
  const tenantId = getTenantObjectId(req);
  if (!tenantId) {
    return res.status(403).json({
      success: false,
      error: { code: 'TENANT_CONTEXT_INVALID', message: 'A valid tenant context is required for member access.' },
      requestId: req.requestId,
    });
  }

  const requestedPage = Number.parseInt(req.query.page, 10) || 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 100000)
    : 1;
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  const filter = { tenantId, deletedAt: null };
  const requestedStatus = String(req.query.status ?? '').trim().toUpperCase();

  if (requestedStatus && requestedStatus !== 'ALL') {
    if (requestedStatus === 'INACTIVE') {
      filter.memberStatus = { $in: ['DORMANT', 'EXITED', 'DECEASED'] };
    } else if (!MEMBER_STATUSES.has(requestedStatus)) {
      return res.status(400).json({
        success: false,
        error: { code: 'MEMBER_STATUS_INVALID', message: 'The requested member status is not supported.' },
        requestId: req.requestId,
      });
    } else {
      filter.memberStatus = requestedStatus;
    }
  }

  const search = String(req.query.search ?? '').trim().slice(0, 100);
  if (search) {
    const regex = safeSearchRegex(search);
    filter.$or = MEMBER_SEARCH_FIELDS.map((field) => ({ [field]: regex }));
  }

  try {
    const [documents, filteredTotal, tenantTotal, active, pending, suspended] = await Promise.all([
      Member.find(filter)
        .select('_id memberNumber firstName otherNames lastName email phoneNumber alternatePhoneNumber gender dateOfBirth address district subCounty village occupation employer memberStatus kycStatus kycVerified joinedAt createdAt updatedAt')
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Member.countDocuments(filter),
      Member.countDocuments({ tenantId, deletedAt: null }),
      Member.countDocuments({ tenantId, deletedAt: null, memberStatus: 'ACTIVE' }),
      Member.countDocuments({ tenantId, deletedAt: null, memberStatus: 'PENDING' }),
      Member.countDocuments({ tenantId, deletedAt: null, memberStatus: 'SUSPENDED' }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        members: documents.map(memberDto),
        pagination: { page, limit, total: filteredTotal, pages: Math.ceil(filteredTotal / limit) },
        summary: { total: tenantTotal, active, pending, suspended },
      },
      requestId: req.requestId,
    });
  } catch (error) {
    req.log?.error?.('Member directory read failed.', {
      code: error?.code || 'MEMBER_DIRECTORY_READ_FAILED',
      requestId: req.requestId,
      correlationId: req.correlationId,
    });
    return res.status(503).json({
      success: false,
      error: { code: 'MEMBER_DIRECTORY_UNAVAILABLE', message: 'The member directory is temporarily unavailable.' },
      requestId: req.requestId,
    });
  }
});

router.get('/:memberId', requirePermission(MEMBER_PERMISSION), async (req, res) => {
  const tenantId = getTenantObjectId(req);
  const { memberId } = req.params;

  if (typeof memberId !== 'string' || !/^[a-f\d]{24}$/i.test(memberId)) {
    return res.status(400).json({
      success: false,
      error: { code: 'MEMBER_ID_INVALID', message: 'The member identifier is not a valid record identifier.' },
      requestId: req.requestId,
    });
  }

  if (!tenantId) {
    return res.status(403).json({
      success: false,
      error: { code: 'TENANT_CONTEXT_INVALID', message: 'A valid tenant context is required for member access.' },
      requestId: req.requestId,
    });
  }

  try {
    const member = await Member.findOne({
      _id: new mongoose.Types.ObjectId(memberId),
      tenantId,
      deletedAt: null,
    })
      .select('_id memberNumber firstName otherNames lastName email phoneNumber alternatePhoneNumber gender dateOfBirth address district subCounty village occupation employer memberStatus kycStatus kycVerified joinedAt createdAt updatedAt')
      .lean();

    // A cross-tenant identifier is intentionally indistinguishable from an
    // absent record to prevent resource enumeration.
    if (!member) {
      return res.status(404).json({
        success: false,
        error: { code: 'MEMBER_NOT_FOUND', message: 'The requested member record was not found.' },
        requestId: req.requestId,
      });
    }

    return res.status(200).json({
      success: true,
      data: { member: memberDto(member) },
      requestId: req.requestId,
    });
  } catch (error) {
    req.log?.error?.('Member profile read failed.', {
      code: error?.code || 'MEMBER_PROFILE_READ_FAILED',
      requestId: req.requestId,
      correlationId: req.correlationId,
    });
    return res.status(503).json({
      success: false,
      error: { code: 'MEMBER_PROFILE_UNAVAILABLE', message: 'The member profile service is temporarily unavailable.' },
      requestId: req.requestId,
    });
  }
});

export default router;
