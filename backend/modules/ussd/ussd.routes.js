import express from 'express';
import crypto from 'node:crypto';
import {
  normalizeCanonicalUssdRequest,
  normalizeProviderCode,
  validateUssdResponse,
} from './ussd.contract.js';

const router = express.Router();
const CALLBACK_PATH = '/providers/:providerCode/callback';
const PROVIDER_ALLOWLIST_ENV = 'TITECH_USSD_ENABLED_PROVIDERS';

function resolveService(registry, name) {
  if (registry && typeof registry.get === 'function') {
    try { return registry.get(name) || null; } catch { return null; }
  }
  return registry && typeof registry === 'object' ? registry[name] || null : null;
}

function configuredProviders() {
  return new Set(String(process.env[PROVIDER_ALLOWLIST_ENV] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
}

function sendUnavailable(res, status = 503) {
  return res.status(status).type('text/plain').send('END TITech USSD is not enabled for this provider.');
}

function sendProviderResponse(res, adapter, response) {
  const serialized = adapter.serializeResponse(response);
  const output = typeof serialized === 'string'
    ? { body: serialized, contentType: 'text/plain; charset=utf-8' }
    : serialized;
  if (!output || typeof output.body !== 'string' || typeof output.contentType !== 'string') {
    throw new TypeError('Provider adapter returned an invalid response serialization.');
  }
  return res.status(200).set('Content-Type', output.contentType).send(output.body);
}

function recordMetric(req, name) {
  const metrics = resolveService(req.app?.locals?.services, 'metricsService')
    || req.app?.locals?.metricsService;
  try { metrics?.increment?.(name); } catch { /* metrics must not change request outcome */ }
}

function safeLog(req, level, message, metadata = {}) {
  const logger = resolveService(req.app?.locals?.services, 'logger')
    || req.app?.locals?.logger;
  try {
    logger?.[level]?.(message, {
      requestId: req.requestId,
      correlationId: req.correlationId,
      ...metadata,
    });
  } catch { /* logging must not mask provider errors */ }
}

router.use(express.json({ limit: '16kb', strict: true }));
router.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 32 }));

router.post(CALLBACK_PATH, async (req, res) => {
  req.requestId = req.requestId || req.get('x-request-id') || crypto.randomUUID();
  req.correlationId = req.correlationId || req.get('x-correlation-id') || crypto.randomUUID();
  res.set('x-request-id', req.requestId);

  if (process.env.TITECH_USSD_ENABLED !== 'true') {
    recordMetric(req, 'titech_ussd_callback_disabled_total');
    return sendUnavailable(res);
  }

  let providerCode;
  try {
    providerCode = normalizeProviderCode(req.params.providerCode);
  } catch {
    return sendUnavailable(res, 404);
  }

  if (!configuredProviders().has(providerCode)) {
    recordMetric(req, 'titech_ussd_provider_not_allowlisted_total');
    return sendUnavailable(res, 404);
  }

  const services = req.app?.locals?.services;
  const registry = resolveService(services, 'ussdProviderRegistry')
    || req.app?.locals?.ussdProviderRegistry;
  const channelService = resolveService(services, 'ussdChannelService')
    || req.app?.locals?.ussdChannelService;
  const adapter = registry?.get?.(providerCode);

  // Fail closed unless an externally configured provider adapter and the
  // existing-domain orchestration service have both been injected.
  if (!adapter || typeof adapter.verifyCallback !== 'function'
      || typeof adapter.normalizeCallback !== 'function'
      || typeof adapter.serializeResponse !== 'function'
      || typeof channelService?.handleCallback !== 'function') {
    recordMetric(req, 'titech_ussd_provider_integration_unavailable_total');
    safeLog(req, 'warn', 'USSD callback rejected because provider/domain integration is not configured.', {
      providerCode,
    });
    return sendUnavailable(res);
  }

  try {
    const verified = await adapter.verifyCallback(req);
    if (verified !== true) {
      recordMetric(req, 'titech_ussd_callback_authentication_failed_total');
      safeLog(req, 'warn', 'USSD provider callback authentication failed.', { providerCode });
      return sendUnavailable(res, 401);
    }

    const adapterPayload = await adapter.normalizeCallback(req);
    const request = normalizeCanonicalUssdRequest(adapterPayload, {
      providerCode,
      maxTextLength: 512,
    });

    const response = await channelService.handleCallback({
      request,
      requestId: req.requestId,
      correlationId: req.correlationId,
      transactionFeaturesEnabled: process.env.TITECH_USSD_TRANSACTION_FEATURES_ENABLED === 'true',
      // Tenant/member context must be resolved by the server-side service.
      // No tenantId or memberId is copied from the provider request.
    });

    const safeResponse = validateUssdResponse(response, {
      maxLength: Number(process.env.TITECH_USSD_RESPONSE_MAX_LENGTH) || 160,
    });
    recordMetric(req, safeResponse.action === 'END'
      ? 'titech_ussd_sessions_completed_total'
      : 'titech_ussd_sessions_continued_total');

    return sendProviderResponse(res, adapter, {
      action: safeResponse.action,
      message: safeResponse.message,
    });
  } catch (error) {
    recordMetric(req, 'titech_ussd_callback_errors_total');
    safeLog(req, 'error', 'USSD provider callback failed safely.', {
      providerCode,
      errorCode: error?.code || 'USSD_CALLBACK_FAILED',
    });
    return sendUnavailable(res);
  }
});

export default router;
export { CALLBACK_PATH };
