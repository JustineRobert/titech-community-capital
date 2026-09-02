'use strict';

/**
 * ============================================================================
 * THREAD LINK SERVICE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Ensures strict enforcement of ACFOS business entity → conversation mapping.
 *
 * TITechChat is NOT a free-form chat system.
 * Every thread MUST be tied to a governed business entity:
 *
 *   LOAN        → Loan lifecycle communication
 *   SAVINGS     → Savings contribution discussions
 *   TRANSACTION → Payment disputes & reconciliation
 *   SUPPORT     → Ticket resolution threads
 *   GROUP       → Member/community discussions
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Entity-to-Thread Mapping
 * ✅ Thread Retrieval by Business Object
 * ✅ Duplicate Thread Prevention
 * ✅ Governance Enforcement Ready
 * ✅ RBAC Integration Ready
 * ✅ Audit/Compliance Ready
 *
 * ============================================================================
 */

const Conversation =
  require('../../models/Conversation');

/*
|--------------------------------------------------------------------------
| Allowed Mapping Rules
|--------------------------------------------------------------------------
*/

const ENTITY_THREAD_MAP = {
  LOAN: 'LOAN',
  SAVINGS: 'SAVINGS',
  TRANSACTION: 'TRANSACTION',
  SUPPORT: 'SUPPORT',
  GROUP: 'GROUP',
};

/*
|--------------------------------------------------------------------------
| Service
|--------------------------------------------------------------------------
*/

class ThreadLinkService {
  /*
  |--------------------------------------------------------------------------
  | Validate Thread Creation Permission
  |--------------------------------------------------------------------------
  */

  canCreateThreadForEntity(
    entityType,
    user,
    actionContext = {}
  ) {
    if (!entityType) return false;

    const normalized =
      String(entityType).toUpperCase();

    if (!ENTITY_THREAD_MAP[normalized]) {
      return false;
    }

    /**
     * ----------------------------------------------------------------------------
     * ACFOS EXTENSION POINT
     * ----------------------------------------------------------------------------
     * In production, this is where we enforce:
     *
     * - Loan Officer approval rights
     * - SACCO member eligibility
     * - Admin-only announcement threads
     * - Transaction dispute validation
     * - Fraud risk scoring checks
     * ----------------------------------------------------------------------------
     */

    if (actionContext?.bypass === true) {
      return true;
    }

    if (!user || !user._id) {
      return false;
    }

    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Generic Thread Resolver
  |--------------------------------------------------------------------------
  */

  async getThreadByEntity(
    entityType,
    entityId
  ) {
    if (!entityType || !entityId) {
      throw new Error(
        'entityType and entityId are required'
      );
    }

    return Conversation.findOne({
      linkedEntityType:
        String(entityType).toUpperCase(),
      linkedEntityId:
        entityId,
    })
      .populate(
        'participants',
        'firstName lastName email avatar'
      )
      .populate(
        'lastMessage'
      );
  }

  /*
  |--------------------------------------------------------------------------
  | Loan Thread
  |--------------------------------------------------------------------------
  */

  async getLoanThread(
    loanId
  ) {
    return this.getThreadByEntity(
      'LOAN',
      loanId
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Savings Thread
  |--------------------------------------------------------------------------
  */

  async getSavingsThread(
    savingsId
  ) {
    return this.getThreadByEntity(
      'SAVINGS',
      savingsId
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Support Thread
  |--------------------------------------------------------------------------
  */

  async getSupportThread(
    ticketId
  ) {
    return this.getThreadByEntity(
      'SUPPORT',
      ticketId
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Transaction Thread
  |--------------------------------------------------------------------------
  */

  async getTransactionThread(
    transactionId
  ) {
    return this.getThreadByEntity(
      'TRANSACTION',
      transactionId
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Check Existing Thread
  |--------------------------------------------------------------------------
  */

  async threadExists(
    entityType,
    entityId
  ) {
    const thread =
      await Conversation.findOne({
        linkedEntityType:
          String(entityType).toUpperCase(),
        linkedEntityId:
          entityId,
      }).select('_id');

    return !!thread;
  }

  /*
  |--------------------------------------------------------------------------
  | Prevent Duplicate Thread Creation
  |--------------------------------------------------------------------------
  */

  async assertNoDuplicateThread(
    entityType,
    entityId
  ) {
    const exists =
      await this.threadExists(
        entityType,
        entityId
      );

    if (exists) {
      throw new Error(
        `Thread already exists for ${entityType}:${entityId}`
      );
    }

    return true;
  }
}

module.exports =
  new ThreadLinkService();