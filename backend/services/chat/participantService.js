'use strict';

/**
 * ============================================================================
 * PARTICIPANT SERVICE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Handles participant lifecycle management for conversations.
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Add Participants
 * ✅ Remove Participants
 * ✅ Promote Administrators
 * ✅ Demote Administrators
 * ✅ Bulk Participant Addition
 * ✅ Bulk Participant Removal
 * ✅ Membership Validation
 * ✅ Conversation Capacity Checks
 * ✅ Audit Logging
 * ✅ Compliance Ready
 * ✅ Notification Ready
 * ✅ Socket.IO Ready
 *
 * ============================================================================
 */

const mongoose =
  require('mongoose');

const Conversation =
  require('../../models/Conversation');

const MessageAudit =
  require('../../models/MessageAudit');

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const MAX_PARTICIPANTS =
  Number(
    process.env.CHAT_MAX_PARTICIPANTS
  ) || 1000;

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function toStringId(id) {
  return String(id);
}

function hasParticipant(
  conversation,
  userId
) {
  return (
    conversation.participants || []
  ).some(
    participant =>
      participant.toString() ===
      userId.toString()
  );
}

function hasAdmin(
  conversation,
  userId
) {
  return (
    conversation.admins || []
  ).some(
    admin =>
      admin.toString() ===
      userId.toString()
  );
}

/*
|--------------------------------------------------------------------------
| Service
|--------------------------------------------------------------------------
*/

class ParticipantService {
  /*
  |--------------------------------------------------------------------------
  | Add Participant
  |--------------------------------------------------------------------------
  */

  async addParticipant(
    conversationId,
    userId,
    actorId
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

      if (
        conversation.status ===
        'ARCHIVED'
      ) {
        throw new Error(
          'Cannot modify archived conversation.'
        );
      }

      if (
        hasParticipant(
          conversation,
          userId
        )
      ) {
        await session.commitTransaction();

        return conversation;
      }

      if (
        conversation
          .participants
          .length >=
        MAX_PARTICIPANTS
      ) {
        throw new Error(
          `Maximum participant limit (${MAX_PARTICIPANTS}) reached.`
        );
      }

      conversation.participants.push(
        userId
      );

      if (
        conversation.unreadCounts
      ) {
        conversation.unreadCounts.set(
          toStringId(
            userId
          ),
          0
        );
      }

      await conversation.save(
        {
          session,
        }
      );

      await MessageAudit.create(
        [
          {
            action:
              'PARTICIPANT_ADDED',
            conversationId,
            userId:
              actorId,
            metadata: {
              participantId:
                userId,
            },
          },
        ],
        {
          session,
        }
      );

      await session.commitTransaction();

      return conversation;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Remove Participant
  |--------------------------------------------------------------------------
  */

  async removeParticipant(
    conversationId,
    userId,
    actorId
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

      conversation.participants =
        conversation.participants.filter(
          participant =>
            participant.toString() !==
            userId.toString()
        );

      conversation.admins =
        (
          conversation.admins ||
          []
        ).filter(
          admin =>
            admin.toString() !==
            userId.toString()
        );

      if (
        conversation.unreadCounts
      ) {
        conversation.unreadCounts.delete(
          toStringId(
            userId
          )
        );
      }

      await conversation.save(
        {
          session,
        }
      );

      await MessageAudit.create(
        [
          {
            action:
              'PARTICIPANT_REMOVED',
            conversationId,
            userId:
              actorId,
            metadata: {
              participantId:
                userId,
            },
          },
        ],
        {
          session,
        }
      );

      await session.commitTransaction();

      return conversation;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Add Multiple Participants
  |--------------------------------------------------------------------------
  */

  async addParticipants(
    conversationId,
    participantIds,
    actorId
  ) {
    const added =
      [];

    for (const userId of participantIds) {
      const conversation =
        await this.addParticipant(
          conversationId,
          userId,
          actorId
        );

      added.push(
        conversation
      );
    }

    return added;
  }

  /*
  |--------------------------------------------------------------------------
  | Remove Multiple Participants
  |--------------------------------------------------------------------------
  */

  async removeParticipants(
    conversationId,
    participantIds,
    actorId
  ) {
    const removed =
      [];

    for (const userId of participantIds) {
      const conversation =
        await this.removeParticipant(
          conversationId,
          userId,
          actorId
        );

      removed.push(
        conversation
      );
    }

    return removed;
  }

  /*
  |--------------------------------------------------------------------------
  | Promote To Admin
  |--------------------------------------------------------------------------
  */

  async promoteToAdmin(
    conversationId,
    userId,
    actorId
  ) {
    const conversation =
      await Conversation.findById(
        conversationId
      );

    if (
      !conversation
    ) {
      throw new Error(
        'Conversation not found.'
      );
    }

    if (
      !hasParticipant(
        conversation,
        userId
      )
    ) {
      throw new Error(
        'User is not a participant.'
      );
    }

    if (
      !hasAdmin(
        conversation,
        userId
      )
    ) {
      conversation.admins.push(
        userId
      );

      await conversation.save();

      await MessageAudit.create(
        {
          action:
            'PARTICIPANT_PROMOTED',
          conversationId,
          userId:
            actorId,
          metadata: {
            participantId:
              userId,
          },
        }
      );
    }

    return conversation;
  }

  /*
  |--------------------------------------------------------------------------
  | Demote Admin
  |--------------------------------------------------------------------------
  */

  async demoteAdmin(
    conversationId,
    userId,
    actorId
  ) {
    const conversation =
      await Conversation.findById(
        conversationId
      );

    if (
      !conversation
    ) {
      throw new Error(
        'Conversation not found.'
      );
    }

    conversation.admins =
      (
        conversation.admins ||
        []
      ).filter(
        admin =>
          admin.toString() !==
          userId.toString()
      );

    await conversation.save();

    await MessageAudit.create(
      {
        action:
          'PARTICIPANT_DEMOTED',
        conversationId,
        userId:
          actorId,
        metadata: {
          participantId:
            userId,
        },
      }
    );

    return conversation;
  }

  /*
  |--------------------------------------------------------------------------
  | Membership Checks
  |--------------------------------------------------------------------------
  */

  async isParticipant(
    conversationId,
    userId
  ) {
    const conversation =
      await Conversation.findById(
        conversationId
      ).select(
        'participants'
      );

    if (
      !conversation
    ) {
      return false;
    }

    return hasParticipant(
      conversation,
      userId
    );
  }

  async isAdmin(
    conversationId,
    userId
  ) {
    const conversation =
      await Conversation.findById(
        conversationId
      ).select(
        'admins'
      );

    if (
      !conversation
    ) {
      return false;
    }

    return hasAdmin(
      conversation,
      userId
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Get Participants
  |--------------------------------------------------------------------------
  */

  async getParticipants(
    conversationId
  ) {
    const conversation =
      await Conversation.findById(
        conversationId
      ).populate(
        'participants',
        'firstName lastName email avatar'
      );

    if (
      !conversation
    ) {
      throw new Error(
        'Conversation not found.'
      );
    }

    return conversation.participants;
  }
}

module.exports =
  new ParticipantService();