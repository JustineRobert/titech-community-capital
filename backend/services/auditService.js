'use strict';

/**
 * ============================================================================
 * AUDIT SERVICE (ACFOS ENTERPRISE GRADE)
 * ============================================================================
 * TITech Community Capital LTD
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Centralized audit logging + cross-module financial timeline reconstruction.
 *
 * CAPABILITIES
 * ----------------------------------------------------------------------------
 * ✅ Write audit events (immutable log trail)
 * ✅ Support multi-tenant isolation
 * ✅ Link actions to domain entities
 *   - Transactions
 *   - Ledger Entries
 *   - Chat / Messaging events
 *   - System events
 *
 * COMPLIANCE USE CASES
 * ----------------------------------------------------------------------------
 * - Regulatory reporting (BoU / SACCO compliance)
 * - Fraud investigation timelines
 * - Loan lifecycle audit reconstruction
 * - Savings contribution tracking
 * - Dispute resolution evidence
 *
 * ARCHITECTURE NOTE
 * ----------------------------------------------------------------------------
 * This service is append-only by design.
 * NEVER update or delete audit logs.
 *
 * ============================================================================
 */

'use strict';

const mongoose = require('mongoose');

const AuditLog = require('../models/AuditLog');

/*
|--------------------------------------------------------------------------
| CORE AUDIT LOGGER
|--------------------------------------------------------------------------
*/

/**
 * Create immutable audit log entry
 */
async function logAction({
  action,
  userId,
  tenantId,
  entityType,
  entityId,
  metadata = {},
}) {
  if (!action || !userId) {
    throw new Error('Audit log requires action and userId');
  }

  const entry = new AuditLog({
    action,
    userId,
    tenantId,
    entityType,
    entityId,
    metadata,
    timestamp: new Date(),
  });

  await entry.save();

  return entry;
}

/*
|--------------------------------------------------------------------------
| UNIFIED FINANCIAL + SYSTEM TIMELINE
|--------------------------------------------------------------------------
*/

/**
 * Builds a cross-module chronological timeline for compliance & audit
 *
 * Sources:
 * - transactions
 * - ledgerentries
 * - auditlogs
 */
async function getUnifiedTimeline(tenantId, requestId) {
  if (!tenantId || !requestId) {
    throw new Error('tenantId and requestId are required');
  }

  const tenantObjectId = new mongoose.Types.ObjectId(
    tenantId
  );

  const pipeline = [
    /*
    |--------------------------------------------------------------------------
    | Transactions
    |--------------------------------------------------------------------------
    */
    {
      $match: {
        tenantId: tenantObjectId,
        requestId,
      },
    },
    {
      $project: {
        type: { $literal: 'Transaction' },
        id: '$_id',
        status: 1,
        amount: 1,
        currency: 1,
        description: 1,
        createdAt: 1,
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Ledger Entries
    |--------------------------------------------------------------------------
    */
    {
      $unionWith: {
        coll: 'ledgerentries',
        pipeline: [
          {
            $match: {
              tenantId: tenantObjectId,
              requestId,
            },
          },
          {
            $project: {
              type: { $literal: 'LedgerEntry' },
              id: '$_id',
              debitAccount: 1,
              creditAccount: 1,
              amount: 1,
              currency: 1,
              reference: 1,
              createdAt: 1,
            },
          },
        ],
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Audit Logs
    |--------------------------------------------------------------------------
    */
    {
      $unionWith: {
        coll: 'auditlogs',
        pipeline: [
          {
            $match: {
              tenantId: tenantObjectId,
              requestId,
            },
          },
          {
            $project: {
              type: { $literal: 'AuditLog' },
              id: '$_id',
              level: 1,
              message: 1,
              meta: 1,
              createdAt: '$timestamp',
            },
          },
        ],
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Final Sort (Chronological Order)
    |--------------------------------------------------------------------------
    */
    {
      $sort: { createdAt: 1 },
    },
  ];

  const db = mongoose.connection.db;

  const timeline = await db
    .collection('transactions')
    .aggregate(pipeline)
    .toArray();

  return {
    requestId,
    tenantId,
    timeline,
  };
}

/*
|--------------------------------------------------------------------------
| CHAT / SYSTEM EVENT AUDIT HELPERS (ACFOS CHAT INTEGRATION)
|--------------------------------------------------------------------------
*/

/**
 * Convenience wrapper for chat-related events
 */
async function logChatEvent({
  action,
  userId,
  conversationId,
  messageId,
  metadata,
}) {
  return logAction({
    action,
    userId,
    entityType: 'CHAT',
    entityId: conversationId,
    metadata: {
      messageId,
      ...metadata,
    },
  });
}

/**
 * Common chat audit events
 */
const CHAT_EVENTS = {
  MESSAGE_CREATED: 'MESSAGE_CREATED',
  MESSAGE_EDITED: 'MESSAGE_EDITED',
  MESSAGE_DELETED: 'MESSAGE_DELETED',
  CONVERSATION_CREATED: 'CONVERSATION_CREATED',
  CONVERSATION_ARCHIVED: 'CONVERSATION_ARCHIVED',
  EXPORT_PERFORMED: 'EXPORT_PERFORMED',
  PARTICIPANT_ADDED: 'PARTICIPANT_ADDED',
  PARTICIPANT_REMOVED: 'PARTICIPANT_REMOVED',
  ANNOUNCEMENT_POSTED: 'ANNOUNCEMENT_POSTED',
};

/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

module.exports = {
  logAction,
  logChatEvent,
  getUnifiedTimeline,
  CHAT_EVENTS,
};