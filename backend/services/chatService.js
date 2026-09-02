/**
 * Chat Service
 * Handles conversations, messages, read receipts, and moderation
 * Supports 1-to-1 direct messages and group conversations
 */

const Conversation = require('../models/Conversation');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const logger = require('../utils/logger');

class ChatService {
  constructor(config = {}) {
    this.messageMaxLength = config.messageMaxLength || 5000;
    this.attachmentMaxSize = config.attachmentMaxSize || 10 * 1024 * 1024; // 10MB
    this.rateLimitMessagesPerMinute = config.rateLimitMessagesPerMinute || 10;
    this.moderationEnabled = config.moderationEnabled !== false;
  }

  /**
   * Create a conversation (1-to-1 or group)
   * @param {Array} participants - User IDs
   * @param {string} type - 'dm' (direct message) or 'group'
   * @param {Object} metadata - Additional conversation data
   * @returns {Object} - Conversation document
   */
  async createConversation(participants, type = 'dm', metadata = {}) {
    try {
      if (!participants || participants.length < 2) {
        throw new Error('Conversation requires at least 2 participants');
      }

      // Remove duplicates and sort for idempotency
      const uniqueParticipants = [...new Set(participants.map((p) => p.toString()))].sort();

      if (type === 'dm' && uniqueParticipants.length !== 2) {
        throw new Error('Direct message must have exactly 2 participants');
      }

      // Check for existing DM conversation (idempotency)
      if (type === 'dm') {
        const existing = await Conversation.findOne({
          type: 'dm',
          participants: { $all: uniqueParticipants },
        });
        if (existing) {
          logger.info('[ChatService] Returning existing DM conversation', {
            conversationId: existing._id,
            participants: uniqueParticipants,
          });
          return existing;
        }
      }

      const conversation = await Conversation.create({
        participants: uniqueParticipants,
        type,
        metadata: {
          ...metadata,
          createdAt: new Date(),
        },
        lastMessageAt: null,
      });

      logger.info('[ChatService] Conversation created', {
        conversationId: conversation._id,
        type,
        participantCount: uniqueParticipants.length,
      });

      return conversation;
    } catch (error) {
      logger.error('[ChatService] Error creating conversation', {
        error: error.message,
        type,
      });
      throw error;
    }
  }

  /**
   * Get conversations for a user
   * @param {string} userId - User ID
   * @param {Object} options - { limit, skip, includeArchived }
   * @returns {Object} - { conversations, total, limit, skip }
   */
  async getUserConversations(userId, options = {}) {
    try {
      const { limit = 20, skip = 0, includeArchived = false } = options;

      const query = { participants: userId };
      if (!includeArchived) {
        query.archived = { $ne: true };
      }

      const [conversations, total] = await Promise.all([
        Conversation.find(query)
          .populate('participants', 'name email avatar')
          .sort({ lastMessageAt: -1 })
          .limit(limit)
          .skip(skip),
        Conversation.countDocuments(query),
      ]);

      return {
        conversations,
        total,
        limit,
        skip,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error('[ChatService] Error getting user conversations', {
        error: error.message,
        userId,
      });
      throw error;
    }
  }

  /**
   * Add message to conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} senderId - Sender user ID
   * @param {Object} params - { content, attachments, replyTo, metadata }
   * @returns {Object} - Message document
   */
  async addMessage(conversationId, senderId, params = {}) {
    try {
      const { content, attachments = [], replyTo = null, metadata = {} } = params;

      // Validate inputs
      if (!content || content.trim().length === 0) {
        throw new Error('Message content cannot be empty');
      }

      if (content.length > this.messageMaxLength) {
        throw new Error(`Message exceeds ${this.messageMaxLength} character limit`);
      }

      // Verify sender is participant in conversation
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      const isParticipant = conversation.participants.some(
        (p) => p.toString() === senderId.toString()
      );
      if (!isParticipant) {
        throw new Error('You are not a participant in this conversation');
      }

      // Validate reply-to if provided
      if (replyTo) {
        const replyMessage = await ChatMessage.findById(replyTo);
        if (!replyMessage || replyMessage.conversation.toString() !== conversationId) {
          throw new Error('Invalid reply-to message');
        }
      }

      // Apply moderation if enabled
      let moderated = false;
      const moderationFlags = [];
      if (this.moderationEnabled) {
        const modResult = this.checkContentModeration(content);
        moderated = modResult.flagged;
        moderationFlags.push(...modResult.flags);
      }

      // Create message
      const message = await ChatMessage.create({
        conversation: conversationId,
        sender: senderId,
        content: content.trim(),
        attachments,
        replyTo: replyTo || null,
        moderated,
        moderationFlags,
        metadata: {
          ...metadata,
          sentAt: new Date(),
        },
      });

      // Populate sender info for response
      await message.populate('sender', 'name email avatar');

      // Update conversation's lastMessageAt
      await Conversation.updateOne({ _id: conversationId }, { lastMessageAt: new Date() });

      logger.info('[ChatService] Message added', {
        messageId: message._id,
        conversationId,
        senderId,
        moderated,
      });

      return message;
    } catch (error) {
      logger.error('[ChatService] Error adding message', {
        error: error.message,
        conversationId,
        senderId,
      });
      throw error;
    }
  }

  /**
   * Get messages for a conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID (for read receipt update)
   * @param {Object} options - { limit, skip, before }
   * @returns {Object} - { messages, total, hasMore }
   */
  async getMessages(conversationId, userId, options = {}) {
    try {
      const { limit = 50, skip = 0, before = null } = options;

      const query = { conversation: conversationId };
      if (before) {
        query.createdAt = { $lt: before };
      }

      const [messages, total] = await Promise.all([
        ChatMessage.find(query)
          .populate('sender', 'name email avatar')
          .populate('replyTo')
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(skip),
        ChatMessage.countDocuments(query),
      ]);

      // Mark messages as read by this user
      await ChatMessage.updateMany(
        {
          conversation: conversationId,
          'readBy.user': { $ne: userId },
        },
        {
          $push: {
            readBy: { user: userId, readAt: new Date() },
          },
        }
      );

      return {
        messages: messages.reverse(), // Reverse to get chronological order
        total,
        limit,
        skip,
        hasMore: skip + limit < total,
      };
    } catch (error) {
      logger.error('[ChatService] Error getting messages', {
        error: error.message,
        conversationId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Mark message as read by user
   * @param {string} messageId - Message ID
   * @param {string} userId - User ID
   * @returns {Object} - Updated message
   */
  async markAsRead(messageId, userId) {
    try {
      const message = await ChatMessage.findByIdAndUpdate(
        messageId,
        {
          $addToSet: {
            readBy: { user: userId, readAt: new Date() },
          },
        },
        { new: true }
      );

      logger.info('[ChatService] Message marked as read', {
        messageId,
        userId,
      });

      return message;
    } catch (error) {
      logger.error('[ChatService] Error marking message as read', {
        error: error.message,
        messageId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Edit a message
   * @param {string} messageId - Message ID
   * @param {string} userId - Sender user ID (for authorization)
   * @param {string} newContent - Updated content
   * @returns {Object} - Updated message
   */
  async editMessage(messageId, userId, newContent) {
    try {
      const message = await ChatMessage.findById(messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      if (message.sender.toString() !== userId.toString()) {
        throw new Error('You can only edit your own messages');
      }

      if (newContent.length > this.messageMaxLength) {
        throw new Error(`Message exceeds ${this.messageMaxLength} character limit`);
      }

      // Check if message is too old to edit (e.g., 15 minutes)
      const editWindow = 15 * 60 * 1000; // 15 minutes
      if (Date.now() - message.createdAt > editWindow) {
        throw new Error('Message can only be edited within 15 minutes of sending');
      }

      message.content = newContent.trim();
      message.editedAt = new Date();

      // Re-check moderation on edited content
      if (this.moderationEnabled) {
        const modResult = this.checkContentModeration(newContent);
        message.moderated = modResult.flagged;
        message.moderationFlags = modResult.flags;
      }

      await message.save();

      logger.info('[ChatService] Message edited', {
        messageId,
        userId,
      });

      return message;
    } catch (error) {
      logger.error('[ChatService] Error editing message', {
        error: error.message,
        messageId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Delete a message
   * @param {string} messageId - Message ID
   * @param {string} userId - User ID (sender or admin)
   * @param {string} userRole - User role (for admin delete)
   * @returns {boolean} - Success
   */
  async deleteMessage(messageId, userId, userRole = 'user') {
    try {
      const message = await ChatMessage.findById(messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      const isSender = message.sender.toString() === userId.toString();
      const isAdmin = userRole === 'admin';

      if (!isSender && !isAdmin) {
        throw new Error('You can only delete your own messages');
      }

      // Soft delete: mark deleted instead of removing
      message.deletedAt = new Date();
      message.deletedBy = userId;
      message.content = '[deleted]';
      await message.save();

      logger.info('[ChatService] Message deleted', {
        messageId,
        userId,
        isSender,
        isAdmin,
      });

      return true;
    } catch (error) {
      logger.error('[ChatService] Error deleting message', {
        error: error.message,
        messageId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Archive conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @returns {Object} - Updated conversation
   */
  async archiveConversation(conversationId, userId) {
    try {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      const isParticipant = conversation.participants.some(
        (p) => p.toString() === userId.toString()
      );
      if (!isParticipant) {
        throw new Error('You are not a participant in this conversation');
      }

      conversation.archived = true;
      conversation.archivedAt = new Date();
      await conversation.save();

      logger.info('[ChatService] Conversation archived', {
        conversationId,
        userId,
      });

      return conversation;
    } catch (error) {
      logger.error('[ChatService] Error archiving conversation', {
        error: error.message,
        conversationId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Check content for moderation flags
   * Simple keyword-based moderation (can be replaced with ML service)
   * @param {string} content - Message content
   * @returns {Object} - { flagged, flags }
   */
  checkContentModeration(content) {
    // This is a simple implementation. In production, use:
    // - ML-based content moderation (OpenAI Moderation, AWS Rekognition)
    // - Profanity filters
    // - Spam detection
    // - Link validation

    const flags = [];

    // Check for suspicious content (example patterns)
    if (/http[s]?:\/\//.test(content)) {
      flags.push('contains_url');
    }

    // Add more checks as needed

    return {
      flagged: flags.length > 0,
      flags,
    };
  }

  /**
   * Get unread message count for user
   * @param {string} userId - User ID
   * @returns {Object} - { total, byConversation: { conversationId: count } }
   */
  async getUnreadCount(userId) {
    try {
      const conversations = await Conversation.find({ participants: userId });

      const byConversation = {};
      let total = 0;

      for (const conversation of conversations) {
        const unreadCount = await ChatMessage.countDocuments({
          conversation: conversation._id,
          'readBy.user': { $ne: userId },
          sender: { $ne: userId },
        });

        if (unreadCount > 0) {
          byConversation[conversation._id] = unreadCount;
          total += unreadCount;
        }
      }

      return {
        total,
        byConversation,
      };
    } catch (error) {
      logger.error('[ChatService] Error getting unread count', {
        error: error.message,
        userId,
      });
      throw error;
    }
  }

  /**
   * Search messages in a conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} query - Search query
   * @returns {Array} - Matching messages
   */
  async searchMessages(conversationId, query) {
    try {
      const messages = await ChatMessage.find({
        conversation: conversationId,
        content: { $regex: query, $options: 'i' },
      })
        .populate('sender', 'name email')
        .sort({ createdAt: -1 })
        .limit(50);

      return messages;
    } catch (error) {
      logger.error('[ChatService] Error searching messages', {
        error: error.message,
        conversationId,
        query,
      });
      throw error;
    }
  }
}

module.exports = ChatService;
