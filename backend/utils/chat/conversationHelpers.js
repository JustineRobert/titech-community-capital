'use strict';

/**
 * ============================================================================
 * CONVERSATION HELPERS
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Central helper utilities for conversation access, participant management,
 * authorization checks, unread counters, business entity linkage validation,
 * and conversation metadata operations.
 *
 * Supports:
 *
 * ✅ Participant Validation
 * ✅ Admin Validation
 * ✅ Membership Validation
 * ✅ Conversation Lookup
 * ✅ Business Thread Validation
 * ✅ Unread Counter Management
 * ✅ Participant Management
 * ✅ Announcement Channel Validation
 * ✅ Conversation Status Validation
 * ✅ Thread Ownership Validation
 * ✅ Socket Room Utilities
 * ✅ Compliance Helpers
 *
 * ============================================================================
 */

const mongoose = require('mongoose');
const Conversation = require('../../models/Conversation');

/*
|--------------------------------------------------------------------------
| Internal Helpers
|--------------------------------------------------------------------------
*/

function normalizeId(id) {
  if (!id) return null;

  if (typeof id === 'string') {
    return id;
  }

  if (id instanceof mongoose.Types.ObjectId) {
    return id.toString();
  }

  return String(id);
}

/*
|--------------------------------------------------------------------------
| Conversation Loaders
|--------------------------------------------------------------------------
*/

async function getConversation(conversationId) {
  if (!conversationId) {
    return null;
  }

  return Conversation.findById(conversationId)
    .populate('participants', '_id firstName lastName email')
    .populate('admins', '_id firstName lastName email');
}

async function getConversationLean(conversationId) {
  if (!conversationId) {
    return null;
  }

  return Conversation.findById(conversationId)
    .lean();
}

/*
|--------------------------------------------------------------------------
| Membership Helpers
|--------------------------------------------------------------------------
*/

async function isParticipant(
  conversationId,
  userId
) {
  const conversation =
    await Conversation.findById(conversationId)
      .select(
        'participants admins isDeleted status'
      )
      .lean();

  if (!conversation) {
    return false;
  }

  if (conversation.isDeleted) {
    return false;
  }

  const user =
    normalizeId(userId);

  const participant =
    conversation.participants.some(
      p => normalizeId(p) === user
    );

  const admin =
    conversation.admins.some(
      a => normalizeId(a) === user
    );

  return participant || admin;
}

async function isAdmin(
  conversationId,
  userId
) {
  const conversation =
    await Conversation.findById(conversationId)
      .select('admins')
      .lean();

  if (!conversation) {
    return false;
  }

  const user =
    normalizeId(userId);

  return conversation.admins.some(
    admin =>
      normalizeId(admin) === user
  );
}

async function isCreator(
  conversationId,
  userId
) {
  const conversation =
    await Conversation.findById(conversationId)
      .select('createdBy')
      .lean();

  if (!conversation) {
    return false;
  }

  return (
    normalizeId(
      conversation.createdBy
    ) === normalizeId(userId)
  );
}

/*
|--------------------------------------------------------------------------
| Participant Utilities
|--------------------------------------------------------------------------
*/

async function getParticipants(
  conversationId
) {
  const conversation =
    await Conversation.findById(conversationId)
      .select('participants')
      .lean();

  return (
    conversation?.participants || []
  );
}

async function getAdmins(
  conversationId
) {
  const conversation =
    await Conversation.findById(conversationId)
      .select('admins')
      .lean();

  return (
    conversation?.admins || []
  );
}

async function addParticipant(
  conversationId,
  userId
) {
  return Conversation.findByIdAndUpdate(
    conversationId,
    {
      $addToSet: {
        participants: userId,
      },
    },
    {
      new: true,
    }
  );
}

async function removeParticipant(
  conversationId,
  userId
) {
  return Conversation.findByIdAndUpdate(
    conversationId,
    {
      $pull: {
        participants: userId,
      },
    },
    {
      new: true,
    }
  );
}

/*
|--------------------------------------------------------------------------
| Business Thread Helpers
|--------------------------------------------------------------------------
*/

async function getByLinkedEntity(
  linkedEntityType,
  linkedEntityId
) {
  return Conversation.findOne({
    linkedEntityType,
    linkedEntityId,
    isDeleted: false,
  });
}

async function conversationExists(
  linkedEntityType,
  linkedEntityId
) {
  const conversation =
    await getByLinkedEntity(
      linkedEntityType,
      linkedEntityId
    );

  return !!conversation;
}

async function validateLinkedEntity(
  conversationId
) {
  const conversation =
    await Conversation.findById(conversationId)
      .select(
        'linkedEntityType linkedEntityId'
      )
      .lean();

  if (!conversation) {
    return {
      valid: false,
    };
  }

  if (
    !conversation.linkedEntityType ||
    !conversation.linkedEntityId
  ) {
    return {
      valid: true,
      linked: false,
    };
  }

  return {
    valid: true,
    linked: true,
    linkedEntityType:
      conversation.linkedEntityType,
    linkedEntityId:
      conversation.linkedEntityId,
  };
}

/*
|--------------------------------------------------------------------------
| Conversation State
|--------------------------------------------------------------------------
*/

function isArchived(
  conversation
) {
  return (
    conversation?.status ===
    'ARCHIVED'
  );
}

function isLocked(
  conversation
) {
  return (
    conversation?.status ===
    'LOCKED'
  );
}

function isAnnouncementChannel(
  conversation
) {
  return Boolean(
    conversation?.isAnnouncementChannel
  );
}

function isActive(
  conversation
) {
  return (
    !!conversation &&
    !conversation.isDeleted &&
    conversation.isActive !== false
  );
}

/*
|--------------------------------------------------------------------------
| Unread Counters
|--------------------------------------------------------------------------
*/

async function incrementUnread(
  conversationId,
  userId
) {
  const conversation =
    await Conversation.findById(
      conversationId
    );

  if (!conversation) {
    return null;
  }

  const key =
    normalizeId(userId);

  const current =
    conversation.unreadCounts.get(
      key
    ) || 0;

  conversation.unreadCounts.set(
    key,
    current + 1
  );

  await conversation.save();

  return conversation;
}

async function clearUnread(
  conversationId,
  userId
) {
  const conversation =
    await Conversation.findById(
      conversationId
    );

  if (!conversation) {
    return null;
  }

  conversation.unreadCounts.set(
    normalizeId(userId),
    0
  );

  await conversation.save();

  return conversation;
}

async function getUnreadCount(
  conversationId,
  userId
) {
  const conversation =
    await Conversation.findById(
      conversationId
    ).select('unreadCounts');

  if (!conversation) {
    return 0;
  }

  return (
    conversation.unreadCounts.get(
      normalizeId(userId)
    ) || 0
  );
}

/*
|--------------------------------------------------------------------------
| Conversation Metadata
|--------------------------------------------------------------------------
*/

async function touchConversation(
  conversationId,
  messageId = null
) {
  const update = {
    lastActivityAt:
      new Date(),
    lastMessageAt:
      new Date(),
  };

  if (messageId) {
    update.lastMessage =
      messageId;
  }

  return Conversation.findByIdAndUpdate(
    conversationId,
    update,
    {
      new: true,
    }
  );
}

async function archiveConversation(
  conversationId,
  userId
) {
  return Conversation.findByIdAndUpdate(
    conversationId,
    {
      status: 'ARCHIVED',
      archivedAt:
        new Date(),
      archivedBy: userId,
    },
    {
      new: true,
    }
  );
}

async function lockConversation(
  conversationId,
  userId
) {
  return Conversation.findByIdAndUpdate(
    conversationId,
    {
      status: 'LOCKED',
      lockedAt:
        new Date(),
      lockedBy: userId,
    },
    {
      new: true,
    }
  );
}

/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

module.exports = {
  normalizeId,

  getConversation,
  getConversationLean,

  isParticipant,
  isAdmin,
  isCreator,

  getParticipants,
  getAdmins,

  addParticipant,
  removeParticipant,

  getByLinkedEntity,
  conversationExists,
  validateLinkedEntity,

  isArchived,
  isLocked,
  isActive,
  isAnnouncementChannel,

  incrementUnread,
  clearUnread,
  getUnreadCount,

  touchConversation,
  archiveConversation,
  lockConversation,
};