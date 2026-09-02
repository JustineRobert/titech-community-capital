'use strict';

/**
 * linkedEntityValidator
 *
 * Validates that a user can access a linked entity before allowing conversation access.
 * - Exports validateLinkedEntityAccess(user, linkedEntityType, linkedEntityId)
 * - Returns boolean (true = allowed, false = denied)
 *
 * Usage:
 * const { validateLinkedEntityAccess } = require('../middleware/linkedEntityValidator');
 * const allowed = await validateLinkedEntityAccess(req.user, 'Loan', conv.linkedEntityId);
 */

const LRU = require('lru-cache');
const titech = require('../services/titechClient');

const cache = new LRU({
  max: 5000,
  ttl: Number(process.env.LINKED_ENTITY_CACHE_TTL_MS || 30 * 1000) // 30s default
});

async function validateLinkedEntityAccess(user, linkedEntityType, linkedEntityId) {
  if (!linkedEntityType || !linkedEntityId) return true; // no linked entity => allowed for group/announcement flows handled elsewhere

  const cacheKey = `${user._id}:${linkedEntityType}:${linkedEntityId}`;
  const cached = cache.get(cacheKey);
  if (typeof cached === 'boolean') return cached;

  try {
    let allowed = false;
    switch ((linkedEntityType || '').toLowerCase()) {
      case 'loan':
      case 'loanthread':
        allowed = await titech.canViewLoan(user._id, linkedEntityId);
        break;
      case 'savings':
      case 'savingsthread':
        allowed = await titech.canViewSavings(user._id, linkedEntityId);
        break;
      case 'transaction':
      case 'transactionthread':
        allowed = await titech.canViewTransaction(user._id, linkedEntityId);
        break;
      case 'support':
      case 'supportticket':
        allowed = await titech.canViewSupportTicket(user._id, linkedEntityId);
        break;
      case 'group':
      case 'groupdiscussion':
        allowed = await titech.canViewGroup(user._id, linkedEntityId);
        break;
      default:
        // Unknown entity type: deny by default to be safe
        allowed = false;
    }

    // Cache result (both true and false) for short TTL
    cache.set(cacheKey, Boolean(allowed));
    return Boolean(allowed);
  } catch (err) {
    // On transient errors, be conservative: deny access.
    // Log error for operators (do not leak tokens or PII)
    // Use your project's logger; fallback to console
    const logger = global.logger || console;
    logger.warn && logger.warn('linkedEntityValidator error', {
      userId: user && user._id,
      linkedEntityType,
      linkedEntityId,
      message: err && err.message
    });
    return false;
  }
}

module.exports = { validateLinkedEntityAccess };