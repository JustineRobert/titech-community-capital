'use strict';

/**
 * ============================================================================
 * MESSAGE SERVICE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Central service responsible for message lifecycle management.
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Create Messages
 * ✅ Edit Messages
 * ✅ Delete Messages (Soft Delete)
 * ✅ Reply Threads
 * ✅ Attachments
 * ✅ Read Receipts
 * ✅ Delivery Tracking
 * ✅ Conversation Activity Updates
 * ✅ Pagination
 * ✅ Search Ready
 * ✅ Export Ready
 * ✅ Audit Logging
 * ✅ Compliance Ready
 * ✅ Socket.IO Ready
 *
 * ============================================================================
 */

const mongoose =
  require('mongoose');

const Message =
  require('../../models/Message');
const Conversation =
  require('../../models/Conversation');
const MessageAudit =
  require('../../models/MessageAudit');

/*
|--------------------------------------------------------------------------
| Service
|--------------------------------------------------------------------------
*/

class MessageService {
  /*
  |--------------------------------------------------------------------------
  | Create Message
  |--------------------------------------------------------------------------
  */

  async createMessage(
    payload
  ) {
    const session =
      await mongoose.startSession();

    try {
      session.startTransaction();

      const conversation =
        await Conversation.findById(
          payload.conversationId
        ).session(session);

      if (
        !conversation
      ) {
        throw new Error(
          'Conversation not found.'
        );
      }

      const message =
        await Message.create(
          [
            {
              conversationId:
                payload.conversationId,
              senderId:
                payload.senderId,
              senderRole:
                payload.senderRole,
              body:
                payload.body,
              attachments:
                payload.attachments ||
                [],
              messageType:
                payload.messageType ||
                'TEXT',
              replyTo:
                payload.replyTo,
              systemMetadata:
                payload.systemMetadata ||
                {},
              auditMetadata:
                payload.auditMetadata ||
                {},
            },
          ],
          {
            session,
          }
        );

      const created =
        message[0];

      /*
      |--------------------------------------------------------------------------
      | Update Conversation
      |--------------------------------------------------------------------------
      */

      await Conversation.findByIdAndUpdate(
        payload.conversationId,
        {
          lastMessage:
            created._id,
          lastActivityAt:
            new Date(),
        },
        {
          session,
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Audit
      |--------------------------------------------------------------------------
      */

      await MessageAudit.create(
        [
          {
            action:
              'MESSAGE_CREATED',
            conversationId:
              payload.conversationId,
            messageId:
              created._id,
            userId:
              payload.senderId,
            metadata: {
              messageType:
                created.messageType,
              attachments:
                created.attachments
                  ?.length ||
                0,
            },
          },
        ],
        {
          session,
        }
      );

      await session.commitTransaction();

      return created;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Get Messages
  |--------------------------------------------------------------------------
  */

  async getConversationMessages(
    conversationId,
    page = 1,
    limit = 50
  ) {
    page = Math.max(
      1,
      Number(page)
    );

    limit = Math.min(
      100,
      Math.max(
        1,
        Number(limit)
      )
    );

    const query = {
      conversationId,
      deletedAt: null,
    };

    const [
      messages,
      total,
    ] = await Promise.all([
      Message.find(query)
        .populate(
          'senderId',
          'firstName lastName email avatar'
        )
        .populate(
          'replyTo'
        )
        .sort({
          createdAt: -1,
        })
        .skip(
          (page - 1) *
            limit
        )
        .limit(limit),

      Message.countDocuments(
        query
      ),
    ]);

    return {
      data:
        messages.reverse(),
      pagination: {
        page,
        limit,
        total,
        totalPages:
          Math.ceil(
            total /
              limit
          ),
        hasNextPage:
          page * limit <
          total,
        hasPreviousPage:
          page > 1,
      },
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Find By Id
  |--------------------------------------------------------------------------
  */

  async findById(
    messageId
  ) {
    return Message.findById(
      messageId
    )
      .populate(
        'senderId',
        'firstName lastName email avatar'
      )
      .populate(
        'replyTo'
      );
  }

  /*
  |--------------------------------------------------------------------------
  | Edit Message
  |--------------------------------------------------------------------------
  */

  async editMessage(
    messageId,
    editorId,
    body
  ) {
    const message =
      await Message.findById(
        messageId
      );

    if (
      !message
    ) {
      throw new Error(
        'Message not found.'
      );
    }

    message.body =
      body;
    message.editedAt =
      new Date();
    message.editedBy =
      editorId;

    await message.save();

    await MessageAudit.create(
      {
        action:
          'MESSAGE_EDITED',
        conversationId:
          message.conversationId,
        messageId:
          message._id,
        userId:
          editorId,
        metadata: {},
      }
    );

    return message;
  }

  /*
  |--------------------------------------------------------------------------
  | Delete Message
  |--------------------------------------------------------------------------
  */

  async deleteMessage(
    messageId,
    deleterId
  ) {
    const message =
      await Message.findById(
        messageId
      );

    if (
      !message
    ) {
      throw new Error(
        'Message not found.'
      );
    }

    message.deletedAt =
      new Date();

    message.deletedBy =
      deleterId;

    await message.save();

    await MessageAudit.create(
      {
        action:
          'MESSAGE_DELETED',
        conversationId:
          message.conversationId,
        messageId:
          message._id,
        userId:
          deleterId,
        metadata: {},
      }
    );

    return message;
  }

  /*
  |--------------------------------------------------------------------------
  | Mark Delivered
  |--------------------------------------------------------------------------
  */

  async markDelivered(
    messageId,
    userId
  ) {
    return Message.findByIdAndUpdate(
      messageId,
      {
        $addToSet: {
          deliveredTo:
            userId,
        },
      },
      {
        new: true,
      }
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Mark Read
  |--------------------------------------------------------------------------
  */

  async markRead(
    messageId,
    userId
  ) {
    return Message.findByIdAndUpdate(
      messageId,
      {
        $addToSet: {
          readBy:
            userId,
        },
      },
      {
        new: true,
      }
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Pin Message
  |--------------------------------------------------------------------------
  */

  async pinMessage(
    messageId
  ) {
    const message =
      await Message.findById(
        messageId
      );

    if (
      !message
    ) {
      throw new Error(
        'Message not found.'
      );
    }

    await Conversation.findByIdAndUpdate(
      message.conversationId,
      {
        $addToSet: {
          pinnedMessageIds:
            message._id,
        },
      }
    );

    return message;
  }

  /*
  |--------------------------------------------------------------------------
  | Search Messages
  |--------------------------------------------------------------------------
  */

  async searchMessages(
    conversationId,
    search
  ) {
    return Message.find({
      conversationId,
      deletedAt: null,
      body: {
        $regex: search,
        $options: 'i',
      },
    })
      .sort({
        createdAt: -1,
      })
      .limit(100);
  }

  /*
  |--------------------------------------------------------------------------
  | Counts
  |--------------------------------------------------------------------------
  */

  async countMessages(
    conversationId
  ) {
    return Message.countDocuments(
      {
        conversationId,
        deletedAt: null,
      }
    );
  }
}

module.exports =
  new MessageService();