import express from 'express';
import crypto from 'node:crypto';
import authModule from '../../../middleware/auth.js';
import idempotencyModule from '../../../middleware/idempotency.js';
import { requirePermission } from '../../../middleware/platformPermissions.js';
import * as controller from '../controllers/agriculture.controller.js';

const router = express.Router({ caseSensitive: false, strict: false });
const { authenticate } = authModule;
const idempotency = idempotencyModule.idempotency || idempotencyModule.default || idempotencyModule;

function requestContext(req, res, next) {
  req.requestId = req.requestId || req.get('X-Request-Id') || crypto.randomUUID();
  req.correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId;
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('X-Correlation-Id', req.correlationId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return next();
}
function body(req, res, next) { return express.json({ limit: process.env.TITECH_AGRICULTURE_BODY_LIMIT || '512kb', strict: true })(req, res, next); }
router.use(requestContext, body, authenticate);
router.get('/health', controller.health);
router.get('/:resource', requirePermission('agriculture:read'), controller.listResource);
router.get('/producers/:producerId/financial-history', requirePermission('agriculture:read'), controller.producerFinancialHistory);

router.post('/groups/:groupId/enable', requirePermission('agriculture:manage'), controller.enableGroupAgriculture);
router.post('/producers', requirePermission('agriculture:write'), controller.createProducer);
router.post('/farms', requirePermission('agriculture:write'), controller.createFarm);
router.post('/commodities', requirePermission('agriculture:manage'), controller.createCommodity);
router.post('/production-cycles', requirePermission('agriculture:write'), controller.createProductionCycle);
router.post('/production-cycles/:productionCycleId/activities', requirePermission('agriculture:write'), controller.recordProductionActivity);
router.post('/buyers', requirePermission('agriculture:write'), controller.createBuyer);
router.post('/offtake-contracts', requirePermission('agriculture:write'), controller.createContract);
router.post('/deliveries', requirePermission('agriculture:write'), controller.createDelivery);
router.post('/deliveries/:deliveryId/verify', requirePermission('agriculture:verify'), controller.verifyDelivery);
router.post('/settlements', requirePermission('agriculture:settle'), controller.createSettlement);
router.post('/settlements/:settlementId/confirm', requirePermission('agriculture:settle'), idempotency({ operation: 'AGRICULTURE_SETTLEMENT_CONFIRM', resource: 'agriculture-settlement-confirm', required: true }), controller.confirmSettlement);

export default router;
