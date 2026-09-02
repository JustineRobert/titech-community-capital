'use strict';

/**
 * ============================================================================
 * UNREAD SERVICE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Manages unread message counters and read receipts for conversations.
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Per-User Unread Counters
 * ✅ Read Receipt Management
 * ✅ Conversation Badge Counts
 * ✅ Bulk Read Operations
 * ✅ Message Read Tracking
 * ✅ Notification Synchronization
 * ✅ Socket.IO Ready
 * ✅ Compliance Ready
 * ✅ Analytics Ready
 * ✅ Multi-Tenant Ready
 *
 * ============================================================================
 */

const mongoose =
  require('mongoose');

const Conversation =
  require('../../models/Conversation');

const Message =
  require('../../models/Message');

const MessageRead =
  require('../../models/MessageRead');

const MessageAudit =
  require('../../models/MessageAudit');

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function normalizeId(
  value
) {
  return String(value);
}

/*
|--------------------------------------------------------------------------
| Service
|--------------------------------------------------------------------------
*/

class UnreadService {
  /*
  |--------------------------------------------------------------------------
  | Increment Unread Counts
  |--------------------------------------------------------------------------
  */

  async incrementUnread(
    conversationId,
    excludeUserId
  ) {
    const conversation =
      await Conversation.findById(
        conversationId
      );

    if (
      !conversation
    ) {
      return null;
    }

    const exclude =
      normalizeId(
        excludeUserId
      );

    for (const participant of conversation.participants) {
      const participantId =
        normalizeId(
          participant
        );

      if (
        participantId ===
        exclude
      ) {
        continue;
      }

      const current =
        conversation.unreadCounts?.get(
          participantId
        ) || 0;

      conversation.unreadCounts.set(
        participantId,
        current + 1
      );
    }

    await conversation.save();

    return conversation;
  }

  /*
  |--------------------------------------------------------------------------
  | Mark Conversation Read
  |--------------------------------------------------------------------------
  */

  async markRead(
    conversationId,
    userId
  ) {
    const session =
      await mongoose.startSession();

    try {
      session.startTransaction();

      const conversation =
        await Conversation.findById(
          conversationId
        ).session(session);

      if (
        !conversation
      ) {
        throw new Error(
          'Conversation not found.'
        );
      }

      const userKey =
        normalizeId(
          userId
        );

      conversation.unreadCounts.set(
        userKey,
        0
      );

      await conversation.save(
        {
          session,
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Mark Messages Read
      |--------------------------------------------------------------------------
      */

      const unreadMessages =
        await Message.find(
          {
            conversationId,
            deletedAt:
              null,
            readBy: {
              $ne:
                userId,
            },
          }
        )
          .select('_id')
          .session(session);

      if (
        unreadMessages.length
      ) {
        const bulkReads =
          unreadMessages.map(
            message => ({
              updateOne: {
                filter: {
                  messageId:
                    message._id,
                  userId,
                },
                update: {
                  $setOnInsert:
                    {
                      messageId:
                        message._id,
                      userId,
                      readAt:
                        new Date(),
                    },
                },
                upsert: true,
              },
            })
          );

        await MessageRead.bulkWrite(
          bulkReads,
          {
            session,
          }
        );

        await Message.updateMany(
          {
            _id: {
              $in:
                unreadMessages.map(
                  m =>
                    m._id
                ),
            },
            readBy: {
              $ne:
                userId,
            },
          },
          {
            $addToSet: {
              readBy:
                userId,
            },
          },
          {
            session,
          }
        );
      }

      /*
      |--------------------------------------------------------------------------
      | Audit
      |--------------------------------------------------------------------------
      */

      await MessageAudit.create(
        [
          {
            action:
              'CONVERSATION_READ',
            conversationId,
            userId,
            metadata: {
              messagesMarked:
                unreadMessages.length,
            },
          },
        ],
        {
          session,
        }
      );

      await session.commitTransaction();

      return {
        success: true,
        messagesMarked:
          unreadMessages.length,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Mark Single Message Read
  |--------------------------------------------------------------------------
  */

  async markMessageRead(
    messageId,
    userId
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

    await MessageRead.findOneAndUpdate(
      {
        messageId,
        userId,
      },
      {
        messageId,
        userId,
        readAt:
          new Date(),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert:
          true,
      }
    );

    await Message.updateOne(
      {
        _id:
          messageId,
      },
      {
        $addToSet: {
          readBy:
            userId,
        },
      }
    );

    return message;
  }

  /*
  |--------------------------------------------------------------------------
  | Reset User Count
  |--------------------------------------------------------------------------
  */

  async resetUnreadCount(
    conversationId,
    userId
  ) {
    const conversation =
      await Conversation.findById(
        conversationId
      );

    if (
      !conversation
    ) {
      return null;
    }

    conversation.unreadCounts.set(
      normalizeId(
        userId
      ),
      0
    );

    await conversation.save();

    return conversation;
  }

  /*
  |--------------------------------------------------------------------------
  | Get User Unread Count
  |--------------------------------------------------------------------------
  */

  async getUnreadCount(
    conversationId,
    userId
  ) {
    const conversation =
      await Conversation.findById(
        conversationId
      ).select(
        'unreadCounts'
      );

    if (
      !conversation
    ) {
      return 0;
    }

    return (
      conversation.unreadCounts?.get(
        normalizeId(
          userId
        )
      ) || 0
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Get Total Unread Count
  |--------------------------------------------------------------------------
  */

  async getTotalUnreadCount(
    userId
  ) {
    const conversations =
      await Conversation.find(
        {
          participants:
            userId,
        }
      ).select(
        'unreadCounts'
      );

    let total = 0;

    for (const conversation of conversations) {
      total +=
        conversation.unreadCounts?.get(
          normalizeId(
            userId
          )
        ) || 0;
    }

    return total;
  }

  /*
  |--------------------------------------------------------------------------
  | Clear All Unread Counts
  |--------------------------------------------------------------------------
  */

  async clearAllUnreadCounts(
    userId
  ) {
    const conversations =
      await Conversation.find(
        {
          participants:
            userId,
        }
      );

    for (const conversation of conversations) {
      conversation.unreadCounts.set(
        normalizeId(
          userId
        ),
        0
      );

      await conversation.save();
    }

    return true;
  }
}

module.exports =
  new UnreadService();