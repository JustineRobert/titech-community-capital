'use strict';

/**
 * ============================================================================
 * SOCKET ROOM MANAGER
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Manages real-time Socket.IO room membership for conversations.
 *
 * RESPONSIBILITIES
 * ----------------------------------------------------------------------------
 * ✅ Join/Leave conversation rooms
 * ✅ Track online participants (in-memory)
 * ✅ Provide presence lookup per conversation
 * ✅ Maintain lightweight session state
 *
 * ARCHITECTURE NOTE
 * ----------------------------------------------------------------------------
 * Current implementation is in-memory ONLY.
 *
 * For production multi-instance scaling:
 *   → Replace with Redis adapter (socket.io-redis)
 *   → Or event bus (Kafka / NATS)
 *
 * ============================================================================
 */

'use strict';

/*
|--------------------------------------------------------------------------
| In-Memory Presence Store
|--------------------------------------------------------------------------
*/

const roomMap = new Map(); // conversationId -> Set(userId)

/*
|--------------------------------------------------------------------------
| Join Room
|--------------------------------------------------------------------------
*/

function joinRoom(socket, conversationId) {
  if (!socket?.user?.id) return;

  const roomId = String(conversationId);

  socket.join(roomId);

  let participants = roomMap.get(roomId);

  if (!participants) {
    participants = new Set();
  }

  participants.add(socket.user.id);

  roomMap.set(roomId, participants);
}

/*
|--------------------------------------------------------------------------
| Leave Room
|--------------------------------------------------------------------------
*/

function leaveRoom(socket, conversationId) {
  if (!socket?.user?.id) return;

  const roomId = String(conversationId);

  socket.leave(roomId);

  const participants =
    roomMap.get(roomId);

  if (!participants) return;

  participants.delete(socket.user.id);

  if (participants.size === 0) {
    roomMap.delete(roomId);
  } else {
    roomMap.set(roomId, participants);
  }
}

/*
|--------------------------------------------------------------------------
| Get Active Participants
|--------------------------------------------------------------------------
*/

function getParticipants(conversationId) {
  const roomId = String(conversationId);

  return Array.from(
    roomMap.get(roomId) || []
  );
}

/*
|--------------------------------------------------------------------------
| Check Online Status
|--------------------------------------------------------------------------
*/

function isUserInRoom(conversationId, userId) {
  const roomId = String(conversationId);

  const participants =
    roomMap.get(roomId);

  if (!participants) return false;

  return participants.has(
    String(userId)
  );
}

/*
|--------------------------------------------------------------------------
| Get Room Stats (Admin/Debug)
|--------------------------------------------------------------------------
*/

function getRoomStats() {
  const stats = {};

  for (const [roomId, users] of roomMap) {
    stats[roomId] = {
      activeUsers: users.size,
      users: Array.from(users),
    };
  }

  return stats;
}

/*
|--------------------------------------------------------------------------
| Cleanup Socket Disconnect Hook
|--------------------------------------------------------------------------
*/

function handleDisconnect(socket) {
  if (!socket?.user?.id) return;

  for (const [roomId, users] of roomMap) {
    if (users.has(socket.user.id)) {
      users.delete(socket.user.id);

      if (users.size === 0) {
        roomMap.delete(roomId);
      } else {
        roomMap.set(roomId, users);
      }
    }
  }
}

/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

module.exports = {
  joinRoom,
  leaveRoom,
  getParticipants,
  isUserInRoom,
  getRoomStats,
  handleDisconnect,
};