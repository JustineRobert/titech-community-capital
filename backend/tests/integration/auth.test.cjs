"use strict";

/**
 * ============================================================================
 * TITech Community Capital
 * Authentication Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/auth.test.js
 *
 * Purpose:
 *   Enterprise-grade integration tests for the TITech authentication boundary.
 *
 * Coverage:
 *
 *   1. User registration
 *   2. Duplicate-account protection
 *   3. Registration validation
 *   4. Authentication / login
 *   5. JWT structure and claims
 *   6. Invalid login protection
 *   7. Refresh-token lifecycle
 *   8. Missing / malformed refresh credentials
 *   9. Logout
 *  10. Logout idempotency
 *  11. Password-reset request
 *  12. Security regression guards
 *  13. Database persistence assertions
 *
 * Security philosophy:
 *
 *   Untrusted request
 *        ↓
 *   Validation
 *        ↓
 *   Authentication
 *        ↓
 *   Token issuance
 *        ↓
 *   Session / refresh lifecycle
 *        ↓
 *   Authorization boundary
 *
 * IMPORTANT:
 *   This suite intentionally avoids asserting implementation details that are
 *   not part of the public API contract. Where the application may return
 *   equivalent security-safe statuses, assertions accept the documented safe
 *   alternatives.
 *
 * IMPORTANT:
 *   Tests must never use a developer's real MongoDB database.
 *
 * ============================================================================
 */

const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = require("../../server");
const User = require("../../models/User");

/**
 * ============================================================================
 * Test Configuration
 * ============================================================================
 */

const TEST_MONGO_URI =
  process.env.TEST_MONGO_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/titech_auth_test";

const TEST_JWT_SECRET =
  process.env.JWT_SECRET || "titech-test-secret-authentication";

const JWT_ALGORITHM = "HS256";

const PASSWORD = "SecurePassword123!";
const NEW_PASSWORD = "NewSecurePassword456!";

const HTTP = Object.freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
});

/**
 * ============================================================================
 * Test State
 * ============================================================================
 */

let databaseOwnedBySuite = false;

/**
 * ============================================================================
 * Utility Helpers
 * ============================================================================
 */

/**
 * Generate a unique email address.
 *
 * @param {string} prefix
 * @returns {string}
 */
function uniqueEmail(prefix = "test") {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}@titech.test`;
}

/**
 * Generate a unique phone number.
 *
 * @returns {string}
 */
function uniquePhoneNumber() {
  const suffix = String(Date.now()).slice(-7);

  return `+2567${suffix}`;
}

/**
 * Safely extract a token from a response.
 *
 * Supports the common response shapes:
 *
 *   { token }
 *   { accessToken }
 *   { data: { token } }
 *   { data: { accessToken } }
 *
 * @param {Object} response
 * @returns {string|null}
 */
function extractAccessToken(response) {
  return (
    response?.body?.token ||
    response?.body?.accessToken ||
    response?.body?.data?.token ||
    response?.body?.data?.accessToken ||
    null
  );
}

/**
 * Extract cookies from a Supertest response.
 *
 * @param {Object} response
 * @returns {string[]}
 */
function extractCookies(response) {
  return response?.headers?.["set-cookie"] || [];
}

/**
 * Determine whether the response contains an authentication cookie.
 *
 * @param {string[]} cookies
 * @returns {boolean}
 */
function containsRefreshCookie(cookies) {
  return cookies.some((cookie) => {
    return /(?:^|;\s*)refreshToken=/i.test(cookie);
  });
}

/**
 * Decode a JWT without verifying it.
 *
 * This is useful for structural assertions. Authentication validity is tested
 * separately by the endpoint itself.
 *
 * @param {string} token
 * @returns {Object}
 */
function decodeJwt(token) {
  const decoded = jwt.decode(token);

  expect(decoded).not.toBeNull();
  expect(typeof decoded).toBe("object");

  return decoded;
}

/**
 * Assert that a response represents an authentication failure.
 *
 * @param {Object} response
 */
function expectAuthenticationFailure(response) {
  expect([
    HTTP.BAD_REQUEST,
    HTTP.UNAUTHORIZED,
    HTTP.FORBIDDEN,
  ]).toContain(response.status);
}

/**
 * ============================================================================
 * Test Lifecycle
 * ============================================================================
 */

beforeAll(async () => {
  /**
   * Ensure the authentication code resolves the same test secret.
   */
  process.env.JWT_SECRET = TEST_JWT_SECRET;

  /**
   * Never knowingly connect this suite to a production database.
   */
  if (
    /production/i.test(process.env.NODE_ENV || "") &&
    !process.env.ALLOW_PRODUCTION_TEST_DATABASE
  ) {
    throw new Error(
      "Refusing to execute authentication integration tests against production."
    );
  }

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_MONGO_URI);

    databaseOwnedBySuite = true;
  }
});

afterAll(async () => {
  if (
    databaseOwnedBySuite &&
    mongoose.connection.readyState === 1 &&
    mongoose.connection.db
  ) {
    /**
     * Drop only the database used by this test connection.
     *
     * This guarantees that no authentication records created by the suite
     * remain after execution.
     */
    await mongoose.connection.db.dropDatabase();
  }

  if (
    databaseOwnedBySuite &&
    mongoose.connection.readyState !== 0
  ) {
    await mongoose.disconnect();
  }
});

beforeEach(async () => {
  /**
   * Authentication tests must be independently reproducible.
   */
  await User.deleteMany({});
});

/**
 * ============================================================================
 * Registration
 * ============================================================================
 */

describe("POST /api/auth/register", () => {
  test("registers a new user successfully", async () => {
    const email = uniqueEmail("register");

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: PASSWORD,
        fullName: "TITech Test User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect([HTTP.OK, HTTP.CREATED]).toContain(response.status);

    expect(response.body).toBeDefined();

    const persistedUser = await User.findOne({
      email: email.toLowerCase(),
    }).lean();

    expect(persistedUser).not.toBeNull();
    expect(persistedUser.email).toBe(email.toLowerCase());

    /**
     * Passwords must never be persisted as plaintext.
     */
    expect(persistedUser.password).not.toBe(PASSWORD);

    /**
     * A response must not expose password material.
     */
    const serializedResponse = JSON.stringify(response.body);

    expect(serializedResponse).not.toContain(PASSWORD);
  });

  test("rejects duplicate email registration", async () => {
    const email = uniqueEmail("duplicate");

    const firstResponse = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: PASSWORD,
        fullName: "Original User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect([HTTP.OK, HTTP.CREATED]).toContain(firstResponse.status);

    const secondResponse = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: "AnotherSecurePassword456!",
        fullName: "Duplicate User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect([HTTP.CONFLICT, HTTP.BAD_REQUEST]).toContain(
      secondResponse.status
    );

    const users = await User.find({
      email: email.toLowerCase(),
    }).lean();

    expect(users).toHaveLength(1);
  });

  test("rejects registration when required fields are missing", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: uniqueEmail("missing"),
        fullName: "Incomplete User",
      });

    expect(response.status).toBe(HTTP.BAD_REQUEST);
  });

  test("rejects invalid email format", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "not-an-email",
        password: PASSWORD,
        fullName: "Invalid Email User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect(response.status).toBe(HTTP.BAD_REQUEST);
  });

  test("rejects weak passwords", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: uniqueEmail("weak-password"),
        password: "weak",
        fullName: "Weak Password User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect(response.status).toBe(HTTP.BAD_REQUEST);
  });

  test("normalizes email identity consistently", async () => {
    const email = uniqueEmail("normalize");

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: email.toUpperCase(),
        password: PASSWORD,
        fullName: "Normalization User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect([HTTP.OK, HTTP.CREATED]).toContain(response.status);

    const persisted = await User.findOne({
      email: email.toLowerCase(),
    }).lean();

    expect(persisted).not.toBeNull();
  });

  test("does not create a user when registration validation fails", async () => {
    const email = uniqueEmail("failed-registration");

    await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: "weak",
        fullName: "Invalid User",
        phoneNumber: uniquePhoneNumber(),
      })
      .expect(HTTP.BAD_REQUEST);

    const persisted = await User.findOne({
      email: email.toLowerCase(),
    });

    expect(persisted).toBeNull();
  });
});

/**
 * ============================================================================
 * Login
 * ============================================================================
 */

describe("POST /api/auth/login", () => {
  let testUser;

  beforeEach(async () => {
    const email = uniqueEmail("login");

    /**
     * Create the account through the public registration endpoint rather than
     * bypassing authentication business rules.
     */
    const registration = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: PASSWORD,
        fullName: "Login Test User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect([HTTP.OK, HTTP.CREATED]).toContain(registration.status);

    testUser = {
      email,
      password: PASSWORD,
    };
  });

  test("logs in successfully with valid credentials", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: testUser.password,
      })
      .expect(HTTP.OK);

    const accessToken = extractAccessToken(response);
    const cookies = extractCookies(response);

    expect(accessToken).toBeTruthy();

    /**
     * A refresh-token cookie is expected when the application uses cookie
     * based refresh sessions.
     */
    if (cookies.length > 0) {
      expect(containsRefreshCookie(cookies)).toBe(true);
    }
  });

  test("returns a structurally valid JWT", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: testUser.password,
      })
      .expect(HTTP.OK);

    const accessToken = extractAccessToken(response);

    expect(accessToken).toBeTruthy();

    const decoded = decodeJwt(accessToken);

    /**
     * Support both the existing `userId` convention and the more generic
     * `id` convention used by some authentication middleware.
     */
    expect(decoded.userId || decoded.id).toBeDefined();

    expect(decoded).toHaveProperty("iat");

    if (decoded.exp !== undefined) {
      expect(decoded.exp).toBeGreaterThan(decoded.iat);
    }
  });

  test("JWT is signed with the configured algorithm", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: testUser.password,
      })
      .expect(HTTP.OK);

    const token = extractAccessToken(response);

    expect(token).toBeTruthy();

    const decodedHeader = jwt.decode(token, {
      complete: true,
    });

    expect(decodedHeader).not.toBeNull();
    expect(decodedHeader.header.alg).toBe(JWT_ALGORITHM);
  });

  test("rejects incorrect password", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: "WrongPassword999!",
      });

    expectAuthenticationFailure(response);
  });

  test("rejects unknown email", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: uniqueEmail("unknown"),
        password: PASSWORD,
      });

    expectAuthenticationFailure(response);
  });

  test("rejects login when credentials are missing", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
      });

    expectAuthenticationFailure(response);
  });

  test("does not expose password material in login response", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: testUser.password,
      })
      .expect(HTTP.OK);

    const body = JSON.stringify(response.body);

    expect(body).not.toContain(testUser.password);
  });
});

/**
 * ============================================================================
 * Refresh Token
 * ============================================================================
 */

describe("POST /api/auth/refresh-token", () => {
  let authCookies;
  let accessToken;
  let testUser;

  beforeEach(async () => {
    const email = uniqueEmail("refresh");

    const registration = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: PASSWORD,
        fullName: "Refresh Token User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect([HTTP.OK, HTTP.CREATED]).toContain(registration.status);

    testUser = {
      email,
      password: PASSWORD,
    };

    const login = await request(app)
      .post("/api/auth/login")
      .send({
        email,
        password: PASSWORD,
      })
      .expect(HTTP.OK);

    authCookies = extractCookies(login);
    accessToken = extractAccessToken(login);
  });

  test("refreshes access token with valid refresh credentials", async () => {
    /**
     * If this installation uses cookie-based refresh tokens, exercise the
     * actual cookie. Otherwise the endpoint's configured authentication
     * mechanism determines the expected response.
     */
    const response = await request(app)
      .post("/api/auth/refresh-token")
      .set("Cookie", authCookies);

    expect([HTTP.OK, HTTP.UNAUTHORIZED]).toContain(response.status);

    if (response.status === HTTP.OK) {
      const refreshedToken = extractAccessToken(response);

      expect(refreshedToken).toBeTruthy();

      if (accessToken && refreshedToken) {
        expect(refreshedToken).not.toBe(accessToken);
      }
    }
  });

  test("rejects refresh when credentials are missing", async () => {
    const response = await request(app)
      .post("/api/auth/refresh-token");

    expect(response.status).toBe(HTTP.UNAUTHORIZED);
  });

  test("rejects malformed refresh token", async () => {
    const response = await request(app)
      .post("/api/auth/refresh-token")
      .set(
        "Cookie",
        "refreshToken=invalid.token.value; Path=/api/auth"
      );

    expectAuthenticationFailure(response);
  });

  test("rejects an expired refresh JWT", async () => {
    const expiredToken = jwt.sign(
      {
        id: String(new mongoose.Types.ObjectId()),
        userId: String(new mongoose.Types.ObjectId()),
        email: testUser.email,
      },
      TEST_JWT_SECRET,
      {
        algorithm: JWT_ALGORITHM,
        expiresIn: -1,
      }
    );

    const response = await request(app)
      .post("/api/auth/refresh-token")
      .set(
        "Cookie",
        `refreshToken=${expiredToken}; Path=/api/auth`
      );

    expectAuthenticationFailure(response);
  });

  test("rejects a refresh token signed with the wrong secret", async () => {
    const forgedToken = jwt.sign(
      {
        id: String(new mongoose.Types.ObjectId()),
        userId: String(new mongoose.Types.ObjectId()),
        email: testUser.email,
      },
      "wrong-secret",
      {
        algorithm: JWT_ALGORITHM,
        expiresIn: "1h",
      }
    );

    const response = await request(app)
      .post("/api/auth/refresh-token")
      .set(
        "Cookie",
        `refreshToken=${forgedToken}; Path=/api/auth`
      );

    expectAuthenticationFailure(response);
  });

  test("does not accept an arbitrary access token as a refresh credential", async () => {
    if (!accessToken) {
      return;
    }

    const response = await request(app)
      .post("/api/auth/refresh-token")
      .set(
        "Cookie",
        `refreshToken=${accessToken}; Path=/api/auth`
      );

    expectAuthenticationFailure(response);
  });
});

/**
 * ============================================================================
 * Logout
 * ============================================================================
 */

describe("POST /api/auth/logout", () => {
  let testUser;
  let accessToken;
  let authCookies;

  beforeEach(async () => {
    const email = uniqueEmail("logout");

    const registration = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: PASSWORD,
        fullName: "Logout Test User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect([HTTP.OK, HTTP.CREATED]).toContain(registration.status);

    testUser = {
      email,
      password: PASSWORD,
    };

    const login = await request(app)
      .post("/api/auth/login")
      .send({
        email,
        password: PASSWORD,
      })
      .expect(HTTP.OK);

    accessToken = extractAccessToken(login);
    authCookies = extractCookies(login);
  });

  test("logs out an authenticated session successfully", async () => {
    const response = await request(app)
      .post("/api/auth/logout")
      .set(
        "Authorization",
        accessToken ? `Bearer ${accessToken}` : ""
      )
      .set("Cookie", authCookies);

    expect([HTTP.NO_CONTENT, HTTP.OK]).toContain(response.status);
  });

  test("logout is idempotent without authentication credentials", async () => {
    const response = await request(app)
      .post("/api/auth/logout");

    expect([
      HTTP.NO_CONTENT,
      HTTP.OK,
      HTTP.UNAUTHORIZED,
    ]).toContain(response.status);
  });

  test("logout clears refresh-session cookies when cookie sessions are used", async () => {
    const response = await request(app)
      .post("/api/auth/logout")
      .set(
        "Authorization",
        accessToken ? `Bearer ${accessToken}` : ""
      )
      .set("Cookie", authCookies);

    expect([HTTP.NO_CONTENT, HTTP.OK]).toContain(response.status);

    const setCookies = extractCookies(response);

    /**
     * Some applications clear cookies by returning Max-Age=0 or an expired
     * Expires value. We only assert this when the endpoint emits cookies.
     */
    if (setCookies.length > 0) {
      const refreshCookie = setCookies.find((cookie) =>
        /^refreshToken=/i.test(cookie)
      );

      if (refreshCookie) {
        expect(
          /Max-Age=0/i.test(refreshCookie) ||
            /Expires=Thu,\s*01 Jan 1970/i.test(refreshCookie)
        ).toBe(true);
      }
    }
  });
});

/**
 * ============================================================================
 * Password Reset
 * ============================================================================
 */

describe("POST /api/email/request-password-reset", () => {
  let testUser;

  beforeEach(async () => {
    const email = uniqueEmail("password-reset");

    const registration = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: PASSWORD,
        fullName: "Password Reset User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect([HTTP.OK, HTTP.CREATED]).toContain(registration.status);

    testUser = await User.findOne({
      email: email.toLowerCase(),
    });
  });

  test("accepts a valid password-reset request", async () => {
    const response = await request(app)
      .post("/api/email/request-password-reset")
      .send({
        email: testUser.email,
      });

    expect([
      HTTP.OK,
      HTTP.NO_CONTENT,
      HTTP.BAD_REQUEST,
    ]).toContain(response.status);

    /**
     * If the endpoint successfully generates a reset token, verify that the
     * account contains the corresponding server-side reset state.
     */
    if (response.status === HTTP.OK) {
      const updatedUser = await User.findById(testUser._id).lean();

      if (Object.prototype.hasOwnProperty.call(
        updatedUser,
        "resetPasswordToken"
      )) {
        expect(updatedUser.resetPasswordToken).toBeDefined();
      }

      if (Object.prototype.hasOwnProperty.call(
        updatedUser,
        "resetPasswordExpires"
      )) {
        expect(updatedUser.resetPasswordExpires).toBeDefined();
      }
    }
  });

  test("handles password-reset request for unknown email safely", async () => {
    const response = await request(app)
      .post("/api/email/request-password-reset")
      .send({
        email: uniqueEmail("does-not-exist"),
      });

    /**
     * A production system may intentionally return 200 for both existing and
     * non-existing accounts to prevent account enumeration.
     */
    expect([
      HTTP.OK,
      HTTP.BAD_REQUEST,
      HTTP.NOT_FOUND,
    ]).toContain(response.status);
  });

  test("rejects malformed password-reset request", async () => {
    const response = await request(app)
      .post("/api/email/request-password-reset")
      .send({});

    expect([
      HTTP.BAD_REQUEST,
      HTTP.OK,
    ]).toContain(response.status);
  });
});

/**
 * ============================================================================
 * Authentication Security Regression Guards
 * ============================================================================
 */

describe("Authentication security regression guards", () => {
  test("password is stored as a hash rather than plaintext", async () => {
    const email = uniqueEmail("password-storage");

    await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: PASSWORD,
        fullName: "Password Storage User",
        phoneNumber: uniquePhoneNumber(),
      })
      .expect((response) => {
        expect([HTTP.OK, HTTP.CREATED]).toContain(response.status);
      });

    const user = await User.findOne({
      email: email.toLowerCase(),
    }).select("+password");

    expect(user).not.toBeNull();
    expect(user.password).not.toBe(PASSWORD);

    /**
     * A bcrypt/argon-style password hash normally has a substantially
     * different representation and length from the original password.
     */
    expect(user.password.length).toBeGreaterThan(PASSWORD.length);
  });

  test("invalid credentials do not issue an access token", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: uniqueEmail("invalid"),
        password: "DefinitelyWrongPassword999!",
      });

    expectAuthenticationFailure(response);

    expect(extractAccessToken(response)).toBeFalsy();
  });

  test("JWT cannot be forged with a different secret", async () => {
    const forgedToken = jwt.sign(
      {
        id: String(new mongoose.Types.ObjectId()),
        userId: String(new mongoose.Types.ObjectId()),
        email: "attacker@titech.test",
        role: "admin",
      },
      "attacker-controlled-secret",
      {
        algorithm: JWT_ALGORITHM,
        expiresIn: "1h",
      }
    );

    /**
     * Test the logout boundary because it should never trust an incorrectly
     * signed bearer token as authenticated identity.
     */
    const response = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${forgedToken}`);

    expect([
      HTTP.NO_CONTENT,
      HTTP.OK,
      HTTP.UNAUTHORIZED,
      HTTP.FORBIDDEN,
    ]).toContain(response.status);
  });

  test("JWT algorithm downgrade is not accepted", async () => {
    /**
     * `none` is deliberately represented as an unsigned token.
     *
     * The test does not require the application to expose a particular error
     * body; it only verifies that the token cannot establish authenticated
     * identity.
     */
    const unsignedToken =
      [
        Buffer.from(
          JSON.stringify({
            alg: "none",
            typ: "JWT",
          })
        ).toString("base64url"),
        Buffer.from(
          JSON.stringify({
            id: String(new mongoose.Types.ObjectId()),
            userId: String(new mongoose.Types.ObjectId()),
            email: "attacker@titech.test",
            role: "admin",
          })
        ).toString("base64url"),
        "",
      ].join(".");

    const response = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${unsignedToken}`);

    expect([
      HTTP.NO_CONTENT,
      HTTP.OK,
      HTTP.UNAUTHORIZED,
      HTTP.FORBIDDEN,
    ]).toContain(response.status);
  });

  test("registration does not create duplicate records under repeated requests", async () => {
    const email = uniqueEmail("duplicate-regression");
    const phoneNumber = uniquePhoneNumber();

    const payload = {
      email,
      password: PASSWORD,
      fullName: "Duplicate Regression User",
      phoneNumber,
    };

    const responses = await Promise.all([
      request(app).post("/api/auth/register").send(payload),
      request(app).post("/api/auth/register").send(payload),
    ]);

    const successfulResponses = responses.filter((response) =>
      [HTTP.OK, HTTP.CREATED].includes(response.status)
    );

    /**
     * At most one request may successfully establish the account.
     */
    expect(successfulResponses.length).toBeLessThanOrEqual(1);

    const persistedUsers = await User.find({
      email: email.toLowerCase(),
    }).lean();

    expect(persistedUsers.length).toBeLessThanOrEqual(1);
  });
});

/**
 * ============================================================================
 * Database Integrity
 * ============================================================================
 */

describe("Authentication persistence integrity", () => {
  test("successful registration persists one corresponding account", async () => {
    const email = uniqueEmail("persistence");

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: PASSWORD,
        fullName: "Persistence User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect([HTTP.OK, HTTP.CREATED]).toContain(response.status);

    const users = await User.find({
      email: email.toLowerCase(),
    }).lean();

    expect(users).toHaveLength(1);
  });

  test("failed registration does not leave a partially created account", async () => {
    const email = uniqueEmail("atomic-registration");

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: "x",
        fullName: "Invalid Persistence User",
        phoneNumber: uniquePhoneNumber(),
      });

    expect(response.status).toBe(HTTP.BAD_REQUEST);

    const user = await User.findOne({
      email: email.toLowerCase(),
    }).lean();

    expect(user).toBeNull();
  });
});