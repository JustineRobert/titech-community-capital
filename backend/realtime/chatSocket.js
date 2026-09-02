// backend/realtime/chatSocket.js (if Socket.IO already exists, extend existing socket service instead)
'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AuditLog = require('../services/auditLogService'); // assumed existing
const Notification = require('../services/notificationService'); // assumed existing

/**
 * Initialize Chat Socket Layer
 * @param {http.Server} server - Node HTTP server instance
 */
function initChatSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL,
      methods: ['GET', 'POST'],
    },
  });

  // Middleware: JWT authentication
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`[chatSocket] User connected: ${user.id}`);

    // Join conversation room
    socket.on('conversation:join', async (conversationId) => {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) return socket.emit('error', 'Conversation not found');
      if (!conversation.participants.some(p => p.equals(user.id))) {
        return socket.emit('error', 'Unauthorized');
      }
      socket.join(conversationId.toString());
      socket.emit('conversation:joined', { conversationId });
    });

    // Send new message
    socket.on('message:new', async (payload) => {
      try {
        const conversation = await Conversation.findById(payload.conversationId);
        if (!conversation) return socket.emit('error', 'Conversation not found');
        if (!conversation.participants.some(p => p.equals(user.id))) {
          return socket.emit('error', 'Unauthorized');
        }

        const message = await Message.create({
          conversationId: payload.conversationId,
          senderId: user.id,
          senderRole: user.role,
          body: payload.body,
          messageType: payload.messageType || 'text',
          attachments: payload.attachments || [],
        });

        conversation.lastMessage = message._id;
        conversation.lastActivityAt = new Date();
        await conversation.save();

        await AuditLog.log(user, 'message:send', { messageId: message.id });
        await Notification.send(conversation.participants, 'New message', { conversationId: conversation.id });

        io.to(payload.conversationId.toString()).emit('message:new', message);
      } catch (err) {
        socket.emit('error', err.message);
      }
    });

    // Typing indicators
    socket.on('typing:start', (conversationId) => {
      socket.to(conversationId.toString()).emit('typing:start', { userId: user.id });
    });
    socket.on('typing:stop', (conversationId) => {
      socket.to(conversationId.toString()).emit('typing:stop', { userId: user.id });
    });

    // Mark message as read
    socket.on('message:read', async ({ conversationId, messageId }) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) return;
        await message.markAsRead(user.id);
        io.to(conversationId.toString()).emit('message:read', { messageId, userId: user.id });
      } catch (err) {
        socket.emit('error', err.message);
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`[chatSocket] User disconnected: ${user.id}`);
    });
  });

  return io;
}

module.exports = initChatSocket;
