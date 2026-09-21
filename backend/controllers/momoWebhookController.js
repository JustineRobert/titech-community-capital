/**
 * =============================================================================
 * TITech Community Capital Ltd
 * MoMo Webhook Controller
 * =============================================================================
 *
 * Architectural role:
 *   Thin compatibility boundary for legacy Mobile Money callback processing.
 *
 * Responsibilities:
 *   - Expose the canonical callback handler to route modules.
 *   - Preserve the existing CJS integration boundary until that integration is
 *     fully consolidated behind the provider-neutral payment port.
 *   - Never mutate balances, wallets, loans or ledger entries directly.
 *
 * Explicit non-responsibilities:
 *   - Provider signature verification.
 *   - Callback normalization.
 *   - Idempotency persistence.
 *   - Financial posting.
 *   - Reconciliation.
 *   - Settlement.
 *
 * The integration module remains an intentional CommonJS interoperability
 * boundary and is marked for later consolidation only after runtime tests prove
 * provider behavior is preserved.
 * =============================================================================
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleMomoCallback: handleMomoCallbackImpl } = require('../modules/integrations/momo.webhook.js');

if (typeof handleMomoCallbackImpl !== 'function') {
  throw new TypeError(
    '[MoMoWebhookController] Canonical handleMomoCallback export is required.',
  );
}

async function momoCallback(req, res, next) {
  try {
    return await handleMomoCallbackImpl(req, res);
  } catch (error) {
    if (typeof next === 'function') return next(error);
    throw error;
  }
}

export { momoCallback };
export const handleMoMoWebhook = momoCallback;
export const handleWebhook = momoCallback;
export const handleMomoCallback = momoCallback;

export default Object.freeze({
  momoCallback,
  handleMoMoWebhook,
  handleWebhook,
  handleMomoCallback,
});
