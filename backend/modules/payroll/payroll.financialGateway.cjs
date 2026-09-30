'use strict';

const { PayrollError } = require('./payroll.errors.cjs');

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

class PayrollFinancialGateway {
  constructor({ serviceRegistry = null, context = null } = {}) {
    this.serviceRegistry = serviceRegistry;
    this.context = context;
  }

  resolve() {
    const registry = this.serviceRegistry || this.context?.services || this.context?.serviceRegistry;
    return resolveRegistryService(registry, [
      'payrollFinancialGateway',
      'financialOperationService',
      'financialService',
      'paymentProcessingService',
    ]);
  }

  async postPayrollDisbursement(input) {
    const service = this.resolve();
    if (!service) {
      return { status: 'REQUIRES_REVIEW', reason: 'FINANCIAL_GATEWAY_NOT_REGISTERED' };
    }

    if (typeof service.postPayrollDisbursement === 'function') {
      const result = await service.postPayrollDisbursement(input);
      return { status: result?.status || 'POSTED', result };
    }

    if (typeof service.postDisbursement === 'function') {
      const result = await service.postDisbursement(input);
      return { status: result?.status || 'POSTED', result };
    }

    return {
      status: 'REQUIRES_REVIEW',
      reason: 'CANONICAL_FINANCIAL_GATEWAY_HAS_NO_PAYROLL_POSTING_CONTRACT',
    };
  }
}

module.exports = { PayrollFinancialGateway, PayrollError };
