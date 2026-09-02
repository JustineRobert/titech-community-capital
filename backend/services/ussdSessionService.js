// ============================================================================
// TITech Community Capital
// File: backend/services/ussdSessionService.js
// Production Grade USSD Session Service
// Multi-Tenant | Distributed Cache | Redis Ready | Enterprise Ready
// ============================================================================

"use strict";

const crypto = require("crypto");
const EventEmitter = require("events");

const logger = require("../utils/logger");

let redisClient = null;

try {
  redisClient = require("../config/redis");
} catch (err) {
  // Redis optional for local development
}

class USSDSessionService extends EventEmitter {
  constructor() {
    super();

    /**
     * Fallback in-memory stores.
     * Used during development or when Redis is unavailable.
     */
    this.sessions = new Map();
    this.responses = new Map();
    this.locks = new Map();

    /**
     * Default TTLs
     */
    this.sessionTTL =
      Number(
        process.env.USSD_SESSION_TTL_SECONDS
      ) || 300;

    this.responseTTL =
      Number(
        process.env.USSD_RESPONSE_TTL_SECONDS
      ) || 600;

    this.cleanupInterval =
      Number(
        process.env.USSD_CLEANUP_INTERVAL_MS
      ) || 60000;

    this.startCleanupWorker();
  }

  // ===========================================================================
  // Keys
  // ===========================================================================

  sessionKey(sessionId) {
    return `ussd:session:${sessionId}`;
  }

  responseKey(idempotencyKey) {
    return `ussd:response:${idempotencyKey}`;
  }

  lockKey(sessionId) {
    return `ussd:lock:${sessionId}`;
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  async createSession(data) {
    const session = {
      id:
        data.id ||
        crypto.randomUUID(),

      sessionId:
        data.sessionId,

      tenantId:
        data.tenantId,

      phoneNumber:
        data.phoneNumber,

      serviceCode:
        data.serviceCode || null,

      currentMenu:
        data.currentMenu ||
        "MAIN",

      metadata:
        data.metadata || {},

      state:
        data.state || {},

      createdAt:
        data.createdAt ||
        new Date(),

      updatedAt:
        new Date(),

      expiresAt:
        new Date(
          Date.now() +
            this.sessionTTL * 1000
        ),
    };

    await this.saveSession(session);

    this.emit(
      "session.created",
      session
    );

    return session;
  }

  async saveSession(session) {
    session.updatedAt =
      new Date();

    session.expiresAt =
      new Date(
        Date.now() +
          this.sessionTTL * 1000
      );

    if (redisClient) {
      await redisClient.set(
        this.sessionKey(
          session.sessionId
        ),
        JSON.stringify(session),
        "EX",
        this.sessionTTL
      );

      return session;
    }

    this.sessions.set(
      session.sessionId,
      session
    );

    return session;
  }

  async updateSession(
    sessionId,
    updates
  ) {
    const existing =
      await this.findSession(
        sessionId
      );

    if (!existing) {
      return null;
    }

    const updated = {
      ...existing,
      ...updates,
      updatedAt:
        new Date(),
      expiresAt:
        new Date(
          Date.now() +
            this.sessionTTL * 1000
        ),
    };

    await this.saveSession(
      updated
    );

    this.emit(
      "session.updated",
      updated
    );

    return updated;
  }

  async findSession(sessionId) {
    if (!sessionId) {
      return null;
    }

    if (redisClient) {
      const value =
        await redisClient.get(
          this.sessionKey(
            sessionId
          )
        );

      return value
        ? JSON.parse(value)
        : null;
    }

    const session =
      this.sessions.get(
        sessionId
      );

    if (!session) {
      return null;
    }

    if (
      new Date(
        session.expiresAt
      ) < new Date()
    ) {
      this.sessions.delete(
        sessionId
      );

      return null;
    }

    return session;
  }

  async getSession(sessionId) {
    return this.findSession(
      sessionId
    );
  }

  async sessionExists(
    sessionId
  ) {
    const session =
      await this.findSession(
        sessionId
      );

    return !!session;
  }

  async endSession(sessionId) {
    if (!sessionId) {
      return;
    }

    if (redisClient) {
      await redisClient.del(
        this.sessionKey(
          sessionId
        )
      );

      return;
    }

    this.sessions.delete(
      sessionId
    );

    this.locks.delete(
      sessionId
    );

    this.emit(
      "session.ended",
      sessionId
    );
  }

  async destroySession(
    sessionId
  ) {
    return this.endSession(
      sessionId
    );
  }

  // ===========================================================================
  // Session State
  // ===========================================================================

  async getState(
    sessionId
  ) {
    const session =
      await this.findSession(
        sessionId
      );

    return (
      session?.state || {}
    );
  }

  async setState(
    sessionId,
    state
  ) {
    const session =
      await this.findSession(
        sessionId
      );

    if (!session) {
      return null;
    }

    session.state = {
      ...session.state,
      ...state,
    };

    return this.saveSession(
      session
    );
  }

  async clearState(
    sessionId
  ) {
    const session =
      await this.findSession(
        sessionId
      );

    if (!session) {
      return null;
    }

    session.state = {};

    return this.saveSession(
      session
    );
  }

  // ===========================================================================
  // Idempotency Response Storage
  // ===========================================================================

  async saveResponse(
    idempotencyKey,
    response
  ) {
    const payload = {
      response,
      createdAt:
        new Date(),
      expiresAt:
        new Date(
          Date.now() +
            this.responseTTL * 1000
        ),
    };

    if (redisClient) {
      await redisClient.set(
        this.responseKey(
          idempotencyKey
        ),
        JSON.stringify(payload),
        "EX",
        this.responseTTL
      );

      return;
    }

    this.responses.set(
      idempotencyKey,
      payload
    );
  }

  async getResponse(
    idempotencyKey
  ) {
    if (redisClient) {
      const value =
        await redisClient.get(
          this.responseKey(
            idempotencyKey
          )
        );

      if (!value) {
        return null;
      }

      return JSON.parse(value)
        .response;
    }

    const data =
      this.responses.get(
        idempotencyKey
      );

    if (!data) {
      return null;
    }

    if (
      new Date(
        data.expiresAt
      ) < new Date()
    ) {
      this.responses.delete(
        idempotencyKey
      );

      return null;
    }

    return data.response;
  }

  // ===========================================================================
  // Distributed Locking
  // ===========================================================================

  async acquireLock(
    sessionId
  ) {
    if (redisClient) {
      const result =
        await redisClient.set(
          this.lockKey(
            sessionId
          ),
          "1",
          "NX",
          "EX",
          30
        );

      return result === "OK";
    }

    if (
      this.locks.has(
        sessionId
      )
    ) {
      return false;
    }

    this.locks.set(
      sessionId,
      true
    );

    return true;
  }

  async releaseLock(
    sessionId
  ) {
    if (redisClient) {
      await redisClient.del(
        this.lockKey(
          sessionId
        )
      );

      return;
    }

    this.locks.delete(
      sessionId
    );
  }

  // ===========================================================================
  // Session Touch
  // ===========================================================================

  async touch(
    sessionId
  ) {
    const session =
      await this.findSession(
        sessionId
      );

    if (!session) {
      return null;
    }

    session.updatedAt =
      new Date();

    session.expiresAt =
      new Date(
        Date.now() +
          this.sessionTTL * 1000
      );

    return this.saveSession(
      session
    );
  }

  // ===========================================================================
  // Diagnostics
  // ===========================================================================

  async getStats() {
    return {
      sessions:
        this.sessions.size,
      responses:
        this.responses.size,
      locks:
        this.locks.size,
      sessionTTL:
        this.sessionTTL,
      responseTTL:
        this.responseTTL,
      usingRedis:
        !!redisClient,
    };
  }

  // ===========================================================================
  // Cleanup Worker
  // ===========================================================================

  startCleanupWorker() {
    if (redisClient) {
      return;
    }

    setInterval(() => {
      try {
        const now =
          new Date();

        for (const [
          key,
          value,
        ] of this.sessions) {
          if (
            new Date(
              value.expiresAt
            ) < now
          ) {
            this.sessions.delete(
              key
            );
          }
        }

        for (const [
          key,
          value,
        ] of this.responses) {
          if (
            new Date(
              value.expiresAt
            ) < now
          ) {
            this.responses.delete(
              key
            );
          }
        }
      } catch (error) {
        logger.error(
          "USSD cleanup worker failed",
          {
            error:
              error.message,
          }
        );
      }
    }, this.cleanupInterval);
  }

  // ===========================================================================
  // Graceful Shutdown
  // ===========================================================================

  async shutdown() {
    try {
      this.sessions.clear();
      this.responses.clear();
      this.locks.clear();

      logger.info(
        "USSD Session Service shutdown complete."
      );
    } catch (error) {
      logger.error(
        "USSD Session Service shutdown failed",
        {
          error:
            error.message,
          stack:
            error.stack,
        }
      );
    }
  }
}

module.exports =
  new USSDSessionService();