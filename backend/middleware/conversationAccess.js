'use strict';

/**
 * ============================================================================
 * CONVERSATION ACCESS MIDDLEWARE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Validates that the authenticated user can access a conversation and its
 * linked business entity.
 *
 * This middleware is a critical security layer because TITechChat conversations
 * are tightly coupled to business objects such as:
 *
 * ✅ Loans
 * ✅ Savings
 * ✅ Transactions
 * ✅ Support Tickets
 * ✅ Groups
 * ✅ Announcements
 *
 * SECURITY FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Conversation Membership Validation
 * ✅ Conversation Admin Validation
 * ✅ Linked Entity Authorization
 * ✅ Archived Conversation Handling
 * ✅ Deleted Conversation Protection
 * ✅ Multi-Tenant Ready
 * ✅ RBAC Ready
 * ✅ Audit Ready
 * ✅ Compliance Ready
 *
 * ============================================================================
 */

const Conversation = require('../models/Conversation');
const {
  isParticipant,
  isAdmin,
} = require('../utils/chat/conversationHelpers');

/*
|--------------------------------------------------------------------------
| Optional Linked Entity Validator
|--------------------------------------------------------------------------
|
| Implement this file if you need fine-grained access checks:
|
| middleware/linkedEntityValidator.js
|
| module.exports.validateLinkedEntityAccess =
|   async (user, type, entityId) => { ... }
|
*/

let validateLinkedEntityAccess =
  async () => true;

try {
  ({
    validateLinkedEntityAccess,
  } = require('./linkedEntityValidator'));
} catch (error) {
  // Optional module not installed.
}

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function getConversationId(
  req
) {
  return (
    req.params.conversationId ||
    req.params.id ||
    req.body.conversationId ||
    req.query.conversationId
  );
}

function forbidden(
  res,
  message =
    'Forbidden'
) {
  return res.status(403).json({
    success: false,
    message,
    code: 'FORBIDDEN',
  });
}

/*
|--------------------------------------------------------------------------
| Main Middleware
|--------------------------------------------------------------------------
*/

async function conversationAccess(
  req,
  res,
  next
) {
  try {
    const conversationId =
      getConversationId(req);

    if (
      !conversationId
    ) {
      return res.status(400).json({
        success: false,
        message:
          'conversationId is required.',
        code:
          'CONVERSATION_ID_REQUIRED',
      });
    }

    const conversation =
      await Conversation.findById(
        conversationId
      );

    if (
      !conversation
    ) {
      return res.status(404).json({
        success: false,
        message:
          'Conversation not found.',
        code:
          'CONVERSATION_NOT_FOUND',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Deleted Conversation Protection
    |--------------------------------------------------------------------------
    */

    if (
      conversation.isDeleted ||
      conversation.softDeleted
    ) {
      return res.status(404).json({
        success: false,
        message:
          'Conversation no longer exists.',
        code:
          'CONVERSATION_DELETED',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Membership Validation
    |--------------------------------------------------------------------------
    */

    const userId =
      req.user._id ||
      req.user.id;

    const participant =
      await isParticipant(
        conversation._id,
        userId
      );

    const admin =
      await isAdmin(
        conversation._id,
        userId
      );

    const isSystemAdmin =
      [
        'ADMIN',
        'SUPER_ADMIN',
        'SUPPORT',
      ].includes(
        String(
          req.user.role || ''
        ).toUpperCase()
      );

    const allowed =
      participant ||
      admin ||
      isSystemAdmin;

    if (!allowed) {
      return forbidden(
        res,
        'Forbidden: not a participant.'
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Linked Entity Validation
    |--------------------------------------------------------------------------
    */

    if (
      conversation.linkedEntityType &&
      conversation.linkedEntityId
    ) {
      const entityAllowed =
        await validateLinkedEntityAccess(
          req.user,
          conversation.linkedEntityType,
          conversation.linkedEntityId,
          req
        );

      if (
        !entityAllowed
      ) {
        return forbidden(
          res,
          `Forbidden: cannot access linked ${conversation.linkedEntityType}.`
        );
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Conversation Status Validation
    |--------------------------------------------------------------------------
    */

    if (
      conversation.status ===
        'LOCKED' &&
      req.method !== 'GET' &&
      !isSystemAdmin
    ) {
      return forbidden(
        res,
        'Conversation is locked.'
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Attach Conversation To Request
    |--------------------------------------------------------------------------
    */

    req.conversation =
      conversation;

    return next();
  } catch (error) {
    return next(error);
  }
}

/*
|--------------------------------------------------------------------------
| Additional Guards
|--------------------------------------------------------------------------
*/

async function requireAdmin(
  req,
  res,
  next
) {
  try {
    const conversationId =
      getConversationId(req);

    const admin =
      await isAdmin(
        conversationId,
        req.user._id
      );

    if (!admin) {
      return forbidden(
        res,
        'Conversation administrator privileges required.'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

async function requireActiveConversation(
  req,
  res,
  next
) {
  try {
    const conversation =
      req.conversation;

    if (
      !conversation
    ) {
      return res.status(500).json({
        success: false,
        message:
          'Conversation middleware order is incorrect.',
      });
    }

    if (
      conversation.status ===
      'ARCHIVED'
    ) {
      return forbidden(
        res,
        'Conversation has been archived.'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports =
  conversationAccess;

module.exports.requireParticipant =
  conversationAccess;

module.exports.requireAdmin =
  requireAdmin;

module.exports.requireActiveConversation =
  requireActiveConversation;