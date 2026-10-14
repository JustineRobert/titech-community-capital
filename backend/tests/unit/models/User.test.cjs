'use strict';

// ============================================================================
// TITech Community Capital
// backend/tests/unit/models/User.test.js
//
// User Model Tests
// ============================================================================
// Coverage:
// - ESM loading of the actual production User model
// - Required fields and schema validation
// - Email normalization and uniqueness
// - Concurrent duplicate-email protection
// - Persistence and model retrieval
// - Password hashing and password verification
// - Password reset and email verification tokens
// - Failed login tracking and account lockout
// - Failed login reset behavior
// - Sensitive-field serialization
// - Stable public ID serialization
//
// IMPORTANT:
// These tests exercise the real User model and database. They must not
// replace or mock the production schema, password hashing, token generation,
// account-lockout methods, or serialization behavior.
//
// Run with ESM support enabled:
// NODE_OPTIONS=--experimental-vm-modules npx jest \
//   backend/tests/unit/models/User.test.js --runInBand
// ============================================================================

const {
  connectDB,
  disconnectDB,
  clearDatabase,
} = require('../../helpers/db');

describe('User Model', () => {
  let User;
  let databaseConnected = false;

  const TEST_PASSWORD = 'SecurePassword123!';

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function createValidUser(overrides = {}) {
    if (typeof User !== 'function') {
      throw new TypeError(
        'The production User model has not been initialized.'
      );
    }

    return new User({
      name: 'John Doe',
      email: 'john@example.com',
      password: TEST_PASSWORD,
      ...overrides,
    });
  }

  // --------------------------------------------------------------------------
  // Database and production model setup
  // --------------------------------------------------------------------------

  beforeAll(async () => {
    // User.js is an ES module. Import it dynamically instead of requiring
    // it from this CommonJS-compatible Jest test file.
    const userModule = await import('../../../models/User.js');

    // Support the common ESM export patterns without modifying the model.
    const candidates = [
      userModule.default,
      userModule.User,
      userModule.default?.User,
    ];

    User = candidates.find(
      (candidate) =>
        typeof candidate === 'function' &&
        typeof candidate.findById === 'function' &&
        typeof candidate.countDocuments === 'function'
    );

    if (!User) {
      throw new TypeError(
        'Could not resolve the production User model from ' +
          'backend/models/User.js. Expected a default export or named ' +
          'User export that exposes Mongoose model methods. Exports found: ' +
          Object.keys(userModule).join(', ')
      );
    }

    await connectDB();
    databaseConnected = true;
  });

  afterAll(async () => {
    if (databaseConnected) {
      await disconnectDB();
      databaseConnected = false;
    }
  });

  beforeEach(async () => {
    await clearDatabase();

    // Ensure schema indexes, including the unique email index, exist before
    // uniqueness and concurrent-save tests execute.
    //
    // This is deliberately performed after clearing the test database in
    // case the helper removes collections or their indexes.
    await User.createIndexes();
  });

  // ==========================================================================
  // USER CREATION AND SCHEMA VALIDATION
  // ==========================================================================

  describe('User Creation and Validation', () => {
    test('creates and persists a user with valid required data', async () => {
      const user = createValidUser();

      await user.save();

      expect(user._id).toBeDefined();
      expect(user.email).toBe('john@example.com');
      expect(user.isActive).toBe(true);
      expect(user.isVerified).toBe(false);

      const retrieved = await User.findById(user._id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.name).toBe('John Doe');
      expect(retrieved.email).toBe('john@example.com');
    });

    test('rejects a user missing required fields', async () => {
      const user = new User({
        name: 'John Doe',
      });

      await expect(user.save()).rejects.toThrow();
    });

    test('rejects an invalid email address', async () => {
      const user = createValidUser({
        email: 'not-an-email',
      });

      await expect(user.save()).rejects.toThrow();
    });

    test.each([
      ['empty address', ''],
      ['whitespace only', '   '],
      ['missing at sign', 'missing-at-sign.example.com'],
      ['missing domain', 'user@'],
      ['missing local part', '@example.com'],
      ['missing top-level domain', 'user@example'],
      ['embedded whitespace', 'user name@example.com'],
      ['multiple at signs', 'user@@example.com'],
      ['consecutive dots in domain', 'user@example..com'],
      ['consecutive dots in local part', 'user..name@example.com'],
      ['leading dot in local part', '.user@example.com'],
      ['trailing dot in local part', 'user.@example.com'],
      ['domain label starts with a hyphen', 'user@-example.com'],
      ['domain label ends with a hyphen', 'user@example-.com'],
      ['one-character top-level domain', 'user@example.c'],
      ['leading whitespace', ' user@example.com'],
      ['trailing whitespace', 'user@example.com '],
      ['null value', null],
      ['undefined value', undefined],
      ['numeric value', 12345],
    ])(
      'rejects malformed email input: %s',
      async (_description, email) => {
        const user = createValidUser({ email });

        await expect(user.save()).rejects.toThrow();
      }
    );

    test.each([
      'user@example.com',
      'test.user@example.co.uk',
      'first+tag@example.org',
      'user123@subdomain.example.com',
    ])('accepts a supported email address: %s', async (email) => {
      const user = createValidUser({ email });

      await expect(user.save()).resolves.toBeDefined();
      expect(user.email).toBe(email);
    });

    test('normalizes email casing and surrounding whitespace', async () => {
      const user = createValidUser({
        email: '  JOHN.DOE@EXAMPLE.COM  ',
      });

      await user.save();

      expect(user.email).toBe('john.doe@example.com');

      const retrieved = await User.findById(user._id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.email).toBe('john.doe@example.com');
    });

    test('enforces unique email addresses in the database', async () => {
      await createValidUser({
        name: 'User One',
        email: 'unique@example.com',
      }).save();

      const duplicate = createValidUser({
        name: 'User Two',
        email: 'unique@example.com',
      });

      await expect(duplicate.save()).rejects.toThrow();

      const matchingUsers = await User.countDocuments({
        email: 'unique@example.com',
      });

      expect(matchingUsers).toBe(1);
    });

    test('prevents concurrent saves from creating duplicate email addresses', async () => {
      const email = 'concurrent@example.com';

      // Start with no existing record for this email.
      const first = createValidUser({
        name: 'Concurrent User One',
        email,
      });

      const second = createValidUser({
        name: 'Concurrent User Two',
        email,
      });

      const results = await Promise.allSettled([
        first.save(),
        second.save(),
      ]);

      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled'
      );

      const rejected = results.filter(
        (result) => result.status === 'rejected'
      );

      // The database's unique index must allow exactly one insert.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      expect(
        await User.countDocuments({ email })
      ).toBe(1);
    });

    test('persists the user and makes it retrievable by ID', async () => {
      const user = createValidUser();

      await user.save();

      const retrieved = await User.findById(user._id);

      expect(retrieved).not.toBeNull();
      expect(retrieved._id.toString()).toBe(user._id.toString());
      expect(retrieved.email).toBe(user.email);
      expect(retrieved.name).toBe(user.name);
    });

    test('applies documented default account flags', async () => {
      const user = createValidUser();

      await user.save();

      expect(user.isActive).toBe(true);
      expect(user.isVerified).toBe(false);
    });
  });

  // ==========================================================================
  // PASSWORD HASHING AND VERIFICATION
  // ==========================================================================

  describe('Password Methods', () => {
    test('hashes the password before persistence', async () => {
      const user = createValidUser();

      await user.save();

      expect(user.password).not.toBe(TEST_PASSWORD);
      expect(typeof user.password).toBe('string');
      expect(user.password.length).toBeGreaterThan(20);
    });

    test('does not persist the original plaintext password', async () => {
      const user = createValidUser();

      await user.save();

      // Explicitly select password if the production schema hides it
      // from ordinary database queries.
      const persisted = await User.findById(user._id).select('+password');

      expect(persisted).not.toBeNull();
      expect(persisted.password).not.toBe(TEST_PASSWORD);
    });

    test('matchPassword returns true for the correct password', async () => {
      const user = createValidUser();

      await user.save();

      await expect(
        user.matchPassword(TEST_PASSWORD)
      ).resolves.toBe(true);
    });

    test('matchPassword returns false for an incorrect password', async () => {
      const user = createValidUser();

      await user.save();

      await expect(
        user.matchPassword('WrongPassword123!')
      ).resolves.toBe(false);
    });

    test('password remains verifiable after retrieving the user', async () => {
      const user = createValidUser();

      await user.save();

      const retrieved = await User.findById(user._id).select('+password');

      expect(retrieved).not.toBeNull();

      await expect(
        retrieved.matchPassword(TEST_PASSWORD)
      ).resolves.toBe(true);
    });

    test('does not rehash an unchanged password on unrelated updates', async () => {
      const user = createValidUser();

      await user.save();

      const originalHash = user.password;

      user.name = 'John Updated';

      await user.save();

      expect(user.password).toBe(originalHash);

      await expect(
        user.matchPassword(TEST_PASSWORD)
      ).resolves.toBe(true);
    });

    test('changes the password hash when the password changes', async () => {
      const user = createValidUser();

      await user.save();

      const originalHash = user.password;
      const replacementPassword = 'ReplacementPassword456!';

      user.password = replacementPassword;

      await user.save();

      expect(user.password).not.toBe(originalHash);
      expect(user.password).not.toBe(replacementPassword);

      await expect(
        user.matchPassword(replacementPassword)
      ).resolves.toBe(true);

      await expect(
        user.matchPassword(TEST_PASSWORD)
      ).resolves.toBe(false);
    });
  });

  // ==========================================================================
  // PASSWORD RESET TOKENS
  // ==========================================================================

  describe('Password Reset Tokens', () => {
    test('generates a reset token and records its expiry', async () => {
      const user = createValidUser();

      await user.save();

      const token = user.generateResetToken();

      expect(typeof token).toBe('string');
      expect(token).toMatch(/^[a-f0-9]{40}$/i);

      expect(user.resetPasswordToken).toBeDefined();
      expect(user.resetPasswordExpires).toBeInstanceOf(Date);
      expect(user.resetPasswordExpires.getTime()).toBeGreaterThan(Date.now());
    });

    test('stores a digest rather than the raw reset token', async () => {
      const user = createValidUser();

      await user.save();

      const token = user.generateResetToken();

      expect(user.resetPasswordToken).toBeDefined();
      expect(user.resetPasswordToken).not.toBe(token);
    });

    test('generates different reset tokens for successive requests', async () => {
      const user = createValidUser();

      await user.save();

      const firstToken = user.generateResetToken();
      const firstDigest = user.resetPasswordToken;

      const secondToken = user.generateResetToken();

      expect(secondToken).not.toBe(firstToken);
      expect(user.resetPasswordToken).not.toBe(firstDigest);
    });
  });

  // ==========================================================================
  // EMAIL VERIFICATION TOKENS
  // ==========================================================================

  describe('Email Verification Tokens', () => {
    test('generates a verification token and records its expiry', async () => {
      const user = createValidUser();

      await user.save();

      const token = user.generateVerificationToken();

      expect(typeof token).toBe('string');
      expect(token).toMatch(/^[a-f0-9]{40}$/i);

      expect(user.verificationToken).toBeDefined();
      expect(user.verificationTokenExpires).toBeInstanceOf(Date);
      expect(user.verificationTokenExpires.getTime())
        .toBeGreaterThan(Date.now());
    });

    test('stores a digest rather than the raw verification token', async () => {
      const user = createValidUser();

      await user.save();

      const token = user.generateVerificationToken();

      expect(user.verificationToken).toBeDefined();
      expect(user.verificationToken).not.toBe(token);
    });

    test('generates different verification tokens for successive requests', async () => {
      const user = createValidUser();

      await user.save();

      const firstToken = user.generateVerificationToken();
      const firstDigest = user.verificationToken;

      const secondToken = user.generateVerificationToken();

      expect(secondToken).not.toBe(firstToken);
      expect(user.verificationToken).not.toBe(firstDigest);
    });
  });

  // ==========================================================================
  // LOGIN LOCKOUT
  // ==========================================================================

  describe('Login Lockout', () => {
    test('tracks failed login attempts', async () => {
      const user = createValidUser();

      await user.save();

      await user.bumpFailedLogin(5, 15);

      expect(user.failedLoginAttempts).toBe(1);

      await user.bumpFailedLogin(5, 15);

      expect(user.failedLoginAttempts).toBe(2);
    });

    test('locks the account when the configured threshold is reached', async () => {
      const user = createValidUser();

      await user.save();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await user.bumpFailedLogin(5, 15);
      }

      expect(user.isLocked()).toBe(true);
      expect(user.lockUntil).toBeInstanceOf(Date);
      expect(user.lockUntil.getTime()).toBeGreaterThan(Date.now());
    });

    test('persists failed login state when the model method saves it', async () => {
      const user = createValidUser();

      await user.save();

      await user.bumpFailedLogin(5, 15);

      const retrieved = await User.findById(user._id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.failedLoginAttempts).toBe(1);
    });

    test('resets failed login attempts and clears lock state', async () => {
      const user = createValidUser();

      await user.save();

      await user.bumpFailedLogin(5, 15);

      expect(user.failedLoginAttempts).toBe(1);

      await user.resetFailedLogin();

      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockUntil == null).toBe(true);
    });

    test('persists the reset login state', async () => {
      const user = createValidUser();

      await user.save();

      await user.bumpFailedLogin(5, 15);
      await user.resetFailedLogin();

      const retrieved = await User.findById(user._id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.failedLoginAttempts).toBe(0);
      expect(retrieved.lockUntil == null).toBe(true);
    });
  });

  // ==========================================================================
  // USER SERIALIZATION
  // ==========================================================================

  describe('User Serialization', () => {
    test('does not expose the password in toJSON()', async () => {
      const user = createValidUser();

      await user.save();

      const json = user.toJSON();

      expect(json.password).toBeUndefined();
    });

    test('does not expose sensitive authentication fields in toJSON()', async () => {
      const user = createValidUser();

      await user.save();

      user.generateResetToken();
      user.generateVerificationToken();

      await user.save();

      const json = user.toJSON();

      expect(json.password).toBeUndefined();
      expect(json.resetPasswordToken).toBeUndefined();
      expect(json.resetPasswordExpires).toBeUndefined();
      expect(json.verificationToken).toBeUndefined();
      expect(json.verificationTokenExpires).toBeUndefined();
      expect(json.failedLoginAttempts).toBeUndefined();
      expect(json.lockUntil).toBeUndefined();
    });

    test('exposes a stable public ID without the MongoDB _id field', async () => {
      const user = createValidUser();

      await user.save();

      const json = user.toJSON();

      expect(json.id).toBeDefined();
      expect(json.id).toBe(user._id.toString());
      expect(json._id).toBeUndefined();
    });

    test('preserves non-sensitive public fields in serialization', async () => {
      const user = createValidUser();

      await user.save();

      const json = user.toJSON();

      expect(json.name).toBe('John Doe');
      expect(json.email).toBe('john@example.com');
      expect(json.isActive).toBe(true);
      expect(json.isVerified).toBe(false);
    });
  });
});