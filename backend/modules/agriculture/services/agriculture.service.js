import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Group from '../../../models/Group.js';
import Member from '../../../models/Member.js';
import FinancialTransaction from '../../../models/FinancialTransaction.js';
import Producer from '../models/Producer.js';
import Farm from '../models/Farm.js';
import Commodity from '../models/Commodity.js';
import Buyer from '../models/Buyer.js';
import ProductionCycle from '../models/ProductionCycle.js';
import OfftakeContract from '../models/OfftakeContract.js';
import Delivery from '../models/Delivery.js';
import AgricultureSettlement from '../models/AgricultureSettlement.js';
import { createAuditLog } from '../../audit/audit.service.js';
import financialRepositoryRegistry from '../../../services/financial/financialRepositoryRegistry.js';
import { processFinancialOperation } from '../../../services/financial/financialTransaction.service.js';
import { executeFinancialOperation, FINANCIAL_OPERATION } from '../../../services/financial/financialOperation.service.js';
import { AGRICULTURE_EVENT_TYPES } from '../constants.js';
import { AgricultureDomainError, addMoney, addQuantity, calculateAllocations, assertProducerOnboardingTransition, assertValidPricingMethod, compareQuantity, normalizeCurrency, normalizeMoney, normalizeProducerReview, normalizeQuantity, requireObjectId, stableStringifyPayload } from '../domain/agriculture.domain.js';

const { outboxRepository } = financialRepositoryRegistry;

function tenantObjectId(tenantId) {
  requireObjectId(String(tenantId), 'tenantId');
  return new mongoose.Types.ObjectId(tenantId);
}

function actorObjectId(actorId) {
  return actorId && mongoose.isValidObjectId(actorId) ? new mongoose.Types.ObjectId(actorId) : null;
}

function idempotencyFingerprint(payload) {
  return crypto.createHash('sha256').update(stableStringifyPayload(payload)).digest('hex');
}

async function withAuditTransaction(operation) {
  const session = await mongoose.startSession();
  try { let result; await session.withTransaction(async () => { result = await operation(session); }); return result; }
  finally { await session.endSession(); }
}

function getIdempotencyKey(input) {
  const key = String(input || '').trim();
  if (!key || key.length > 255) throw new AgricultureDomainError('Idempotency-Key is required and must not exceed 255 characters.', 'AGRICULTURE_IDEMPOTENCY_REQUIRED');
  return key;
}

async function replayOrConflict(Model, tenantId, key, payload, session = null) {
  if (!key) return null;
  const query = Model.findOne({ tenantId: tenantObjectId(tenantId), idempotencyKey: key });
  if (session) query.session(session);
  const existing = await query;
  if (!existing) return null;
  const fingerprint = idempotencyFingerprint(payload);
  if (existing.idempotencyFingerprint && existing.idempotencyFingerprint !== fingerprint) {
    throw new AgricultureDomainError('Idempotency-Key was reused with a different operation payload.', 'AGRICULTURE_IDEMPOTENCY_CONFLICT', 409);
  }
  return { replay: true, resource: existing };
}

async function writeAudit({ tenantId, actorId, action, data, requestId, correlationId, session = null }) {
  return createAuditLog({ tenantId, action, data, actorId, requestId, correlationId, session });
}

async function requireGroup(tenantId, groupId, session = null) {
  const query = Group.findOne({ _id: groupId, tenantId: tenantObjectId(tenantId), deletedAt: null });
  if (session) query.session(session);
  const group = await query;
  if (!group) throw new AgricultureDomainError('Group was not found for the active tenant.', 'AGRICULTURE_GROUP_NOT_FOUND', 404);
  return group;
}

async function assertGroupAgricultureEnabled(tenantId, groupId, session = null) {
  const group = await requireGroup(tenantId, groupId, session);
  if (group.capabilities?.agriculture !== true) throw new AgricultureDomainError('Agriculture capability is not enabled for this group.', 'AGRICULTURE_GROUP_CAPABILITY_DISABLED', 409);
  return group;
}

async function assertMemberBelongsToGroup(tenantId, member, group) {
  if (!member) throw new AgricultureDomainError('Member was not found.', 'AGRICULTURE_MEMBER_NOT_FOUND', 404);
  if (String(member.tenantId) !== String(tenantId)) throw new AgricultureDomainError('Member does not belong to the active tenant.', 'TENANT_ACCESS_DENIED', 403);
  if (!member.userId) throw new AgricultureDomainError('The member has no linked authentication identity for group membership validation.', 'AGRICULTURE_MEMBER_IDENTITY_REQUIRED', 409);
  const userId = String(member.userId);
  const acceptedProjection = (group.memberRoles || []).some((item) => String(item.userId) === userId && item.invitationStatus === 'accepted' && !item.removedAt);
  const acceptedLegacy = (group.members || []).some((item) => String(item) === userId);
  if (!acceptedProjection && !acceptedLegacy) throw new AgricultureDomainError('Producer member is not an accepted member of the selected group.', 'AGRICULTURE_GROUP_MEMBERSHIP_REQUIRED', 403);
}

function assertProducerApproved(producer) {
  if (!producer || producer.status !== 'ACTIVE' || producer.verificationStatus !== 'VERIFIED' || !['COMPLETED', 'APPROVED'].includes(producer.onboardingStatus)) {
    throw new AgricultureDomainError('Producer onboarding and institutional verification must be complete before this operation.', 'AGRICULTURE_PRODUCER_NOT_VERIFIED', 409);
  }
}

async function createWithIdempotency(Model, tenantId, payload, key, createPayload, session = null) {
  const existing = await replayOrConflict(Model, tenantId, key, payload, session);
  if (existing) return existing;
  try {
    const document = { ...createPayload, tenantId: tenantObjectId(tenantId), idempotencyKey: key, idempotencyFingerprint: idempotencyFingerprint(payload) };
    const record = session ? (await Model.create([document], { session }))[0] : await Model.create(document);
    return { replay: false, resource: record };
  } catch (error) {
    if (!session && error?.code === 11000 && key) {
      const replay = await replayOrConflict(Model, tenantId, key, payload);
      if (replay) return replay;
    }
    if (error?.code === 11000) {
      throw new AgricultureDomainError('The requested agriculture resource already exists with a conflicting unique reference.', 'AGRICULTURE_DUPLICATE_REFERENCE', 409);
    }
    throw error;
  }
}

export async function enableGroupAgriculture({ tenantId, groupId, actorId, requestId, correlationId }) {
  return withAuditTransaction(async (session) => {
    const group = await requireGroup(tenantId, requireObjectId(groupId, 'groupId'), session);
    if (group.capabilities?.agriculture === true) return { replay: true, group };
    group.set('capabilities.agriculture', true);
    await group.save({ session });
    await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_GROUP_ENABLED', data: { groupId: String(group._id) }, requestId, correlationId, session });
    return { replay: false, group };
  });
}

export async function createProducer({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey);
  const memberId = requireObjectId(data.memberId, 'memberId');
  return withAuditTransaction(async (session) => {
    const member = await Member.findOne({ _id: memberId, tenantId: tenantObjectId(tenantId) }).session(session);
    if (!member) throw new AgricultureDomainError('Member was not found for the active tenant.', 'AGRICULTURE_MEMBER_NOT_FOUND', 404);
    let group = null;
    if (data.groupId) {
      group = await assertGroupAgricultureEnabled(tenantId, requireObjectId(data.groupId, 'groupId'), session);
      await assertMemberBelongsToGroup(tenantId, member, group);
    }
    const result = await createWithIdempotency(Producer, tenantId,
      { memberId, groupId: group?._id || null, producerType: data.producerType, primaryLocation: data.primaryLocation || null }, key,
      { memberId, groupId: group?._id || null, producerType: data.producerType || 'INDIVIDUAL_FARMER', primaryLocation: data.primaryLocation || null,
        preferredLanguage: data.preferredLanguage || 'en', contactChannels: data.contactChannels || {}, onboardingStatus: 'IN_PROGRESS', status: 'INACTIVE', verificationStatus: 'PENDING', createdBy: String(actorId), syncStatus: data.syncStatus || 'SERVER_ACCEPTED', deviceId: data.deviceId || null, clientOperationId: data.clientOperationId || null, payloadHash: data.payloadHash || null }, session);
    if (!result.replay) await writeAudit({ tenantId, actorId, action: AGRICULTURE_EVENT_TYPES.PRODUCER_REGISTERED, data: { producerId: String(result.resource._id), memberId }, requestId, correlationId, session });
    return result;
  });
}

export async function submitProducerOnboarding({ tenantId, actorId, requestId, correlationId, producerId }) {
  return withAuditTransaction(async (session) => {
    const producer = await Producer.findOne({ _id: requireObjectId(producerId, 'producerId'), tenantId: tenantObjectId(tenantId) }).session(session);
    if (!producer) throw new AgricultureDomainError('Producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
    const previous = producer.onboardingStatus;
    assertProducerOnboardingTransition(previous, 'SUBMITTED');
    producer.onboardingStatus = 'SUBMITTED'; producer.submittedBy = String(actorId); producer.submittedAt = new Date();
    producer.onboardingHistory.push({ fromStatus: previous, toStatus: 'SUBMITTED', actorId: String(actorId) });
    await producer.save({ session });
    await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_PRODUCER_SUBMITTED', data: { producerId: String(producer._id), fromStatus: previous, toStatus: 'SUBMITTED' }, requestId, correlationId, session });
    return { resource: producer };
  });
}

export async function resubmitProducerOnboarding({ tenantId, actorId, requestId, correlationId, producerId }) {
  return withAuditTransaction(async (session) => {
    const producer = await Producer.findOne({ _id: requireObjectId(producerId, 'producerId'), tenantId: tenantObjectId(tenantId) }).session(session);
    if (!producer) throw new AgricultureDomainError('Producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
    const previous = producer.onboardingStatus;
    if (previous !== 'VERIFICATION_REQUIRED') throw new AgricultureDomainError('Only a producer returned for correction can be resubmitted.', 'AGRICULTURE_PRODUCER_RESUBMIT_STATE_INVALID', 409);
    assertProducerOnboardingTransition(previous, 'SUBMITTED');
    producer.onboardingStatus = 'SUBMITTED'; producer.submittedBy = String(actorId); producer.submittedAt = new Date();
    producer.onboardingHistory.push({ fromStatus: previous, toStatus: 'SUBMITTED', actorId: String(actorId) });
    await producer.save({ session });
    await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_PRODUCER_RESUBMITTED', data: { producerId: String(producer._id), fromStatus: previous, toStatus: 'SUBMITTED' }, requestId, correlationId, session });
    return { resource: producer };
  });
}

export async function reviewProducerOnboarding({ tenantId, actorId, requestId, correlationId, producerId, data = {} }) {
  const review = normalizeProducerReview(data);
  return withAuditTransaction(async (session) => {
    const producer = await Producer.findOne({ _id: requireObjectId(producerId, 'producerId'), tenantId: tenantObjectId(tenantId) }).session(session);
    if (!producer) throw new AgricultureDomainError('Producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
    if (producer.createdBy && String(producer.createdBy) === String(actorId) || producer.submittedBy && String(producer.submittedBy) === String(actorId)) {
      throw new AgricultureDomainError('The producer applicant cannot review their own onboarding.', 'AGRICULTURE_PRODUCER_SELF_REVIEW_FORBIDDEN', 403);
    }
    const previous = producer.onboardingStatus;
    assertProducerOnboardingTransition(previous, review.decision);
    producer.onboardingStatus = review.decision === 'APPROVED' ? 'COMPLETED' : review.decision;
    producer.verificationStatus = review.decision === 'APPROVED' ? 'VERIFIED' : review.decision === 'REJECTED' ? 'REJECTED' : 'PENDING';
    producer.status = review.decision === 'APPROVED' ? 'ACTIVE' : 'INACTIVE';
    producer.reviewedBy = String(actorId); producer.reviewedAt = new Date(); producer.reviewReason = review.reason;
    producer.onboardingHistory.push({ fromStatus: previous, toStatus: producer.onboardingStatus, actorId: String(actorId), reason: review.reason });
    await producer.save({ session });
    await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_PRODUCER_REVIEWED', data: { producerId: String(producer._id), fromStatus: previous, decision: review.decision, toStatus: producer.onboardingStatus, reason: review.reason }, requestId, correlationId, session });
    return { resource: producer };
  });
}

export async function createFarm({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey);
  const producerId = requireObjectId(data.producerId, 'producerId');
  return withAuditTransaction(async (session) => {
    const producer = await Producer.findOne({ _id: producerId, tenantId: tenantObjectId(tenantId) }).session(session);
    if (!producer) throw new AgricultureDomainError('Producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
    if (producer.status !== 'ACTIVE' || producer.verificationStatus !== 'VERIFIED' || !['COMPLETED', 'APPROVED'].includes(producer.onboardingStatus)) throw new AgricultureDomainError('Producer onboarding and verification must be complete before registering a farm.', 'AGRICULTURE_PRODUCER_NOT_VERIFIED', 409);
    const groupId = data.groupId || producer.groupId || null;
    if (groupId) { const group = await assertGroupAgricultureEnabled(tenantId, requireObjectId(groupId, 'groupId'), session); if (String(producer.groupId || '') !== String(group._id)) throw new AgricultureDomainError('Farm group does not match the producer group.', 'AGRICULTURE_FARM_GROUP_MISMATCH', 409); }
    const result = await createWithIdempotency(Farm, tenantId, { producerId, groupId, acreage: String(data.acreage), location: data.location || null }, key,
      { producerId, groupId, location: data.location || null, acreage: String(data.acreage), landTenureType: data.landTenureType || 'UNKNOWN', irrigationStatus: data.irrigationStatus || 'UNKNOWN', soilInformation: data.soilInformation || null, productionSystems: Array.isArray(data.productionSystems) ? data.productionSystems : [], verificationStatus: 'PENDING', status: 'INACTIVE', createdBy: String(actorId), deviceId: data.deviceId || null, clientOperationId: data.clientOperationId || null, payloadHash: data.payloadHash || null, syncStatus: data.syncStatus || 'SERVER_ACCEPTED' }, session);
    if (!result.replay) await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_FARM_REGISTERED', data: { farmId: String(result.resource._id), producerId }, requestId, correlationId, session });
    return result;
  });
}

export async function verifyFarm({ tenantId, actorId, requestId, correlationId, farmId, data = {} }) {
  const decision = String(data.decision || '').trim().toUpperCase();
  const reason = String(data.reason || '').trim();
  if (!['VERIFIED', 'REJECTED'].includes(decision)) throw new AgricultureDomainError('Farm verification decision is invalid.', 'AGRICULTURE_FARM_REVIEW_DECISION_INVALID', 422);
  if (decision === 'REJECTED' && reason.length < 5) throw new AgricultureDomainError('A reason is required to reject a farm.', 'AGRICULTURE_FARM_REVIEW_REASON_REQUIRED', 422);
  if (reason.length > 1000) throw new AgricultureDomainError('Farm review reason is too long.', 'AGRICULTURE_FARM_REVIEW_REASON_INVALID', 422);
  return withAuditTransaction(async (session) => {
    const farm = await Farm.findOne({ _id: requireObjectId(farmId, 'farmId'), tenantId: tenantObjectId(tenantId) }).session(session);
    if (!farm) throw new AgricultureDomainError('Farm not found.', 'AGRICULTURE_FARM_NOT_FOUND', 404);
    if (farm.createdBy && String(farm.createdBy) === String(actorId)) throw new AgricultureDomainError('The farm creator cannot verify their own farm.', 'AGRICULTURE_FARM_SELF_REVIEW_FORBIDDEN', 403);
    if (farm.verificationStatus !== 'PENDING' && farm.verificationStatus !== 'VALIDATED') {
      if (farm.verificationStatus === decision) return { replay: true, resource: farm };
      throw new AgricultureDomainError('Farm is not awaiting verification.', 'AGRICULTURE_FARM_REVIEW_STATE_INVALID', 409);
    }
    farm.verificationStatus = decision; farm.status = decision === 'VERIFIED' ? 'ACTIVE' : 'INACTIVE';
    farm.metadata = { ...(farm.metadata || {}), reviewReason: reason || null, reviewedBy: String(actorId), reviewedAt: new Date() };
    await farm.save({ session });
    await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_FARM_REVIEWED', data: { farmId: String(farm._id), producerId: String(farm.producerId), decision, reason: reason || null }, requestId, correlationId, session });
    return { replay: false, resource: farm };
  });
}

export async function createCommodity({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = idempotencyKey ? getIdempotencyKey(idempotencyKey) : null;
  return withAuditTransaction(async (session) => {
    if (key) {
      const existing = await replayOrConflict(Commodity, tenantId, key, data, session);
      if (existing) return existing;
    }
    const payload = {
      tenantId: tenantObjectId(tenantId), code: String(data.code).trim().toUpperCase(),
      name: String(data.name).trim(), variety: data.variety || null, units: data.units || [],
      qualityGrades: data.qualityGrades || [], pricingModels: data.pricingModels || [],
      seasonality: data.seasonality || null, productionMetrics: data.productionMetrics || [], status: 'ACTIVE',
      ...(key ? { idempotencyKey: key, idempotencyFingerprint: idempotencyFingerprint(data) } : {}),
    };
    const record = (await Commodity.create([payload], { session }))[0];
    await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_COMMODITY_CREATED', data: { commodityId: String(record._id), code: record.code, name: record.name }, requestId, correlationId, session });
    return { replay: false, resource: record };
  });
}

async function ensureProducerFarm(tenantId, producerId, farmId, session = null) {
  const producerQuery = Producer.findOne({ _id: producerId, tenantId: tenantObjectId(tenantId) });
  const farmQuery = Farm.findOne({ _id: farmId, tenantId: tenantObjectId(tenantId), producerId, status: 'ACTIVE', verificationStatus: 'VERIFIED' });
  if (session) { producerQuery.session(session); farmQuery.session(session); }
  const [producer, farm] = await Promise.all([producerQuery, farmQuery]);
  if (!producer) throw new AgricultureDomainError('Producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
  assertProducerApproved(producer);
  if (!farm) throw new AgricultureDomainError('Farm not found for producer.', 'AGRICULTURE_FARM_NOT_FOUND', 404);
  return { producer, farm };
}

export async function createProductionCycle({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey);
  const producerId = requireObjectId(data.producerId, 'producerId');
  const farmId = requireObjectId(data.farmId, 'farmId');
  const commodityId = requireObjectId(data.commodityId, 'commodityId');
  return withAuditTransaction(async (session) => {
    const { producer, farm } = await ensureProducerFarm(tenantId, producerId, farmId, session);
    if (data.groupId) {
      const group = await assertGroupAgricultureEnabled(tenantId, requireObjectId(data.groupId, 'groupId'), session);
      if (String(producer.groupId || '') !== String(group._id)) throw new AgricultureDomainError('Production cycle group does not match the producer group.', 'AGRICULTURE_PRODUCTION_GROUP_MISMATCH', 409);
    }
    const commodity = await Commodity.findOne({ _id: commodityId, tenantId: tenantObjectId(tenantId), status: 'ACTIVE' }).session(session);
    if (!commodity) throw new AgricultureDomainError('Commodity not found.', 'AGRICULTURE_COMMODITY_NOT_FOUND', 404);
    const result = await createWithIdempotency(ProductionCycle, tenantId,
      { producerId, farmId, commodityId, season: data.season }, key,
      { producerId, farmId, groupId: data.groupId || producer.groupId || null, commodityId, season: String(data.season).trim(), plantingDate: data.plantingDate || null, expectedHarvestDate: data.expectedHarvestDate || null, area: String(data.area), expectedYield: data.expectedYield ?? null, unitOfMeasure: String(data.unitOfMeasure).trim(), productionStatus: 'PLANNED', verificationStatus: 'PENDING', activities: [], deviceId: data.deviceId || null, clientOperationId: data.clientOperationId || null, payloadHash: data.payloadHash || null, syncStatus: data.syncStatus || 'SERVER_ACCEPTED' }, session);
    if (!result.replay) await writeAudit({ tenantId, actorId, action: AGRICULTURE_EVENT_TYPES.PRODUCTION_CYCLE_CREATED, data: { productionCycleId: String(result.resource._id), producerId, farmId, commodityId }, requestId, correlationId, session });
    return result;
  });
}

export async function recordProductionActivity({ tenantId, actorId, requestId, correlationId, productionCycleId, idempotencyKey, data }) {
  const operationId = getIdempotencyKey(idempotencyKey);
  const cycleId = requireObjectId(productionCycleId, 'productionCycleId');
  return withAuditTransaction(async (session) => {
    const cycle = await ProductionCycle.findOne({ _id: cycleId, tenantId: tenantObjectId(tenantId) }).session(session);
    if (!cycle) throw new AgricultureDomainError('Production cycle not found.', 'AGRICULTURE_PRODUCTION_CYCLE_NOT_FOUND', 404);
    const existing = cycle.activities?.find((item) => item.clientOperationId === operationId);
    if (existing) return { replay: true, resource: existing, productionCycle: cycle };
    const type = String(data.type || '').trim().toUpperCase();
    if (!type) throw new AgricultureDomainError('Activity type is required.', 'AGRICULTURE_ACTIVITY_TYPE_REQUIRED');
    const payload = { type, date: data.date || new Date(), quantity: data.quantity ?? null, unit: data.unit || null, note: data.note || null, evidenceRefs: data.evidenceRefs || [] };
    cycle.activities.push({ ...payload, clientOperationId: operationId, payloadHash: idempotencyFingerprint(payload) });
    cycle.markModified('activities');
    await cycle.save({ session });
    await writeAudit({ tenantId, actorId, action: AGRICULTURE_EVENT_TYPES.PRODUCTION_ACTIVITY_RECORDED, data: { productionCycleId: String(cycle._id), activityType: type, clientOperationId: operationId }, requestId, correlationId, session });
    return { replay: false, resource: cycle.activities[cycle.activities.length - 1], productionCycle: cycle };
  });
}

export async function createBuyer({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey);
  return withAuditTransaction(async (session) => {
    const result = await createWithIdempotency(Buyer, tenantId, { name: data.name, buyerType: data.buyerType }, key,
      { name: String(data.name).trim(), buyerType: String(data.buyerType || 'OTHER').trim().toUpperCase(), organizationId: data.organizationId || null, registration: data.registration || null, contact: data.contact || null, commodities: data.commodities || [], locations: data.locations || [], contractPreferences: data.contractPreferences || {}, settlementMethods: data.settlementMethods || [], verificationStatus: 'PENDING', complianceStatus: 'PENDING', status: 'INACTIVE', createdBy: String(actorId) }, session);
    if (!result.replay) await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_BUYER_REGISTERED', data: { buyerId: String(result.resource._id) }, requestId, correlationId, session });
    return result;
  });
}

export async function reviewBuyer({ tenantId, actorId, requestId, correlationId, buyerId, data = {} }) {
  const verificationStatus = String(data.verificationStatus || '').trim().toUpperCase();
  const complianceStatus = String(data.complianceStatus || '').trim().toUpperCase();
  const reason = String(data.reason || '').trim();
  if (!['VERIFIED', 'REJECTED'].includes(verificationStatus)) throw new AgricultureDomainError('Buyer verification decision is invalid.', 'AGRICULTURE_BUYER_REVIEW_DECISION_INVALID', 422);
  if (!['CLEARED', 'REVIEW', 'BLOCKED'].includes(complianceStatus)) throw new AgricultureDomainError('Buyer compliance decision is invalid.', 'AGRICULTURE_BUYER_COMPLIANCE_DECISION_INVALID', 422);
  if ((verificationStatus !== 'VERIFIED' || complianceStatus !== 'CLEARED') && reason.length < 5) throw new AgricultureDomainError('A reason is required for a non-clear buyer decision.', 'AGRICULTURE_BUYER_REVIEW_REASON_REQUIRED', 422);
  if (reason.length > 1000) throw new AgricultureDomainError('Buyer review reason is too long.', 'AGRICULTURE_BUYER_REVIEW_REASON_INVALID', 422);
  return withAuditTransaction(async (session) => {
    const buyer = await Buyer.findOne({ _id: requireObjectId(buyerId, 'buyerId'), tenantId: tenantObjectId(tenantId) }).session(session);
    if (!buyer) throw new AgricultureDomainError('Buyer not found.', 'AGRICULTURE_BUYER_NOT_FOUND', 404);
    if (buyer.createdBy && String(buyer.createdBy) === String(actorId)) throw new AgricultureDomainError('The buyer creator cannot approve their own buyer onboarding.', 'AGRICULTURE_BUYER_SELF_REVIEW_FORBIDDEN', 403);
    if (buyer.verificationStatus !== 'PENDING' && buyer.verificationStatus !== 'VALIDATED') {
      if (buyer.verificationStatus === verificationStatus && buyer.complianceStatus === complianceStatus) return { replay: true, resource: buyer };
      throw new AgricultureDomainError('Buyer is not awaiting verification.', 'AGRICULTURE_BUYER_REVIEW_STATE_INVALID', 409);
    }
    buyer.verificationStatus = verificationStatus; buyer.complianceStatus = complianceStatus;
    buyer.status = verificationStatus === 'VERIFIED' && complianceStatus === 'CLEARED' ? 'ACTIVE' : 'INACTIVE';
    buyer.reviewedBy = String(actorId); buyer.reviewedAt = new Date(); buyer.reviewReason = reason || null;
    buyer.reviewHistory.push({ verificationStatus, complianceStatus, actorId: String(actorId), reason: reason || null });
    await buyer.save({ session });
    await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_BUYER_REVIEWED', data: { buyerId: String(buyer._id), verificationStatus, complianceStatus, status: buyer.status, reason: reason || null }, requestId, correlationId, session });
    return { replay: false, resource: buyer };
  });
}

export async function createOfftakeContract({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey);
  const buyerId = requireObjectId(data.buyerId, 'buyerId');
  const commodityId = requireObjectId(data.commodityId, 'commodityId');
  return withAuditTransaction(async (session) => {
    const replay = await replayOrConflict(OfftakeContract, tenantId, key, data, session);
    if (replay) return replay;
    const buyer = await Buyer.findOne({ _id: buyerId, tenantId: tenantObjectId(tenantId), status: 'ACTIVE', verificationStatus: 'VERIFIED', complianceStatus: 'CLEARED' }).session(session);
    if (!buyer) throw new AgricultureDomainError('Buyer onboarding, verification and compliance clearance must be complete before contracting.', 'AGRICULTURE_BUYER_NOT_VERIFIED', 409);
    if (!data.producerId && !data.groupId) throw new AgricultureDomainError('An offtake contract must identify a producer or group seller.', 'AGRICULTURE_CONTRACT_SELLER_REQUIRED');
    if (data.producerId) {
      const producer = await Producer.findOne({ _id: requireObjectId(data.producerId, 'producerId'), tenantId: tenantObjectId(tenantId) }).session(session);
      if (!producer) throw new AgricultureDomainError('Producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
      assertProducerApproved(producer);
      if (data.groupId && String(producer.groupId || '') !== String(data.groupId)) throw new AgricultureDomainError('Producer does not belong to the contract group.', 'AGRICULTURE_CONTRACT_GROUP_MISMATCH', 409);
    }
    if (data.groupId) await assertGroupAgricultureEnabled(tenantId, requireObjectId(data.groupId, 'groupId'), session);
    const commodity = await Commodity.findOne({ _id: commodityId, tenantId: tenantObjectId(tenantId), status: 'ACTIVE' }).session(session);
    if (!commodity) throw new AgricultureDomainError('Commodity not found.', 'AGRICULTURE_COMMODITY_NOT_FOUND', 404);
    assertValidPricingMethod(data.pricingMethod);
    const currency = normalizeCurrency(data.currency);
    const price = normalizeMoney(data.price, 'price');
    const expectedQuantity = normalizeQuantity(data.expectedQuantity, 'expectedQuantity');
    const result = await createWithIdempotency(OfftakeContract, tenantId,
      { buyerId, producerId: data.producerId || null, groupId: data.groupId || null, commodityId, expectedQuantity, price, currency }, key,
      { buyerId, producerId: data.producerId || null, groupId: data.groupId || null, commodityId, expectedQuantity,
        fulfilledQuantity: '0', unit: String(data.unit).trim(), pricingMethod: String(data.pricingMethod).trim().toUpperCase(), price, currency,
        qualityRequirements: data.qualityRequirements || null, deliveryWindow: data.deliveryWindow || null,
        paymentTerms: data.paymentTerms || null, deductions: data.deductions || [], financingLink: data.financingLink || null, status: 'ACTIVE' }, session);
    if (!result.replay) await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_OFFTAKE_CONTRACT_CREATED', data: { contractId: String(result.resource._id), buyerId, producerId: data.producerId || null, groupId: data.groupId || null, commodityId, expectedQuantity, currency }, requestId, correlationId, session });
    return result;
  });
}

export async function createDelivery({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey);
  const contractId = requireObjectId(data.contractId, 'contractId');
  const producerId = requireObjectId(data.producerId, 'producerId');
  const productionCycleId = requireObjectId(data.productionCycleId, 'productionCycleId');
  return withAuditTransaction(async (session) => {
    const contract = await OfftakeContract.findOne({ _id: contractId, tenantId: tenantObjectId(tenantId), status: { $in: ['ACTIVE', 'PARTIALLY_FULFILLED'] } }).session(session);
    if (!contract) throw new AgricultureDomainError('Active offtake contract not found.', 'AGRICULTURE_CONTRACT_NOT_FOUND', 404);
    if (contract.producerId && String(contract.producerId) !== String(producerId)) throw new AgricultureDomainError('Delivery producer does not match the contract.', 'AGRICULTURE_DELIVERY_PARTY_MISMATCH', 409);
    const producer = await Producer.findOne({ _id: producerId, tenantId: tenantObjectId(tenantId) }).session(session);
    if (!producer) throw new AgricultureDomainError('Delivery producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
    assertProducerApproved(producer);
    if (contract.groupId && String(producer.groupId || '') !== String(contract.groupId)) throw new AgricultureDomainError('Delivery producer does not belong to the contract group.', 'AGRICULTURE_DELIVERY_GROUP_MISMATCH', 409);
    const buyer = await Buyer.findOne({ _id: contract.buyerId, tenantId: tenantObjectId(tenantId), status: 'ACTIVE', verificationStatus: 'VERIFIED', complianceStatus: 'CLEARED' }).session(session);
    if (!buyer) throw new AgricultureDomainError('Contract buyer is not verified and cleared.', 'AGRICULTURE_BUYER_NOT_VERIFIED', 409);
    const cycle = await ProductionCycle.findOne({ _id: productionCycleId, tenantId: tenantObjectId(tenantId), producerId, commodityId: contract.commodityId }).session(session);
    if (!cycle) throw new AgricultureDomainError('Production cycle is not valid for this contract producer and commodity.', 'AGRICULTURE_PRODUCTION_CYCLE_NOT_FOUND', 404);
    await ensureProducerFarm(tenantId, producerId, cycle.farmId, session);
    const unit = String(data.unit || '').trim();
    if (!unit) throw new AgricultureDomainError('Delivery unit is required.', 'AGRICULTURE_DELIVERY_UNIT_REQUIRED');
    if (unit !== String(contract.unit).trim()) throw new AgricultureDomainError('Delivery unit does not match the contract unit.', 'AGRICULTURE_DELIVERY_UNIT_MISMATCH', 409);
    const quantity = normalizeQuantity(data.quantity);
    const result = await createWithIdempotency(Delivery, tenantId, { contractId, producerId, quantity, productionCycleId }, key,
      { contractId, producerId, buyerId: contract.buyerId, productionCycleId, quantity, unit, createdBy: String(actorId), qualityGrade: data.qualityGrade || null, warehouse: data.warehouse || null, deliveryDate: data.deliveryDate || new Date(), receivingParty: data.receivingParty || null, supportingEvidence: data.supportingEvidence || [], verificationStatus: 'PENDING', status: 'PENDING_VERIFICATION', deviceId: data.deviceId || null, clientOperationId: data.clientOperationId || null, payloadHash: data.payloadHash || null, syncStatus: data.syncStatus || 'SERVER_ACCEPTED' }, session);
    if (!result.replay) await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_DELIVERY_CREATED', data: { deliveryId: String(result.resource._id), contractId, producerId, quantity, unit }, requestId, correlationId, session });
    return result;
  });
}

async function sumContractDeliveries(tenantId, contractId) {
  const rows = await Delivery.aggregate([
    { $match: { tenantId: tenantObjectId(tenantId), contractId, status: { $in: ['VERIFIED', 'SETTLED'] } } },
    { $group: { _id: null, quantity: { $sum: { $toDecimal: '$quantity' } } } },
  ]);
  return rows[0]?.quantity?.toString?.() || '0';
}

export async function verifyDelivery({ tenantId, actorId, requestId, correlationId, deliveryId }) {
  return withAuditTransaction(async (session) => {
    const id = requireObjectId(deliveryId, 'deliveryId');
    const delivery = await Delivery.findOne({ _id: id, tenantId: tenantObjectId(tenantId) }).session(session);
    if (!delivery) throw new AgricultureDomainError('Delivery not found.', 'AGRICULTURE_DELIVERY_NOT_FOUND', 404);
    if (delivery.status === 'VERIFIED' || delivery.status === 'SETTLED') return { replay: true, resource: delivery };
    if (delivery.createdBy && String(delivery.createdBy) === String(actorId)) throw new AgricultureDomainError('The delivery creator cannot verify their own delivery.', 'AGRICULTURE_DELIVERY_SELF_REVIEW_FORBIDDEN', 403);
    if (delivery.status !== 'PENDING_VERIFICATION') throw new AgricultureDomainError('Only pending deliveries can be verified.', 'AGRICULTURE_DELIVERY_STATE_INVALID', 409);
    const contract = await OfftakeContract.findOne({ _id: delivery.contractId, tenantId: tenantObjectId(tenantId) }).session(session);
    if (!contract) throw new AgricultureDomainError('Contract not found.', 'AGRICULTURE_CONTRACT_NOT_FOUND', 404);
    const previouslyVerified = await Delivery.aggregate([
      { $match: { tenantId: tenantObjectId(tenantId), contractId: contract._id, status: { $in: ['VERIFIED', 'SETTLED'] } } },
      { $group: { _id: null, quantity: { $sum: { $toDecimal: '$quantity' } } } },
    ]).session(session);
    const aggregatedCurrent = previouslyVerified[0]?.quantity?.toString?.() || '0';
    const storedCurrent = String(contract.fulfilledQuantity || '0');
    const current = compareQuantity(storedCurrent, aggregatedCurrent) > 0 ? storedCurrent : aggregatedCurrent;
    const projected = addQuantity(current, String(delivery.quantity));
    if (compareQuantity(projected, contract.expectedQuantity.toString()) > 0) throw new AgricultureDomainError('Verified deliveries would exceed the contracted quantity.', 'AGRICULTURE_DELIVERY_QUANTITY_EXCEEDED', 409, { projectedQuantity: projected, expectedQuantity: contract.expectedQuantity.toString() });
    contract.fulfilledQuantity = projected;
    contract.status = compareQuantity(projected, contract.expectedQuantity.toString()) === 0 ? 'FULFILLED' : 'PARTIALLY_FULFILLED';
    await contract.save({ session });
    delivery.status = 'VERIFIED'; delivery.verificationStatus = 'VERIFIED';
    delivery.metadata = { ...(delivery.metadata || {}), verifiedBy: String(actorId), verifiedAt: new Date() };
    await delivery.save({ session });
    await writeAudit({ tenantId, actorId, action: AGRICULTURE_EVENT_TYPES.DELIVERY_VERIFIED, data: { deliveryId: String(delivery._id), contractId: String(delivery.contractId), quantity: delivery.quantity.toString(), fulfilledQuantity: projected }, requestId, correlationId, session });
    return { replay: false, resource: delivery };
  });
}

export async function createSettlement({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey);
  const deliveryId = requireObjectId(data.deliveryId, 'deliveryId');
  return withAuditTransaction(async (session) => {
    const replay = await replayOrConflict(AgricultureSettlement, tenantId, key, data, session);
    if (replay) return replay;
    const delivery = await Delivery.findOne({ _id: deliveryId, tenantId: tenantObjectId(tenantId), status: 'VERIFIED' }).session(session);
    if (!delivery) throw new AgricultureDomainError('A verified and unsettled delivery is required for settlement.', 'AGRICULTURE_DELIVERY_NOT_VERIFIED', 409);
    const producer = await Producer.findOne({ _id: delivery.producerId, tenantId: tenantObjectId(tenantId) }).session(session);
    if (!producer) throw new AgricultureDomainError('Delivery producer was not found for settlement.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
    assertProducerApproved(producer);
    const requestedGroupId = data.groupId || producer.groupId || null;
    if (requestedGroupId) {
      const group = await assertGroupAgricultureEnabled(tenantId, requireObjectId(requestedGroupId, 'groupId'), session);
      if (String(producer.groupId || '') !== String(group._id)) throw new AgricultureDomainError('Settlement group does not match the delivery producer group.', 'AGRICULTURE_SETTLEMENT_GROUP_MISMATCH', 409);
    }
    const grossAmount = normalizeMoney(data.grossAmount, 'grossAmount');
    const currency = normalizeCurrency(data.currency);
    const allocations = calculateAllocations({ amount: grossAmount, rule: data.allocationRule || 'EXPLICIT', recipients: data.allocations || data.recipients });
    const record = (await AgricultureSettlement.create([{
      tenantId: tenantObjectId(tenantId), deliveryId, buyerId: delivery.buyerId, producerId: delivery.producerId,
      groupId: requestedGroupId || null, productionCycleId: delivery.productionCycleId,
      invoiceReference: data.invoiceReference || null, grossAmount, currency,
      sourceAccountId: requireObjectId(data.sourceAccountId, 'sourceAccountId'),
      allocationRule: String(data.allocationRule || 'EXPLICIT').toUpperCase(), allocationFormulaVersion: 'v1',
      allocations, paymentEvidence: [], status: 'PENDING_PAYMENT', reconciliationStatus: 'UNMATCHED',
      idempotencyKey: key, idempotencyFingerprint: idempotencyFingerprint(data), actorId: actorObjectId(actorId),
      metadata: { requestId, correlationId, confirmationBlockedUntilProviderIntegration: true },
    }], { session }))[0];
    await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_SETTLEMENT_CREATED', data: { settlementId: String(record._id), deliveryId, grossAmount, currency }, requestId, correlationId, session });
    return { replay: false, resource: record };
  });
}

export async function confirmSettlement() {
  throw new AgricultureDomainError('Settlement cannot be confirmed until an approved provider adapter has verified the original provider outcome and settlement evidence.', 'AGRICULTURE_PROVIDER_OUTCOME_UNVERIFIED', 503);
}

export async function getProducerFinancialHistory({ tenantId, producerId }) {
  const id = requireObjectId(producerId, 'producerId');
  const producer = await Producer.findOne({ _id: id, tenantId: tenantObjectId(tenantId) }).lean(); if (!producer) throw new AgricultureDomainError('Producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
  const transactions = await FinancialTransaction.find({ tenantId: String(tenantId), status: 'COMPLETED', 'metadata.producerId': String(id) }).sort({ completedAt: -1, createdAt: -1 }).limit(500).lean();
  return { producerId: String(id), transactions };
}

export async function list({ tenantId, resource, filter = {}, limit = 50 }) {
  const Models = { producers: Producer, farms: Farm, commodities: Commodity, buyers: Buyer, productionCycles: ProductionCycle, contracts: OfftakeContract, deliveries: Delivery, settlements: AgricultureSettlement };
  const Model = Models[resource]; if (!Model) throw new AgricultureDomainError('Unsupported agriculture resource.', 'AGRICULTURE_RESOURCE_INVALID');
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return Model.find({ ...filter, tenantId: tenantObjectId(tenantId) }).sort({ createdAt: -1 }).limit(safeLimit).lean();
}
