/**
 * Utility Functions Unit Tests
 * ============================================================================
 * Unit tests for validation, formatting, and helper functions
 */

/**
 * Utility Functions Unit Tests
 */

/* global Intl */


describe('Utility Functions', () => {
  describe('Phone Number Validation', () => {
    const validatePhoneNumber = (phone) => {
      // Support international format
      const phoneRegex = /^\+?[1-9]\d{1,14}$/;
      return phoneRegex.test(phone);
    };

    it('should validate international phone format', () => {
      expect(validatePhoneNumber('+254712345678')).toBe(true);
      expect(validatePhoneNumber('+1234567890')).toBe(true);
    });

    it('should reject invalid phone numbers', () => {
      expect(validatePhoneNumber('invalid')).toBe(false);
      expect(validatePhoneNumber('+0123')).toBe(false);
      expect(validatePhoneNumber('712345678')).toBe(false);
    });
  });

  describe('Email Validation', () => {
    const validateEmail = (email) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    };

    it('should validate email addresses', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('test.user@example.co.uk')).toBe(true);
    });

    it('should reject invalid emails', () => {
      expect(validateEmail('invalid')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
    });
  });

  describe('Amount Formatting', () => {
    const formatCurrency = (amount, currency = 'USD') => {
      const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      });
      return formatter.format(amount);
    };

    it('should format amounts as currency', () => {
      expect(formatCurrency(1000)).toBe('$1,000.00');
      expect(formatCurrency(1000.5)).toBe('$1,000.50');
    });

    it('should support different currencies', () => {
      const kshFormatted = formatCurrency(1000, 'KES');
      expect(kshFormatted).toContain('1,000');
    });
  });

  describe('Date Utilities', () => {
    const getMonthLater = (date = new Date()) => {
      const next = new Date(date);
      next.setMonth(next.getMonth() + 1);
      return next;
    };

    const formatDate = (date) => {
      return date.toISOString().split('T')[0];
    };

    it('should calculate date one month later', () => {
      const today = new Date('2024-01-15');
      const next = getMonthLater(today);
      expect(next.getMonth()).toBe(1);
      expect(next.getDate()).toBe(15);
    });

    it('should format date as YYYY-MM-DD', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(formatDate(date)).toBe('2024-01-15');
    });
  });

  describe('Password Validation', () => {
    const validatePassword = (password) => {
      // At least 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char
      return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(password);
    };

    it('should validate strong passwords', () => {
      expect(validatePassword('SecurePass123!')).toBe(true);
      expect(validatePassword('MyPassword@123')).toBe(true);
    });

    it('should reject weak passwords', () => {
      expect(validatePassword('weak')).toBe(false);
      expect(validatePassword('NoSpecial123')).toBe(false);
      expect(validatePassword('nouppercas3!')).toBe(false);
      expect(validatePassword('NOLOWERCASE3!')).toBe(false);
    });
  });

  describe('JSON Web Token Utilities', () => {
    const jwt = require('jsonwebtoken');
    const secret = 'test-secret';

    const createToken = (data) => {
      return jwt.sign(data, secret, { expiresIn: '1h' });
    };

    const verifyToken = (token) => {
      try {
        return jwt.verify(token, secret);
      } catch (err) {
        return null;
      }
    };

    it('should create and verify tokens', () => {
      const data = { userId: '123', email: 'test@example.com' };
      const token = createToken(data);
      const decoded = verifyToken(token);

      expect(decoded).toBeTruthy();
      expect(decoded.userId).toBe('123');
      expect(decoded.email).toBe('test@example.com');
    });

    it('should reject expired tokens', () => {
      const token = jwt.sign({ userId: '123' }, secret, { expiresIn: '-1s' });
      const decoded = verifyToken(token);
      expect(decoded).toBeNull();
    });

    it('should reject tampered tokens', () => {
      const token = createToken({ userId: '123' });
      const tampered = token.slice(0, -5) + 'XXXXX';
      const decoded = verifyToken(tampered);
      expect(decoded).toBeNull();
    });
  });

  describe('Array Utilities', () => {
    const chunk = (arr, size) => {
      const result = [];
      for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
      }
      return result;
    };

    const unique = (arr) => [...new Set(arr)];

    const sum = (arr) => arr.reduce((acc, val) => acc + val, 0);

    it('should chunk arrays', () => {
      const result = chunk([1, 2, 3, 4, 5], 2);
      expect(result).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('should get unique values', () => {
      const result = unique([1, 2, 2, 3, 3, 3]);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should sum array values', () => {
      expect(sum([1, 2, 3, 4, 5])).toBe(15);
    });
  });

  describe('Error Handling', () => {
    const asyncHandler = (fn) => (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };

    it('should handle async errors', async () => {
      const error = new Error('Test error');
      const mockNext = jest.fn();

      const handler = asyncHandler(async () => {
        throw error;
      });

      await handler({}, {}, mockNext);
      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('Cache Utilities', () => {
    class Cache {
      constructor(ttl = 60000) {
        this.data = new Map();
        this.ttl = ttl;
      }

      set(key, value) {
        this.data.set(key, {
          value,
          expiresAt: Date.now() + this.ttl,
        });
      }

      get(key) {
        const item = this.data.get(key);
        if (!item) return null;
        if (item.expiresAt < Date.now()) {
          this.data.delete(key);
          return null;
        }
        return item.value;
      }

      clear() {
        this.data.clear();
      }
    }

    it('should cache and retrieve values', () => {
      const cache = new Cache(1000);
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should expire cached values', (done) => {
      const cache = new Cache(100);
      cache.set('key1', 'value1');

      setTimeout(() => {
        expect(cache.get('key1')).toBeNull();
        done();
      }, 150);
    });
  });

  describe('Pagination Utilities', () => {
    const paginate = (items, page = 1, limit = 10) => {
      const skip = (page - 1) * limit;
      return {
        items: items.slice(skip, skip + limit),
        pagination: {
          page,
          limit,
          total: items.length,
          pages: Math.ceil(items.length / limit),
        },
      };
    };

    it('should paginate arrays', () => {
      const items = Array.from({ length: 25 }, (_, i) => i + 1);
      const result = paginate(items, 2, 10);

      expect(result.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
      expect(result.pagination.pages).toBe(3);
    });
  });
});

module.exports = {};
