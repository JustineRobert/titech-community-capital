'use strict';

/**
 * ============================================================================
 * TITechChat SOCKET LAYER (ACFOS ENTERPRISE EDITION)
 * ============================================================================
 * TITech Community Capital LTD
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Real-time communication layer for chat events.
 *
 * DESIGN PRINCIPLES
 * ----------------------------------------------------------------------------
 * ✅ REST is source of truth (sockets are event mirrors only)
 * ✅ No business logic in socket handlers
 * ✅ All validation happens in HTTP layer + services
 * ✅ Lightweight real-time event propagation only
 *
 * SUPPORTED EVENTS
 * ----------------------------------------------------------------------------
 * - typing:start
 * - typing:stop
 * - room:join
 * - room:leave
 *
 * SCALABILITY NOTE
 * ----------------------------------------------------------------------------
 * This layer is Redis-ready for horizontal scaling (Socket.IO adapter).
 *
 * ============================================================================
 */

const socketAuth = require('./socketAuth');
const {
  joinRoom,
  leaveRoom,
  handleDisconnect,
} = require('./roomManager');

const {
  TYPING_START,
  TYPING_STOP,
} = require('../utils/chat/messageEvents');

/*
|--------------------------------------------------------------------------
| Chat Socket Initializer
|--------------------------------------------------------------------------
*/

module.exports = function initChatSocket(io) {
  /*
  |--------------------------------------------------------------------------
  | Authentication Middleware
  |--------------------------------------------------------------------------
  */

  io.use(socketAuth);

  /*
  |--------------------------------------------------------------------------
  | Connection Handler
  |--------------------------------------------------------------------------
  */

  io.on('connection', (socket) => {
    const userId = socket.user?.id;

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Join Room
    |--------------------------------------------------------------------------
    */

    socket.on('room:join', (conversationId) => {
      if (!conversationId) return;

      joinRoom(socket, conversationId);

      socket.emit('room:joined', {
        conversationId,
        userId,
      });
    });

    /*
    |--------------------------------------------------------------------------
    | Leave Room
    |--------------------------------------------------------------------------
    */

    socket.on('room:leave', (conversationId) => {
      if (!conversationId) return;

      leaveRoom(socket, conversationId);

      socket.emit('room:left', {
        conversationId,
        userId,
      });
    });

    /*
    |--------------------------------------------------------------------------
    | Typing Start
    |--------------------------------------------------------------------------
    */

    socket.on('typing:start', (payload) => {
      if (!payload?.conversationId) return;

      socket
        .to(payload.conversationId)
        .emit(TYPING_START, {
          conversationId: payload.conversationId,
          userId,
        });
    });

    /*
    |--------------------------------------------------------------------------
    | Typing Stop
    |--------------------------------------------------------------------------
    */

    socket.on('typing:stop', (payload) => {
      if (!payload?.conversationId) return;

      socket
        .to(payload.conversationId)
        .emit(TYPING_STOP, {
          conversationId: payload.conversationId,
          userId,
        });
    });

    /*
    |--------------------------------------------------------------------------
    | Disconnect Cleanup
    |--------------------------------------------------------------------------
    */

    socket.on('disconnect', () => {
      handleDisconnect(socket);
    });
  });
};