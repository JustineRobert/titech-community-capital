'use strict';

/**
 * ============================================================================
 * MESSAGE CONTROLLER
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Handles HTTP + realtime coordination for message operations:
 *
 * ✅ Send Message
 * ✅ Edit Message
 * ✅ Delete Message
 * ✅ Moderation Enforcement
 * ✅ Unread Tracking Integration
 * ✅ Socket.IO Event Broadcasting
 * ✅ Compliance Ready Hooks
 *
 * NOTES
 * ----------------------------------------------------------------------------
 * Controller is intentionally thin:
 * All business logic is delegated to services.
 *
 * ============================================================================
 */

const messageService =
  require('../../services/chat/messageService');

const moderationService =
  require('../../services/chat/moderationService');

const unreadService =
  require('../../services/chat/unreadService');

const messageEvents =
  require('../../utils/chat/messageEvents');

/*
|--------------------------------------------------------------------------
| Send Message
|--------------------------------------------------------------------------
*/

exports.sendMessage = async (
  req,
  res,
  next
) => {
  try {
    const {
      body,
      attachments,
      replyTo,
      messageType,
    } = req.body;

    const conversationId =
      req.params.id;

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
          'Message blocked by moderation engine',
        reason:
          moderation.reason,
        flaggedWord:
          moderation.flaggedWord,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CREATE MESSAGE
    |--------------------------------------------------------------------------
    */

    const message =
      await messageService.createMessage(
        {
          conversationId,
          senderId:
            req.user._id,
          senderRole:
            req.user.role,
          body,
          attachments:
            attachments || [],
          replyTo,
          messageType:
            messageType ||
            'TEXT',
        }
      );

    /*
    |--------------------------------------------------------------------------
    | UNREAD TRACKING
    |--------------------------------------------------------------------------
    */

    await unreadService.incrementUnread(
      conversationId,
      req.user._id
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
        messageEvents.MESSAGE_NEW,
        message
      );
    }

    res.status(201).json(
      message
    );
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| Edit Message
|--------------------------------------------------------------------------
*/

exports.editMessage = async (
  req,
  res,
  next
) => {
  try {
    const message =
      await messageService.editMessage(
        req.params.messageId,
        req.user._id,
        req.body.body
      );

    const io =
      req.app.get('io');

    if (io) {
      io.to(
        message.conversationId.toString()
      ).emit(
        messageEvents.MESSAGE_UPDATE,
        message
      );
    }

    res.json(message);
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| Delete Message
|--------------------------------------------------------------------------
*/

exports.deleteMessage = async (
  req,
  res,
  next
) => {
  try {
    const message =
      await messageService.deleteMessage(
        req.params.messageId,
        req.user._id
      );

    const io =
      req.app.get('io');

    if (io) {
      io.to(
        message.conversationId.toString()
      ).emit(
        messageEvents.MESSAGE_DELETE,
        {
          messageId:
            message._id,
        }
      );
    }

    res.json({
      success: true,
    });
  } catch (err) {
    next(err);
  }
};