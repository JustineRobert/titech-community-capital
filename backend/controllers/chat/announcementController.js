'use strict';

/**
 * ============================================================================
 * ANNOUNCEMENT CONTROLLER
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Handles system-wide announcements inside governed communication channels.
 *
 * Announcements are:
 *   - ONE-WAY broadcasts
 *   - ADMIN/LEADER controlled
 *   - AUDIT LOGGED
 *   - REAL-TIME broadcast via Socket.IO
 *
 * USED FOR:
 * ----------------------------------------------------------------------------
 * ✅ SACCO Notices
 * ✅ Loan Policy Updates
 * ✅ Savings Alerts
 * ✅ Regulatory Notices (BoU compliance)
 * ✅ Platform-wide alerts
 *
 * ============================================================================
 */

const messageService =
  require('../../services/chat/messageService');

const moderationService =
  require('../../services/chat/moderationService');

const MessageAudit =
  require('../../models/MessageAudit');

const messageEvents =
  require('../../utils/chat/messageEvents');

/*
|--------------------------------------------------------------------------
| Post Announcement
|--------------------------------------------------------------------------
*/

exports.postAnnouncement = async (
  req,
  res,
  next
) => {
  try {
    const {
      conversationId,
      body,
    } = req.body;

    /*
    |--------------------------------------------------------------------------
    | RBAC ENFORCEMENT
    |--------------------------------------------------------------------------
    */

    const role =
      String(req.user.role || '').toUpperCase();

    const allowedRoles = [
      'ADMIN',
      'LEADER',
    ];

    if (
      !allowedRoles.includes(role)
    ) {
      return res.status(403).json({
        error:
          'Only ADMIN or LEADER can post announcements',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | MODERATION LAYER (ACFOS COMPLIANCE)
    |--------------------------------------------------------------------------
    */

    const moderation =
      await moderationService.moderateMessage(
        body,
        {
          conversationId,
          userId:
            req.user._id,
        }
      );

    if (
      moderation.blocked
    ) {
      return res.status(
        400
      ).json({
        error:
          'Announcement blocked by moderation engine',
        reason:
          moderation.reason,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CREATE ANNOUNCEMENT MESSAGE
    |--------------------------------------------------------------------------
    */

    const msg =
      await messageService.createMessage(
        {
          conversationId,
          senderId:
            req.user._id,
          senderRole:
            role,
          body,
          messageType:
            'ANNOUNCEMENT',
        }
      );

    /*
    |--------------------------------------------------------------------------
    | AUDIT LOG
    |--------------------------------------------------------------------------
    */

    await MessageAudit.create(
      {
        action:
          'ANNOUNCEMENT_POSTED',
        conversationId,
        userId:
          req.user._id,
        metadata: {
          messageId:
            msg._id,
        },
      }
    );

    /*
    |--------------------------------------------------------------------------
    | SOCKET BROADCAST
    |--------------------------------------------------------------------------
    */

    const io =
      req.app.get('io');

    if (io) {
      io.to(conversationId).emit(
        messageEvents.CONVERSATION_UPDATE,
        {
          type:
            'ANNOUNCEMENT',
          message: msg,
        }
      );
    }

    res.status(201).json(
      msg
    );
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| Get Announcement Feed (Optional Extension Hook)
|--------------------------------------------------------------------------
*/

exports.getAnnouncements = async (
  req,
  res,
  next
) => {
  try {
    const messageService =
      require('../../services/chat/messageService');

    const messages =
      await messageService.getConversationMessages(
        req.params.conversationId,
        req.query.page || 1,
        req.query.limit || 20
      );

    const filtered =
      messages.filter(
        m =>
          m.messageType ===
          'ANNOUNCEMENT'
      );

    res.json(filtered);
  } catch (err) {
    next(err);
  }
};