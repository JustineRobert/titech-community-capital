
/**
 * ============================================================================
 * TITech Community Capital
 * File: backend/tests/unit/utils.test.js
 * Utility Functions Unit Tests — Native ESM
 * ============================================================================
 *
 * Coverage:
 * - Phone-number validation
 * - Email validation
 * - Currency formatting
 * - Date utilities
 * - Password validation
 * - JSON Web Token operations
 * - Array utilities
 * - Asynchronous error handling
 * - Cache expiry
 * - Pagination
 *
 * Uses Jest's explicit ESM API imports.
 * ============================================================================
 */

import {
  describe,
  it,
  expect,
  jest,
} from '@jest/globals';

import jwt from 'jsonwebtoken';

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

describe('Utility Functions', () => {
  /* ------------------------------------------------------------------------
   * Phone Number Validation
   * ---------------------------------------------------------------------- */

  describe('Phone Number Validation', () => {
    const validatePhoneNumber = (phone) => {
      if (typeof phone !== 'string') {
        return false;
      }

      // E.164: leading plus, non-zero country code, 8–15 digits.
      const phoneRegex = /^\+[1-9]\d{7,14}$/;

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
      expect(validatePhoneNumber('')).toBe(false);
      expect(validatePhoneNumber(null)).toBe(false);
      expect(validatePhoneNumber(254712345678)).toBe(false);
    });
  });

  /* ------------------------------------------------------------------------
   * Email Validation
   * ---------------------------------------------------------------------- */

  describe('Email Validation', () => {
    const validateEmail = (email) => {
      if (typeof email !== 'string') {
        return false;
      }

      const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      expect(validateEmail('user example@example.com')).toBe(false);
      expect(validateEmail('')).toBe(false);
      expect(validateEmail(null)).toBe(false);
    });
  });

  /* ------------------------------------------------------------------------
   * Currency Formatting
   * ---------------------------------------------------------------------- */

  describe('Amount Formatting', () => {
    const formatCurrency = (amount, currency = 'USD') => {
      if (
        typeof amount !== 'number' ||
        !Number.isFinite(amount)
      ) {
        throw new TypeError(
          'Currency amount must be a finite number.',
        );
      }

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
      const kesFormatted = formatCurrency(1000, 'KES');

      expect(kesFormatted).toContain('1,000');
    });

    it('should reject invalid currency amounts', () => {
      expect(() => formatCurrency(Number.NaN)).toThrow(TypeError);
      expect(() => formatCurrency(Number.POSITIVE_INFINITY)).toThrow(
        TypeError,
      );
      expect(() => formatCurrency('1000')).toThrow(TypeError);
    });
  });

  /* ------------------------------------------------------------------------
   * Date Utilities
   * ---------------------------------------------------------------------- */

  describe('Date Utilities', () => {
    /**
     * Add one calendar month while clamping the day to the last valid day
     * of the destination month.
     *
     * For example, January 31 advances to the final day of February
     * instead of overflowing into March.
     */
    const getMonthLater = (date = new Date()) => {
      const source = new Date(date);

      if (Number.isNaN(source.getTime())) {
        throw new TypeError('A valid date is required.');
      }

      const originalDay = source.getDate();

      const next = new Date(source);
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);

      const lastDayOfTargetMonth = new Date(
        next.getFullYear(),
        next.getMonth() + 1,
        0,
      ).getDate();

      next.setDate(
        Math.min(originalDay, lastDayOfTargetMonth),
      );

      return next;
    };

    const formatDate = (date) => {
      const value = new Date(date);

      if (Number.isNaN(value.getTime())) {
        throw new TypeError('A valid date is required.');
      }

      return value.toISOString().split('T')[0];
    };

    it('should calculate date one month later', () => {
      const today = new Date('2024-01-15T12:00:00Z');
      const next = getMonthLater(today);

      expect(next.getMonth()).toBe(1);
      expect(next.getDate()).toBe(15);
    });

    it('should clamp month-end dates instead of overflowing', () => {
      const january31 = new Date('2024-01-31T12:00:00Z');
      const next = getMonthLater(january31);

      expect(next.getMonth()).toBe(1);
      expect(next.getDate()).toBe(29);
    });

    it('should format date as YYYY-MM-DD', () => {
      const date = new Date('2024-01-15T10:30:00Z');

      expect(formatDate(date)).toBe('2024-01-15');
    });

    it('should reject invalid dates', () => {
      expect(() => formatDate('invalid-date')).toThrow(TypeError);
      expect(() => getMonthLater('invalid-date')).toThrow(TypeError);
    });
  });

  /* ------------------------------------------------------------------------
   * Password Validation
   * ---------------------------------------------------------------------- */

  describe('Password Validation', () => {
    const validatePassword = (password) => {
      if (typeof password !== 'string') {
        return false;
      }

      /*
       * At least eight characters, including:
       * - One uppercase letter
       * - One lowercase letter
       * - One digit
       * - One permitted special character
       */
      const passwordRegex =
        /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

      return passwordRegex.test(password);
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
      expect(validatePassword('')).toBe(false);
      expect(validatePassword(null)).toBe(false);
    });
  });

  /* ------------------------------------------------------------------------
   * JSON Web Token Utilities
   * ---------------------------------------------------------------------- */

  describe('JSON Web Token Utilities', () => {
    const secret = 'test-secret';

    const createToken = (data) => {
      return jwt.sign(data, secret, {
        expiresIn: '1h',
      });
    };

    const verifyToken = (token) => {
      try {
        return jwt.verify(token, secret);
      } catch {
        return null;
      }
    };

    it('should create and verify tokens', () => {
      const data = {
        userId: '123',
        email: 'test@example.com',
      };

      const token = createToken(data);
      const decoded = verifyToken(token);

      expect(decoded).toBeTruthy();
      expect(decoded.userId).toBe('123');
      expect(decoded.email).toBe('test@example.com');
    });

    it('should reject expired tokens', () => {
      const token = jwt.sign(
        { userId: '123' },
        secret,
        { expiresIn: '-1s' },
      );

      expect(verifyToken(token)).toBeNull();
    });

    it('should reject tampered tokens', () => {
      const token = createToken({ userId: '123' });
      const tampered = token.slice(0, -5) + 'XXXXX';

      expect(verifyToken(tampered)).toBeNull();
    });

    it('should reject tokens signed with another secret', () => {
      const token = jwt.sign(
        { userId: '123' },
        'different-test-secret',
      );

      expect(verifyToken(token)).toBeNull();
    });
  });

  /* ------------------------------------------------------------------------
   * Array Utilities
   * ---------------------------------------------------------------------- */

  describe('Array Utilities', () => {
    const chunk = (arr, size) => {
      if (!Array.isArray(arr)) {
        throw new TypeError('Input must be an array.');
      }

      if (!Number.isInteger(size) || size <= 0) {
        throw new RangeError(
          'Chunk size must be a positive integer.',
        );
      }

      const result = [];

      for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
      }

      return result;
    };

    const unique = (arr) => {
      if (!Array.isArray(arr)) {
        throw new TypeError('Input must be an array.');
      }

      return [...new Set(arr)];
    };

    const sum = (arr) => {
      if (!Array.isArray(arr)) {
        throw new TypeError('Input must be an array.');
      }

      if (
        arr.some(
          (value) =>
            typeof value !== 'number' ||
            !Number.isFinite(value),
        )
      ) {
        throw new TypeError(
          'All array values must be finite numbers.',
        );
      }

      return arr.reduce((acc, value) => acc + value, 0);
    };

    it('should chunk arrays', () => {
      const result = chunk([1, 2, 3, 4, 5], 2);

      expect(result).toEqual([
        [1, 2],
        [3, 4],
        [5],
      ]);
    });

    it('should reject invalid chunk sizes', () => {
      expect(() => chunk([1, 2], 0)).toThrow(RangeError);
      expect(() => chunk([1, 2], -1)).toThrow(RangeError);
      expect(() => chunk([1, 2], 1.5)).toThrow(RangeError);
    });

    it('should get unique values', () => {
      const result = unique([1, 2, 2, 3, 3, 3]);

      expect(result).toEqual([1, 2, 3]);
    });

    it('should sum array values', () => {
      expect(sum([1, 2, 3, 4, 5])).toBe(15);
      expect(sum([])).toBe(0);
    });

    it('should reject non-finite array values', () => {
      expect(() => sum([1, Number.NaN])).toThrow(TypeError);
      expect(() => sum([1, Number.POSITIVE_INFINITY])).toThrow(TypeError);
    });
  });

  /* ------------------------------------------------------------------------
   * Error Handling
   * ---------------------------------------------------------------------- */

  describe('Error Handling', () => {
    const asyncHandler = (fn) => (req, res, next) => {
      return Promise.resolve()
        .then(() => fn(req, res, next))
        .catch(next);
    };

    it('should forward asynchronous errors', async () => {
      const error = new Error('Test error');
      const mockNext = jest.fn();

      const handler = asyncHandler(async () => {
        throw error;
      });

      await handler({}, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should forward synchronous errors', async () => {
      const error = new Error('Synchronous test error');
      const mockNext = jest.fn();

      const handler = asyncHandler(() => {
        throw error;
      });

      await handler({}, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  /* ------------------------------------------------------------------------
   * Cache Utilities
   * ---------------------------------------------------------------------- */

  describe('Cache Utilities', () => {
    class Cache {
      constructor(ttl = 60000) {
        if (!Number.isFinite(ttl) || ttl < 0) {
          throw new RangeError(
            'Cache TTL must be a non-negative finite number.',
          );
        }

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

        if (!item) {
          return null;
        }

        if (item.expiresAt <= Date.now()) {
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

    it('should expire cached values at the TTL boundary', () => {
      jest.useFakeTimers();

      try {
        const cache = new Cache(100);

        cache.set('key1', 'value1');

        expect(cache.get('key1')).toBe('value1');

        jest.advanceTimersByTime(100);

        expect(cache.get('key1')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should clear cached entries', () => {
      const cache = new Cache(1000);

      cache.set('key1', 'value1');
      cache.clear();

      expect(cache.get('key1')).toBeNull();
    });

    it('should reject invalid TTL values', () => {
      expect(() => new Cache(-1)).toThrow(RangeError);
      expect(() => new Cache(Number.NaN)).toThrow(RangeError);
    });
  });

  /* ------------------------------------------------------------------------
   * Pagination Utilities
   * ---------------------------------------------------------------------- */

  describe('Pagination Utilities', () => {
    const paginate = (items, page = 1, limit = 10) => {
      if (!Array.isArray(items)) {
        throw new TypeError('Items must be an array.');
      }

      if (!Number.isInteger(page) || page < 1) {
        throw new RangeError(
          'Page must be a positive integer.',
        );
      }

      if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError(
          'Limit must be a positive integer.',
        );
      }

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
      const items = Array.from(
        { length: 25 },
        (_, index) => index + 1,
      );

      const result = paginate(items, 2, 10);

      expect(result.items).toEqual([
        11, 12, 13, 14, 15,
        16, 17, 18, 19, 20,
      ]);

      expect(result.pagination.pages).toBe(3);
      expect(result.pagination.total).toBe(25);
    });

    it('should reject invalid page and limit values', () => {
      expect(() => paginate([1, 2], 0, 10)).toThrow(RangeError);
      expect(() => paginate([1, 2], 1, 0)).toThrow(RangeError);
      expect(() => paginate([1, 2], 1.5, 10)).toThrow(RangeError);
    });
  });
});
