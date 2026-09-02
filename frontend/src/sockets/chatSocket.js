'use strict';

/**
 * ============================================================================
 * FRONTEND CHAT SOCKET (ACFOS ENTERPRISE EDITION)
 * ============================================================================
 * TITech Community Capital LTD
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Real-time communication client for TITechChat using Socket.IO.
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ JWT-authenticated socket connection
 * ✅ Room join/leave management
 * ✅ Event subscription helpers
 * ✅ Reconnection-safe initialization
 * ✅ Singleton socket instance
 *
 * ARCHITECTURE RULE
 * ----------------------------------------------------------------------------
 * Socket layer = real-time transport only
 * No business logic here.
 *
 * ============================================================================
 */

import { io } from 'socket.io-client';
import { getJwt } from '../auth';

/*
|--------------------------------------------------------------------------
| Socket Singleton
|--------------------------------------------------------------------------
*/

let socket = null;

/*
|--------------------------------------------------------------------------
| Initialize Socket Connection
|--------------------------------------------------------------------------
*/

export function initSocket() {
  if (socket && socket.connected) {
    return socket;
  }

  socket = io('/', {
    auth: {
      token: getJwt(),
    },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  /*
  |--------------------------------------------------------------------------
  | Connection Events
  |--------------------------------------------------------------------------
  */

  socket.on('connect', () => {
    console.log('[ChatSocket] Connected:', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.warn('[ChatSocket] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.error('[ChatSocket] Connection error:', err.message);
  });

  return socket;
}

/*
|--------------------------------------------------------------------------
| Ensure Socket Exists
|--------------------------------------------------------------------------
*/

function ensureSocket() {
  if (!socket) {
    return initSocket();
  }
  return socket;
}

/*
|--------------------------------------------------------------------------
| Room Management
|--------------------------------------------------------------------------
*/

export function joinRoom(conversationId) {
  const s = ensureSocket();

  if (!conversationId) return;

  s.emit('room:join', {
    conversationId,
  });
}

export function leaveRoom(conversationId) {
  const s = ensureSocket();

  if (!conversationId) return;

  s.emit('room:leave', {
    conversationId,
  });
}

/*
|--------------------------------------------------------------------------
| Event Subscription Helpers
|--------------------------------------------------------------------------
*/

export function on(event, cb) {
  const s = ensureSocket();
  s.on(event, cb);
}

export function off(event, cb) {
  const s = ensureSocket();
  s.off(event, cb);
}

/*
|--------------------------------------------------------------------------
| Emit Helpers (Future-proof for messaging layer)
|--------------------------------------------------------------------------
*/

export function emitTypingStart(conversationId) {
  const s = ensureSocket();
  s.emit('typing:start', { conversationId });
}

export function emitTypingStop(conversationId) {
  const s = ensureSocket();
  s.emit('typing:stop', { conversationId });
}

/*
|--------------------------------------------------------------------------
| Get Raw Socket (advanced usage only)
|--------------------------------------------------------------------------
*/

export function getSocket() {
  return ensureSocket();
}

/*
|--------------------------------------------------------------------------
| Disconnect
|--------------------------------------------------------------------------
*/

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
