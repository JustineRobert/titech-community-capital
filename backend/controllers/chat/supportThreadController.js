'use strict';

/**
 * ============================================================================
 * SUPPORT THREAD CONTROLLER
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Manages creation of SUPPORT conversation threads tied to:
 *
 *   - Support Tickets
 *   - Member Complaints
 *   - Operational Issues
 *   - Service Requests
 *
 * These threads are NOT free-form chats.
 * They are governed operational communication channels.
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Support Thread Creation
 * ✅ ACFOS Entity Binding Enforcement
 * ✅ RBAC Ready (Support/Admin roles)
 * ✅ Audit-Friendly Structure
 * ✅ Linked Ticket Traceability
 *
 * ============================================================================
 */

const conversationService =
  require('../../services/chat/conversationService');

const threadLinkService =
  require('../../services/chat/threadLinkService');

/*
|--------------------------------------------------------------------------
| Create Support Thread
|--------------------------------------------------------------------------
*/

exports.createSupportThread = async (
  req,
  res,
  next
) => {
  try {
    const {
      title,
      description,
      supportTicketId,
      participants,
      admins,
    } = req.body;

    /*
    |--------------------------------------------------------------------------
    | ACFOS VALIDATION: ENTITY THREAD RULE
    |--------------------------------------------------------------------------
    | Every support thread MUST be linked to a valid support ticket
    |--------------------------------------------------------------------------
    */

    if (!supportTicketId) {
      return res.status(400).json({
        error:
          'supportTicketId is required to create a support thread',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | DUPLICATE THREAD PREVENTION
    |--------------------------------------------------------------------------
    */

    const existing =
      await threadLinkService.getSupportThread(
        supportTicketId
      );

    if (existing) {
      return res.status(409).json({
        error:
          'Support thread already exists for this ticket',
        conversationId:
          existing._id,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | RBAC PLACEHOLDER EXTENSION
    |--------------------------------------------------------------------------
    */

    const isSupportOrAdmin =
      ['SUPPORT', 'ADMIN'].includes(
        String(req.user.role || '').toUpperCase()
      );

    if (!isSupportOrAdmin) {
      return res.status(403).json({
        error:
          'Only support or admin users can create support threads',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CREATE CONVERSATION
    |--------------------------------------------------------------------------
    */

    const conv =
      await conversationService.create(
        {
          type: 'SUPPORT',
          title,
          description,
          linkedEntityType: 'SUPPORT',
          linkedEntityId:
            supportTicketId,
          participants:
            participants || [],
          admins:
            admins || [
              req.user._id,
            ],
          createdBy:
            req.user._id,
          status: 'ACTIVE',
        },
        req.user._id
      );

    res.status(201).json(conv);
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| Get Support Thread
|--------------------------------------------------------------------------
*/

exports.getSupportThread = async (
  req,
  res,
  next
) => {
  try {
    const thread =
      await threadLinkService.getSupportThread(
        req.params.supportTicketId
      );

    if (!thread) {
      return res.status(404).json({
        error:
          'Support thread not found',
      });
    }

    res.json(thread);
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| Lock Support Thread (Compliance / Resolution)
|--------------------------------------------------------------------------
*/

exports.lockSupportThread = async (
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