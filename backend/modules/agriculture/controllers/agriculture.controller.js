import * as service from '../services/agriculture.service.js';

function actorId(req) {
  return String(req.user?.id || req.user?.userId || req.auth?.sub || req.auth?.userId || '');
}
function context(req) {
  return { tenantId: req.tenantId, actorId: actorId(req), requestId: req.requestId, correlationId: req.correlationId };
}
function idempotencyKey(req) { return req.get('Idempotency-Key') || req.get('X-Idempotency-Key'); }
function send(req, res, status, data) { return res.status(status).json({ success: true, ...data, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() }); }

export async function enableGroupAgriculture(req, res) { return send(req, res, 200, await service.enableGroupAgriculture({ ...context(req), groupId: req.params.groupId })); }
export async function createProducer(req, res) { const result = await service.createProducer({ ...context(req), idempotencyKey: idempotencyKey(req), data: req.body }); res.setHeader('X-Idempotent-Replay', String(result.replay)); return send(req, res, result.replay ? 200 : 201, result); }
export async function createFarm(req, res) { const result = await service.createFarm({ ...context(req), idempotencyKey: idempotencyKey(req), data: req.body }); res.setHeader('X-Idempotent-Replay', String(result.replay)); return send(req, res, result.replay ? 200 : 201, result); }
export async function createCommodity(req, res) { const result = await service.createCommodity({ ...context(req), idempotencyKey: idempotencyKey(req), data: req.body }); res.setHeader('X-Idempotent-Replay', String(result.replay)); return send(req, res, result.replay ? 200 : 201, result); }
export async function createProductionCycle(req, res) { const result = await service.createProductionCycle({ ...context(req), idempotencyKey: idempotencyKey(req), data: req.body }); res.setHeader('X-Idempotent-Replay', String(result.replay)); return send(req, res, result.replay ? 200 : 201, result); }
export async function recordProductionActivity(req, res) { const result = await service.recordProductionActivity({ ...context(req), productionCycleId: req.params.productionCycleId, idempotencyKey: idempotencyKey(req), data: req.body }); res.setHeader('X-Idempotent-Replay', String(result.replay)); return send(req, res, result.replay ? 200 : 201, result); }
export async function createBuyer(req, res) { const result = await service.createBuyer({ ...context(req), idempotencyKey: idempotencyKey(req), data: req.body }); res.setHeader('X-Idempotent-Replay', String(result.replay)); return send(req, res, result.replay ? 200 : 201, result); }
export async function createContract(req, res) { const result = await service.createOfftakeContract({ ...context(req), idempotencyKey: idempotencyKey(req), data: req.body }); res.setHeader('X-Idempotent-Replay', String(result.replay)); return send(req, res, result.replay ? 200 : 201, result); }
export async function createDelivery(req, res) { const result = await service.createDelivery({ ...context(req), idempotencyKey: idempotencyKey(req), data: req.body }); res.setHeader('X-Idempotent-Replay', String(result.replay)); return send(req, res, result.replay ? 200 : 201, result); }
export async function verifyDelivery(req, res) { return send(req, res, 200, await service.verifyDelivery({ ...context(req), deliveryId: req.params.deliveryId })); }
export async function createSettlement(req, res) { const result = await service.createSettlement({ ...context(req), idempotencyKey: idempotencyKey(req), data: req.body }); res.setHeader('X-Idempotent-Replay', String(result.replay)); return send(req, res, result.replay ? 200 : 201, result); }
export async function confirmSettlement(req, res) { return send(req, res, 200, await service.confirmSettlement({ ...context(req), settlementId: req.params.settlementId, idempotency: req.idempotency, data: req.body })); }
export async function producerFinancialHistory(req, res) { return send(req, res, 200, await service.getProducerFinancialHistory({ tenantId: req.tenantId, producerId: req.params.producerId })); }
export async function listResource(req, res) { return send(req, res, 200, { data: await service.list({ tenantId: req.tenantId, resource: req.params.resource, limit: req.query.limit }) }); }
export function health(req, res) { return send(req, res, 200, { module: 'agriculture', status: 'UP', tenantScoped: true, financialMutations: 'canonical-financial-service' }); }
