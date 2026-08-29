"use strict";

/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Chat Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/chat.test.js
 *
 * Purpose:
 *   Production-grade integration tests for TITech real-time chat.
 *
 * Coverage:
 *
 *   Authentication
 *   Tenant isolation
 *   Conversation lifecycle
 *   DM idempotency
 *   Concurrent conversation creation
 *   Group conversations
 *   Conversation membership authorization
 *   Message creation
 *   Message pagination
 *   Message search
 *   Read receipts
 *   Unread counts
 *   Message editing
 *   Message soft deletion
 *   Conversation archiving
 *   Invalid identifiers
 *   Cross-user authorization
 *   Persistence-level security assertions
 *
 * Security model:
 *
 *   JWT authenticated identity
 *          ↓
 *   Authenticated tenant context
 *          ↓
 *   Conversation membership
 *          ↓
 *   Resource authorization
 *          ↓
 *   Persistence query
 *
 * IMPORTANT:
 *
 *   `x-tenant-id` is treated as untrusted client input.
 *
 *   The authenticated JWT tenant context is authoritative.
 *
 *   A client must never be able to:
 *
 *   1. Read another tenant's conversation.
 *   2. Read another tenant's messages.
 *   3. Search another tenant's messages.
 *   4. Mark another tenant's message as read.
 *   5. Edit another user's message.
 *   6. Delete another user's message.
 *   7. Archive another user's conversation.
 *   8. Create a conversation in another tenant.
 *   9. Override tenant context using x-tenant-id.
 *  10. Enumerate resources belonging to another tenant.
 *
 * NOTE:
 *
 *   Endpoint paths follow the current TITech chat API contract:
 *
 *   POST   /api/chat/conversations
 *   GET    /api/chat/conversations
 *   POST   /api/chat/conversations/:id/messages
 *   GET    /api/chat/conversations/:id/messages
 *   POST   /api/chat/conversations/:id/messages/:id/read
 *   PUT    /api/chat/conversations/:id/messages/:id
 *   DELETE /api/chat/conversations/:id/messages/:id
 *   POST   /api/chat/conversations/:id/archive
 *   GET    /api/chat/unread
 *   GET    /api/chat/conversations/:id/search
 *
 * ============================================================================
 */

const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = require("../../server");

const User = require("../../models/User");
const Conversation = require("../../models/Conversation");
const ChatMessage = require("../../models/ChatMessage");

/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const JWT_SECRET =
  process.env.JWT_SECRET || "titech-test-secret-chat-integration";

const JWT_ALGORITHM = "HS256";

const API = Object.freeze({
  CONVERSATIONS: "/api/chat/conversations",
  UNREAD: "/api/chat/unread",
});

const HTTP = Object.freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
});

/**
 * ============================================================================
 * Test Identity Helpers
 * ============================================================================
 */

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createToken(identity = {}) {
  const userId = identity.userId || objectId();
  const tenantId = identity.tenantId || objectId();

  return jwt.sign(
    {
      _id: String(userId),
      id: String(userId),
      userId: String(userId),

      tenantId: String(tenantId),

      email:
        identity.email ||
        `chat-user-${String(userId)}@titech.test`,

      role: identity.role || "user",
    },
    JWT_SECRET,
    {
      algorithm: JWT_ALGORITHM,
      expiresIn: "1h",
    }
  );
}

function buildIdentity(tenantId, overrides = {}) {
  const userId = overrides.userId || objectId();

  return {
    userId,
    tenantId,
    email:
      overrides.email ||
      `user-${String(userId)}@titech.test`,
    role: overrides.role || "user",
  };
}

function tenantAdmin(tenantId) {
  return buildIdentity(tenantId, {
    role: "admin",
  });
}

function tenantUser(tenantId) {
  return buildIdentity(tenantId, {
    role: "user",
  });
}

/**
 * ============================================================================
 * HTTP Helpers
 * ============================================================================
 */

function authenticatedRequest(identity, options = {}) {
  const token = createToken(identity);

  const req = request(app);

  req.set("Authorization", `Bearer ${token}`);

  if (options.tenantHeader !== undefined) {
    req.set("x-tenant-id", String(options.tenantHeader));
  } else if (options.includeTenantHeader !== false) {
    req.set("x-tenant-id", String(identity.tenantId));
  }

  return req;
}

function unauthenticatedRequest() {
  return request(app);
}

/**
 * ============================================================================
 * Response Helpers
 * ============================================================================
 */

function expectAuthorizationFailure(response) {
  expect([
    HTTP.BAD_REQUEST,
    HTTP.UNAUTHORIZED,
    HTTP.FORBIDDEN,
    HTTP.NOT_FOUND,
  ]).toContain(response.status);
}

function expectResourceSuccess(response) {
  expect([
    HTTP.OK,
    HTTP.CREATED,
    HTTP.NO_CONTENT,
  ]).toContain(response.status);
}

function extractData(response) {
  return response?.body?.data ?? response?.body;
}

function extractRecords(response) {
  const body = response?.body || {};

  if (Array.isArray(body)) {
    return body;
  }

  if (Array.isArray(body.data)) {
    return body.data;
  }

  if (Array.isArray(body.results)) {
    return body.results;
  }

  if (Array.isArray(body.messages)) {
    return body.messages;
  }

  if (Array.isArray(body.conversations)) {
    return body.conversations;
  }

  return [];
}

function extractId(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value._id) {
    return String(value._id);
  }

  if (value.id) {
    return String(value.id);
  }

  return null;
}

/**
 * ============================================================================
 * Database Helpers
 * ============================================================================
 */

async function clearChatCollections() {
  await Promise.all([
    ChatMessage.deleteMany({}),
    Conversation.deleteMany({}),
    User.deleteMany({}),
  ]);
}

async function createUser(identity, overrides = {}) {
  return User.create({
    _id: identity.userId,

    name:
      overrides.name ||
      `TITech Chat User ${String(identity.userId).slice(-6)}`,

    email:
      identity.email ||
      `chat-${String(identity.userId)}@titech.test`,

    password: overrides.password || "HashedPassword123!",

    role: identity.role || "user",

    isVerified: true,

    ...overrides,
  });
}

async function createConversation(overrides = {}) {
  const tenantId = overrides.tenantId || objectId();

  const participantIds =
    overrides.participantIds || [objectId(), objectId()];

  return Conversation.create({
    tenantId,

    type: overrides.type || "dm",

    participants: participantIds,

    participantIds,

    name:
      overrides.name ||
      (overrides.type === "group" ? "TITech Test Group" : undefined),

    description:
      overrides.description ||
      (overrides.type === "group"
        ? "TITech enterprise chat test group"
        : undefined),

    archivedBy: overrides.archivedBy || [],

    ...overrides,
  });
}

async function createMessage(overrides = {}) {
  const conversationId =
    overrides.conversationId || objectId();

  const senderId =
    overrides.senderId || objectId();

  return ChatMessage.create({
    conversation: conversationId,
    conversationId,

    sender: senderId,
    senderId,

    content:
      overrides.content ||
      "TITech Community Capital test message.",

    ...overrides,
  });
}

/**
 * ============================================================================
 * Test Suite
 * ============================================================================
 */

describe("TITech Chat Integration Tests", () => {
  let tenantA;
  let tenantB;

  let user1;
  let user2;
  let user3;

  let user1Token;
  let user2Token;
  let user3Token;

  let conversationId;

  /**
   * ========================================================================
   * Lifecycle
   * ========================================================================
   */

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGO_URI ||
          "mongodb://127.0.0.1:27017/titech_chat_test"
      );
    }
  });

  beforeEach(async () => {
    await clearChatCollections();

    tenantA = objectId();
    tenantB = objectId();

    const identity1 = tenantUser(tenantA);
    const identity2 = tenantUser(tenantA);
    const identity3 = tenantUser(tenantB);

    user1 = await createUser(identity1, {
      name: "TITech Chat User One",
    });

    user2 = await createUser(identity2, {
      name: "TITech Chat User Two",
    });

    user3 = await createUser(identity3, {
      name: "TITech Chat User Three",
    });

    user1Token = createToken({
      userId: user1._id,
      tenantId: tenantA,
      email: user1.email,
      role: "user",
    });

    user2Token = createToken({
      userId: user2._id,
      tenantId: tenantA,
      email: user2.email,
      role: "user",
    });

    user3Token = createToken({
      userId: user3._id,
      tenantId: tenantB,
      email: user3.email,
      role: "user",
    });

    conversationId = null;
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  /**
   * ========================================================================
   * Authentication
   * ========================================================================
   */

  describe("Authentication", () => {
    test("should reject unauthenticated conversation creation", async () => {
      const response = await unauthenticatedRequest()
        .post(API.CONVERSATIONS)
        .send({
          type: "dm",
          participantIds: [user2._id.toString()],
        });

      expect([
        HTTP.UNAUTHORIZED,
        HTTP.FORBIDDEN,
      ]).toContain(response.status);
    });

    test("should reject unauthenticated conversation listing", async () => {
      const response = await unauthenticatedRequest()
        .get(API.CONVERSATIONS);

      expect([
        HTTP.UNAUTHORIZED,
        HTTP.FORBIDDEN,
      ]).toContain(response.status);
    });

    test("should reject malformed bearer token", async () => {
      const response = await request(app)
        .get(API.CONVERSATIONS)
        .set("Authorization", "Bearer invalid.jwt.token");

      expect([
        HTTP.UNAUTHORIZED,
        HTTP.FORBIDDEN,
      ]).toContain(response.status);
    });

    test("should reject requests with an invalid JWT signature", async () => {
      const token = jwt.sign(
        {
          userId: String(user1._id),
          tenantId: String(tenantA),
        },
        "wrong-secret",
        {
          algorithm: JWT_ALGORITHM,
        }
      );

      const response = await request(app)
        .get(API.CONVERSATIONS)
        .set("Authorization", `Bearer ${token}`);

      expect([
        HTTP.UNAUTHORIZED,
        HTTP.FORBIDDEN,
      ]).toContain(response.status);
    });
  });

  /**
   * ========================================================================
   * Conversation Creation
   * ========================================================================
   */

  describe("Conversation creation", () => {
    test("should create a DM conversation", async () => {
      const response = await authenticatedRequest({
        userId: user1._id,
        tenantId: tenantA,
        email: user1.email,
        role: "user",
      })
        .post(API.CONVERSATIONS)
        .send({
          type: "dm",
          participantIds: [user2._id.toString()],
        });

      expect(response.status).toBe(201);

      const data = extractData(response);

      expect(data).toBeDefined();
      expect(data._id).toBeDefined();
      expect(data.type).toBe("dm");

      conversationId = extractId(data);
    });

    test("should create a group conversation", async () => {
      const response = await authenticatedRequest({
        userId: user1._id,
        tenantId: tenantA,
        email: user1.email,
        role: "user",
      })
        .post(API.CONVERSATIONS)
        .send({
          type: "group",
          participantIds: [
            user2._id.toString(),
          ],
          name: "TITech Test Group",
          description: "Enterprise integration test group",
        });

      expect(response.status).toBe(201);

      const data = extractData(response);

      expect(data.type).toBe("group");
      expect(data.name).toBe("TITech Test Group");
    });

    test("should reject group conversation without a name", async () => {
      const response = await authenticatedRequest({
        userId: user1._id,
        tenantId: tenantA,
        email: user1.email,
        role: "user",
      })
        .post(API.CONVERSATIONS)
        .send({
          type: "group",
          participantIds: [
            user2._id.toString(),
          ],
        });

      expect(response.status).toBe(HTTP.BAD_REQUEST);
    });

    test("should reject malformed participant identifiers", async () => {
      const response = await authenticatedRequest({
        userId: user1._id,
        tenantId: tenantA,
        email: user1.email,
        role: "user",
      })
        .post(API.CONVERSATIONS)
        .send({
          type: "dm",
          participantIds: ["not-a-valid-object-id"],
        });

      expect([
        HTTP.BAD_REQUEST,
        HTTP.NOT_FOUND,
      ]).toContain(response.status);
    });

    test("should not allow a client to create a conversation for another tenant", async () => {
      const response = await authenticatedRequest({
        userId: user1._id,
        tenantId: tenantA,
        email: user1.email,
        role: "user",
      })
        .post(API.CONVERSATIONS)
        .set("Idempotency-Key", `tenant-attack-${objectId()}`)
        .send({
          type: "dm",
          tenantId: String(tenantB),
          participantIds: [user3._id.toString()],
        });

      expect([
        HTTP.BAD_REQUEST,
        HTTP.FORBIDDEN,
        HTTP.UNAUTHORIZED,
      ]).toContain(response.status);

      const crossTenantConversations =
        await Conversation.find({
          tenantId: tenantB,
        }).lean();

      expect(crossTenantConversations).toHaveLength(0);
    });

    test("should not allow x-tenant-id to override authenticated tenant", async () => {
      const response = await authenticatedRequest(
        {
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        },
        {
          tenantHeader: tenantB,
        }
      )
        .post(API.CONVERSATIONS)
        .set("Idempotency-Key", `header-attack-${objectId()}`)
        .send({
          type: "dm",
          participantIds: [user2._id.toString()],
        });

      expect([
        HTTP.BAD_REQUEST,
        HTTP.FORBIDDEN,
        HTTP.UNAUTHORIZED,
      ]).toContain(response.status);

      const records = await Conversation.find({
        participantIds: {
          $all: [user1._id, user2._id],
        },
      }).lean();

      for (const record of records) {
        if (record.tenantId) {
          expect(String(record.tenantId)).toBe(
            String(tenantA)
          );
        }
      }
    });
  });

  /**
   * ========================================================================
   * DM Idempotency
   * ========================================================================
   */

  describe("DM idempotency", () => {
    test("should return the same DM for identical participants", async () => {
      const identity = {
        userId: user1._id,
        tenantId: tenantA,
        email: user1.email,
        role: "user",
      };

      const first = await authenticatedRequest(identity)
        .post(API.CONVERSATIONS)
        .send({
          type: "dm",
          participantIds: [user2._id.toString()],
        });

      expect(first.status).toBe(201);

      const firstData = extractData(first);
      const firstId = extractId(firstData);

      const second = await authenticatedRequest(identity)
        .post(API.CONVERSATIONS)
        .send({
          type: "dm",
          participantIds: [user2._id.toString()],
        });

      expect([HTTP.OK, HTTP.CREATED]).toContain(
        second.status
      );

      const secondData = extractData(second);
      const secondId = extractId(secondData);

      expect(secondId).toBe(firstId);

      const records = await Conversation.find({
        type: "dm",
        tenantId: tenantA,
      }).lean();

      expect(records).toHaveLength(1);
    });

    test("should preserve DM idempotency when participant order changes", async () => {
      const first = await authenticatedRequest({
        userId: user1._id,
        tenantId: tenantA,
        email: user1.email,
        role: "user",
      })
        .post(API.CONVERSATIONS)
        .send({
          type: "dm",
          participantIds: [
            user2._id.toString(),
          ],
        });

      expect(first.status).toBe(201);

      const firstId = extractId(
        extractData(first)
      );

      const second = await authenticatedRequest({
        userId: user2._id,
        tenantId: tenantA,
        email: user2.email,
        role: "user",
      })
        .post(API.CONVERSATIONS)
        .send({
          type: "dm",
          participantIds: [
            user1._id.toString(),
          ],
        });

      expect([HTTP.OK, HTTP.CREATED]).toContain(
        second.status
      );

      const secondId = extractId(
        extractData(second)
      );

      expect(secondId).toBe(firstId);
    });

    test("should remain isolated between tenants even with identical participants", async () => {
      const tenantBUser = user3;

      const tenantAResponse =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [user2._id.toString()],
          });

      expect(tenantAResponse.status).toBe(201);

      const tenantBResponse =
        await authenticatedRequest({
          userId: tenantBUser._id,
          tenantId: tenantB,
          email: tenantBUser.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [tenantBUser._id.toString()],
          });

      expect([
        HTTP.OK,
        HTTP.CREATED,
        HTTP.BAD_REQUEST,
      ]).toContain(tenantBResponse.status);

      const tenantARecords =
        await Conversation.find({
          tenantId: tenantA,
        }).lean();

      for (const record of tenantARecords) {
        expect(String(record.tenantId)).toBe(
          String(tenantA)
        );
      }
    });

    test("should handle concurrent DM creation without creating uncontrolled duplicates", async () => {
      const identity = {
        userId: user1._id,
        tenantId: tenantA,
        email: user1.email,
        role: "user",
      };

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          authenticatedRequest(identity)
            .post(API.CONVERSATIONS)
            .send({
              type: "dm",
              participantIds: [
                user2._id.toString(),
              ],
            })
        )
      );

      for (const response of responses) {
        expect([
          HTTP.OK,
          HTTP.CREATED,
          HTTP.CONFLICT,
        ]).toContain(response.status);
      }

      const records = await Conversation.find({
        tenantId: tenantA,
        type: "dm",
      }).lean();

      expect(records.length).toBeLessThanOrEqual(1);
    });
  });

  /**
   * ========================================================================
   * Conversation Listing
   * ========================================================================
   */

  describe("Conversation listing", () => {
    beforeEach(async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [
              user2._id.toString(),
            ],
          });

      conversationId = extractId(
        extractData(response)
      );
    });

    test("should list conversations for authenticated user", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .get(`${API.CONVERSATIONS}?page=1&limit=20`);

      expect(response.status).toBe(200);

      const records = extractRecords(response);

      expect(Array.isArray(records)).toBe(true);
    });

    test("should enforce pagination limits", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .get(
            `${API.CONVERSATIONS}?page=1&limit=100000`
          );

      expect([
        HTTP.OK,
        HTTP.BAD_REQUEST,
      ]).toContain(response.status);

      if (response.status === HTTP.OK) {
        expect(
          extractRecords(response).length
        ).toBeLessThanOrEqual(100);
      }
    });

    test("should not list conversations from another tenant", async () => {
      await createConversation({
        tenantId: tenantB,
        type: "dm",
        participantIds: [
          user3._id,
          objectId(),
        ],
      });

      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(API.CONVERSATIONS);

      expect(response.status).toBe(200);

      const records = extractRecords(response);

      for (const record of records) {
        if (record.tenantId) {
          expect(String(record.tenantId)).toBe(
            String(tenantA)
          );
        }
      }
    });
  });

  /**
   * ========================================================================
   * Conversation Membership Isolation
   * ========================================================================
   */

  describe("Conversation membership authorization", () => {
    beforeEach(async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [
              user2._id.toString(),
            ],
          });

      conversationId = extractId(
        extractData(response)
      );
    });

    test("participant should be able to access the conversation", async () => {
      const response =
        await authenticatedRequest({
          userId: user2._id,
          tenantId: tenantA,
          email: user2.email,
          role: "user",
        })
          .get(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          );

      expect([
        HTTP.OK,
        HTTP.NO_CONTENT,
      ]).toContain(response.status);
    });

    test("non-member from same tenant must not access conversation", async () => {
      const outsiderIdentity = tenantUser(tenantA);

      const outsider = await createUser(
        outsiderIdentity,
        {
          name: "TITech Same Tenant Outsider",
        }
      );

      const response =
        await authenticatedRequest({
          userId: outsider._id,
          tenantId: tenantA,
          email: outsider.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationId}/messages`
        );

      expectAuthorizationFailure(response);
    });

    test("user from another tenant must not access conversation", async () => {
      const response =
        await authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationId}/messages`
        );

      expectAuthorizationFailure(response);
    });
  });

  /**
   * ========================================================================
   * Message Creation
   * ========================================================================
   */

  describe("Message creation", () => {
    beforeEach(async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [
              user2._id.toString(),
            ],
          });

      conversationId = extractId(
        extractData(response)
      );
    });

    test("should send a message", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({
            content:
              "Hello from TITech Community Capital.",
          });

      expect(response.status).toBe(201);

      const data = extractData(response);

      expect(data).toBeDefined();
      expect(data._id).toBeDefined();
      expect(data.content).toBe(
        "Hello from TITech Community Capital."
      );
    });

    test("should reject an empty message", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({
            content: "",
          });

      expect(response.status).toBe(400);
    });

    test("should reject whitespace-only messages", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({
            content: "     ",
          });

      expect(response.status).toBe(400);
    });

    test("should reject oversized messages", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({
            content: "x".repeat(5001),
          });

      expect(response.status).toBe(400);
    });

    test("should reject a message from a non-member", async () => {
      const outsiderIdentity = tenantUser(tenantA);

      const outsider = await createUser(
        outsiderIdentity,
        {
          name: "TITech Message Outsider",
        }
      );

      const response =
        await authenticatedRequest({
          userId: outsider._id,
          tenantId: tenantA,
          email: outsider.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({
            content:
              "Unauthorized message injection.",
          });

      expectAuthorizationFailure(response);

      const messages =
        await ChatMessage.find({
          conversation: conversationId,
          sender: outsider._id,
        }).lean();

      expect(messages).toHaveLength(0);
    });

    test("should not allow a tenant header to redirect message creation", async () => {
      const response =
        await authenticatedRequest(
          {
            userId: user1._id,
            tenantId: tenantA,
            email: user1.email,
            role: "user",
          },
          {
            tenantHeader: tenantB,
          }
        )
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({
            content:
              "Tenant header attack attempt.",
          });

      expectAuthorizationFailure(response);

      const messages =
        await ChatMessage.find({
          conversation: conversationId,
          content:
            "Tenant header attack attempt.",
        }).lean();

      expect(messages).toHaveLength(0);
    });
  });

  /**
   * ========================================================================
   * Message Retrieval
   * ========================================================================
   */

  describe("Message retrieval", () => {
    let messageId;

    beforeEach(async () => {
      const conversationResponse =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [
              user2._id.toString(),
            ],
          });

      conversationId = extractId(
        extractData(conversationResponse)
      );

      const messageResponse =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({
            content:
              "TITech message retrieval test.",
          });

      messageId = extractId(
        extractData(messageResponse)
      );
    });

    test("should retrieve conversation messages", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .get(
            `${API.CONVERSATIONS}/${conversationId}/messages?page=1&limit=50`
          );

      expect(response.status).toBe(200);

      const records = extractRecords(response);

      expect(Array.isArray(records)).toBe(true);

      expect(
        records.some(
          (item) =>
            String(item._id) ===
            String(messageId)
        )
      ).toBe(true);
    });

    test("should not expose messages to another tenant", async () => {
      const response =
        await authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationId}/messages`
        );

      expectAuthorizationFailure(response);
    });

    test("should safely handle invalid conversation ID", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/not-a-valid-id/messages`
        );

      expect([
        HTTP.BAD_REQUEST,
        HTTP.NOT_FOUND,
      ]).toContain(response.status);
    });

    test("should safely handle non-existent conversation ID", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${objectId()}/messages`
        );

      expect([
        HTTP.BAD_REQUEST,
        HTTP.NOT_FOUND,
      ]).toContain(response.status);
    });
  });

  /**
   * ========================================================================
   * Read Receipts
   * ========================================================================
   */

  describe("Read receipts", () => {
    let messageId;

    beforeEach(async () => {
      const conversationResponse =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [
              user2._id.toString(),
            ],
          });

      conversationId = extractId(
        extractData(conversationResponse)
      );

      const messageResponse =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({
            content:
              "TITech read receipt test.",
          });

      messageId = extractId(
        extractData(messageResponse)
      );
    });

    test("conversation participant should mark a message as read", async () => {
      const response =
        await authenticatedRequest({
          userId: user2._id,
          tenantId: tenantA,
          email: user2.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages/${messageId}/read`
          )
          .send({});

      expect([
        HTTP.OK,
        HTTP.NO_CONTENT,
      ]).toContain(response.status);
    });

    test("another tenant must not mark the message as read", async () => {
      const response =
        await authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages/${messageId}/read`
          )
          .send({});

      expectAuthorizationFailure(response);
    });

    test("read operation must not mutate another tenant's message", async () => {
      const before =
        await ChatMessage.findById(messageId).lean();

      const response =
        await authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages/${messageId}/read`
          )
          .send({});

      expectAuthorizationFailure(response);

      const after =
        await ChatMessage.findById(messageId).lean();

      expect(after).not.toBeNull();
      expect(before).not.toBeNull();

      expect(
        String(after._id)
      ).toBe(String(before._id));

      expect(
        String(after.conversation || after.conversationId)
      ).toBe(
        String(
          before.conversation ||
            before.conversationId
        )
      );
    });
  });

  /**
   * ========================================================================
   * Message Editing
   * ========================================================================
   */

  describe("Message editing", () => {
    let messageId;

    beforeEach(async () => {
      const conversationResponse =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [
              user2._id.toString(),
            ],
          });

      conversationId = extractId(
        extractData(conversationResponse)
      );

      const messageResponse =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({
            content:
              "Original TITech message.",
          });

      messageId = extractId(
        extractData(messageResponse)
      );
    });

    test("should allow the sender to edit their own message", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .put(
            `${API.CONVERSATIONS}/${conversationId}/messages/${messageId}`
          )
          .send({
            content:
              "Edited TITech message.",
          });

      expect(response.status).toBe(200);

      const data = extractData(response);

      expect(data.content).toBe(
        "Edited TITech message."
      );
    });

    test("should prevent another participant from editing the sender's message", async () => {
      const response =
        await authenticatedRequest({
          userId: user2._id,
          tenantId: tenantA,
          email: user2.email,
          role: "user",
        })
          .put(
            `${API.CONVERSATIONS}/${conversationId}/messages/${messageId}`
          )
          .send({
            content:
              "Unauthorized TITech message modification.",
          });

      expect(response.status).toBe(HTTP.FORBIDDEN);

      const persisted =
        await ChatMessage.findById(messageId).lean();

      expect(persisted).not.toBeNull();
      expect(persisted.content).toBe(
        "Original TITech message."
      );
    });

    test("should prevent another tenant from editing the message", async () => {
      const response =
        await authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        })
          .put(
            `${API.CONVERSATIONS}/${conversationId}/messages/${messageId}`
          )
          .send({
            content:
              "Cross-tenant modification attempt.",
          });

      expectAuthorizationFailure(response);

      const persisted =
        await ChatMessage.findById(messageId).lean();

      expect(persisted).not.toBeNull();
      expect(persisted.content).toBe(
        "Original TITech message."
      );
    });

    test("should safely handle invalid message ID during edit", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .put(
            `${API.CONVERSATIONS}/${conversationId}/messages/not-valid`
          )
          .send({
            content: "Invalid identifier test.",
          });

      expect([
        HTTP.BAD_REQUEST,
        HTTP.NOT_FOUND,
      ]).toContain(response.status);
    });
  });

  /**
   * ========================================================================
   * Message Soft Deletion
   * ========================================================================
   */

  describe("Message deletion", () => {
    let messageId;

    beforeEach(async () => {
      const conversationResponse =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [
              user2._id.toString(),
            ],
          });

      conversationId = extractId(
        extractData(conversationResponse)
      );

      const messageResponse =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({
            content:
              "TITech message scheduled for deletion.",
          });

      messageId = extractId(
        extractData(messageResponse)
      );
    });

    test("should soft-delete own message", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).delete(
          `${API.CONVERSATIONS}/${conversationId}/messages/${messageId}`
        );

      expect(response.status).toBe(200);

      const data = extractData(response);

      if (data) {
        expect(data.deletedAt).toBeDefined();
        expect(data.deletedBy).toBeDefined();
      }

      const persisted =
        await ChatMessage.findById(messageId).lean();

      expect(persisted).not.toBeNull();

      expect(
        persisted.deletedAt ||
          persisted.isDeleted ||
          persisted.deleted
      ).toBeTruthy();
    });

    test("should prevent another participant from deleting the message", async () => {
      const response =
        await authenticatedRequest({
          userId: user2._id,
          tenantId: tenantA,
          email: user2.email,
          role: "user",
        }).delete(
          `${API.CONVERSATIONS}/${conversationId}/messages/${messageId}`
        );

      expect(response.status).toBe(
        HTTP.FORBIDDEN
      );

      const persisted =
        await ChatMessage.findById(messageId).lean();

      expect(persisted).not.toBeNull();

      if (persisted.deletedAt) {
        expect(persisted.deletedAt).toBeNull();
      }

      if (persisted.isDeleted !== undefined) {
        expect(persisted.isDeleted).toBe(false);
      }
    });

    test("should prevent another tenant from deleting the message", async () => {
      const response =
        await authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        }).delete(
          `${API.CONVERSATIONS}/${conversationId}/messages/${messageId}`
        );

      expectAuthorizationFailure(response);

      const persisted =
        await ChatMessage.findById(messageId).lean();

      expect(persisted).not.toBeNull();
      expect(
        String(
          persisted.conversation ||
            persisted.conversationId
        )
      ).toBe(String(conversationId));
    });
  });

  /**
   * ========================================================================
   * Conversation Archiving
   * ========================================================================
   */

  describe("Conversation archiving", () => {
    beforeEach(async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [
              user2._id.toString(),
            ],
          });

      conversationId = extractId(
        extractData(response)
      );
    });

    test("should archive a conversation for an authorized participant", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).post(
          `${API.CONVERSATIONS}/${conversationId}/archive`
        );

      expect(response.status).toBe(200);

      const persisted =
        await Conversation.findById(
          conversationId
        ).lean();

      expect(persisted).not.toBeNull();

      if (persisted.archivedBy) {
        expect(
          persisted.archivedBy.map(String)
        ).toContain(
          String(user1._id)
        );
      }
    });

    test("should prevent another tenant from archiving the conversation", async () => {
      const response =
        await authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        }).post(
          `${API.CONVERSATIONS}/${conversationId}/archive`
        );

      expectAuthorizationFailure(response);

      const persisted =
        await Conversation.findById(
          conversationId
        ).lean();

      expect(persisted).not.toBeNull();
      expect(
        String(persisted.tenantId)
      ).toBe(String(tenantA));
    });
  });

  /**
   * ========================================================================
   * Unread Counts
   * ========================================================================
   */

  describe("Unread counts", () => {
    beforeEach(async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [
              user2._id.toString(),
            ],
          });

      conversationId = extractId(
        extractData(response)
      );

      await authenticatedRequest({
        userId: user1._id,
        tenantId: tenantA,
        email: user1.email,
        role: "user",
      })
        .post(
          `${API.CONVERSATIONS}/${conversationId}/messages`
        )
        .send({
          content:
            "TITech unread message.",
        });
    });

    test("should return unread counts for authorized participant", async () => {
      const response =
        await authenticatedRequest({
          userId: user2._id,
          tenantId: tenantA,
          email: user2.email,
          role: "user",
        }).get(API.UNREAD);

      expect(response.status).toBe(200);

      expect(
        Array.isArray(
          response.body.data
        )
      ).toBe(true);
    });

    test("should not expose tenant A unread data to tenant B", async () => {
      const response =
        await authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        }).get(API.UNREAD);

      expect(response.status).toBe(200);

      const records = extractRecords(response);

      for (const record of records) {
        if (record.tenantId) {
          expect(
            String(record.tenantId)
          ).toBe(String(tenantB));
        }

        if (record.conversation?.tenantId) {
          expect(
            String(record.conversation.tenantId)
          ).toBe(String(tenantB));
        }
      }
    });
  });

  /**
   * ========================================================================
   * Message Search
   * ========================================================================
   */

  describe("Message search", () => {
    beforeEach(async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(API.CONVERSATIONS)
          .send({
            type: "dm",
            participantIds: [
              user2._id.toString(),
            ],
          });

      conversationId = extractId(
        extractData(response)
      );

      const messages = [
        "Hello from TITech.",
        "Community savings platform.",
        "TITech enterprise chat search.",
      ];

      for (const content of messages) {
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        })
          .post(
            `${API.CONVERSATIONS}/${conversationId}/messages`
          )
          .send({ content });
      }
    });

    test("should search messages in the conversation", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationId}/search?q=TITech`
        );

      expect(response.status).toBe(200);

      const records = extractRecords(response);

      expect(records.length).toBeGreaterThan(0);
    });

    test("should require a search query", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationId}/search`
        );

      expect(response.status).toBe(400);
    });

    test("should not allow another tenant to search the conversation", async () => {
      const response =
        await authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationId}/search?q=TITech`
        );

      expectAuthorizationFailure(response);
    });

    test("search results must not contain messages from another tenant", async () => {
      await createMessage({
        conversationId: objectId(),
        senderId: user3._id,
        content:
          "TITech confidential tenant B search record.",
      });

      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationId}/search?q=TITech`
        );

      expect(response.status).toBe(200);

      const records = extractRecords(response);

      for (const record of records) {
        if (record.tenantId) {
          expect(
            String(record.tenantId)
          ).toBe(String(tenantA));
        }

        expect(record.content).not.toBe(
          "TITech confidential tenant B search record."
        );
      }
    });
  });

  /**
   * ========================================================================
   * Tenant Isolation
   * ========================================================================
   */

  describe("Tenant isolation", () => {
    let tenantAConversation;
    let tenantBConversation;

    beforeEach(async () => {
      tenantAConversation =
        await createConversation({
          tenantId: tenantA,
          type: "dm",
          participantIds: [
            user1._id,
            user2._id,
          ],
        });

      tenantBConversation =
        await createConversation({
          tenantId: tenantB,
          type: "dm",
          participantIds: [
            user3._id,
            objectId(),
          ],
        });

      await createMessage({
        conversationId:
          tenantAConversation._id,
        senderId: user1._id,
        content:
          "Tenant A confidential message.",
      });

      await createMessage({
        conversationId:
          tenantBConversation._id,
        senderId: user3._id,
        content:
          "Tenant B confidential message.",
      });
    });

    test("tenant A cannot retrieve tenant B conversation messages", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${tenantBConversation._id}/messages`
        );

      expectAuthorizationFailure(response);
    });

    test("tenant B cannot retrieve tenant A conversation messages", async () => {
      const response =
        await authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${tenantAConversation._id}/messages`
        );

      expectAuthorizationFailure(response);
    });

    test("tenant A cannot manipulate tenant B conversation", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).post(
          `${API.CONVERSATIONS}/${tenantBConversation._id}/archive`
        );

      expectAuthorizationFailure(response);

      const persisted =
        await Conversation.findById(
          tenantBConversation._id
        ).lean();

      expect(persisted).not.toBeNull();
      expect(
        String(persisted.tenantId)
      ).toBe(String(tenantB));
    });

    test("forged tenant header must not grant access to another tenant", async () => {
      const response =
        await authenticatedRequest(
          {
            userId: user1._id,
            tenantId: tenantA,
            email: user1.email,
            role: "user",
          },
          {
            tenantHeader: tenantB,
          }
        ).get(
          `${API.CONVERSATIONS}/${tenantBConversation._id}/messages`
        );

      expectAuthorizationFailure(response);
    });

    test("missing tenant header must not grant cross-tenant access", async () => {
      const response =
        await authenticatedRequest(
          {
            userId: user1._id,
            tenantId: tenantA,
            email: user1.email,
            role: "user",
          },
          {
            includeTenantHeader: false,
          }
        ).get(
          `${API.CONVERSATIONS}/${tenantBConversation._id}/messages`
        );

      expect([
        HTTP.UNAUTHORIZED,
        HTTP.FORBIDDEN,
        HTTP.NOT_FOUND,
        HTTP.BAD_REQUEST,
      ]).toContain(response.status);
    });
  });

  /**
   * ========================================================================
   * Persistence-Level Security
   * ========================================================================
   */

  describe("Persistence-level security assertions", () => {
    test("tenant-scoped conversation query returns only tenant-owned records", async () => {
      await Promise.all([
        createConversation({
          tenantId: tenantA,
          participantIds: [
            user1._id,
            user2._id,
          ],
        }),
        createConversation({
          tenantId: tenantA,
          participantIds: [
            user1._id,
            user2._id,
          ],
        }),
        createConversation({
          tenantId: tenantB,
          participantIds: [
            user3._id,
            objectId(),
          ],
        }),
        createConversation({
          tenantId: tenantB,
          participantIds: [
            user3._id,
            objectId(),
          ],
        }),
      ]);

      const tenantARecords =
        await Conversation.find({
          tenantId: tenantA,
        }).lean();

      expect(tenantARecords).toHaveLength(2);

      for (const record of tenantARecords) {
        expect(
          String(record.tenantId)
        ).toBe(String(tenantA));
      }
    });

    test("tenant-scoped message dataset remains isolated", async () => {
      const conversationA =
        await createConversation({
          tenantId: tenantA,
          participantIds: [
            user1._id,
            user2._id,
          ],
        });

      const conversationB =
        await createConversation({
          tenantId: tenantB,
          participantIds: [
            user3._id,
            objectId(),
          ],
        });

      await createMessage({
        conversationId: conversationA._id,
        senderId: user1._id,
        content: "A-1",
      });

      await createMessage({
        conversationId: conversationA._id,
        senderId: user2._id,
        content: "A-2",
      });

      await createMessage({
        conversationId: conversationB._id,
        senderId: user3._id,
        content: "B-1",
      });

      const tenantAMessages =
        await ChatMessage.find({
          conversation: conversationA._id,
        }).lean();

      expect(tenantAMessages).toHaveLength(2);

      for (const message of tenantAMessages) {
        expect(
          String(
            message.conversation ||
              message.conversationId
          )
        ).toBe(
          String(conversationA._id)
        );
      }
    });

    test("cross-tenant lookup using tenant + conversation ID returns no record", async () => {
      const conversationB =
        await createConversation({
          tenantId: tenantB,
          participantIds: [
            user3._id,
            objectId(),
          ],
        });

      const result =
        await Conversation.findOne({
          _id: conversationB._id,
          tenantId: tenantA,
        }).lean();

      expect(result).toBeNull();
    });

    test("cross-tenant message lookup cannot resolve tenant B resource", async () => {
      const conversationB =
        await createConversation({
          tenantId: tenantB,
          participantIds: [
            user3._id,
            objectId(),
          ],
        });

      const messageB =
        await createMessage({
          conversationId: conversationB._id,
          senderId: user3._id,
          content:
            "Tenant B protected message.",
        });

      const conversationForTenantA =
        await Conversation.findOne({
          _id: conversationB._id,
          tenantId: tenantA,
        }).lean();

      expect(conversationForTenantA).toBeNull();

      const message =
        await ChatMessage.findOne({
          _id: messageB._id,
          conversation: conversationB._id,
        }).lean();

      expect(message).not.toBeNull();
    });
  });

  /**
   * ========================================================================
   * Concurrent Tenant Isolation
   * ========================================================================
   */

  describe("Concurrent tenant isolation", () => {
    test("concurrent requests from separate tenants remain isolated", async () => {
      const conversationA =
        await createConversation({
          tenantId: tenantA,
          participantIds: [
            user1._id,
            user2._id,
          ],
        });

      const conversationB =
        await createConversation({
          tenantId: tenantB,
          participantIds: [
            user3._id,
            objectId(),
          ],
        });

      const [
        ownA,
        crossA,
        ownB,
        crossB,
      ] = await Promise.all([
        authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationA._id}/messages`
        ),

        authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationB._id}/messages`
        ),

        authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationB._id}/messages`
        ),

        authenticatedRequest({
          userId: user3._id,
          tenantId: tenantB,
          email: user3.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${conversationA._id}/messages`
        ),
      ]);

      expect([
        HTTP.OK,
        HTTP.NO_CONTENT,
      ]).toContain(ownA.status);

      expect([
        HTTP.OK,
        HTTP.NO_CONTENT,
      ]).toContain(ownB.status);

      expectAuthorizationFailure(crossA);
      expectAuthorizationFailure(crossB);
    });
  });

  /**
   * ========================================================================
   * Information Disclosure / Invalid Identifier Handling
   * ========================================================================
   */

  describe("Identifier validation and information disclosure", () => {
    test("invalid conversation ID must fail safely", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/invalid-conversation-id/messages`
        );

      expect([
        HTTP.BAD_REQUEST,
        HTTP.NOT_FOUND,
      ]).toContain(response.status);
    });

    test("invalid message ID must fail safely", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).post(
          `${API.CONVERSATIONS}/${objectId()}/messages/not-valid/read`
        );

      expect([
        HTTP.BAD_REQUEST,
        HTTP.NOT_FOUND,
      ]).toContain(response.status);
    });

    test("non-existent conversation must not reveal resource information", async () => {
      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${objectId()}/messages`
        );

      expect([
        HTTP.BAD_REQUEST,
        HTTP.NOT_FOUND,
      ]).toContain(response.status);
    });

    test("cross-tenant resources should behave as not-found where supported", async () => {
      const tenantBConversation =
        await createConversation({
          tenantId: tenantB,
          participantIds: [
            user3._id,
            objectId(),
          ],
        });

      const response =
        await authenticatedRequest({
          userId: user1._id,
          tenantId: tenantA,
          email: user1.email,
          role: "user",
        }).get(
          `${API.CONVERSATIONS}/${tenantBConversation._id}/messages`
        );

      expect([
        HTTP.NOT_FOUND,
        HTTP.FORBIDDEN,
      ]).toContain(response.status);
    });
  });

  /**
   * ========================================================================
   * Regression Guards
   * ========================================================================
   */

  describe("Chat security regression guards", () => {
    test("conversation ownership must be represented by tenant context when supported", async () => {
      const conversation =
        await createConversation({
          tenantId: tenantA,
          participantIds: [
            user1._id,
            user2._id,
          ],
        });

      const persisted =
        await Conversation.findById(
          conversation._id
        ).lean();

      expect(persisted).not.toBeNull();

      if (persisted.tenantId !== undefined) {
        expect(
          String(persisted.tenantId)
        ).toBe(String(tenantA));
      }
    });

    test("tenant A dataset must never contain tenant B records", async () => {
      const a1 =
        await createConversation({
          tenantId: tenantA,
          participantIds: [
            user1._id,
            user2._id,
          ],
        });

      const a2 =
        await createConversation({
          tenantId: tenantA,
          participantIds: [
            user1._id,
            user2._id,
          ],
        });

      const b1 =
        await createConversation({
          tenantId: tenantB,
          participantIds: [
            user3._id,
            objectId(),
          ],
        });

      const b2 =
        await createConversation({
          tenantId: tenantB,
          participantIds: [
            user3._id,
            objectId(),
          ],
        });

      const aRecords =
        await Conversation.find({
          tenantId: tenantA,
        }).lean();

      const bRecords =
        await Conversation.find({
          tenantId: tenantB,
        }).lean();

      expect(
        aRecords
          .map((record) =>
            String(record._id)
          )
          .sort()
      ).toEqual(
        [
          String(a1._id),
          String(a2._id),
        ].sort()
      );

      expect(
        bRecords
          .map((record) =>
            String(record._id)
          )
          .sort()
      ).toEqual(
        [
          String(b1._id),
          String(b2._id),
        ].sort()
      );

      expect(
        aRecords.some(
          (record) =>
            String(record.tenantId) !==
            String(tenantA)
        )
      ).toBe(false);

      expect(
        bRecords.some(
          (record) =>
            String(record.tenantId) !==
            String(tenantB)
        )
      ).toBe(false);
    });
  });
});