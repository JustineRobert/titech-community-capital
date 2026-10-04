'use strict';

/**
 * Legacy compatibility facade for the canonical sanctions screening service.
 *
 * This file exists only to preserve older controller imports while routing all
 * screening work to backend/modules/risk/services/sanctionsScreeningService.js.
 * It does not weaken fail-closed behaviour or create a second sanctions engine.
 */

const SanctionsScreeningService = require('../modules/risk/services/sanctionsScreeningService.js');

const service = new SanctionsScreeningService();

module.exports = Object.freeze({
  screen: async function screen(input = {}) {
    const normalized = {
      tenantId: input.tenantId ?? null,
      phoneNumber: input.phoneNumber ?? null,
      userId: input.userId ?? null,
    };

    const result = await service.screenCustomer(
      normalized,
      {
        tenantId: normalized.tenantId,
        correlationId: input.correlationId,
      },
    );

    return {
      ...result,
      passed: result.decision !== 'BLOCK',
      matched: Array.isArray(result.matches)
        ? result.matches.length > 0
        : Boolean(result.matched),
      matches: result.matches ?? [],
    };
  },
  screenCustomer: (...args) => service.screenCustomer(...args),
  screenTransaction: (...args) => service.screenTransaction(...args),
  getHealth: () => service.getHealth(),
});
