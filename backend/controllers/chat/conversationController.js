'use strict';

/**
 * ============================================================================
 * CONVERSATION CONTROLLER
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Handles HTTP layer for conversation operations including:
 *
 * ✅ Conversation Creation (ACFOS governed)
 * ✅ Fetch Single Conversation
 * ✅ Archive Conversation
 * ✅ User Conversation Listing
 * ✅ RBAC Enforcement Hooks
 * ✅ Validation Layer Enforcement
 * ✅ Error Standardization
 *
 * NOTES
 * ----------------------------------------------------------------------------
 * This controller is intentionally thin:
 * Business logic MUST remain in services.
 *
 * ============================================================================
 */

const conversationService =
  require('../../services/chat/conversationService');

/*
|--------------------------------------------------------------------------
| Create Conversation
|--------------------------------------------------------------------------
*/

exports.createConversation = async (
  req,
  res,
  next
) => {
  try {
    const payload = req.body;

    /*
    |--------------------------------------------------------------------------
    | ACFOS RULE ENFORCEMENT
    |--------------------------------------------------------------------------
    | No free-form social chat allowed.
    | Every conversation MUST be:
    |   - linked to an entity (loan, savings, transaction, support, group)
    |   OR be an announcement/group thread
    |--------------------------------------------------------------------------
    */

    const isFreeForm =
      !payload.linkedEntityType &&
      !['GROUP', 'ANNOUNCEMENT'].includes(
        String(payload.type || '').toUpperCase()
      );

    if (isFreeForm) {
      return res.status(403).json({
        error:
          'Free-form conversations are not allowed in ACFOS chat system',
      });
    }

    const conv =
      await conversationService.create(
        payload,
        req.user._id
      );

    res.status(201).json(conv);
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| Get Conversation
|--------------------------------------------------------------------------
*/

exports.getConversation = async (
  req,
  res,
  next
) => {
  try {
    const conv =
      await conversationService.findById(
        req.params.conversationId
      );

    if (!conv) {
      return res.status(404).json({
        error: 'Conversation not found',
      });
    }

    res.json(conv);
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| Archive Conversation
|--------------------------------------------------------------------------
*/

exports.archiveConversation = async (
  req,
  res,
  next
) => {
  try {
    const conv =
      await conversationService.archive(
        req.params.conversationId,
        req.user._id
      );

    res.json(conv);
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| User Conversations
|--------------------------------------------------------------------------
*/

exports.myConversations = async (
  req,
  res,
  next
) => {
  try {
    const data =
      await conversationService.getUserConversations(
        req.user.id,
        req.query
      );

    res.json(data);
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| Lock Conversation (Admin / Compliance)
|--------------------------------------------------------------------------
*/

exports.lockConversation = async (
  req,
  res,
  next
) => {
  try {
    const conv =
      await conversationService.lock(
        req.params.conversationId,
        req.user._id
      );

    res.json(conv);
  } catch (err) {
    next(err);
  }
};