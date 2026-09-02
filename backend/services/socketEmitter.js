/**
 * Socket.IO Event Emitter Service
 * ============================================================================
 * Centralized utility for emitting real-time events to connected clients
 * across the application. Controllers and services can use this to push
 * notifications and updates without direct socket.io dependency.
 */

class SocketEmitter {
  constructor(io) {
    this.io = io;
  }

  /**
   * Emit notification to specific user
   * @param {string} userId - Target user ID
   * @param {string} type - Notification type (e.g., 'loan-approved', 'contribution-received')
   * @param {object} data - Notification data
   */
  notifyUser(userId, type, data) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return;
    }
    this.io.to(`user:${userId}`).emit('notification:received', {
      type,
      data,
      timestamp: new Date(),
    });
  }

  /**
   * Emit notification to group members
   * @param {string} groupId - Target group ID
   * @param {string} type - Notification type
   * @param {object} data - Notification data
   * @param {string} excludeUserId - Optional: user ID to exclude from notification
   */
  notifyGroup(groupId, type, data, excludeUserId = null) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return;
    }
    const payload = {
      type,
      data,
      timestamp: new Date(),
    };
    if (excludeUserId) {
      // Emit to group but exclude specific user
      this.io
        .to(`notifications:${groupId}`)
        .except(`user:${excludeUserId}`)
        .emit('notification:received', payload);
    } else {
      this.io.to(`notifications:${groupId}`).emit('notification:received', payload);
    }
  }

  /**
   * Broadcast loan update to group
   * @param {string} groupId - Group ID
   * @param {object} loanData - Loan information
   */
  broadcastLoanUpdate(groupId, loanData) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return;
    }
    this.io.to(`loans:${groupId}`).emit('loan:updated', {
      ...loanData,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcast contribution update to group
   * @param {string} groupId - Group ID
   * @param {object} contributionData - Contribution information
   */
  broadcastContributionUpdate(groupId, contributionData) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return;
    }
    this.io.to(`contributions:${groupId}`).emit('contribution:updated', {
      ...contributionData,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcast payment status update
   * @param {string} userId - User ID
   * @param {string} paymentId - Payment ID
   * @param {string} status - Payment status (pending, completed, failed)
   * @param {object} metadata - Additional payment data
   */
  broadcastPaymentStatus(userId, paymentId, status, metadata = {}) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return;
    }
    this.io.to(`user:${userId}`).emit('payment:status-updated', {
      paymentId,
      status,
      metadata,
      timestamp: new Date(),
    });
  }

  /**
   * Emit chat message (can be called server-side for system messages)
   * @param {string} groupId - Group ID
   * @param {object} messageData - Message information
   */
  broadcastChatMessage(groupId, messageData) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return;
    }
    this.io.to(`chat:${groupId}`).emit('chat:message-received', {
      ...messageData,
      timestamp: new Date(),
    });
  }

  /**
   * Update group statistics in real-time
   * @param {string} groupId - Group ID
   * @param {object} stats - Group statistics
   */
  updateGroupStats(groupId, stats) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return;
    }
    this.io.to(`notifications:${groupId}`).emit('group:stats-updated', {
      ...stats,
      timestamp: new Date(),
    });
  }

  /**
   * Notify user activity (presence, milestone achieved, etc.)
   * @param {string} userId - User ID
   * @param {string} activityType - Type of activity
   * @param {object} activityData - Activity details
   */
  trackActivity(userId, activityType, activityData = {}) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return;
    }
    this.io.to(`user:${userId}`).emit('activity:tracked', {
      type: activityType,
      data: activityData,
      timestamp: new Date(),
    });
  }

  /**
   * Get connected users count for a group
   * @param {string} groupId - Group ID
   * @returns {number} Number of connected users
   */
  getGroupActiveUsers(groupId) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return 0;
    }
    const room = this.io.sockets.adapter.rooms.get(`notifications:${groupId}`);
    return room ? room.size : 0;
  }

  /**
   * Get total connected users
   * @returns {number} Number of connected users
   */
  getTotalActiveUsers() {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return 0;
    }
    return this.io.engine.clientsCount;
  }

  /**
   * Check if user is online
   * @param {string} userId - User ID
   * @returns {boolean} True if user has active connection
   */
  isUserOnline(userId) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return false;
    }
    const room = this.io.sockets.adapter.rooms.get(`user:${userId}`);
    return room && room.size > 0;
  }

  /**
   * Get all active users in a group
   * @param {string} groupId - Group ID
   * @returns {array} Array of connected socket IDs
   */
  getGroupUsers(groupId) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return [];
    }
    const room = this.io.sockets.adapter.rooms.get(`notifications:${groupId}`);
    return room ? Array.from(room) : [];
  }

  /**
   * Emit to specific socket ID (admin/system messages)
   * @param {string} socketId - Socket ID
   * @param {string} event - Event name
   * @param {object} data - Event data
   */
  emitToSocket(socketId, event, data) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return;
    }
    this.io.to(socketId).emit(event, data);
  }

  /**
   * Broadcast to all connected users
   * @param {string} event - Event name
   * @param {object} data - Event data
   */
  broadcastToAll(event, data) {
    if (!this.io) {
      console.warn('⚠️ Socket.IO not initialized');
      return;
    }
    this.io.emit(event, data);
  }
}

module.exports = SocketEmitter;
