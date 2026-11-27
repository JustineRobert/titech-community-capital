'use strict';

/**
 * TITech Community Capital — safe billing visibility API.
 * All endpoints are read-only and consume the canonical billing collections.
 * Tenant routes bind scope to the authenticated JWT tenant, never request data.
 */

import express from 'express';
import mongoose from 'mongoose';
import authModule from '../../middleware/auth.js';
import { BillingReadModelService } from '../services/billing/billingReadModel.service.js';

const router = express.Router();
const service = new BillingReadModelService({
  connection: mongoose.connection,
  toObjectId: (value) => new mongoose.Types.ObjectId(value),
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sendFailure(res, error, req) {
  const statusCode = Number(error?.statusCode) || (error?.code === 'BILLING_TENANT_CONTEXT_REQUIRED' ? 403 : 500);
  const safeMessage = statusCode >= 500
    ? 'Billing information is temporarily unavailable.'
    : 'The billing request could not be authorized.';
  return res.status(statusCode).json({
    success: false,
    error: {
      code: error?.code || 'BILLING_READ_FAILED',
      message: safeMessage,
    },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
    timestamp: new Date().toISOString(),
  });
}

function respond(handler) {
  return asyncRoute(async (req, res) => {
    try {
      const data = await handler(req);
      return res.status(200).json({
        success: true,
        data,
        requestId: req.requestId || null,
        correlationId: req.correlationId || req.requestId || null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return sendFailure(res, error, req);
    }
  });
}

const requirePlatformView = [
  authModule.authenticate,
  authModule.requirePermission('BILLING_PLATFORM_VIEW'),
];

const requireFinanceView = [
  authModule.authenticate,
  authModule.requirePermission('BILLING_COLLECTION_VIEW'),
];

const requireTenantView = [
  authModule.authenticate,
  authModule.requireAuthenticatedTenant,
  authModule.requirePermission('BILLING_SELF_VIEW'),
];

router.get('/platform/overview', requirePlatformView, respond(() => service.getOverview()));
router.get('/platform/subscriptions', [authModule.authenticate, authModule.requirePermission('BILLING_SUBSCRIPTION_VIEW')], respond((req) => service.list('subscriptions', req.query)));
router.get('/platform/invoices', [authModule.authenticate, authModule.requirePermission('BILLING_INVOICE_VIEW')], respond((req) => service.list('invoices', req.query)));
router.get('/platform/payments', [authModule.authenticate, authModule.requirePermission('BILLING_PAYMENT_VIEW')], respond((req) => service.list('payments', req.query)));
router.get('/platform/collections', requireFinanceView, respond(() => service.getCollectionsOverview()));

router.get('/me/overview', requireTenantView, respond((req) => service.getOverview({ tenantId: req.user.tenantId })));
router.get('/me/subscriptions', requireTenantView, respond((req) => service.list('subscriptions', { ...req.query, tenantId: req.user.tenantId })));
router.get('/me/invoices', [authModule.authenticate, authModule.requireAuthenticatedTenant, authModule.requirePermission('BILLING_SELF_INVOICE_VIEW')], respond((req) => service.list('invoices', { ...req.query, tenantId: req.user.tenantId })));
router.get('/me/payments', [
  authModule.authenticate,
  authModule.requireAuthenticatedTenant,
  authModule.requirePermission('BILLING_SELF_PAYMENT_VIEW'),
], respond((req) => service.list('payments', { ...req.query, tenantId: req.user.tenantId })));

export default router;
