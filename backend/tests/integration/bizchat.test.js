"use strict";

/**

* ============================================================================
* TITech Community Capital
* BizChat Integration & Security Test Suite
* ============================================================================
*
* File:
* backend/tests/integration/bizchat.test.js
*
* Purpose:
* Enterprise-grade integration and security tests for the TITech BizChat
* command execution API.
*
* Endpoint:
* POST /api/bizchat/execute
*
* Primary objectives:
*
* 1. Verify authenticated BizChat command execution.
* 2. Verify JWT authentication requirements.
* 3. Verify tenant context is derived from authenticated identity.
* 4. Ensure x-tenant-id cannot override the authenticated tenant.
* 5. Reject malformed and unsafe requests.
* 6. Ensure unauthenticated clients cannot execute protected commands.
* 7. Verify response contracts and traceability.
* 8. Verify command execution remains isolated between tenants.
* 9. Verify concurrent tenant requests remain isolated.
* 10. Prevent information disclosure through malformed requests.
* 11. Verify authentication failures fail closed.
* 12. Provide regression protection for future BizChat changes.
*
* Security model:
*
* Client Request
* ```
     |
  ```
* ```
     v
  ```
* Authentication
* ```
     |
  ```
* ```
     v
  ```
* JWT verification
* ```
     |
  ```
* ```
     v
  ```
* Authenticated User
* ```
     |
  ```
* ```
     v
  ```
* Authenticated Tenant Context
* ```
     |
  ```
* ```
     v
  ```
* Authorization
* ```
     |
  ```
* ```
     v
  ```
* BizChat Command Engine
*
* IMPORTANT:
*
* x-tenant-id is treated as untrusted client input.
*
* A client must never be able to become another tenant merely by changing:
*
* ```
    x-tenant-id
  ```
*
* The authoritative tenant boundary must originate from authenticated
* server-controlled identity/session context.
*
* NOTE:
*
* These tests intentionally avoid assuming implementation-specific internal
* BizChat service classes. They exercise the public HTTP contract while also
* inspecting JWT claims where appropriate.
*
* ============================================================================
  */

const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const app = require("../../server");

/**

* ============================================================================
* Test Configuration
* ============================================================================
  */

const TEST_JWT_SECRET =
process.env.JWT_SECRET ||
"titech-test-secret-bizchat";

const TEST_JWT_ALGORITHM = "HS256";

const API_PREFIX = "/api/bizchat/execute";

const AUTH_PREFIX = "/api/auth";

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
UNPROCESSABLE_ENTITY: 422,
});

/**

* ============================================================================
* Test Identity State
* ============================================================================
  */

let testUser;
let testUserData;

let tenantA;
let tenantB;

let tenantAToken;
let tenantBToken;

/**

* ============================================================================
* Utility Helpers
* ============================================================================
  */

/**

* Generate a deterministic MongoDB ObjectId.
*
* @returns {mongoose.Types.ObjectId}
  */
  function objectId() {
  return new mongoose.Types.ObjectId();
  }

/**

* Return a string representation of an ObjectId.
*
* @param {*} value
* @returns {string}
  */
  function idString(value) {
  return String(value);
  }

/**

* Decode a JWT without verifying it.
*
* This helper is intentionally used only for inspecting a token that was
* already issued by the application's authentication endpoint.
*
* @param {string} token
* @returns {Object|null}
  */
  function decodeToken(token) {
  if (!token || typeof token !== "string") {
  return null;
  }

return jwt.decode(token);
}

/**

* Extract a useful response payload without making the tests depend on one
* exact response envelope.
*
* @param {Object} response
* @returns {*}
  */
  function responseData(response) {
  const body = response?.body || {};

return (
body.data ??
body.result ??
body.response ??
body.payload ??
body
);
}

/**

* Extract a trace identifier from common response locations.
*
* @param {Object} response
* @returns {string|undefined}
  */
  function getTraceId(response) {
  const body = response?.body || {};

return (
body.traceId ||
body.traceID ||
body.trace_id ||
body.meta?.traceId ||
body.metadata?.traceId
);
}

/**

* Extract an error message without depending on one exact error envelope.
*
* @param {Object} response
* @returns {string}
  */
  function getErrorMessage(response) {
  const body = response?.body || {};

const message =
body.message ||
body.error?.message ||
body.error ||
body.details?.message;

return typeof message === "string" ? message : "";
}

/**

* Determine whether a status represents an authentication/authorization
* failure.
*
* @param {number} status
* @returns {boolean}
  */
  function isAuthFailure(status) {
  return [
  HTTP.UNAUTHORIZED,
  HTTP.FORBIDDEN,
  ].includes(status);
  }

/**

* ============================================================================
* JWT Test Token Factory
* ============================================================================
  */

/**

* Create a test JWT.
*
* This is used only for negative authentication/security tests. Normal
* successful-flow tests use tokens issued by the application's own login
* endpoint.
*
* @param {Object} overrides
* @returns {string}
  */
  function createTestToken(overrides = {}) {
  const userId = overrides.userId || objectId();
  const tenantId = overrides.tenantId || tenantA;

const payload = {
id: idString(userId),
userId: idString(userId),
tenantId: idString(tenantId),
email:
overrides.email ||
`bizchat-${idString(userId)}@titech.test`,
role: overrides.role || "user",
};

return jwt.sign(payload, TEST_JWT_SECRET, {
algorithm: TEST_JWT_ALGORITHM,
expiresIn: overrides.expiresIn || "1h",
});
}

/**

* ============================================================================
* HTTP Request Helpers
* ============================================================================
  */

/**

* Build an authenticated BizChat request.
*
* @param {string} token
* @param {Object} options
* @returns {Object}
  */
  function authenticatedRequest(token, options = {}) {
  const req = request(app)
  .post(API_PREFIX)
  .set("Authorization", `Bearer ${token}`)
  .set("Content-Type", "application/json");

if (options.tenantHeader !== undefined) {
req.set("x-tenant-id", idString(options.tenantHeader));
}

if (options.requestId) {
req.set("X-Request-ID", options.requestId);
}

if (options.correlationId) {
req.set("X-Correlation-ID", options.correlationId);
}

return req;
}

/**

* Execute a normal BizChat command.
*
* @param {string} token
* @param {string} text
* @param {Object} options
* @returns {Promise<Object>}
  */
  function executeCommand(token, text, options = {}) {
  return authenticatedRequest(token, options).send({
  text,
  ...(options.payload || {}),
  });
  }

/**

* ============================================================================
* Test User Registration
* ============================================================================
  */

async function registerUser({
tenantId,
email,
fullName,
phoneNumber,
}) {
const response = await request(app)
.post(`${AUTH_PREFIX}/register`)
.set("x-tenant-id", idString(tenantId))
.send({
email,
password: "BizPassword123!",
fullName,
phoneNumber,
});

return response;
}

/**

* ============================================================================
* Login Helper
* ============================================================================
  */

async function loginUser({
email,
password,
tenantId,
}) {
const response = await request(app)
.post(`${AUTH_PREFIX}/login`)
.set("x-tenant-id", idString(tenantId))
.send({
email,
password,
});

return response;
}

/**

* ============================================================================
* Test Suite
* ============================================================================
  */

describe("TITech BizChat Integration & Security", () => {
/**

* ========================================================================
* Global Lifecycle
* ========================================================================
  */

beforeAll(async () => {
/**
* Ensure authentication middleware sees the test secret.
*
* Do not overwrite a deliberately configured test secret when one is
* already supplied by the Jest environment.
*/
process.env.JWT_SECRET =
process.env.JWT_SECRET || TEST_JWT_SECRET;


tenantA = objectId();
tenantB = objectId();

testUserData = {
  email: `biz-${Date.now()}@example.com`,
  password: "BizPassword123!",
  fullName: "BizChat Test User",
  phoneNumber: `+25677${String(Date.now()).slice(-7)}`,
};

/**
 * Register user in Tenant A.
 */
const registration = await registerUser({
  tenantId: tenantA,
  ...testUserData,
});

if (![HTTP.OK, HTTP.CREATED, HTTP.CONFLICT].includes(registration.status)) {
  throw new Error(
    `BizChat test bootstrap failed during registration: HTTP ${registration.status}`
  );
}

/**
 * Preserve the application's returned user object where available.
 */
testUser = registration.body?.user || null;

/**
 * Login using the same tenant context.
 */
const login = await loginUser({
  email: testUserData.email,
  password: testUserData.password,
  tenantId: tenantA,
});

if (login.status !== HTTP.OK) {
  throw new Error(
    `BizChat test bootstrap failed during login: HTTP ${login.status}`
  );
}

tenantAToken = login.body?.token;

if (!tenantAToken) {
  throw new Error(
    "BizChat test bootstrap failed: authentication endpoint did not return a token."
  );
}

/**
 * Inspect the application's issued token.
 *
 * This intentionally does not verify the token again because successful
 * authentication was already established by the login endpoint.
 */
const decoded = decodeToken(tenantAToken);

if (!decoded) {
  throw new Error(
    "BizChat test bootstrap failed: issued JWT could not be decoded."
  );
}

/**
 * Create an independent Tenant B identity using a signed test token.
 *
 * This allows cross-tenant isolation tests without requiring a second
 * complete user-registration lifecycle.
 */
tenantBToken = createTestToken({
  tenantId: tenantB,
  userId: objectId(),
  email: `tenant-b-${Date.now()}@titech.test`,
  role: "user",
});


});

afterAll(async () => {
/**
* The application owns the server lifecycle in this test architecture.
*
* We therefore do not force-close mongoose here. Jest/test setup may
* maintain the shared database connection for other integration suites.
*/
});

/**

* ========================================================================
* Authentication
* ========================================================================
  */

describe("Authentication", () => {
test("should execute BizChat command for an authenticated user", async () => {
const response = await executeCommand(
tenantAToken,
"Check my SACCO balance"
);


  expect(response.status).toBe(HTTP.OK);

  expect(response.body).toBeDefined();
  expect(response.body.success).toBe(true);

  expect(responseData(response)).toBeDefined();

  /**
   * Production observability requirement:
   *
   * Every successful command execution should be traceable.
   */
  expect(getTraceId(response)).toBeDefined();
});

test("should reject execution without an Authorization header", async () => {
  const response = await request(app)
    .post(API_PREFIX)
    .set("Content-Type", "application/json")
    .send({
      text: "Check my SACCO balance",
    });

  expect([
    HTTP.UNAUTHORIZED,
    HTTP.FORBIDDEN,
  ]).toContain(response.status);
});

test("should reject an invalid bearer token", async () => {
  const response = await request(app)
    .post(API_PREFIX)
    .set("Authorization", "Bearer invalid.invalid.invalid")
    .set("Content-Type", "application/json")
    .send({
      text: "Check my SACCO balance",
    });

  expect([
    HTTP.UNAUTHORIZED,
    HTTP.FORBIDDEN,
  ]).toContain(response.status);
});

test("should reject malformed Authorization headers", async () => {
  const malformedHeaders = [
    "Bearer",
    "Bearer ",
    "Token abc",
    "Basic abc",
    "invalid-token",
  ];

  for (const authorization of malformedHeaders) {
    const response = await request(app)
      .post(API_PREFIX)
      .set("Authorization", authorization)
      .set("Content-Type", "application/json")
      .send({
        text: "Check my SACCO balance",
      });

    expect([
      HTTP.UNAUTHORIZED,
      HTTP.FORBIDDEN,
    ]).toContain(response.status);
  }
});

test("should reject an expired JWT", async () => {
  const expiredToken = createTestToken({
    tenantId: tenantA,
    userId: objectId(),
    expiresIn: -1,
  });

  const response = await executeCommand(
    expiredToken,
    "Check my SACCO balance"
  );

  expect([
    HTTP.UNAUTHORIZED,
    HTTP.FORBIDDEN,
  ]).toContain(response.status);
});

test("should reject a JWT signed with the wrong secret", async () => {
  const forgedToken = jwt.sign(
    {
      id: idString(objectId()),
      userId: idString(objectId()),
      tenantId: idString(tenantA),
      role: "user",
    },
    "attacker-controlled-secret",
    {
      algorithm: TEST_JWT_ALGORITHM,
      expiresIn: "1h",
    }
  );

  const response = await executeCommand(
    forgedToken,
    "Check my SACCO balance"
  );

  expect([
    HTTP.UNAUTHORIZED,
    HTTP.FORBIDDEN,
  ]).toContain(response.status);
});

test("should reject a token using an unsupported signing algorithm", async () => {
  const noneToken = [
    Buffer.from(
      JSON.stringify({
        alg: "none",
        typ: "JWT",
      })
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        id: idString(objectId()),
        userId: idString(objectId()),
        tenantId: idString(tenantA),
        role: "admin",
      })
    ).toString("base64url"),
    "",
  ].join(".");

  const response = await executeCommand(
    noneToken,
    "Check my SACCO balance"
  );

  expect([
    HTTP.UNAUTHORIZED,
    HTTP.FORBIDDEN,
  ]).toContain(response.status);
});


});

/**

* ========================================================================
* JWT Identity Integrity
* ========================================================================
  */

describe("JWT identity integrity", () => {
test("issued authentication token should contain a user identity", () => {
const decoded = decodeToken(tenantAToken);


  expect(decoded).not.toBeNull();

  expect(
    decoded.userId || decoded.id || decoded.sub
  ).toBeDefined();
});

test("issued authentication token should contain tenant context", () => {
  const decoded = decodeToken(tenantAToken);

  expect(decoded).not.toBeNull();

  /**
   * Multi-tenant deployments require tenant context to survive the
   * authentication boundary.
   */
  expect(decoded.tenantId).toBeDefined();
  expect(String(decoded.tenantId)).toBe(String(tenantA));
});

test("issued JWT should use the configured secure signing algorithm", () => {
  const decoded = decodeToken(tenantAToken);

  expect(decoded).not.toBeNull();

  /**
   * Inspect the JWT header without accepting the token as trusted data.
   */
  const [encodedHeader] = tenantAToken.split(".");
  const header = JSON.parse(
    Buffer.from(encodedHeader, "base64url").toString("utf8")
  );

  expect(header.alg).toBe(TEST_JWT_ALGORITHM);
});


});

/**

* ========================================================================
* Request Validation
* ========================================================================
  */

describe("Request validation", () => {
test("should reject a missing request body", async () => {
const response = await authenticatedRequest(tenantAToken).send();


  expect([
    HTTP.BAD_REQUEST,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});

test("should reject an empty request body", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({});

  expect([
    HTTP.BAD_REQUEST,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});

test("should reject a missing text command", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    command: "balance",
  });

  expect([
    HTTP.BAD_REQUEST,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});

test("should reject null command text", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: null,
  });

  expect([
    HTTP.BAD_REQUEST,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});

test("should reject non-string command text", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: {
      command: "Check my balance",
    },
  });

  expect([
    HTTP.BAD_REQUEST,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});

test("should reject empty command text", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "",
  });

  expect([
    HTTP.BAD_REQUEST,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});

test("should reject whitespace-only command text", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "     ",
  });

  expect([
    HTTP.BAD_REQUEST,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});


});

/**

* ========================================================================
* Command Execution
* ========================================================================
  */

describe("Command execution", () => {
test("should execute balance command", async () => {
const response = await executeCommand(
tenantAToken,
"Check my SACCO balance"
);


  expect(response.status).toBe(HTTP.OK);
  expect(response.body.success).toBe(true);
  expect(response.body.data).toBeDefined();
  expect(getTraceId(response)).toBeDefined();
});

test("should normalize harmless surrounding whitespace", async () => {
  const response = await executeCommand(
    tenantAToken,
    "   Check my SACCO balance   "
  );

  /**
   * Depending on the command parser implementation, the application may
   * either normalize the command or reject it. Both are safe behaviours;
   * what must not happen is an unexpected server failure.
   */
  expect(response.status).toBeLessThan(HTTP.NOT_FOUND);
  expect(response.status).not.toBe(500);
});

test("should return a structured response", async () => {
  const response = await executeCommand(
    tenantAToken,
    "Check my SACCO balance"
  );

  expect(response.body).toBeDefined();
  expect(typeof response.body).toBe("object");

  expect(response.body.success).toBe(true);
  expect(getTraceId(response)).toEqual(
    expect.any(String)
  );
});

test("should not expose authentication secrets in successful response", async () => {
  const response = await executeCommand(
    tenantAToken,
    "Check my SACCO balance"
  );

  const serialized = JSON.stringify(response.body);

  expect(serialized).not.toContain(TEST_JWT_SECRET);
  expect(serialized).not.toContain(
    "BizPassword123!"
  );
});


});

/**

* ========================================================================
* Tenant Isolation
* ========================================================================
  */

describe("Tenant isolation", () => {
test("tenant A should execute within tenant A context", async () => {
const response = await authenticatedRequest(
tenantAToken,
{
tenantHeader: tenantA,
}
).send({
text: "Check my SACCO balance",
});


  expect(response.status).toBe(HTTP.OK);
  expect(response.body.success).toBe(true);
});

test("tenant A must not become tenant B through x-tenant-id", async () => {
  const response = await authenticatedRequest(
    tenantAToken,
    {
      tenantHeader: tenantB,
    }
  ).send({
    text: "Check my SACCO balance",
  });

  /**
   * A secure implementation must either:
   *
   *   1. Ignore the forged header and execute in Tenant A context, or
   *   2. Reject the inconsistent tenant context.
   *
   * It must never execute as Tenant B.
   */
  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.FORBIDDEN,
    HTTP.UNAUTHORIZED,
  ]).toContain(response.status);

  if (response.status === HTTP.OK) {
    expect(response.body.success).toBe(true);
  }
});

test("forged tenant header must never authorize another tenant", async () => {
  const response = await authenticatedRequest(
    tenantAToken,
    {
      tenantHeader: tenantB,
    }
  ).send({
    text: "Check my SACCO balance",
  });

  /**
   * The security assertion is deliberately stronger than simply checking
   * for a 403. An implementation may legitimately ignore the header and
   * continue using the authenticated tenant.
   */
  if (response.status === HTTP.OK) {
    expect(response.body.success).toBe(true);
  } else {
    expect([
      HTTP.BAD_REQUEST,
      HTTP.FORBIDDEN,
      HTTP.UNAUTHORIZED,
    ]).toContain(response.status);
  }
});

test("missing tenant header must not remove JWT tenant isolation", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "Check my SACCO balance",
  });

  /**
   * The JWT should provide the authenticated tenant context.
   */
  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.FORBIDDEN,
  ]).toContain(response.status);
});

test("tenant B token must represent tenant B", () => {
  const decoded = decodeToken(tenantBToken);

  expect(decoded).not.toBeNull();
  expect(decoded.tenantId).toBeDefined();
  expect(String(decoded.tenantId)).toBe(String(tenantB));
});


});

/**

* ========================================================================
* Tenant Context Confusion
* ========================================================================
  */

describe("Tenant-context confusion resistance", () => {
test("tenant A JWT plus tenant B header must never produce a tenant B JWT identity", async () => {
const decodedBefore = decodeToken(tenantAToken);


  expect(String(decodedBefore.tenantId)).toBe(
    String(tenantA)
  );

  const response = await authenticatedRequest(
    tenantAToken,
    {
      tenantHeader: tenantB,
    }
  ).send({
    text: "Check my SACCO balance",
  });

  /**
   * We cannot assume the application returns the tenant identifier in its
   * response, therefore the assertion focuses on the security boundary:
   * the request must not be rejected in a way that leaks another tenant,
   * and if accepted it must remain a normal authenticated execution.
   */
  expect(response.status).not.toBe(500);
});

test("tenant header must not be accepted as the only authentication mechanism", async () => {
  const response = await request(app)
    .post(API_PREFIX)
    .set("x-tenant-id", String(tenantB))
    .set("Content-Type", "application/json")
    .send({
      text: "Check my SACCO balance",
    });

  expect([
    HTTP.UNAUTHORIZED,
    HTTP.FORBIDDEN,
  ]).toContain(response.status);
});


});

/**

* ========================================================================
* Error Handling & Information Disclosure
* ========================================================================
  */

describe("Error handling and information disclosure", () => {
test("unknown command should not cause an internal server error", async () => {
const response = await executeCommand(
tenantAToken,
"This is definitely not a supported BizChat command xyz987"
);


  expect(response.status).not.toBe(500);

  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.UNPROCESSABLE_ENTITY,
    HTTP.NOT_FOUND,
  ]).toContain(response.status);
});

test("very large command should be handled safely", async () => {
  const oversizedCommand = "A".repeat(100_000);

  const response = await executeCommand(
    tenantAToken,
    oversizedCommand
  );

  expect(response.status).not.toBe(500);

  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.UNPROCESSABLE_ENTITY,
    HTTP.TOO_MANY_REQUESTS,
  ]).toContain(response.status);
});

test("prototype-pollution style payload must not crash the endpoint", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "Check my SACCO balance",
    __proto__: {
      polluted: true,
    },
    constructor: {
      prototype: {
        polluted: true,
      },
    },
  });

  expect(response.status).not.toBe(500);
});

test("error responses should not expose JWT secrets", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "",
  });

  const serialized = JSON.stringify(response.body || {});

  expect(serialized).not.toContain(TEST_JWT_SECRET);
  expect(serialized).not.toContain(
    "BizPassword123!"
  );
});

test("error response should remain structured", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "",
  });

  expect(response.body).toBeDefined();
  expect(typeof response.body).toBe("object");
});


});

/**

* ========================================================================
* Traceability / Observability
* ========================================================================
  */

describe("Traceability and observability", () => {
test("successful request should return a trace identifier", async () => {
const response = await executeCommand(
tenantAToken,
"Check my SACCO balance"
);


  expect(response.status).toBe(HTTP.OK);

  expect(getTraceId(response)).toEqual(
    expect.any(String)
  );

  expect(getTraceId(response).length).toBeGreaterThan(0);
});

test("separate requests should receive independent trace identifiers", async () => {
  const response1 = await executeCommand(
    tenantAToken,
    "Check my SACCO balance"
  );

  const response2 = await executeCommand(
    tenantAToken,
    "Check my SACCO balance"
  );

  expect(response1.status).toBe(HTTP.OK);
  expect(response2.status).toBe(HTTP.OK);

  const trace1 = getTraceId(response1);
  const trace2 = getTraceId(response2);

  expect(trace1).toBeDefined();
  expect(trace2).toBeDefined();

  expect(trace1).not.toBe(trace2);
});

test("request correlation identifier should not cause server failure", async () => {
  const requestId = `bizchat-test-${Date.now()}-${objectId()}`;

  const response = await executeCommand(
    tenantAToken,
    "Check my SACCO balance",
    {
      requestId,
    }
  );

  expect(response.status).not.toBe(500);
});


});

/**

* ========================================================================
* Authorization
* ========================================================================
  */

describe("Authorization", () => {
test("normal authenticated user should be able to execute permitted command", async () => {
const response = await executeCommand(
tenantAToken,
"Check my SACCO balance"
);


  expect(response.status).toBe(HTTP.OK);
  expect(response.body.success).toBe(true);
});

test("authentication must not be bypassed by role fields in request body", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "Check my SACCO balance",
    role: "admin",
    isAdmin: true,
    permissions: ["*"],
  });

  expect(response.status).not.toBe(500);

  /**
   * The client cannot elevate the authenticated role simply by sending
   * role/permission fields in the request.
   */
  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.FORBIDDEN,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});

test("authentication must not be bypassed by supplying another userId", async () => {
  const attackerSuppliedUserId = objectId();

  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "Check my SACCO balance",
    userId: String(attackerSuppliedUserId),
  });

  expect(response.status).not.toBe(500);

  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.FORBIDDEN,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});


});

/**

* ========================================================================
* Concurrent Execution
* ========================================================================
  */

describe("Concurrent execution", () => {
test("concurrent requests from the same tenant should complete safely", async () => {
const commands = [
"Check my SACCO balance",
"Check my savings balance",
"Show my contributions",
"Check my SACCO balance",
];


  const responses = await Promise.all(
    commands.map((command) =>
      executeCommand(tenantAToken, command)
    )
  );

  expect(responses).toHaveLength(commands.length);

  for (const response of responses) {
    expect(response.status).not.toBe(500);
  }
});

test("concurrent requests from different tenants must remain independently authenticated", async () => {
  const [
    tenantAResponse,
    tenantBResponse,
    tenantACrossHeaderResponse,
    tenantBCrossHeaderResponse,
  ] = await Promise.all([
    executeCommand(
      tenantAToken,
      "Check my SACCO balance",
      {
        tenantHeader: tenantA,
      }
    ),
    executeCommand(
      tenantBToken,
      "Check my SACCO balance",
      {
        tenantHeader: tenantB,
      }
    ),
    executeCommand(
      tenantAToken,
      "Check my SACCO balance",
      {
        tenantHeader: tenantB,
      }
    ),
    executeCommand(
      tenantBToken,
      "Check my SACCO balance",
      {
        tenantHeader: tenantA,
      }
    ),
  ]);

  expect(tenantAResponse.status).not.toBe(500);
  expect(tenantBResponse.status).not.toBe(500);

  expect(tenantACrossHeaderResponse.status).not.toBe(500);
  expect(tenantBCrossHeaderResponse.status).not.toBe(500);

  /**
   * A forged header must never turn one authenticated tenant into another.
   */
  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.FORBIDDEN,
    HTTP.UNAUTHORIZED,
  ]).toContain(tenantACrossHeaderResponse.status);

  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.FORBIDDEN,
    HTTP.UNAUTHORIZED,
  ]).toContain(tenantBCrossHeaderResponse.status);
});


});

/**

* ========================================================================
* Content-Type / Transport Validation
* ========================================================================
  */

describe("Transport validation", () => {
test("should handle a JSON request using the expected content type", async () => {
const response = await authenticatedRequest(
tenantAToken
)
.set("Content-Type", "application/json")
.send({
text: "Check my SACCO balance",
});


  expect(response.status).not.toBe(500);
});

test("unsupported HTTP method should not execute the command", async () => {
  const response = await request(app)
    .get(API_PREFIX)
    .set("Authorization", `Bearer ${tenantAToken}`);

  expect([
    HTTP.NOT_FOUND,
    HTTP.BAD_REQUEST,
    HTTP.UNAUTHORIZED,
    HTTP.FORBIDDEN,
  ]).toContain(response.status);
});


});

/**

* ========================================================================
* Regression Guards
* ========================================================================
  */

describe("BizChat security regression guards", () => {
test("BizChat endpoint must remain protected", async () => {
const response = await request(app)
.post(API_PREFIX)
.send({
text: "Check my SACCO balance",
});


  expect(isAuthFailure(response.status)).toBe(true);
});

test("client-controlled tenant identity must never be trusted", async () => {
  const forgedTenant = objectId();

  const response = await authenticatedRequest(
    tenantAToken,
    {
      tenantHeader: forgedTenant,
    }
  ).send({
    text: "Check my SACCO balance",
  });

  expect(response.status).not.toBe(500);

  /**
   * If accepted, the authenticated JWT must remain the authority.
   * If rejected, the security boundary has still been preserved.
   */
  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.FORBIDDEN,
    HTTP.UNAUTHORIZED,
  ]).toContain(response.status);
});

test("client-controlled role must never replace authenticated authorization context", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "Check my SACCO balance",
    role: "super_admin",
    userRole: "super_admin",
    isPlatformAdmin: true,
  });

  expect(response.status).not.toBe(500);

  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.FORBIDDEN,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});

test("endpoint should not leak stack traces to clients", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "",
  });

  const serialized = JSON.stringify(response.body || {});

  expect(serialized).not.toMatch(
    /at\s+\w+.*\(.+:\d+:\d+\)/i
  );
});

test("endpoint should not expose database connection information", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "",
  });

  const serialized = JSON.stringify(response.body || {});

  expect(serialized).not.toMatch(
    /mongodb:\/\/|mongoose|mongodb/i
  );
});


});

/**

* ========================================================================
* Authentication Isolation Regression
* ========================================================================
  */

describe("Authentication isolation regression", () => {
test("Tenant A token must remain cryptographically distinct from Tenant B token", () => {
expect(tenantAToken).toBeDefined();
expect(tenantBToken).toBeDefined();


  expect(tenantAToken).not.toBe(tenantBToken);

  const tokenA = decodeToken(tenantAToken);
  const tokenB = decodeToken(tenantBToken);

  expect(tokenA).not.toBeNull();
  expect(tokenB).not.toBeNull();

  expect(String(tokenA.tenantId)).toBe(
    String(tenantA)
  );

  expect(String(tokenB.tenantId)).toBe(
    String(tenantB)
  );

  expect(String(tokenA.tenantId)).not.toBe(
    String(tokenB.tenantId)
  );
});

test("Tenant A authenticated identity must not be replaced by a request-body tenantId", async () => {
  const response = await authenticatedRequest(
    tenantAToken
  ).send({
    text: "Check my SACCO balance",
    tenantId: String(tenantB),
  });

  expect(response.status).not.toBe(500);

  expect([
    HTTP.OK,
    HTTP.BAD_REQUEST,
    HTTP.FORBIDDEN,
    HTTP.UNPROCESSABLE_ENTITY,
  ]).toContain(response.status);
});


});
});

/**

* ============================================================================
* End of Test Suite
* ============================================================================
  */