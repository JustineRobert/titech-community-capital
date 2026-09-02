// services/socket.js
// Socket.IO initialization and helper utilities (backend version)

'use strict';

const { Server: SocketIOServer } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

function createSocketServer(httpServer, options = {}) {
  const allowedOrigins = (config.corsOrigins || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingInterval: options.pingInterval || 25000,
    pingTimeout: options.pingTimeout || 20000,
    maxHttpBufferSize: options.maxHttpBufferSize || 1e6,
  });

  // Authentication middleware
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization
          ? socket.handshake.headers.authorization.split(' ')[1]
          : null);

      if (!token) {
        return next(new Error('Authentication error: token missing'));
      }

      const decoded = jwt.verify(token, config.auth.jwtSecret);
      socket.user = decoded.user || decoded;
      socket.userId = decoded.userId || decoded.id;
      return next();
    } catch (err) {
      logger.error('Socket authentication failed', { error: err.message });
      return next(new Error('Authentication error'));
    }
  });

  // Connection handlers
  io.on('connection', (socket) => {
    logger.info('WebSocket connected', { socketId: socket.id, userId: socket.userId });
    socket.join(`user:${socket.userId}`);

    socket.on('presence:status', (status) => {
      const validStatuses = ['online', 'away', 'offline', 'busy'];
      if (validStatuses.includes(status)) {
        io.to(`user:${socket.userId}`).emit('presence:updated', {
          userId: socket.userId,
          status,
          timestamp: new Date(),
        });
      }
    });

    socket.on('disconnect', () => {
      logger.info('WebSocket disconnected', { socketId: socket.id, userId: socket.userId });
      io.emit('presence:updated', {
        userId: socket.userId,
        status: 'offline',
        timestamp: new Date(),
      });
    });

    socket.on('error', (err) => {
      logger.error('Socket error', { socketId: socket.id, error: err?.message });
    });
  });

  return io;
}

module.exports = { createSocketServer };