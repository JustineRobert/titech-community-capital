'use strict';

const { PayrollError } = require('./payroll.errors.cjs');
const { PROVIDERS } = require('./payroll.constants.cjs');

function resolveRegistryService(registry, names = []) {
  for (const name of names) {
    if (!registry) continue;
    try {
      if (typeof registry.get === 'function') {
        const value = registry.get(name);
        if (value) return value;
      }
    } catch {}
    if (registry[name]) return registry[name];
  }
  return null;
}

function normalizeStatus(value) {
  const status = String(value || '').toUpperCase();
  if (['SUCCESS', 'COMPLETED', 'SUCCESSFUL', 'SETTLED'].includes(status)) return 'SUCCESS';
  if (['FAILED', 'FAILURE', 'REJECTED', 'DECLINED', 'CANCELLED'].includes(status)) return 'FAILED';
  if (['PROCESSING', 'PENDING', 'ACCEPTED', 'INITIATED'].includes(status)) return 'PROCESSING';
  return 'UNKNOWN';
}

class PayrollProviderGateway {
  constructor({ serviceRegistry = null, context = null, logger = console } = {}) {
    this.serviceRegistry = serviceRegistry;
    this.context = context;
    this.logger = logger;
  }

  async resolve(provider) {
    const normalized = String(provider || '').toUpperCase();
    const registry = this.serviceRegistry || this.context?.services || this.context?.serviceRegistry;

    if (normalized === PROVIDERS.MTN_MOMO) {
      const service = resolveRegistryService(registry, [
        'payrollMtnDisbursementService',
        'mtnDisbursementService',
        'MTNDisbursementService',
      ]);
      if (service) return service;
      try {
        return require('../../services/mtn/disbursements.js');
      } catch (error) {
        throw new PayrollError('PAYROLL_MTN_ADAPTER_UNAVAILABLE', 'MTN payroll disbursement adapter is unavailable.', 503, { cause: error.message });
      }
    }

    if (normalized === PROVIDERS.AIRTEL_MONEY) {
      const service = resolveRegistryService(registry, [
        'payrollAirtelDisbursementService',
        'airtelDisbursementService',
        'AirtelDisbursementService',
      ]);
      if (service) return service;
      try {
        return require('../../services/airtel/disbursements.js');
      } catch (error) {
        throw new PayrollError('PAYROLL_AIRTEL_ADAPTER_UNAVAILABLE', 'Airtel payroll disbursement adapter is unavailable.', 503, { cause: error.message });
      }
    }

    throw new PayrollError('PAYROLL_PROVIDER_UNSUPPORTED', `Payroll provider ${normalized} is not supported.`, 400);
  }

  async disburse({ provider, tenantId, amount, currency, phoneNumber, idempotencyKey, transactionId, employeeId, employeeName, correlationId }) {
    const service = await this.resolve(provider);
    const payload = {
      tenantId,
      amount,
      currency,
      phoneNumber,
      externalId: idempotencyKey,
      reference: idempotencyKey,
      idempotencyKey,
      correlationId,
      metadata: {
        payrollTransactionId: transactionId,
        employeeId,
        employeeName,
      },
    };

    try {
      let response;
      if (typeof service.disburse === 'function') {
        response = await service.disburse(payload);
      } else if (typeof service.initiateTransfer === 'function') {
        response = await service.initiateTransfer(payload);
      } else if (typeof service.create === 'function') {
        response = await service.create(payload);
      } else {
        throw new Error('Provider disbursement service does not expose a supported contract.');
      }

      return {
        provider,
        accepted: Boolean(response?.success !== false),
        status: normalizeStatus(response?.status || response?.providerStatus || response?.state),
        providerTransactionId: response?.transactionId || response?.transactionID || response?.id || response?.reference || response?.providerResponse?.reference || null,
        providerRef: response?.reference || response?.providerRef || response?.providerResponse?.reference || null,
        rawStatus: response?.status || response?.providerStatus || response?.state || null,
      };
    } catch (error) {
      this.logger.warn?.('Payroll provider disbursement failed.', { provider, transactionId, error: error.message });
      return {
        provider,
        accepted: false,
        status: 'UNKNOWN',
        errorCode: error.code || 'PAYROLL_PROVIDER_ERROR',
        message: 'Provider outcome could not be confirmed.',
      };
    }
  }

  async getStatus({ provider, reference }) {
    const service = await this.resolve(provider);
    if (typeof service.getStatus !== 'function') {
      return { provider, status: 'UNKNOWN', providerRef: reference };
    }
    try {
      const response = await service.getStatus(reference);
      return {
        provider,
        status: normalizeStatus(response?.status || response?.providerStatus || response?.state),
        providerRef: response?.reference || response?.providerRef || reference,
      };
    } catch (error) {
      return {
        provider,
        status: 'UNKNOWN',
        providerRef: reference,
        errorCode: error.code || 'PAYROLL_PROVIDER_STATUS_ERROR',
        message: 'Provider status could not be confirmed.',
      };
    }
  }
}

module.exports = { PayrollProviderGateway, normalizeStatus };
