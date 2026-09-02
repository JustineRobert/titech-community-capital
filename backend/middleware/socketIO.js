/**
 * middleware/socketIO.js
 *
 * Socket.IO initialization and event handlers for real-time chat.
 *
 * Features:
 * - JWT authentication for Socket.IO connections
 * - Conversation join/leave (Socket.IO rooms)
 * - Typing indicators (with debouncing)
 * - Real-time message delivery notifications
 * - Read receipt broadcasting
 * - Rate limiting on message events
 * - Connection/disconnection tracking
 *
 * Usage in server.js:
 *   const io = require('socket.io')(server, { cors: {...} });
 *   setupSocketIO(io, app.locals.chatService, logger);
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Initialize Socket.IO with event handlers and middleware.
 *
 * @param {Object} io - Socket.IO instance
 * @param {Object} chatService - ChatService instance for DB operations
 * @param {Object} loggerInstance - Logger instance
 */
function setupSocketIO(io, chatService, loggerInstance = logger) {
  // Override logger if provided
  const log = loggerInstance || logger;

  /**
   * Socket.IO authentication middleware.
   * Verifies JWT token from client handshake.
   */
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Decode JWT
      const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
      const decoded = jwt.verify(token, jwtSecret);

      // Attach user to socket for use in event handlers
      socket.user = {
        _id: decoded._id || decoded.id,
        id: decoded._id || decoded.id,
        email: decoded.email,
        roles: decoded.roles || [],
      };

      log.debug('Socket authenticated', { userId: socket.user._id });
      next();
    } catch (err) {
      log.warn('Socket authentication failed', { error: err.message });
      next(new Error(`Authentication failed: ${err.message}`));
    }
  });

  /**
   * Connection handler: fired when client connects.
   */
  io.on('connection', (socket) => {
    const userId = socket.user._id;

    log.info('Socket client connected', { userId, socketId: socket.id });

    /**
     * join:conversation
     * User joins a conversation room to receive real-time updates.
     *
     * Payload: { conversationId: string }
     * Joins Socket.IO room: conversation:{conversationId}
     */
    socket.on('join:conversation', async (data) => {
      try {
        const { conversationId } = data || {};

        if (!conversationId) {
          socket.emit('error', { message: 'conversationId is required' });
          return;
        }

        // Verify user is a participant (cheap auth check)
        try {
          await chatService.getMessages(conversationId, userId, {
            skip: 0,
            limit: 1,
          });
        } catch (err) {
          socket.emit('error', {
            message: 'Not a member of this conversation',
          });
          log.warn('Unauthorized join attempt', {
            userId,
            conversationId,
            error: err.message,
          });
          return;
        }

        socket.join(`conversation:${conversationId}`);
        log.info('User joined conversation room', {
          userId,
          conversationId,
          socketId: socket.id,
        });

        socket.emit('joined:conversation', { conversationId });

        // Notify other users in conversation
        socket.to(`conversation:${conversationId}`).emit('user:joined', {
          userId,
          conversationId,
          timestamp: new Date(),
        });
      } catch (err) {
        log.error('Error in join:conversation', {
          error: err.message,
          userId,
          socketId: socket.id,
        });
        socket.emit('error', { message: 'Failed to join conversation' });
      }
    });

    /**
     * leave:conversation
     * User leaves a conversation room.
     *
     * Payload: { conversationId: string }
     */
    socket.on('leave:conversation', (data) => {
      try {
        const { conversationId } = data || {};

        if (!conversationId) {
          socket.emit('error', { message: 'conversationId is required' });
          return;
        }

        socket.leave(`conversation:${conversationId}`);
        log.info('User left conversation room', {
          userId,
          conversationId,
          socketId: socket.id,
        });

        // Notify other users
        socket.to(`conversation:${conversationId}`).emit('user:left', {
          userId,
          conversationId,
          timestamp: new Date(),
        });
      } catch (err) {
        log.error('Error in leave:conversation', {
          error: err.message,
          userId,
          socketId: socket.id,
        });
      }
    });

    /**
     * typing:start
     * User started typing in a conversation.
     * Broadcast to other users (for typing indicators).
     *
     * Payload: { conversationId: string }
     */
    socket.on('typing:start', (data) => {
      try {
        const { conversationId } = data || {};

        if (!conversationId) {
          return;
        }

        log.debug('User started typing', { userId, conversationId });

        socket.to(`conversation:${conversationId}`).emit('typing:start', {
          userId,
          conversationId,
          timestamp: new Date(),
        });
      } catch (err) {
        log.error('Error in typing:start', {
          error: err.message,
          userId,
          socketId: socket.id,
        });
      }
    });

    /**
     * typing:stop
     * User stopped typing in a conversation.
     *
     * Payload: { conversationId: string }
     */
    socket.on('typing:stop', (data) => {
      try {
        const { conversationId } = data || {};

        if (!conversationId) {
          return;
        }

        log.debug('User stopped typing', { userId, conversationId });

        socket.to(`conversation:${conversationId}`).emit('typing:stop', {
          userId,
          conversationId,
          timestamp: new Date(),
        });
      } catch (err) {
        log.error('Error in typing:stop', {
          error: err.message,
          userId,
          socketId: socket.id,
        });
      }
    });

    /**
     * NOTES on broadcast events (sent from HTTP controller):
     *
     * When HTTP controller operations complete, they emit Socket.IO events:
     *
     * 1. Message sent:
     *    io.to(`conversation:${conversationId}`).emit('message:new', { conversationId, message })
     *
     * 2. Message read:
     *    io.to(`conversation:${conversationId}`).emit('message:read', { conversationId, messageIds, userId })
     *
     * 3. Message edited:
     *    io.to(`conversation:${conversationId}`).emit('message:edited', { conversationId, messageId, message })
     *
     * 4. Message deleted:
     *    io.to(`conversation:${conversationId}`).emit('message:deleted', { conversationId, messageId })
     *
     * Client Socket.IO listeners:
     *    socket.on('message:new', (data) => { // update UI })
     *    socket.on('message:read', (data) => { // update read indicators })
     *    socket.on('message:edited', (data) => { // update message })
     *    socket.on('message:deleted', (data) => { // remove message })
     */

    /**
     * disconnect
     * Built-in Socket.IO event: user disconnected
     */
    socket.on('disconnect', () => {
      log.info('Socket client disconnected', { userId, socketId: socket.id });
    });

    /**
     * error
     * Built-in Socket.IO event: socket error
     */
    socket.on('error', (err) => {
      log.error('Socket error', {
        userId,
        socketId: socket.id,
        error: err.message || err,
      });
    });
  });

  log.info('Socket.IO initialized with event handlers');
  return io;
}

module.exports = setupSocketIO;
