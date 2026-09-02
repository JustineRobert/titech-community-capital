// tests/unit/models/User.test.js
// ============================================================================
// User Model Tests
// Unit tests for User model methods and validations
// ============================================================================

const User = require('../../../models/User');
const { connectDB, disconnectDB, clearDatabase } = require('../../helpers/db');

describe('User Model', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe('User Creation', () => {
    test('should create user with valid data', async () => {
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePassword123!',
      });

      await user.save();

      expect(user._id).toBeDefined();
      expect(user.email).toBe('john@example.com');
      expect(user.isActive).toBe(true);
      expect(user.isVerified).toBe(false);
    });

    test('should fail with missing required fields', async () => {
      const user = new User({
        name: 'John Doe',
        // missing email and password
      });

      await expect(user.save()).rejects.toThrow();
    });

    test('should fail with invalid email', async () => {
      const user = new User({
        name: 'John Doe',
        email: 'not-an-email',
        password: 'SecurePassword123!',
      });

      await expect(user.save()).rejects.toThrow();
    });

    test('should enforce unique email', async () => {
      const email = 'unique@example.com';

      await new User({
        name: 'User 1',
        email,
        password: 'SecurePassword123!',
      }).save();

      const user2 = new User({
        name: 'User 2',
        email,
        password: 'SecurePassword123!',
      });

      await expect(user2.save()).rejects.toThrow();
    });

    test('should hash password before saving', async () => {
      const password = 'OriginalPassword123!';
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password,
      });

      await user.save();

      expect(user.password).not.toBe(password);
      expect(user.password.length).toBeGreaterThan(20); // bcrypt hash is long
    });
  });

  describe('Password Methods', () => {
    test('matchPassword should return true for correct password', async () => {
      const password = 'CorrectPassword123!';
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password,
      });

      await user.save();

      const isMatch = await user.matchPassword(password);
      expect(isMatch).toBe(true);
    });

    test('matchPassword should return false for incorrect password', async () => {
      const password = 'CorrectPassword123!';
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password,
      });

      await user.save();

      const isMatch = await user.matchPassword('WrongPassword123!');
      expect(isMatch).toBe(false);
    });

    test('should generate reset token', async () => {
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePassword123!',
      });

      await user.save();

      const token = user.generateResetToken();

      expect(token).toBeDefined();
      expect(token.length).toBe(40); // hex string of 20 bytes
      expect(user.resetPasswordToken).toBeDefined();
      expect(user.resetPasswordExpires).toBeDefined();
      expect(user.resetPasswordExpires.getTime()).toBeGreaterThan(Date.now());
    });

    test('should generate verification token', async () => {
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePassword123!',
      });

      await user.save();

      const token = user.generateVerificationToken();

      expect(token).toBeDefined();
      expect(token.length).toBe(40); // hex string of 20 bytes
      expect(user.verificationToken).toBeDefined();
      expect(user.verificationTokenExpires).toBeDefined();
      expect(user.verificationTokenExpires.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Login Lockout', () => {
    test('should track failed login attempts', async () => {
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePassword123!',
      });

      await user.save();

      await user.bumpFailedLogin(5, 15);
      expect(user.failedLoginAttempts).toBe(1);

      await user.bumpFailedLogin(5, 15);
      expect(user.failedLoginAttempts).toBe(2);
    });

    test('should lock account after threshold exceeded', async () => {
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePassword123!',
      });

      await user.save();

      for (let i = 0; i < 5; i++) {
        await user.bumpFailedLogin(5, 15);
      }

      expect(user.isLocked()).toBe(true);
      expect(user.lockUntil).toBeDefined();
    });

    test('should reset failed login attempts', async () => {
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePassword123!',
      });

      await user.save();

      await user.bumpFailedLogin(5, 15);
      expect(user.failedLoginAttempts).toBe(1);

      await user.resetFailedLogin();
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockUntil).toBeNull();
    });
  });

  describe('User Serialization', () => {
    test('should not return password in toJSON', async () => {
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePassword123!',
      });

      await user.save();

      const json = user.toJSON();
      expect(json.password).toBeUndefined();
    });

    test('should not return sensitive fields in toJSON', async () => {
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePassword123!',
      });

      await user.save();
      user.generateResetToken();
      await user.save();

      const json = user.toJSON();
      expect(json.resetPasswordToken).toBeUndefined();
      expect(json.verificationToken).toBeUndefined();
      expect(json.failedLoginAttempts).toBeUndefined();
    });

    test('should normalize id field', async () => {
      const user = new User({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePassword123!',
      });

      await user.save();

      const json = user.toJSON();
      expect(json.id).toBeDefined();
      expect(json.id).toBe(user._id.toString());
      expect(json._id).toBeUndefined();
    });
  });
});
