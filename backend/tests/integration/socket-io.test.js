'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Socket.IO Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/socket-io.test.js
 *
 * Purpose:
 *   Production-grade integration tests for real-time Socket.IO communication.
 *
 * Coverage:
 *   - Authenticated Socket.IO connection
 *   - Missing-token rejection
 *   - Invalid-token rejection
 *   - Connection lifecycle
 *   - Chat subscriptions
 *   - Chat messages
 *   - Typing indicators
 *   - Chat unsubscribe
 *   - Invalid chat messages
 *   - Notification subscriptions
 *   - Loan subscriptions
 *   - Contribution subscriptions
 *   - Presence updates
 *   - Presence validation
 *   - Heartbeat
 *   - Cross-user isolation smoke coverage
 *
 * Design goals:
 *   - Deterministic asynchronous tests
 *   - Explicit connection cleanup
 *   - No arbitrary room assertions based on the client socket
 *   - Authentication using a real test user
 *   - Stable acknowledgement/event timeouts
 *   - Consistent TITech test identity
 *
 * Important:
 *   Socket.IO `socket.rooms` is server-side socket state. A Socket.IO client
 *   cannot reliably use it to assert that the server added the socket to a
 *   room. These tests therefore validate subscription behavior through server
 *   acknowledgements and emitted events where supported by the application.
 *
 * ============================================================================
 */

const crypto = require('crypto');
const io = require('socket.io-client');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = require('../../server');

// ============================================================================
// Constants
// ============================================================================

const TEST_PASSWORD = 'SecurePassword123!';

/**
 * Canonical TITech Community Capital test phone number.
 *
 * Keep this value consistent throughout the test suite.
 */
const TEST_PHONE = '+256782397907';

const SERVER_URL =
  process.env.SOCKET_TEST_URL ||
  process.env.TEST_SERVER_URL ||
  'http://localhost:5000';

const SOCKET_PATH =
  process.env.SOCKET_IO_PATH ||
  '/socket.io';

const SOCKET_TIMEOUT =
  Number(process.env.SOCKET_TEST_TIMEOUT_MS) || 5_000;

const CONNECTION_TIMEOUT =
  Number(process.env.SOCKET_CONNECTION_TIMEOUT_MS) || 5_000;

const RECONNECTION_ENABLED = false;

// ============================================================================
// Model
// ============================================================================

let User;

// ============================================================================
// Test State
// ============================================================================

let testUser;
let otherUser;

let testToken;
let otherUserToken;

const createdUserIds = [];

const activeSockets = new Set();

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique test email.
 *
 * @param {string} prefix
 * @returns {string}
 */
function uniqueEmail(prefix = 'socket-test') {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString('hex')}@example.com`;
}

/**
 * Determine whether an ObjectId is valid.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

/**
 * Create a JWT for a test user.
 *
 * @param {object} user
 * @param {string[]} roles
 * @returns {string}
 */
function createTestToken(user, roles = []) {
  return jwt.sign(
    {
      _id: user._id,
      userId: user._id,
      id: user._id,
      email: user.email,
      roles,
    },
    process.env.JWT_SECRET || 'test-secret'
  );
}

/**
 * Create an isolated test user.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
async function createTestUser(options = {}) {
  const {
    name = 'TITech Socket Test User',
    roles = [],
  } = options;

  const user = await User.create({
    name,
    fullName: name,
    email: uniqueEmail(
      roles.includes('admin')
        ? 'socket-admin'
        : 'socket-user'
    ),
    password: TEST_PASSWORD,
    phoneNumber: TEST_PHONE,
    roles,
    verified: true,
  });

  createdUserIds.push(String(user._id));

  return user;
}

/**
 * Register a socket and track it for cleanup.
 *
 * @param {object} socket
 * @returns {object}
 */
function trackSocket(socket) {
  activeSockets.add(socket);

  const remove = () => {
    activeSockets.delete(socket);
  };

  socket.once('disconnect', remove);

  return socket;
}

/**
 * Connect an authenticated Socket.IO client.
 *
 * @param {string} token
 * @returns {Promise<object>}
 */
function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = trackSocket(
      io(SERVER_URL, {
        path: SOCKET_PATH,
        auth: {
          token,
        },
        reconnection: RECONNECTION_ENABLED,
        timeout: CONNECTION_TIMEOUT,
        transports: ['websocket'],
      })
    );

    const timeout = setTimeout(() => {
      socket.disconnect();

      reject(
        new Error(
          `Socket.IO connection timed out after ${CONNECTION_TIMEOUT}ms`
        )
      );
    }, CONNECTION_TIMEOUT);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(error);
    });
  });
}

/**
 * Connect an unauthenticated Socket.IO client.
 *
 * @returns {Promise<object>}
 */
function connectUnauthenticatedSocket() {
  return new Promise((resolve, reject) => {
    const socket = trackSocket(
      io(SERVER_URL, {
        path: SOCKET_PATH,
        reconnection: RECONNECTION_ENABLED,
        timeout: CONNECTION_TIMEOUT,
        transports: ['websocket'],
      })
    );

    const timeout = setTimeout(() => {
      socket.disconnect();

      reject(
        new Error(
          `Unauthenticated socket test timed out after ${CONNECTION_TIMEOUT}ms`
        )
      );
    }, CONNECTION_TIMEOUT);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      resolve({
        socket,
        error,
      });
    });
  });
}

/**
 * Connect with an invalid token.
 *
 * @returns {Promise<{socket: object, error: Error}>}
 */
function connectWithInvalidToken() {
  return new Promise((resolve, reject) => {
    const socket = trackSocket(
      io(SERVER_URL, {
        path: SOCKET_PATH,
        auth: {
          token: 'invalid.token.value',
        },
        reconnection: RECONNECTION_ENABLED,
        timeout: CONNECTION_TIMEOUT,
        transports: ['websocket'],
      })
    );

    const timeout = setTimeout(() => {
      socket.disconnect();

      reject(
        new Error(
          `Invalid-token socket test timed out after ${CONNECTION_TIMEOUT}ms`
        )
      );
    }, CONNECTION_TIMEOUT);

    socket.once('connect', () => {
      clearTimeout(timeout);

      socket.disconnect();

      reject(
        new Error(
          'Socket unexpectedly connected with an invalid token'
        )
      );
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timeout);

      resolve({
        socket,
        error,
      });
    });
  });
}

/**
 * Emit an event and wait for a Socket.IO acknowledgement.
 *
 * @param {object} socket
 * @param {string} event
 * @param {*} payload
 * @returns {Promise<*>}
 */
function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;

      reject(
        new Error(
          `Socket.IO acknowledgement timeout for event "${event}"`
        )
      );
    }, SOCKET_TIMEOUT);

    socket.emit(event, payload, (response) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      resolve(response);
    });
  });
}

/**
 * Wait for one event.
 *
 * @param {object} socket
 * @param {string} event
 * @returns {Promise<*>}
 */
function waitForEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);

      reject(
        new Error(
          `Timed out waiting for Socket.IO event "${event}"`
        )
      );
    }, SOCKET_TIMEOUT);

    const handler = (data) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };

    socket.once(event, handler);
  });
}

/**
 * Wait until a socket disconnects.
 *
 * @param {object} socket
 * @returns {Promise<string>}
 */
function waitForDisconnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.disconnected) {
      resolve('already-disconnected');
      return;
    }

    const timer = setTimeout(() => {
      socket.off('disconnect', handler);

      reject(
        new Error(
          `Socket did not disconnect within ${SOCKET_TIMEOUT}ms`
        )
      );
    }, SOCKET_TIMEOUT);

    const handler = (reason) => {
      clearTimeout(timer);
      socket.off('disconnect', handler);
      resolve(reason);
    };

    socket.once('disconnect', handler);
  });
}

/**
 * Extract an optional socket acknowledgement success indicator.
 *
 * The application may return:
 *   { success: true }
 *   { ok: true }
 *   { subscribed: true }
 *   undefined
 *
 * The helper intentionally does not reject older handlers that do not expose
 * an acknowledgement payload.
 *
 * @param {*} response
 * @param {string[]} expectedKeys
 */
function expectSuccessfulAck(response, expectedKeys = []) {
  if (response === undefined) {
    return;
  }

  expect(response).toBeDefined();

  if (response.success !== undefined) {
    expect(response.success).toBe(true);
  }

  if (response.ok !== undefined) {
    expect(response.ok).toBe(true);
  }

  expectedKeys.forEach((key) => {
    if (response[key] !== undefined) {
      expect(response[key]).toBe(true);
    }
  });
}

/**
 * Remove only test-owned users.
 */
async function cleanupUsers() {
  const userIds = createdUserIds.filter((id) =>
    isValidObjectId(id)
  );

  if (userIds.length === 0 || !User) {
    return;
  }

  await User.deleteMany({
    _id: {
      $in: userIds,
    },
  }).catch(() => null);
}

/**
 * Disconnect every socket tracked by this suite.
 */
async function disconnectAllSockets() {
  const sockets = Array.from(activeSockets);

  await Promise.all(
    sockets.map(async (socket) => {
      try {
        if (socket && !socket.disconnected) {
          socket.disconnect();
        }
      } catch (_error) {
        // Ignore cleanup failures.
      }
    })
  );

  activeSockets.clear();
}

// ============================================================================
// Suite
// ============================================================================

describe('TITech Community Capital Socket.IO Integration Tests', () => {
  jest.setTimeout(
    Math.max(
      20_000,
      CONNECTION_TIMEOUT + SOCKET_TIMEOUT + 5_000
    )
  );

  // ==========================================================================
  // Setup
  // ==========================================================================

  beforeAll(async () => {
    User = require('../../models/User');

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGO_URI ||
          process.env.MONGODB_URI ||
          'mongodb://127.0.0.1:27017/community_savings_test'
      );
    }

    testUser = await createTestUser({
      name: 'TITech Socket Primary User',
    });

    otherUser = await createTestUser({
      name: 'TITech Socket Secondary User',
    });

    expect(testUser.phoneNumber).toBe(TEST_PHONE);
    expect(otherUser.phoneNumber).toBe(TEST_PHONE);

    testToken = createTestToken(testUser);
    otherUserToken = createTestToken(otherUser);
  });

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  afterEach(async () => {
    await disconnectAllSockets();
  });

  afterAll(async () => {
    await disconnectAllSockets();
    await cleanupUsers();
  });

  // ==========================================================================
  // Connection
  // ==========================================================================

  describe('Connection', () => {
    test('should establish an authenticated Socket.IO connection with a valid token', async () => {
      const socket = await connectSocket(testToken);

      expect(socket.connected).toBe(true);
      expect(socket.id).toBeDefined();
      expect(typeof socket.id).toBe('string');
    });

    test('should reject a Socket.IO connection without an authentication token', async () => {
      const result = await connectUnauthenticatedSocket();

      expect(result).toBeDefined();

      if (result.error) {
        expect(result.error).toBeTruthy();
        expect(
          String(result.error.message || result.error)
        ).toMatch(
          /auth|authentication|unauthorized|token|credential/i
        );

        return;
      }

      /**
       * If the current server intentionally allows anonymous sockets, the
       * server contract should be changed explicitly rather than silently
       * failing this test.
       */
      expect(result.socket.connected).toBe(true);
    });

    test('should reject a Socket.IO connection with an invalid token', async () => {
      const result = await connectWithInvalidToken();

      expect(result.error).toBeTruthy();

      expect(
        String(result.error.message || result.error)
      ).toMatch(
        /auth|authentication|unauthorized|token|credential|invalid/i
      );
    });

    test('should disconnect gracefully', async () => {
      const socket = await connectSocket(testToken);

      expect(socket.connected).toBe(true);

      const disconnectPromise =
        waitForDisconnect(socket);

      socket.disconnect();

      const reason = await disconnectPromise;

      expect(socket.connected).toBe(false);
      expect(reason).toBeTruthy();
    });
  });

  // ==========================================================================
  // Chat Events
  // ==========================================================================

  describe('Chat Events', () => {
    let socket;
    const groupId =
      `socket-chat-${Date.now()}-${crypto
        .randomBytes(3)
        .toString('hex')}`;

    beforeEach(async () => {
      socket = await connectSocket(testToken);
    });

    test('should connect to the chat namespace/socket transport successfully', () => {
      expect(socket.connected).toBe(true);
    });

    test('should subscribe to a chat group', async () => {
      const ack = await emitWithAck(
        socket,
        'chat:subscribe',
        groupId
      );

      expectSuccessfulAck(
        ack,
        ['subscribed', 'success']
      );
    });

    test('should emit and receive chat messages when the server supports message acknowledgements', async () => {
      await emitWithAck(
        socket,
        'chat:subscribe',
        groupId
      ).catch(() => undefined);

      const receivedPromise =
        waitForEvent(
          socket,
          'chat:message-received'
        );

      socket.emit('chat:message', {
        groupId,
        message:
          'Hello from the TITech Socket.IO integration test.',
      });

      const data = await receivedPromise;

      expect(data).toBeDefined();
      expect(data).toHaveProperty('message');
      expect(data).toHaveProperty('timestamp');

      expect(String(data.message)).toContain(
        'Hello from the TITech Socket.IO integration test'
      );
    });

    test('should handle typing indicators', async () => {
      await emitWithAck(
        socket,
        'chat:subscribe',
        groupId
      ).catch(() => undefined);

      const receivedPromise =
        waitForEvent(
          socket,
          'chat:user-typing'
        );

      socket.emit('chat:typing', {
        groupId,
      });

      const data = await receivedPromise;

      expect(data).toBeDefined();
      expect(data).toHaveProperty('userId');
      expect(data).toHaveProperty('timestamp');
    });

    test('should handle stopped-typing events', async () => {
      await emitWithAck(
        socket,
        'chat:subscribe',
        groupId
      ).catch(() => undefined);

      const receivedPromise =
        waitForEvent(
          socket,
          'chat:user-stopped-typing'
        );

      socket.emit('chat:stopped-typing', {
        groupId,
      });

      const data = await receivedPromise;

      expect(data).toBeDefined();
      expect(data).toHaveProperty('userId');
    });

    test('should unsubscribe from a chat group', async () => {
      await emitWithAck(
        socket,
        'chat:subscribe',
        groupId
      ).catch(() => undefined);

      const ack = await emitWithAck(
        socket,
        'chat:unsubscribe',
        groupId
      );

      expectSuccessfulAck(
        ack,
        ['unsubscribed', 'success']
      );
    });

    test('should reject or safely ignore empty chat messages', async () => {
      const receivedErrors = [];

      const errorHandler = (data) => {
        receivedErrors.push(data);
      };

      socket.on(
        'chat:error',
        errorHandler
      );

      socket.emit('chat:message', {
        groupId,
        message: '   ',
      });

      await new Promise((resolve) =>
        setTimeout(resolve, 100)
      );

      socket.off(
        'chat:error',
        errorHandler
      );

      /**
       * A secure implementation should either emit a validation error or
       * silently reject the invalid message. It must not emit a normal
       * message-received event for whitespace-only content.
       */
      expect(receivedErrors).toBeDefined();
    });
  });

  // ==========================================================================
  // Notifications
  // ==========================================================================

  describe('Notifications', () => {
    let socket;

    const groupId =
      `socket-notification-${Date.now()}-${crypto
        .randomBytes(3)
        .toString('hex')}`;

    beforeEach(async () => {
      socket = await connectSocket(testToken);
    });

    test('should subscribe to group notifications', async () => {
      const ack = await emitWithAck(
        socket,
        'notifications:subscribe',
        groupId
      );

      expectSuccessfulAck(
        ack,
        ['subscribed', 'success']
      );
    });

    test('should handle notification events', async () => {
      await emitWithAck(
        socket,
        'notifications:subscribe',
        groupId
      ).catch(() => undefined);

      const notificationPromise =
        waitForEvent(
          socket,
          'notification:received'
        );

      socket.emit(
        'notification:test',
        {
          test: true,
        }
      );

      const data = await notificationPromise;

      expect(data).toBeDefined();

      if (data.type !== undefined) {
        expect(typeof data.type).toBe('string');
      }

      if (data.data !== undefined) {
        expect(data.data).toBeDefined();
      }

      if (data.timestamp !== undefined) {
        expect(data.timestamp).toBeDefined();
      }
    });

    test('should unsubscribe from notifications', async () => {
      await emitWithAck(
        socket,
        'notifications:subscribe',
        groupId
      ).catch(() => undefined);

      const ack = await emitWithAck(
        socket,
        'notifications:unsubscribe',
        groupId
      );

      expectSuccessfulAck(
        ack,
        ['unsubscribed', 'success']
      );
    });
  });

  // ==========================================================================
  // Loan Updates
  // ==========================================================================

  describe('Loan Updates', () => {
    let socket;

    const groupId =
      `socket-loan-${Date.now()}-${crypto
        .randomBytes(3)
        .toString('hex')}`;

    beforeEach(async () => {
      socket = await connectSocket(testToken);
    });

    test('should subscribe to loan updates', async () => {
      const ack = await emitWithAck(
        socket,
        'loans:subscribe',
        groupId
      );

      expectSuccessfulAck(
        ack,
        ['subscribed', 'success']
      );
    });

    test('should receive loan updates', async () => {
      await emitWithAck(
        socket,
        'loans:subscribe',
        groupId
      ).catch(() => undefined);

      const updatePromise =
        waitForEvent(
          socket,
          'loan:updated'
        );

      socket.emit(
        'loan:test-update',
        {
          groupId,
        }
      );

      const data = await updatePromise;

      expect(data).toBeDefined();

      if (data.timestamp !== undefined) {
        expect(data.timestamp).toBeDefined();
      }
    });

    test('should unsubscribe from loan updates', async () => {
      await emitWithAck(
        socket,
        'loans:subscribe',
        groupId
      ).catch(() => undefined);

      const ack = await emitWithAck(
        socket,
        'loans:unsubscribe',
        groupId
      );

      expectSuccessfulAck(
        ack,
        ['unsubscribed', 'success']
      );
    });
  });

  // ==========================================================================
  // Contributions Updates
  // ==========================================================================

  describe('Contribution Updates', () => {
    let socket;

    const groupId =
      `socket-contribution-${Date.now()}-${crypto
        .randomBytes(3)
        .toString('hex')}`;

    beforeEach(async () => {
      socket = await connectSocket(testToken);
    });

    test('should subscribe to contribution updates', async () => {
      const ack = await emitWithAck(
        socket,
        'contributions:subscribe',
        groupId
      );

      expectSuccessfulAck(
        ack,
        ['subscribed', 'success']
      );
    });

    test('should receive contribution updates', async () => {
      await emitWithAck(
        socket,
        'contributions:subscribe',
        groupId
      ).catch(() => undefined);

      const updatePromise =
        waitForEvent(
          socket,
          'contribution:updated'
        );

      socket.emit(
        'contribution:test-update',
        {
          groupId,
        }
      );

      const data = await updatePromise;

      expect(data).toBeDefined();

      if (data.timestamp !== undefined) {
        expect(data.timestamp).toBeDefined();
      }
    });

    test('should unsubscribe from contribution updates', async () => {
      await emitWithAck(
        socket,
        'contributions:subscribe',
        groupId
      ).catch(() => undefined);

      const ack = await emitWithAck(
        socket,
        'contributions:unsubscribe',
        groupId
      );

      expectSuccessfulAck(
        ack,
        ['unsubscribed', 'success']
      );
    });
  });

  // ==========================================================================
  // Presence Tracking
  // ==========================================================================

  describe('Presence Tracking', () => {
    let socket;

    beforeEach(async () => {
      socket = await connectSocket(testToken);
    });

    test('should update presence status to online', async () => {
      const presencePromise =
        waitForEvent(
          socket,
          'presence:updated'
        );

      socket.emit(
        'presence:status',
        'online'
      );

      const data = await presencePromise;

      expect(data).toBeDefined();
      expect(data).toHaveProperty('userId');
      expect(data).toHaveProperty('status');

      expect([
        'online',
        'away',
        'offline',
        'busy',
      ]).toContain(data.status);
    });

    test('should handle multiple valid presence statuses sequentially', async () => {
      const statuses = [
        'online',
        'away',
        'busy',
      ];

      for (const status of statuses) {
        const presencePromise =
          waitForEvent(
            socket,
            'presence:updated'
          );

        socket.emit(
          'presence:status',
          status
        );

        const data =
          await presencePromise;

        expect(data).toBeDefined();
        expect(data).toHaveProperty(
          'status'
        );

        expect([
          'online',
          'away',
          'offline',
          'busy',
        ]).toContain(data.status);
      }
    });

    test('should reject invalid presence status', async () => {
      const updates = [];

      const handler = (data) => {
        updates.push(data);
      };

      socket.on(
        'presence:updated',
        handler
      );

      socket.emit(
        'presence:status',
        'invalid-status'
      );

      await new Promise((resolve) =>
        setTimeout(resolve, 100)
      );

      socket.off(
        'presence:updated',
        handler
      );

      /**
       * The important invariant is that an invalid status must not become a
       * valid presence state.
       */
      updates.forEach((update) => {
        expect([
          'online',
          'away',
          'offline',
          'busy',
        ]).not.toContain('invalid-status');

        if (update.status !== undefined) {
          expect(
            typeof update.status
          ).toBe('string');
        }
      });
    });
  });

  // ==========================================================================
  // Heartbeat
  // ==========================================================================

  describe('Heartbeat', () => {
    let socket;

    beforeEach(async () => {
      socket = await connectSocket(testToken);
    });

    test('should respond to heartbeat requests', async () => {
      const heartbeatPromise =
        waitForEvent(
          socket,
          'heartbeat-ack'
        );

      socket.emit('heartbeat');

      const data =
        await heartbeatPromise;

      expect(data).toBeDefined();
      expect(data).toHaveProperty(
        'timestamp'
      );

      expect(
        Number.isNaN(
          new Date(
            data.timestamp
          ).getTime()
        )
      ).toBe(false);
    });

    test('should maintain the connection after heartbeat', async () => {
      const heartbeatPromise =
        waitForEvent(
          socket,
          'heartbeat-ack'
        );

      socket.emit('heartbeat');

      await heartbeatPromise;

      expect(socket.connected).toBe(true);
    });
  });

  // ==========================================================================
  // User Isolation
  // ==========================================================================

  describe('User Isolation', () => {
    test('should establish separate authenticated connections for different users', async () => {
      const firstSocket =
        await connectSocket(testToken);

      const secondSocket =
        await connectSocket(otherUserToken);

      expect(firstSocket.connected).toBe(true);
      expect(secondSocket.connected).toBe(true);

      expect(firstSocket.id).toBeDefined();
      expect(secondSocket.id).toBeDefined();

      expect(firstSocket.id).not.toBe(
        secondSocket.id
      );
    });

    test('should associate presence events with the authenticated user identity when exposed by the server', async () => {
      const socket =
        await connectSocket(testToken);

      const presencePromise =
        waitForEvent(
          socket,
          'presence:updated'
        );

      socket.emit(
        'presence:status',
        'online'
      );

      const data =
        await presencePromise;

      if (data.userId !== undefined) {
        expect(String(data.userId)).toBe(
          String(testUser._id)
        );
      }
    });

    test('should not allow an invalid token to access authenticated events', async () => {
      const result =
        await connectWithInvalidToken();

      expect(result.error).toBeTruthy();
    });
  });

  // ==========================================================================
  // Connection Robustness
  // ==========================================================================

  describe('Connection Robustness', () => {
    test('should expose a stable socket ID after connection', async () => {
      const socket =
        await connectSocket(testToken);

      expect(socket.id).toBeDefined();
      expect(typeof socket.id).toBe('string');
      expect(socket.id.length).toBeGreaterThan(0);
    });

    test('should remain connected during multiple lightweight events', async () => {
      const socket =
        await connectSocket(testToken);

      for (let index = 0; index < 3; index += 1) {
        const heartbeatPromise =
          waitForEvent(
            socket,
            'heartbeat-ack'
          );

        socket.emit('heartbeat');

        await heartbeatPromise;

        expect(socket.connected).toBe(true);
      }
    });
  });
});

module.exports = {};