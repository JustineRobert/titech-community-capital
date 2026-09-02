// tests/helpers/auth.js
// ============================================================================
// Authentication Test Helpers
// Create test users, tokens, and auth contexts
// ============================================================================

const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const RefreshToken = require('../../models/RefreshToken');
const crypto = require('crypto');

/**
 * Create a test user
 */
async function createTestUser(userData = {}) {
  const defaultData = {
    name: 'Test User',
    email: `test-${Date.now()}@example.com`,
    password: 'TestPassword123!',
    role: 'user',
    isVerified: true,
  };

  const user = new User({
    ...defaultData,
    ...userData,
  });

  await user.save();
  return user;
}

/**
 * Create multiple test users
 */
async function createTestUsers(count = 3, overrides = {}) {
  const users = [];
  for (let i = 0; i < count; i++) {
    const user = await createTestUser({
      email: `test-user-${i + 1}-${Date.now()}@example.com`,
      ...overrides,
    });
    users.push(user);
  }
  return users;
}

/**
 * Generate access token for test user
 */
function generateAccessToken(user, expiresIn = '15m') {
  const payload = {
    user: {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    },
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

/**
 * Generate refresh token for test user
 */
async function generateRefreshToken(userId) {
  const token = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const dbEntry = await RefreshToken.create({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    revokedAt: null,
  });

  return { token, dbEntry };
}

/**
 * Create authenticated request context
 */
async function createAuthContext(userData = {}) {
  const user = await createTestUser(userData);
  const accessToken = generateAccessToken(user);
  const { token: refreshToken } = await generateRefreshToken(user._id);

  return {
    user,
    accessToken,
    refreshToken,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };
}

/**
 * Mock request with auth headers
 */
function mockAuthRequest(user, method = 'GET', path = '/', body = null) {
  const accessToken = generateAccessToken(user);

  return {
    method,
    path,
    body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    user,
  };
}

module.exports = {
  createTestUser,
  createTestUsers,
  generateAccessToken,
  generateRefreshToken,
  createAuthContext,
  mockAuthRequest,
};
