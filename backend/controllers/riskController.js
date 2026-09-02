// controllers/riskController.js
/**
 * Production-ready risk controller
 * - Uses existing services: creditScoringService, fraudDetectionService, eventStreamService, complianceService
 * - Performs input validation, structured responses, latency logging, and audit logging
 * - Pushes transactions/events to Redis stream for async feature extraction / ML processing
 * - Keeps handlers fast: synchronous checks + enqueue heavy work to background stream
 *
 * Drop into: controllers/riskController.js
 */

const logger = require('../utils/logger') || console;
const metrics = require('../utils/metrics') || null; // optional metrics helper (timers, histograms)
const CreditScoringService = require('../services/creditScoringService');
const FraudDetectionService = require('../services/fraudDetectionService');
const ComplianceService = require('../services/complianceService');
const EventStreamService = require('../services/eventStreamService');

const RiskProfile = require('../models/RiskProfile');
const FraudLog = require('../models/FraudLog');
const ComplianceLog = require('../models/ComplianceLog');

/**
 * Helper: measure elapsed ms
 */
function nowMs() {
  const [s, ns] = process.hrtime();
  return Math.round(s * 1000 + ns / 1e6);
}

/**
 * POST /api/risk/score
 * Body: { features: { contributions, loanRepaymentHistory, missedPayments, momoInflows, momoOutflows, savingsConsistency, groupParticipation, guarantorStrength } }
 */
exports.runCreditScore = async (req, res, next) => {
  const start = nowMs();
  try {
    const user = req.user;
    if (!user || !user._id) return res.status(401).json({ error: 'Unauthorized' });

    const features = req.body && req.body.features;
    if (!features || typeof features !== 'object') {
      return res.status(400).json({ error: 'Missing features payload' });
    }

    // Quick validation / normalization
    const normalized = {
      contributions: Number(features.contributions || 0),
      loanRepaymentsOnTime: !!features.loanRepaymentsOnTime,
      missedPayments: Number(features.missedPayments || 0),
      momoInflows: Number(features.momoInflows || 0),
      momoOutflows: Number(features.momoOutflows || 0),
      savingsConsistency: !!features.savingsConsistency,
      groupParticipation: !!features.groupParticipation,
      guarantorStrength: features.guarantorStrength || 'unknown'
    };

    // Enqueue event for feature engineering / historical aggregation (async)
    try {
      await EventStreamService.pushTransaction({
        _id: `score-${user._id}-${Date.now()}`,
        userId: user._id,
        tenantId: user.tenantId,
        type: 'score_request',
        amount: 0,
        metadata: { features: normalized }
      });
    } catch (e) {
      // Non-fatal: log but continue
      logger.warn('EventStream push failed (score request)', e.message || e);
    }

    // Calculate score (fast path)
    const { score, riskLevel } = await CreditScoringService.calculateScore(user, normalized);

    // Persist risk profile (ensure upsert)
    try {
      await RiskProfile.upsertScore(user._id, user.tenantId, score, {
        explain: { source: 'creditScoringService', features: normalized },
        modelVersion: process.env.CREDIT_MODEL_VERSION || 'v1',
        source: 'hybrid'
      });
    } catch (err) {
      logger.warn('RiskProfile upsert failed', err.message || err);
    }

    const elapsed = nowMs() - start;
    if (metrics && typeof metrics.observe === 'function') {
      metrics.observe('risk.score.latency_ms', elapsed);
    }
    logger.info('Credit score computed', { userId: user._id, tenantId: user.tenantId, score, riskLevel, elapsedMs: elapsed });

    return res.json({ score, riskLevel });
  } catch (err) {
    logger.error('runCreditScore error', err.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/risk/fraud-check
 * Body: { transaction: { _id, type, amount, frequency, newDevice, locationMismatch, device, geo, metadata } }
 *
 * This endpoint performs a synchronous fraud check (rules + lightweight ML simulation),
 * logs the result, and enqueues the full transaction to the stream for deeper async analysis.
 */
exports.runFraudCheck = async (req, res, next) => {
  const start = nowMs();
  try {
    const user = req.user;
    if (!user || !user._id) return res.status(401).json({ error: 'Unauthorized' });

    const tx = req.body && req.body.transaction;
    if (!tx || !tx._id || !tx.type || typeof tx.amount === 'undefined') {
      return res.status(400).json({ error: 'Invalid transaction payload' });
    }

    // Normalize transaction
    const transaction = {
      _id: tx._id,
      tenantId: user.tenantId,
      userId: user._id,
      type: tx.type,
      amount: Number(tx.amount || 0),
      frequency: Number(tx.frequency || 9999),
      newDevice: !!tx.newDevice,
      locationMismatch: !!tx.locationMismatch,
      device: tx.device || {},
      geo: tx.geo || {},
      metadata: tx.metadata || {}
    };

    // Fast synchronous fraud check
    const { fraudScore, decision } = await FraudDetectionService.checkTransaction(user, transaction);

    // Create FraudLog entry (persisted by service, but ensure we have a record)
    try {
      await FraudLog.createLog({
        tenantId: user.tenantId,
        userId: user._id,
        transactionId: transaction._id,
        transactionSnapshot: {
          type: transaction.type,
          amount: transaction.amount,
          device: transaction.device,
          geo: transaction.geo,
          metadata: transaction.metadata
        },
        fraudScore,
        decision,
        engine: 'hybrid',
        modelVersion: process.env.FRAUD_MODEL_VERSION || 'v1'
      });
    } catch (err) {
      // If createLog fails, log and continue
      logger.warn('FraudLog.createLog failed', err.message || err);
    }

    // If suspicious, generate compliance STR entry asynchronously
    if (fraudScore > 0.8 || decision === 'BLOCK') {
      try {
        await ComplianceLog.createSTR({
          tenantId: user.tenantId,
          userId: user._id,
          activity: 'STR_GENERATED',
          flagged: true,
          reason: 'High fraud score',
          details: { fraudScore, decision, transactionId: transaction._id },
          fraudLogId: null,
          reporter: 'fraud-engine'
        });
      } catch (err) {
        logger.warn('ComplianceLog.createSTR failed', err.message || err);
      }
    }

    // Enqueue full transaction for async feature extraction / ML retraining dataset
    try {
      await EventStreamService.pushTransaction({
        _id: transaction._id,
        userId: user._id,
        tenantId: user.tenantId,
        type: transaction.type,
        amount: transaction.amount,
        metadata: {
          device: transaction.device,
          geo: transaction.geo,
          fraudScore,
          decision
        }
      });
    } catch (e) {
      logger.warn('EventStream push failed (fraud-check)', e.message || e);
    }

    const elapsed = nowMs() - start;
    if (metrics && typeof metrics.observe === 'function') {
      metrics.observe('risk.fraud.latency_ms', elapsed);
    }
    logger.info('Fraud check completed', { userId: user._id, tenantId: user.tenantId, fraudScore, decision, elapsedMs: elapsed });

    // Response shape includes recommended action for caller to enforce
    return res.json({
      fraudScore,
      decision,
      action: decision === 'BLOCK' ? 'block' : decision === 'STEP_UP' ? 'step_up_auth' : 'allow'
    });
  } catch (err) {
    logger.error('runFraudCheck error', err.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
