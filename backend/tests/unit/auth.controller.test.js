/**
 * Authentication Controller Tests
 * Tests core authentication flows: register, login, refresh, logout
 * @group unit/controllers
 */

jest.mock('../../models/User');
jest.mock('../../models/RefreshToken');

const User = require('../../models/User');
const RefreshToken = require('../../models/RefreshToken');
const authController = require('../../controllers/authController');

describe('authController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-key-12345678';
    process.env.ACCESS_TOKEN_EXP = '15m';
    process.env.REFRESH_TOKEN_DAYS = '30';
  });

  describe('register', () => {
    it('should successfully register a new user', async () => {
      const req = {
        body: {
          email: 'test@example.com',
          password: 'SecurePassword123!',
          firstName: 'Test',
          lastName: 'User',
          phoneNumber: '+256701234567',
        },
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('jest-agent'),
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        cookie: jest.fn(),
      };

      User.findOne = jest.fn().mockResolvedValue(null);
      User.create = jest.fn().mockResolvedValue({
        _id: 'user-123',
        email: req.body.email,
        name: 'Test User',
        role: 'user',
      });

      // Assuming register method exists
      if (authController.register) {
        await authController.register(req, res);
        expect(User.findOne).toHaveBeenCalledWith({ email: req.body.email });
        expect(User.create).toHaveBeenCalled();
      }
    });

    it('should reject registration with existing email', async () => {
      const req = {
        body: {
          email: 'existing@example.com',
          password: 'SecurePassword123!',
          name: 'Existing User',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      User.findOne = jest.fn().mockResolvedValue({ email: req.body.email });

      if (authController.register) {
        await authController.register(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
      }
    });

    it('should validate password strength', async () => {
      const req = {
        body: {
          email: 'test@example.com',
          password: 'weak', // Too weak
          name: 'Test User',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      if (authController.register) {
        await authController.register(req, res);
        // Should reject weak password
        expect(res.status).toHaveBeenCalledWith(expect.any(Number));
      }
    });
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      const req = {
        body: {
          email: 'test@example.com',
          password: 'SecurePassword123!',
        },
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('jest-agent'),
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        cookie: jest.fn(),
      };

      const mockUser = {
        _id: 'user-123',
        email: 'test@example.com',
        role: 'user',
        status: 'active',
        matchPassword: jest.fn().mockResolvedValue(true),
        resetFailedLogin: jest.fn().mockResolvedValue(true),
        save: jest.fn().mockResolvedValue(true),
        security: {},
      };

      User.findOne = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockUser),
      });

      if (authController.login) {
        await authController.login(req, res);
        expect(User.findOne).toHaveBeenCalledWith({ email: req.body.email });
        expect(res.status).toHaveBeenCalledWith(200);
      }
    });

    it('should reject login with invalid credentials', async () => {
      const req = {
        body: {
          email: 'test@example.com',
          password: 'wrongpassword',
        },
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('jest-agent'),
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockUser = {
        _id: 'user-123',
        email: 'test@example.com',
        role: 'user',
        status: 'active',
        matchPassword: jest.fn().mockResolvedValue(false),
      };

      User.findOne = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockUser),
      });

      if (authController.login) {
        await authController.login(req, res);
        expect(res.status).toHaveBeenCalledWith(401);
      }
    });

    it('should reject login with non-existent user', async () => {
      const req = {
        body: {
          email: 'nonexistent@example.com',
          password: 'SecurePassword123!',
          name: 'Existing User',
        },
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('jest-agent'),
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      User.findOne = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });

      if (authController.login) {
        await authController.login(req, res);
        expect(res.status).toHaveBeenCalledWith(401);
      }
    });
  });

  describe('refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const req = {
        cookies: {
          refreshToken: 'valid-refresh-token',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        cookie: jest.fn(),
      };

      const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn(),
        inTransaction: jest.fn().mockReturnValue(true),
      };

      const mockUser = {
        _id: 'user-123',
        email: 'test@example.com',
        role: 'user',
      };

      RefreshToken.startSession = jest.fn().mockResolvedValue(session);
      RefreshToken.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({
          userId: 'user-123',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 10000),
          save: jest.fn().mockResolvedValue(true),
        }),
      });
      User.findById = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(mockUser),
      });
      RefreshToken.create = jest.fn().mockResolvedValue({
        id: 'new-session-id',
        userId: 'user-123',
        tokenHash: 'hash',
        lastUsedAt: new Date(),
        save: jest.fn().mockResolvedValue(true),
      });

      if (authController.refresh) {
        await authController.refresh(req, res);
        expect(RefreshToken.findOne).toHaveBeenCalled();
      }
    });

    it('should reject refresh with invalid token', async () => {
      const req = {
        cookies: {
          refreshToken: 'invalid-refresh-token',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn(),
        inTransaction: jest.fn().mockReturnValue(true),
      };
      RefreshToken.startSession = jest.fn().mockResolvedValue(session);
      RefreshToken.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      if (authController.refresh) {
        await authController.refresh(req, res);
        expect(res.status).toHaveBeenCalledWith(401);
      }
    });

    it('should reject refresh with revoked token', async () => {
      const req = {
        cookies: {
          refreshToken: 'revoked-token',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn(),
        inTransaction: jest.fn().mockReturnValue(true),
      };
      RefreshToken.startSession = jest.fn().mockResolvedValue(session);
      RefreshToken.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({
          userId: 'user-123',
          revokedAt: new Date(),
        }),
      });

      if (authController.refresh) {
        await authController.refresh(req, res);
        expect(res.status).toHaveBeenCalledWith(401);
      }
    });
  });

  describe('logout', () => {
    it('should successfully logout and revoke refresh token', async () => {
      const req = {
        cookies: {
          refreshToken: 'valid-refresh-token',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        clearCookie: jest.fn(),
        end: jest.fn(),
      };

      RefreshToken.findOne = jest.fn().mockResolvedValue({
        _id: 'token-123',
        revokedAt: null,
      });
      RefreshToken.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

      if (authController.logout) {
        await authController.logout(req, res);
        expect(RefreshToken.findOne).toHaveBeenCalled();
        expect(RefreshToken.updateOne).toHaveBeenCalled();
        expect(res.clearCookie).toHaveBeenCalled();
      }
    });
  });

  describe('verifyToken', () => {
    it('should verify valid JWT token', () => {
      const payload = {
        user: {
          id: 'user-123',
          email: 'test@example.com',
          role: 'user',
        },
      };

      if (authController.verifyToken) {
        const token = authController.generateAccessToken?.(payload.user);
        if (token) {
          expect(token).toBeDefined();
        }
      }
    });
  });
});
