'use strict';

/**
 * ============================================================================
 * CONVERSATION SERVICE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Central business service responsible for conversation lifecycle management.
 *
 * TITechChat is not an open social chat system. Conversations are tightly
 * coupled to ACFOS business entities:
 *
 * ✅ Group Discussions
 * ✅ Loan Threads
 * ✅ Savings Threads
 * ✅ Transaction Disputes
 * ✅ Support Tickets
 * ✅ Announcements
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Conversation Creation
 * ✅ Entity Validation
 * ✅ User Conversations
 * ✅ Conversation Archiving
 * ✅ Conversation Locking
 * ✅ Participant Management
 * ✅ Unread Count Management
 * ✅ Audit Logging
 * ✅ Compliance Ready
 * ✅ Multi-Tenant Ready
 * ✅ Realtime Ready
 *
 * ============================================================================
 */

const mongoose =
  require('mongoose');

const Conversation =
  require('../../models/Conversation');
const Message =
  require('../../models/Message');
const MessageAudit =
  require('../../models/MessageAudit');

/*
|--------------------------------------------------------------------------
| Constants
|--------------------------------------------------------------------------
*/

const ALLOWED_ENTITY_TYPES =
  [
    'GROUP',
    'LOAN',
    'SAVINGS',
    'TRANSACTION',
    'SUPPORT',
  ];

const ALLOWED_TYPES = [
  'GROUP',
  'LOAN',
  'SAVINGS',
  'SUPPORT',
  'TRANSACTION',
  'ANNOUNCEMENT',
];

/*
|--------------------------------------------------------------------------
| Service
|--------------------------------------------------------------------------
*/

class ConversationService {
  /*
  |--------------------------------------------------------------------------
  | Find By Id
  |--------------------------------------------------------------------------
  */

  async findById(id) {
    return Conversation.findById(
      id
    )
      .populate(
        'participants',
        'firstName lastName email avatar'
      )
      .populate(
        'admins',
        'firstName lastName email avatar'
      )
      .populate(
        'createdBy',
        'firstName lastName email'
      )
      .populate(
        'lastMessage'
      );
  }

  /*
  |--------------------------------------------------------------------------
  | Create Conversation
  |--------------------------------------------------------------------------
  */

  async create(
    payload,
    actorId
  ) {
    const session =
      await mongoose.startSession();

    try {
      session.startTransaction();

      const type =
        String(
          payload.type
        ).toUpperCase();

      /*
      |--------------------------------------------------------------------------
      | Validation
      |--------------------------------------------------------------------------
      */

      if (
        !ALLOWED_TYPES.includes(
          type
        )
      ) {
        throw new Error(
          `Invalid conversation type: ${type}`
        );
      }

      /*
      |--------------------------------------------------------------------------
      | ACFOS Restriction
      |--------------------------------------------------------------------------
      */

      const unrestricted =
        [
          'GROUP',
          'ANNOUNCEMENT',
        ];

      if (
        !unrestricted.includes(
          type
        )
      ) {
        if (
          !payload.linkedEntityType ||
          !payload.linkedEntityId
        ) {
          throw new Error(
            'Business conversations must be linked to an ACFOS entity.'
          );
        }
      }

      if (
        payload.linkedEntityType
      ) {
        const linkedType =
          String(
            payload.linkedEntityType
          ).toUpperCase();

        if (
          !ALLOWED_ENTITY_TYPES.includes(
            linkedType
          )
        ) {
          throw new Error(
            `Invalid linked entity type: ${linkedType}`
          );
        }
      }

      /*
      |--------------------------------------------------------------------------
      | Participants Validation
      |--------------------------------------------------------------------------
      */

      const participants =
        Array.from(
          new Set(
            [
              ...(payload.participants ||
                []),
              actorId,
            ].map(String)
          )
        );

      /*
      |--------------------------------------------------------------------------
      | Prevent Duplicate Entity Conversations
      |--------------------------------------------------------------------------
      */

      if (
        payload.linkedEntityType &&
        payload.linkedEntityId
      ) {
        const existing =
          await Conversation.findOne(
            {
              linkedEntityType:
                payload.linkedEntityType,
              linkedEntityId:
                payload.linkedEntityId,
              status: {
                $ne:
                  'ARCHIVED',
              },
            }
          ).session(
            session
          );

        if (existing) {
          await session.abortTransaction();
          return existing;
        }
      }

      /*
      |--------------------------------------------------------------------------
      | Create
      |--------------------------------------------------------------------------
      */

      const conversation =
        await Conversation.create(
          [
            {
              ...payload,
              type,
              participants,
              createdBy:
                actorId,
              lastActivityAt:
                new Date(),
            },
          ],
          {
            session,
          }
        );

      const created =
        conversation[0];

      /*
      |--------------------------------------------------------------------------
      | Audit
      |--------------------------------------------------------------------------
      */

      await MessageAudit.create(
        [
          {
            action:
              'CONVERSATION_CREATED',
            conversationId:
              created._id,
            userId:
              actorId,
            metadata: {
              type,
              linkedEntityType:
                payload.linkedEntityType,
              linkedEntityId:
                payload.linkedEntityId,
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
  | Archive Conversation
  |--------------------------------------------------------------------------
  */

  async archive(
    conversationId,
    userId
  ) {
    const conversation =
      await Conversation.findByIdAndUpdate(
        conversationId,
        {
          status:
            'ARCHIVED',
          deletedAt:
            new Date(),
          deletedBy:
            userId,
        },
        {
          new: true,
        }
      );

    if (
      conversation
    ) {
      await MessageAudit.create(
        {
          action:
            'CONVERSATION_ARCHIVED',
          conversationId,
          userId,
          metadata: {},
        }
      );
    }

    return conversation;
  }

  /*
  |--------------------------------------------------------------------------
  | Lock Conversation
  |--------------------------------------------------------------------------
  */

  async lock(
    conversationId,
    userId
  ) {
    const conversation =
      await Conversation.findByIdAndUpdate(
        conversationId,
        {
          status:
            'LOCKED',
        },
        {
          new: true,
        }
      );

    if (
      conversation
    ) {
      await MessageAudit.create(
        {
          action:
            'CONVERSATION_LOCKED',
          conversationId,
          userId,
        }
      );
    }

    return conversation;
  }

  /*
  |--------------------------------------------------------------------------
  | User Conversations
  |--------------------------------------------------------------------------
  */

  async getUserConversations(
    userId,
    filters = {}
  ) {
    const query = {
      participants:
        userId,
      status: {
        $ne:
          'ARCHIVED',
      },
    };

    if (
      filters.type
    ) {
      query.type =
        String(
          filters.type
        ).toUpperCase();
    }

    return Conversation.find(
      query
    )
      .populate(
        'lastMessage'
      )
      .sort({
        lastActivityAt:
          -1,
      });
  }

  /*
  |--------------------------------------------------------------------------
  | Add Participant
  |--------------------------------------------------------------------------
  */

  async addParticipant(
    conversationId,
    participantId,
    actorId
  ) {
    const conversation =
      await Conversation.findByIdAndUpdate(
        conversationId,
        {
          $addToSet: {
            participants:
              participantId,
          },
        },
        {
          new: true,
        }
      );

    if (
      conversation
    ) {
      await MessageAudit.create(
        {
          action:
            'PARTICIPANT_ADDED',
          conversationId,
          userId:
            actorId,
          metadata: {
            participantId,
          },
        }
      );
    }

    return conversation;
  }

  /*
  |--------------------------------------------------------------------------
  | Remove Participant
  |--------------------------------------------------------------------------
  */

  async removeParticipant(
    conversationId,
    participantId,
    actorId
  ) {
    const conversation =
      await Conversation.findByIdAndUpdate(
        conversationId,
        {
          $pull: {
            participants:
              participantId,
          },
        },
        {
          new: true,
        }
      );

    if (
      conversation
    ) {
      await MessageAudit.create(
        {
          action:
            'PARTICIPANT_REMOVED',
          conversationId,
          userId:
            actorId,
          metadata: {
            participantId,
          },
        }
      );
    }

    return conversation;
  }

  /*
  |--------------------------------------------------------------------------
  | Update Last Activity
  |--------------------------------------------------------------------------
  */

  async touch(
    conversationId,
    messageId
  ) {
    return Conversation.findByIdAndUpdate(
      conversationId,
      {
        lastMessage:
          messageId,
        lastActivityAt:
          new Date(),
      },
      {
        new: true,
      }
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Counts
  |--------------------------------------------------------------------------
  */

  async countUserConversations(
    userId
  ) {
    return Conversation.countDocuments(
      {
        participants:
          userId,
      }
    );
  }

  async countMessages(
    conversationId
  ) {
    return Message.countDocuments(
      {
        conversationId,
      }
    );
  }
}

module.exports =
  new ConversationService();