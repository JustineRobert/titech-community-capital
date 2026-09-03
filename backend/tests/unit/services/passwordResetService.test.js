/**
 * =============================================================================
 * TITech Community Capital
 * =============================================================================
 *
 * File:
 *   backend/tests/unit/services/passwordResetService.test.js
 *
 * Purpose:
 *   Enterprise unit tests for PasswordResetService.
 *
 * Test Coverage:
 *   - Token generation
 *   - SHA-256 token hashing
 *   - Previous-token revocation
 *   - Email delivery
 *   - Email delivery failure
 *   - Password policy enforcement
 *   - Current-password reuse prevention
 *   - Atomic token consumption
 *   - MongoDB transaction behavior
 *   - User password update
 *   - Other-token revocation
 *   - Session invalidation
 *   - Invalid token handling
 *   - Invalid / expired token verification
 *   - Reset status
 *   - Cleanup
 *   - No plaintext token logging
 *
 * =============================================================================
 */

"use strict";

const mongoose = require("mongoose");
const crypto = require("crypto");
const bcrypt = require("bcrypt");

const PasswordResetService = require(
  "../../../services/passwordResetService"
);

const PasswordResetToken = require(
  "../../../models/PasswordResetToken"
);

const User = require(
  "../../../models/User"
);

const logger = require(
  "../../../utils/logger"
);

jest.mock(
  "../../../models/PasswordResetToken"
);

jest.mock(
  "../../../models/User"
);

jest.mock(
  "../../../utils/logger"
);

jest.mock(
  "bcrypt"
);

/**
 * =============================================================================
 * Helpers
 * =============================================================================
 */

/**
 * Create a Mongoose-like chainable query mock.
 */
function createQueryMock(resolvedValue) {
  const query = {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(
      resolvedValue
    ),
    then: undefined,
  };

  return query;
}

/**
 * Create a fake MongoDB session.
 */
function createMockSession() {
  const session = {
    withTransaction: jest.fn(
      async (callback) => {
        await callback();
      }
    ),

    endSession: jest
      .fn()
      .mockResolvedValue(undefined),
  };

  return session;
}

/**
 * Generate a valid 64-character SHA-256 hash.
 */
function createValidTokenHash(
  token = "valid-reset-token"
) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

/**
 * =============================================================================
 * Test Suite
 * =============================================================================
 */

describe(
  "PasswordResetService",
  () => {
    let service;
    let mockUser;
    let mockSession;
    let mockEmailService;
    let mockSessionService;

    beforeEach(() => {
      jest.clearAllMocks();
      process.env.FRONTEND_URL = "http://localhost:5173";

      mockUser = {
        _id: new mongoose.Types.ObjectId(),
        email: "test@example.com",
        name: "Test User",
        password: "$2a$12$existing-hash",
        tenantId:
          new mongoose.Types.ObjectId(),
        emailVerified: true,
      };

      mockSession =
        createMockSession();

      mockEmailService = {
        sendPasswordReset:
          jest.fn().mockResolvedValue(
            undefined
          ),
      };

      mockSessionService = {
        invalidateUserSessions:
          jest.fn().mockResolvedValue(
            undefined
          ),
      };

      service =
        new PasswordResetService({
          emailService:
            mockEmailService,
          sessionService:
            mockSessionService,
        });

      /**
       * Mock bcrypt behavior.
       */
      bcrypt.hash = jest
        .fn()
        .mockResolvedValue(
          "$2b$12$new-password-hash"
        );

      bcrypt.compare = jest
        .fn()
        .mockResolvedValue(false);

      /**
       * Mock MongoDB session.
       */
      jest
        .spyOn(mongoose, "startSession")
        .mockResolvedValue(
          mockSession
        );

      /**
       * Default active-token revocation.
       */
      PasswordResetToken.revokeActiveForUser =
        jest
          .fn()
          .mockResolvedValue({
            modifiedCount: 1,
          });

      /**
       * Default token creation.
       */
      PasswordResetToken.create =
        jest
          .fn()
          .mockResolvedValue({
            _id: new mongoose.Types.ObjectId(),
            user: mockUser._id,
            tokenHash:
              createValidTokenHash(),
            expiresAt:
              new Date(
                Date.now() +
                  60 * 60 * 1000
              ),
          });

      /**
       * Default user lookup chain.
       */
      User.findById =
        jest
          .fn()
          .mockReturnValue(
            createQueryMock(
              mockUser
            )
          );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /**
     * ========================================================================
     * createResetToken
     * ========================================================================
     */

    describe(
      "createResetToken",
      () => {
        it(
          "should create a cryptographically secure reset token",
          async () => {
            const result =
              await service.createResetToken(
                mockUser
              );

            expect(result).toBeDefined();

            expect(result.success).toBe(
              true
            );

            expect(result.token).toEqual(
              expect.any(String)
            );

            expect(
              result.token
            ).toHaveLength(64);

            expect(
              result.tokenId
            ).toBeDefined();

            expect(
              result.expiresAt
            ).toBeInstanceOf(Date);
          }
        );

        it(
          "should persist only the SHA-256 token hash",
          async () => {
            const result =
              await service.createResetToken(
                mockUser
              );

            const createCall =
              PasswordResetToken.create.mock
                .calls[0][0];

            expect(
              createCall.tokenHash
            ).toBeDefined();

            expect(
              createCall.tokenHash
            ).toHaveLength(64);

            expect(
              createCall.tokenHash
            ).toMatch(
              /^[a-f0-9]{64}$/
            );

            expect(
              createCall.tokenHash
            ).not.toBe(
              result.token
            );

            expect(
              JSON.stringify(createCall)
            ).not.toContain(
              result.token
            );
          }
        );

        it(
          "should revoke existing active reset tokens before creating a new token",
          async () => {
            await service.createResetToken(
              mockUser
            );

            expect(
              PasswordResetToken.revokeActiveForUser
            ).toHaveBeenCalledWith(
              mockUser._id,
              "superseded_by_new_request",
              expect.objectContaining({
                tenantId:
                  mockUser.tenantId,
              })
            );
          }
        );

        it(
          "should create token with tenant and audit context",
          async () => {
            await service.createResetToken(
              mockUser,
              {
                tenantId:
                  mockUser.tenantId,
                requestIp:
                  "127.0.0.1",
                userAgent:
                  "Jest-Test-Agent",
                requestId:
                  "req-test-001",
              }
            );

            expect(
              PasswordResetToken.create
            ).toHaveBeenCalledWith(
              expect.objectContaining({
                user:
                  mockUser._id,
                tenantId:
                  mockUser.tenantId,
                requestIp:
                  "127.0.0.1",
                userAgent:
                  "Jest-Test-Agent",
                requestId:
                  "req-test-001",
              })
            );
          }
        );

        it(
          "should send the plaintext token only through the email service",
          async () => {
            const result =
              await service.createResetToken(
                mockUser
              );

            expect(
              mockEmailService
                .sendPasswordReset
            ).toHaveBeenCalledWith(
              mockUser.email,
              expect.objectContaining({
                userId:
                  mockUser._id,
                token:
                  result.token,
                frontendResetUrl:
                  expect.stringContaining(
                    result.token
                  ),
              })
            );
          }
        );

        it(
          "should never log the plaintext reset token",
          async () => {
            const result =
              await service.createResetToken(
                mockUser
              );

            const loggerCalls =
              [
                ...logger.info.mock.calls,
                ...logger.warn.mock.calls,
                ...logger.error.mock.calls,
              ];

            const serializedLogs =
              JSON.stringify(
                loggerCalls
              );

            expect(
              serializedLogs
            ).not.toContain(
              result.token
            );
          }
        );

        it(
          "should revoke the token if email delivery fails",
          async () => {
            mockEmailService
              .sendPasswordReset
              .mockRejectedValueOnce(
                new Error(
                  "Email provider unavailable"
                )
              );

            await expect(
              service.createResetToken(
                mockUser
              )
            ).rejects.toThrow(
              "Email provider unavailable"
            );

            expect(
              PasswordResetToken
                .findOneAndUpdate
            ).toHaveBeenCalledWith(
              expect.objectContaining({
                _id: expect.anything(),
                used: false,
                revoked: false,
              }),
              expect.objectContaining({
                $set:
                  expect.objectContaining({
                    revoked: true,
                    revocationReason:
                      "delivery_failed",
                  }),
              })
            );
          }
        );

        it(
          "should reject reset requests for already verified users only when the user object says so",
          async () => {
            const verifiedUser = {
              ...mockUser,
              emailVerified:
                undefined,
            };

            await expect(
              service.createResetToken(
                verifiedUser
              )
            ).resolves.toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * resetPassword
     * ========================================================================
     */

    describe(
      "resetPassword",
      () => {
        beforeEach(() => {
          /**
           * User lookup required by the enhanced service.
           */
          User.findById =
            jest
              .fn()
              .mockReturnValue(
                createQueryMock(
                  mockUser
                )
              );

          /**
           * Atomic token consumption.
           */
          PasswordResetToken
            .consumeAtomically =
            jest
              .fn()
              .mockResolvedValue({
                _id:
                  new mongoose.Types.ObjectId(),
                user:
                  mockUser._id,
                expiresAt:
                  new Date(
                    Date.now() +
                      60 * 60 * 1000
                  ),
                used: true,
                usedAt:
                  new Date(),
              });

          /**
           * User password update.
           */
          User.findOneAndUpdate =
            jest
              .fn()
              .mockReturnValue(
                createQueryMock({
                  _id:
                    mockUser._id,
                  email:
                    mockUser.email,
                  tenantId:
                    mockUser.tenantId,
                })
              );
        });

        it(
          "should reset the password successfully",
          async () => {
            const result =
              await service.resetPassword(
                mockUser._id,
                "a".repeat(64),
                "StrongPassword123!@#"
              );

            expect(
              result.success
            ).toBe(true);

            expect(
              PasswordResetToken
                .consumeAtomically
            ).toHaveBeenCalled();

            expect(
              User.findOneAndUpdate
            ).toHaveBeenCalled();

            expect(
              bcrypt.hash
            ).toHaveBeenCalledWith(
              "StrongPassword123!@#",
              12
            );

            expect(
              mockSessionService
                .invalidateUserSessions
            ).toHaveBeenCalledWith(
              mockUser._id
            );
          }
        );

        it(
          "should execute the reset flow inside a MongoDB transaction",
          async () => {
            await service.resetPassword(
              mockUser._id,
              "a".repeat(64),
              "StrongPassword123!@#"
            );

            expect(
              mongoose.startSession
            ).toHaveBeenCalled();

            expect(
              mockSession.withTransaction
            ).toHaveBeenCalled();

            expect(
              mockSession.endSession
            ).toHaveBeenCalled();
          }
        );

        it(
          "should consume the token atomically",
          async () => {
            const token =
              "a".repeat(64);

            await service.resetPassword(
              mockUser._id,
              token,
              "StrongPassword123!@#"
            );

            expect(
              PasswordResetToken
                .consumeAtomically
            ).toHaveBeenCalledWith(
              createValidTokenHash(token),
              expect.objectContaining({
                userId:
                  mockUser._id,
                tenantId:
                  mockUser.tenantId,
                session:
                  mockSession,
              })
            );
          }
        );

        it(
          "should update the password inside the same transaction",
          async () => {
            await service.resetPassword(
              mockUser._id,
              "a".repeat(64),
              "StrongPassword123!@#"
            );

            expect(
              User.findOneAndUpdate
            ).toHaveBeenCalledWith(
              {
                _id:
                  mockUser._id,
              },
              {
                $set:
                  expect.objectContaining({
                    password:
                      "$2b$12$new-password-hash",
                    passwordResetAt:
                      expect.any(Date),
                    passwordResetAttempts:
                      0,
                  }),
              },
              expect.objectContaining({
                session:
                  mockSession,
                new: true,
                runValidators: true,
              })
            );
          }
        );

        it(
          "should revoke remaining active reset tokens after successful password change",
          async () => {
            await service.resetPassword(
              mockUser._id,
              "a".repeat(64),
              "StrongPassword123!@#"
            );

            expect(
              PasswordResetToken
                .revokeActiveForUser
            ).toHaveBeenCalledWith(
              mockUser._id,
              "password_successfully_changed",
              expect.objectContaining({
                tenantId:
                  mockUser.tenantId,
                session:
                  mockSession,
              })
            );
          }
        );

        it(
          "should reject weak passwords before consuming the token",
          async () => {
            await expect(
              service.resetPassword(
                mockUser._id,
                "a".repeat(64),
                "weak"
              )
            ).rejects.toThrow();

            expect(
              PasswordResetToken
                .consumeAtomically
            ).not.toHaveBeenCalled();

            expect(
              User.findOneAndUpdate
            ).not.toHaveBeenCalled();
          }
        );

        it(
          "should reject password reuse",
          async () => {
            bcrypt.compare =
              jest
                .fn()
                .mockResolvedValue(
                  true
                );

            await expect(
              service.resetPassword(
                mockUser._id,
                "a".repeat(64),
                "StrongPassword123!@#"
              )
            ).rejects.toThrow(
              "different from the current password"
            );

            expect(
              PasswordResetToken
                .consumeAtomically
            ).not.toHaveBeenCalled();
          }
        );

        it(
          "should reject an invalid reset token",
          async () => {
            PasswordResetToken
              .consumeAtomically
              .mockResolvedValueOnce(
                null
              );

            await expect(
              service.resetPassword(
                mockUser._id,
                "a".repeat(64),
                "StrongPassword123!@#"
              )
            ).rejects.toThrow(
              "Invalid or expired password reset token"
            );

            expect(
              User.findOneAndUpdate
            ).not.toHaveBeenCalled();
          }
        );

        it(
          "should not expose the submitted token in logs",
          async () => {
            const token =
              "a".repeat(64);

            await service.resetPassword(
              mockUser._id,
              token,
              "StrongPassword123!@#"
            );

            const loggerCalls =
              [
                ...logger.info.mock.calls,
                ...logger.warn.mock.calls,
                ...logger.error.mock.calls,
              ];

            expect(
              JSON.stringify(
                loggerCalls
              )
            ).not.toContain(
              token
            );
          }
        );

        it(
          "should continue successfully when session invalidation fails",
          async () => {
            mockSessionService
              .invalidateUserSessions
              .mockRejectedValueOnce(
                new Error(
                  "Session service unavailable"
                )
              );

            const result =
              await service.resetPassword(
                mockUser._id,
                "a".repeat(64),
                "StrongPassword123!@#"
              );

            expect(
              result.success
            ).toBe(true);

            expect(
              logger.error
            ).toHaveBeenCalledWith(
              "[PasswordResetService] Session invalidation failed after password reset",
              expect.objectContaining({
                userId:
                  mockUser._id,
              })
            );
          }
        );
      }
    );

    /**
     * ========================================================================
     * verifyResetToken
     * ========================================================================
     */

    describe(
      "verifyResetToken",
      () => {
        it(
          "should return valid for an active token",
          async () => {
            const expiresAt =
              new Date(
                Date.now() +
                  30 * 60 * 1000
              );

            PasswordResetToken
              .findActiveByHash =
              jest
                .fn()
                .mockResolvedValue({
                  _id:
                    new mongoose.Types.ObjectId(),
                  expiresAt,
                  used: false,
                  revoked: false,
                  isDeleted: false,
                });

            const result =
              await service.verifyResetToken(
                mockUser._id,
                "a".repeat(64)
              );

            expect(
              result.valid
            ).toBe(true);

            expect(
              result.expiresAt
            ).toEqual(expiresAt);

            expect(
              result.remainingMinutes
            ).toBeGreaterThan(0);
          }
        );

        it(
          "should return invalid when token does not exist",
          async () => {
            PasswordResetToken
              .findActiveByHash =
              jest
                .fn()
                .mockResolvedValue(
                  null
                );

            const result =
              await service.verifyResetToken(
                mockUser._id,
                "a".repeat(64)
              );

            expect(
              result.valid
            ).toBe(false);
          }
        );

        it(
          "should reject malformed tokens without querying the database",
          async () => {
            const result =
              await service.verifyResetToken(
                mockUser._id,
                "invalid"
              );

            expect(
              result.valid
            ).toBe(false);

            expect(
              PasswordResetToken
                .findActiveByHash
            ).not.toHaveBeenCalled();
          }
        );

        it(
          "should return invalid for malformed user IDs",
          async () => {
            const result =
              await service.verifyResetToken(
                "invalid-user-id",
                "a".repeat(64)
              );

            expect(
              result.valid
            ).toBe(false);
          }
        );
      }
    );

    /**
     * ========================================================================
     * getResetStatus
     * ========================================================================
     */

    describe(
      "getResetStatus",
      () => {
        it(
          "should report an active pending reset",
          async () => {
            const expiresAt =
              new Date(
                Date.now() +
                  30 * 60 * 1000
              );

            PasswordResetToken
              .findOne =
              jest
                .fn()
                .mockReturnValue(
                  {
                    sort:
                      jest
                        .fn()
                        .mockReturnValue(
                          Promise.resolve(
                            {
                              expiresAt,
                            }
                          )
                        ),
                  }
                );

            const result =
              await service.getResetStatus(
                mockUser._id
              );

            expect(
              result.hasPendingReset
            ).toBe(true);

            expect(
              result.expiresAt
            ).toEqual(expiresAt);
          }
        );

        it(
          "should report no pending reset when no active token exists",
          async () => {
            PasswordResetToken
              .findOne =
              jest
                .fn()
                .mockReturnValue(
                  {
                    sort:
                      jest
                        .fn()
                        .mockReturnValue(
                          Promise.resolve(
                            null
                          )
                        ),
                  }
                );

            const result =
              await service.getResetStatus(
                mockUser._id
              );

            expect(
              result.hasPendingReset
            ).toBe(false);

            expect(
              result.expiresAt
            ).toBeNull();
          }
        );

        it(
          "should reject invalid user IDs",
          async () => {
            await expect(
              service.getResetStatus(
                "bad-user-id"
              )
            ).rejects.toThrow(
              "Invalid user ID"
            );
          }
        );
      }
    );

    /**
     * ========================================================================
     * cleanupExpiredTokens
     * ========================================================================
     */

    describe(
      "cleanupExpiredTokens",
      () => {
        it(
          "should delete expired reset tokens",
          async () => {
            PasswordResetToken
              .deleteMany =
              jest
                .fn()
                .mockResolvedValue({
                  deletedCount: 7,
                });

            const result =
              await service.cleanupExpiredTokens();

            expect(
              result
            ).toBe(7);

            expect(
              PasswordResetToken
                .deleteMany
            ).toHaveBeenCalledWith(
              expect.objectContaining({
                expiresAt:
                  expect.objectContaining({
                    $lte:
                      expect.any(Date),
                  }),
              })
            );
          }
        );
      }
    );

    /**
     * ========================================================================
     * Password Validator
     * ========================================================================
     */

    describe(
      "validatePasswordEnterprise",
      () => {
        it(
          "should expose strong password validation through the service module",
          async () => {
            const {
              validatePasswordEnterprise,
            } =
              require(
                "../../../services/passwordResetService"
              );

            /**
             * zxcvbn is intentionally not mocked here.
             *
             * This test uses a deliberately strong password.
             */
            const result =
              validatePasswordEnterprise(
                "A-Very-Strong-Password!9472",
                {
                  email:
                    mockUser.email,
                  name:
                    mockUser.name,
                }
              );

            expect(
              result
            ).toHaveProperty(
              "valid"
            );

            expect(
              result
            ).toHaveProperty(
              "score"
            );

            expect(
              result
            ).toHaveProperty(
              "rules"
            );
          }
        );
      }
    );
  }
);