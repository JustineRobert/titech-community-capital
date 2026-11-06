// services/socket.js
// Socket.IO initialization and helper utilities (backend version)

import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import logger from '../utils/logger.js';

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

      const secrets = [
        process.env.JWT_ACCESS_SECRET,
        process.env.ACCESS_TOKEN_SECRET,
        process.env.JWT_SECRET,
        config.auth.jwtSecret,
      ].filter((secret, index, values) =>
        typeof secret === 'string' &&
        secret.length > 0 &&
        values.indexOf(secret) === index
      );

      let decoded;
      let verificationError;
      for (const secret of secrets) {
        try {
          decoded = jwt.verify(token, secret);
          break;
        } catch (error) {
          verificationError = error;
        }
      }

      if (!decoded) {
        throw verificationError || new Error('JWT verification failed');
      }
      socket.user = decoded.user || decoded;
      socket.userId =
        decoded.userId ||
        decoded.id ||
        decoded.user?.userId ||
        decoded.user?.id ||
        decoded.user?._id;
      socket.tenantId =
        decoded.tenantId ||
        decoded.user?.tenantId ||
        decoded.user?.tenant?.id ||
        decoded.user?.tenant?._id;

      if (!socket.userId) {
        return next(new Error('Authentication error: user identity missing'));
      }
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

export { createSocketServer };