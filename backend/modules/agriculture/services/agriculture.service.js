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
import { AgricultureDomainError, addMoney, addQuantity, calculateAllocations, assertValidPricingMethod, compareQuantity, normalizeCurrency, normalizeMoney, normalizeQuantity, requireObjectId } from '../domain/agriculture.domain.js';

const { outboxRepository } = financialRepositoryRegistry;

function tenantObjectId(tenantId) {
  requireObjectId(String(tenantId), 'tenantId');
  return new mongoose.Types.ObjectId(tenantId);
}

function actorObjectId(actorId) {
  return actorId && mongoose.isValidObjectId(actorId) ? new mongoose.Types.ObjectId(actorId) : null;
}

function idempotencyFingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload, Object.keys(payload).sort())).digest('hex');
}

function getIdempotencyKey(input) {
  const key = String(input || '').trim();
  if (!key || key.length > 255) throw new AgricultureDomainError('Idempotency-Key is required and must not exceed 255 characters.', 'AGRICULTURE_IDEMPOTENCY_REQUIRED');
  return key;
}

async function replayOrConflict(Model, tenantId, key, payload) {
  if (!key) return null;
  const existing = await Model.findOne({ tenantId: tenantObjectId(tenantId), idempotencyKey: key });
  if (!existing) return null;
  const fingerprint = idempotencyFingerprint(payload);
  if (existing.idempotencyFingerprint && existing.idempotencyFingerprint !== fingerprint) {
    throw new AgricultureDomainError('Idempotency-Key was reused with a different operation payload.', 'AGRICULTURE_IDEMPOTENCY_CONFLICT', 409);
  }
  return { replay: true, resource: existing };
}

async function writeAudit({ tenantId, actorId, action, data, requestId, correlationId }) {
  try {
    await createAuditLog({ tenantId, action, data, actorId, requestId, correlationId });
  } catch (error) {
    // Audit failure must not turn a committed operational mutation into a false rollback.
    console.error(JSON.stringify({ level: 'error', event: 'agriculture.audit_write_failed', action, tenantId: String(tenantId), error: { name: error?.name, code: error?.code, message: error?.message } }));
  }
}

async function requireGroup(tenantId, groupId) {
  const group = await Group.findOne({ _id: groupId, tenantId: tenantObjectId(tenantId), deletedAt: null });
  if (!group) throw new AgricultureDomainError('Group was not found for the active tenant.', 'AGRICULTURE_GROUP_NOT_FOUND', 404);
  return group;
}

async function assertGroupAgricultureEnabled(tenantId, groupId) {
  const group = await requireGroup(tenantId, groupId);
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

async function createWithIdempotency(Model, tenantId, payload, key, createPayload) {
  const existing = await replayOrConflict(Model, tenantId, key, payload);
  if (existing) return existing;
  try {
    const record = await Model.create({ ...createPayload, tenantId: tenantObjectId(tenantId), idempotencyKey: key, idempotencyFingerprint: idempotencyFingerprint(payload) });
    return { replay: false, resource: record };
  } catch (error) {
    if (error?.code === 11000 && key) {
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
  const group = await requireGroup(tenantId, requireObjectId(groupId, 'groupId'));
  if (group.capabilities?.agriculture === true) return { replay: true, group };
  group.set('capabilities.agriculture', true);
  await group.save();
  await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_GROUP_ENABLED', data: { groupId: String(group._id) }, requestId, correlationId });
  return { replay: false, group };
}

export async function createProducer({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey);
  const memberId = requireObjectId(data.memberId, 'memberId');
  const member = await Member.findOne({ _id: memberId, tenantId: tenantObjectId(tenantId) });
  if (!member) throw new AgricultureDomainError('Member was not found for the active tenant.', 'AGRICULTURE_MEMBER_NOT_FOUND', 404);
  let group = null;
  if (data.groupId) {
    group = await assertGroupAgricultureEnabled(tenantId, requireObjectId(data.groupId, 'groupId'));
    await assertMemberBelongsToGroup(tenantId, member, group);
  }
  return createWithIdempotency(Producer, tenantId, { memberId, groupId: group?._id || null, producerType: data.producerType, primaryLocation: data.primaryLocation || null }, key, {
    memberId, groupId: group?._id || null, producerType: data.producerType || 'INDIVIDUAL_FARMER', primaryLocation: data.primaryLocation || null,
    preferredLanguage: data.preferredLanguage || 'en', contactChannels: data.contactChannels || {}, onboardingStatus: 'IN_PROGRESS', status: 'ACTIVE', syncStatus: data.syncStatus || 'SERVER_ACCEPTED', deviceId: data.deviceId || null, clientOperationId: data.clientOperationId || null, payloadHash: data.payloadHash || null,
  }).then(async (result) => { if (!result.replay) await writeAudit({ tenantId, actorId, action: AGRICULTURE_EVENT_TYPES.PRODUCER_REGISTERED, data: { producerId: String(result.resource._id), memberId }, requestId, correlationId }); return result; });
}

export async function createFarm({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey); const producerId = requireObjectId(data.producerId, 'producerId');
  const producer = await Producer.findOne({ _id: producerId, tenantId: tenantObjectId(tenantId) }); if (!producer) throw new AgricultureDomainError('Producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
  if (data.groupId) { const group = await assertGroupAgricultureEnabled(tenantId, requireObjectId(data.groupId, 'groupId')); if (String(producer.groupId || '') !== String(group._id)) throw new AgricultureDomainError('Farm group does not match the producer group.', 'AGRICULTURE_FARM_GROUP_MISMATCH', 409); }
  return createWithIdempotency(Farm, tenantId, { producerId, groupId: data.groupId || producer.groupId || null, acreage: String(data.acreage) }, key, { producerId, groupId: data.groupId || producer.groupId || null, location: data.location || null, acreage: String(data.acreage), landTenureType: data.landTenureType || 'UNKNOWN', irrigationStatus: data.irrigationStatus || 'UNKNOWN', soilInformation: data.soilInformation || null, productionSystems: Array.isArray(data.productionSystems) ? data.productionSystems : [], verificationStatus: 'PENDING', status: 'ACTIVE', deviceId: data.deviceId || null, clientOperationId: data.clientOperationId || null, payloadHash: data.payloadHash || null, syncStatus: data.syncStatus || 'SERVER_ACCEPTED' });
}

export async function createCommodity({ tenantId, idempotencyKey, data }) {
  const key = idempotencyKey ? getIdempotencyKey(idempotencyKey) : null;
  if (key) { const existing = await replayOrConflict(Commodity, tenantId, key, data); if (existing) return existing; }
  const record = await Commodity.create({ tenantId: tenantObjectId(tenantId), code: String(data.code).trim().toUpperCase(), name: String(data.name).trim(), variety: data.variety || null, units: data.units || [], qualityGrades: data.qualityGrades || [], pricingModels: data.pricingModels || [], seasonality: data.seasonality || null, productionMetrics: data.productionMetrics || [], status: 'ACTIVE', ...(key ? { idempotencyKey: key, idempotencyFingerprint: idempotencyFingerprint(data) } : {}) });
  return { replay: false, resource: record };
}

async function ensureProducerFarm(tenantId, producerId, farmId) {
  const [producer, farm] = await Promise.all([Producer.findOne({ _id: producerId, tenantId: tenantObjectId(tenantId) }), Farm.findOne({ _id: farmId, tenantId: tenantObjectId(tenantId), producerId })]);
  if (!producer) throw new AgricultureDomainError('Producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
  if (!farm) throw new AgricultureDomainError('Farm not found for producer.', 'AGRICULTURE_FARM_NOT_FOUND', 404);
  return { producer, farm };
}

export async function createProductionCycle({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey); const producerId = requireObjectId(data.producerId, 'producerId'); const farmId = requireObjectId(data.farmId, 'farmId'); const commodityId = requireObjectId(data.commodityId, 'commodityId');
  const { producer, farm } = await ensureProducerFarm(tenantId, producerId, farmId); if (data.groupId) { const group = await assertGroupAgricultureEnabled(tenantId, data.groupId); if (String(producer.groupId || '') !== String(group._id)) throw new AgricultureDomainError('Production cycle group does not match the producer group.', 'AGRICULTURE_PRODUCTION_GROUP_MISMATCH', 409); }
  const commodity = await Commodity.findOne({ _id: commodityId, tenantId: tenantObjectId(tenantId), status: 'ACTIVE' }); if (!commodity) throw new AgricultureDomainError('Commodity not found.', 'AGRICULTURE_COMMODITY_NOT_FOUND', 404);
  return createWithIdempotency(ProductionCycle, tenantId, { producerId, farmId, commodityId, season: data.season }, key, { producerId, farmId, groupId: data.groupId || producer.groupId || null, commodityId, season: String(data.season).trim(), plantingDate: data.plantingDate || null, expectedHarvestDate: data.expectedHarvestDate || null, area: String(data.area), expectedYield: data.expectedYield ?? null, unitOfMeasure: String(data.unitOfMeasure).trim(), productionStatus: 'PLANNED', verificationStatus: 'PENDING', activities: [], deviceId: data.deviceId || null, clientOperationId: data.clientOperationId || null, payloadHash: data.payloadHash || null, syncStatus: data.syncStatus || 'SERVER_ACCEPTED' }).then(async (result) => { if (!result.replay) await writeAudit({ tenantId, actorId, action: AGRICULTURE_EVENT_TYPES.PRODUCTION_CYCLE_CREATED, data: { productionCycleId: String(result.resource._id), producerId, farmId, commodityId }, requestId, correlationId }); return result; });
}

export async function recordProductionActivity({ tenantId, actorId, requestId, correlationId, productionCycleId, idempotencyKey, data }) {
  const operationId = getIdempotencyKey(idempotencyKey);
  const cycleId = requireObjectId(productionCycleId, 'productionCycleId');
  const cycle = await ProductionCycle.findOne({ _id: cycleId, tenantId: tenantObjectId(tenantId) });
  if (!cycle) throw new AgricultureDomainError('Production cycle not found.', 'AGRICULTURE_PRODUCTION_CYCLE_NOT_FOUND', 404);
  const existing = cycle.activities?.find((item) => item.clientOperationId === operationId);
  if (existing) return { replay: true, resource: existing, productionCycle: cycle };
  const type = String(data.type || '').trim().toUpperCase();
  if (!type) throw new AgricultureDomainError('Activity type is required.', 'AGRICULTURE_ACTIVITY_TYPE_REQUIRED');
  const payload = { type, date: data.date || new Date(), quantity: data.quantity ?? null, unit: data.unit || null, note: data.note || null, evidenceRefs: data.evidenceRefs || [] };
  cycle.activities.push({ ...payload, clientOperationId: operationId, payloadHash: idempotencyFingerprint(payload) });
  cycle.markModified('activities');
  await cycle.save();
  await writeAudit({ tenantId, actorId, action: AGRICULTURE_EVENT_TYPES.PRODUCTION_ACTIVITY_RECORDED, data: { productionCycleId: String(cycle._id), activityType: type, clientOperationId: operationId }, requestId, correlationId });
  return { replay: false, resource: cycle.activities[cycle.activities.length - 1], productionCycle: cycle };
}

export async function createBuyer({ tenantId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey); return createWithIdempotency(Buyer, tenantId, { name: data.name, buyerType: data.buyerType }, key, { name: String(data.name).trim(), buyerType: String(data.buyerType || 'OTHER').trim().toUpperCase(), organizationId: data.organizationId || null, registration: data.registration || null, contact: data.contact || null, commodities: data.commodities || [], locations: data.locations || [], contractPreferences: data.contractPreferences || {}, settlementMethods: data.settlementMethods || [], verificationStatus: 'PENDING', complianceStatus: 'PENDING', status: 'ACTIVE' });
}

export async function createOfftakeContract({ tenantId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey); const buyerId = requireObjectId(data.buyerId, 'buyerId'); const commodityId = requireObjectId(data.commodityId, 'commodityId');
  const buyer = await Buyer.findOne({ _id: buyerId, tenantId: tenantObjectId(tenantId), status: 'ACTIVE' }); if (!buyer) throw new AgricultureDomainError('Buyer not found.', 'AGRICULTURE_BUYER_NOT_FOUND', 404);
  if (!data.producerId && !data.groupId) throw new AgricultureDomainError('An offtake contract must identify a producer or group seller.', 'AGRICULTURE_CONTRACT_SELLER_REQUIRED');
  if (data.producerId) { const p = await Producer.findOne({ _id: data.producerId, tenantId: tenantObjectId(tenantId) }); if (!p) throw new AgricultureDomainError('Producer not found.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404); }
  if (data.groupId) await assertGroupAgricultureEnabled(tenantId, data.groupId);
  if (data.producerId && data.groupId) { const p = await Producer.findOne({ _id: data.producerId, tenantId: tenantObjectId(tenantId) }); if (String(p.groupId || '') !== String(data.groupId)) throw new AgricultureDomainError('Producer does not belong to the contract group.', 'AGRICULTURE_CONTRACT_GROUP_MISMATCH', 409); }
  const commodity = await Commodity.findOne({ _id: commodityId, tenantId: tenantObjectId(tenantId) }); if (!commodity) throw new AgricultureDomainError('Commodity not found.', 'AGRICULTURE_COMMODITY_NOT_FOUND', 404);
  assertValidPricingMethod(data.pricingMethod); const currency = normalizeCurrency(data.currency); const price = normalizeMoney(data.price, 'price'); const expectedQuantity = normalizeQuantity(data.expectedQuantity, 'expectedQuantity');
  return createWithIdempotency(OfftakeContract, tenantId, { buyerId, producerId: data.producerId || null, groupId: data.groupId || null, commodityId, expectedQuantity, price, currency }, key, { buyerId, producerId: data.producerId || null, groupId: data.groupId || null, commodityId, expectedQuantity, unit: String(data.unit).trim(), pricingMethod: String(data.pricingMethod).trim().toUpperCase(), price, currency, qualityRequirements: data.qualityRequirements || null, deliveryWindow: data.deliveryWindow || null, paymentTerms: data.paymentTerms || null, deductions: data.deductions || [], financingLink: data.financingLink || null, status: 'ACTIVE' });
}

export async function createDelivery({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey); const contractId = requireObjectId(data.contractId, 'contractId'); const producerId = requireObjectId(data.producerId, 'producerId'); const productionCycleId = requireObjectId(data.productionCycleId, 'productionCycleId');
  const contract = await OfftakeContract.findOne({ _id: contractId, tenantId: tenantObjectId(tenantId), status: { $in: ['ACTIVE', 'PARTIALLY_FULFILLED'] } }); if (!contract) throw new AgricultureDomainError('Active offtake contract not found.', 'AGRICULTURE_CONTRACT_NOT_FOUND', 404);
  if (String(contract.producerId || producerId) !== String(producerId)) throw new AgricultureDomainError('Delivery producer does not match the contract.', 'AGRICULTURE_DELIVERY_PARTY_MISMATCH', 409);
  if (contract.groupId) {
    const producerForGroup = await Producer.findOne({ _id: producerId, tenantId: tenantObjectId(tenantId) }).lean();
    if (!producerForGroup || String(producerForGroup.groupId || '') !== String(contract.groupId)) throw new AgricultureDomainError('Delivery producer does not belong to the contract group.', 'AGRICULTURE_DELIVERY_GROUP_MISMATCH', 409);
  }
  const cycle = await ProductionCycle.findOne({ _id: productionCycleId, tenantId: tenantObjectId(tenantId), producerId }); if (!cycle) throw new AgricultureDomainError('Production cycle not found.', 'AGRICULTURE_PRODUCTION_CYCLE_NOT_FOUND', 404);
  if (String(cycle.commodityId) !== String(contract.commodityId)) throw new AgricultureDomainError('Delivery commodity does not match the contract commodity.', 'AGRICULTURE_DELIVERY_COMMODITY_MISMATCH', 409);
  const unit = String(data.unit || '').trim();
  if (!unit) throw new AgricultureDomainError('Delivery unit is required.', 'AGRICULTURE_DELIVERY_UNIT_REQUIRED');
  if (unit !== String(contract.unit).trim()) throw new AgricultureDomainError('Delivery unit does not match the contract unit.', 'AGRICULTURE_DELIVERY_UNIT_MISMATCH', 409);
  const quantity = normalizeQuantity(data.quantity);
  return createWithIdempotency(Delivery, tenantId, { contractId, producerId, quantity, productionCycleId }, key, { contractId, producerId, buyerId: contract.buyerId, productionCycleId, quantity, unit, qualityGrade: data.qualityGrade || null, warehouse: data.warehouse || null, deliveryDate: data.deliveryDate || new Date(), receivingParty: data.receivingParty || null, supportingEvidence: data.supportingEvidence || [], verificationStatus: 'PENDING', status: 'PENDING_VERIFICATION', deviceId: data.deviceId || null, clientOperationId: data.clientOperationId || null, payloadHash: data.payloadHash || null, syncStatus: data.syncStatus || 'SERVER_ACCEPTED' });
}

async function sumContractDeliveries(tenantId, contractId) {
  const rows = await Delivery.aggregate([
    { $match: { tenantId: tenantObjectId(tenantId), contractId, status: { $in: ['VERIFIED', 'SETTLED'] } } },
    { $group: { _id: null, quantity: { $sum: { $toDecimal: '$quantity' } } } },
  ]);
  return rows[0]?.quantity?.toString?.() || '0';
}

export async function verifyDelivery({ tenantId, actorId, requestId, correlationId, deliveryId }) {
  const id = requireObjectId(deliveryId, 'deliveryId'); const delivery = await Delivery.findOne({ _id: id, tenantId: tenantObjectId(tenantId) }); if (!delivery) throw new AgricultureDomainError('Delivery not found.', 'AGRICULTURE_DELIVERY_NOT_FOUND', 404);
  if (delivery.status === 'VERIFIED' || delivery.status === 'SETTLED') return { replay: true, resource: delivery };
  if (delivery.status !== 'PENDING_VERIFICATION') throw new AgricultureDomainError('Only pending deliveries can be verified.', 'AGRICULTURE_DELIVERY_STATE_INVALID', 409);
  const contract = await OfftakeContract.findOne({ _id: delivery.contractId, tenantId: tenantObjectId(tenantId) }); if (!contract) throw new AgricultureDomainError('Contract not found.', 'AGRICULTURE_CONTRACT_NOT_FOUND', 404);
  const current = await sumContractDeliveries(tenantId, delivery.contractId); const projected = addQuantity(current, String(delivery.quantity));
  if (compareQuantity(projected, contract.expectedQuantity.toString()) > 0) throw new AgricultureDomainError('Verified deliveries would exceed the contracted quantity.', 'AGRICULTURE_DELIVERY_QUANTITY_EXCEEDED', 409, { projectedQuantity: projected, expectedQuantity: contract.expectedQuantity.toString() });
  delivery.status = 'VERIFIED'; delivery.verificationStatus = 'VERIFIED'; await delivery.save();
  await writeAudit({ tenantId, actorId, action: AGRICULTURE_EVENT_TYPES.DELIVERY_VERIFIED, data: { deliveryId: String(delivery._id), contractId: String(delivery.contractId), quantity: delivery.quantity.toString() }, requestId, correlationId });
  return { replay: false, resource: delivery };
}

export async function createSettlement({ tenantId, actorId, requestId, correlationId, idempotencyKey, data }) {
  const key = getIdempotencyKey(idempotencyKey); const deliveryId = requireObjectId(data.deliveryId, 'deliveryId'); const delivery = await Delivery.findOne({ _id: deliveryId, tenantId: tenantObjectId(tenantId), status: { $in: ['VERIFIED', 'SETTLED'] } }); if (!delivery) throw new AgricultureDomainError('A verified delivery is required for settlement.', 'AGRICULTURE_DELIVERY_NOT_VERIFIED', 409);
  const existing = await replayOrConflict(AgricultureSettlement, tenantId, key, data); if (existing) return existing;
  const grossAmount = normalizeMoney(data.grossAmount, 'grossAmount'); const currency = normalizeCurrency(data.currency);
  const deliveryProducer = await Producer.findOne({ _id: delivery.producerId, tenantId: tenantIdObj }).lean();
  if (!deliveryProducer) throw new AgricultureDomainError('Delivery producer was not found for settlement.', 'AGRICULTURE_PRODUCER_NOT_FOUND', 404);
  const requestedGroupId = data.groupId || deliveryProducer.groupId || null;
  if (requestedGroupId) {
    const group = await assertGroupAgricultureEnabled(tenantId, requireObjectId(requestedGroupId, 'groupId'));
    if (String(deliveryProducer.groupId || '') !== String(group._id)) throw new AgricultureDomainError('Settlement group does not match the delivery producer group.', 'AGRICULTURE_SETTLEMENT_GROUP_MISMATCH', 409);
  }
  const allocations = calculateAllocations({ amount: grossAmount, rule: data.allocationRule || 'EXPLICIT', recipients: data.allocations || data.recipients });
  const record = await AgricultureSettlement.create({ tenantId: tenantObjectId(tenantId), deliveryId, buyerId: delivery.buyerId, producerId: delivery.producerId, groupId: requestedGroupId || null, productionCycleId: delivery.productionCycleId, invoiceReference: data.invoiceReference || null, grossAmount, currency, sourceAccountId: requireObjectId(data.sourceAccountId, 'sourceAccountId'), allocationRule: String(data.allocationRule || 'EXPLICIT').toUpperCase(), allocationFormulaVersion: 'v1', allocations, paymentEvidence: data.paymentEvidence || [], status: 'PENDING_PAYMENT', reconciliationStatus: 'UNMATCHED', idempotencyKey: key, idempotencyFingerprint: idempotencyFingerprint(data), actorId: actorObjectId(actorId), metadata: { requestId, correlationId } });
  await writeAudit({ tenantId, actorId, action: 'AGRICULTURE_SETTLEMENT_CREATED', data: { settlementId: String(record._id), deliveryId, grossAmount, currency }, requestId, correlationId });
  return { replay: false, resource: record };
}

export async function confirmSettlement({ tenantId, actorId, requestId, correlationId, idempotency, settlementId, data }) {
  const tenantIdObj = tenantObjectId(tenantId); const id = requireObjectId(settlementId, 'settlementId'); const settlement = await AgricultureSettlement.findOne({ _id: id, tenantId: tenantIdObj }); if (!settlement) throw new AgricultureDomainError('Settlement not found.', 'AGRICULTURE_SETTLEMENT_NOT_FOUND', 404);
  if (settlement.status === 'CONFIRMED') return { replay: true, resource: settlement, financialTransactionId: settlement.financialTransactionId };
  if (settlement.status !== 'PENDING_PAYMENT' && settlement.status !== 'RECONCILIATION_REQUIRED') throw new AgricultureDomainError('Settlement cannot be confirmed from its current state.', 'AGRICULTURE_SETTLEMENT_STATE_INVALID', 409);
  const providerName = String(data.providerName || '').trim(); const providerReference = String(data.providerReference || '').trim(); if (!providerName || !providerReference) throw new AgricultureDomainError('providerName and providerReference are required to confirm a settlement.', 'AGRICULTURE_PAYMENT_EVIDENCE_REQUIRED');
  const result = await processFinancialOperation({ tenantId: String(tenantId), principalId: String(actorId), operation: FINANCIAL_OPERATION.TRANSACTION_CREATE, resource: 'agriculture-settlement', transactionId: settlement.financialTransactionId || undefined, idempotency: { recordId: idempotency.recordId, key: idempotency.key, fingerprint: idempotency.fingerprint }, execute: async ({ session, transactionId }) => {
    const allocations = settlement.allocations.map((item) => ({ accountId: String(item.accountId), amount: item.amount.toString(), direction: 'CREDIT', balanceEffect: 'INCREASE', entryType: 'AGRICULTURE_SETTLEMENT' }));
    const source = { accountId: String(settlement.sourceAccountId), amount: settlement.grossAmount.toString(), direction: 'DEBIT', balanceEffect: 'DECREASE', entryType: 'AGRICULTURE_BUYER_PAYMENT' };
    const financial = await executeFinancialOperation({ operation: FINANCIAL_OPERATION.TRANSACTION_CREATE, session, context: { transactionId, tenantId: String(tenantId), principalId: String(actorId), correlationId }, repositories: financialRepositoryRegistry, payload: { amount: settlement.grossAmount.toString(), currency: settlement.currency, entries: [source, ...allocations], metadata: { domain: 'agriculture', settlementId: String(settlement._id), deliveryId: String(settlement.deliveryId), producerId: String(settlement.producerId), buyerId: String(settlement.buyerId), providerName, providerReference } } });
    const delivery = await Delivery.findOne({ _id: settlement.deliveryId, tenantId: tenantIdObj }, null, { session });
    if (!delivery) throw new AgricultureDomainError('Settlement delivery was not found during financial commit.', 'AGRICULTURE_DELIVERY_NOT_FOUND', 409);
    if (!['VERIFIED', 'SETTLED'].includes(delivery.status)) throw new AgricultureDomainError('Settlement delivery is no longer in a settleable state.', 'AGRICULTURE_DELIVERY_STATE_INVALID', 409);
    delivery.status = 'SETTLED';
    delivery.verificationStatus = 'VERIFIED';
    delivery.syncStatus = 'SERVER_ACCEPTED';
    await delivery.save({ session });

    settlement.status = 'CONFIRMED'; settlement.reconciliationStatus = 'MATCHED'; settlement.financialTransactionId = transactionId; settlement.providerName = providerName; settlement.providerReference = providerReference; settlement.paymentEvidence = data.paymentEvidence || settlement.paymentEvidence; settlement.confirmedAt = new Date(); settlement.actorId = actorObjectId(actorId);
    await settlement.save({ session });
    const eventId = `agriculture-settlement:${settlement._id}:confirmed:v1`;
    await outboxRepository.create({ tenantId: String(tenantId), eventId, eventKey: eventId, eventType: AGRICULTURE_EVENT_TYPES.SETTLEMENT_CONFIRMED, eventVersion: '1', schemaVersion: '1', category: 'agriculture', fingerprint: crypto.createHash('sha256').update(`${tenantId}:${settlement._id}:confirmed:v1`).digest('hex'), transactionId, correlationId, idempotencyKey: idempotency.key, userId: actorId, operation: FINANCIAL_OPERATION.TRANSACTION_CREATE, source: 'agriculture.service', aggregate: { type: 'AgricultureSettlement', id: String(settlement._id), version: settlement.version || 1 }, payload: { settlementId: String(settlement._id), deliveryId: String(settlement.deliveryId), financialTransactionId: transactionId, status: 'CONFIRMED' }, metadata: { providerName, providerReference } }, { session });
    return { responseBody: { settlementId: String(settlement._id), financialTransactionId: transactionId, status: settlement.status, reconciliationStatus: settlement.reconciliationStatus }, financialResult: financial };
  }});
  await writeAudit({ tenantId, actorId, action: AGRICULTURE_EVENT_TYPES.SETTLEMENT_CONFIRMED, data: { settlementId: String(settlement._id), financialTransactionId: result.responseBody.financialTransactionId, providerName, providerReference }, requestId, correlationId });
  return { replay: false, resource: settlement, ...result.responseBody };
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
