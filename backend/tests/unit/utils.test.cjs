'use strict';

/**
 * TITech Community Capital
 * backend/tests/unit/utils.test.cjs
 *
 * Utility Functions Unit Tests
 * ============================================================================
 * Coverage:
 * - Phone number validation.
 * - Email validation.
 * - Currency formatting.
 * - Date calculation and formatting.
 * - Password validation.
 * - JSON Web Token verification.
 * - Array helpers.
 * - Asynchronous error handling.
 * - Cache expiration.
 * - Pagination.
 *
 * IMPORTANT:
 * validatePhoneNumber is imported from the real project utility.
 * The other helpers in this file are local contract examples. They must be
 * replaced with imports from their canonical production modules before this
 * file can be considered proof of those production utilities.
 */

const {
  validatePhoneNumber: assertValidPhoneNumber,
} = require('../../utils/validateInput.js');

const jwt = require('jsonwebtoken');

const JWT_TEST_SECRET =
  'titech-unit-test-only-secret-not-for-production';

// ============================================================================
// PHONE NUMBER VALIDATION
// ============================================================================

describe('Utility Functions — Phone Number Validation', () => {
  function validatePhoneNumber(phone) {
    try {
      assertValidPhoneNumber(phone);
      return true;
    } catch {
      return false;
    }
  }

  test.each([
    ['Kenyan international number', '+254712345678'],
    ['North American international number', '+1234567890'],
  ])('accepts a supported international number: %s', (_label, phone) => {
    expect(validatePhoneNumber(phone)).toBe(true);
  });

  test.each([
    ['arbitrary text', 'invalid'],
    ['incomplete international prefix', '+0123'],
    ['number without international prefix', '712345678'],
    ['empty string', ''],
    ['whitespace', '   '],
    ['missing number', null],
    ['numeric instead of string', 254712345678],
  ])('rejects an invalid phone number: %s', (_label, phone) => {
    expect(validatePhoneNumber(phone)).toBe(false);
  });

  test('does not throw through the boolean validation wrapper', () => {
    expect(() => validatePhoneNumber('invalid')).not.toThrow();
    expect(validatePhoneNumber('invalid')).toBe(false);
  });
});

// ============================================================================
// EMAIL VALIDATION
// ============================================================================

describe('Utility Functions — Email Validation', () => {
  /**
   * Lightweight structural email validation for these unit tests.
   *
   * Checks:
   * - A non-empty local part.
   * - No consecutive or leading/trailing dots in the local part.
   * - A domain containing valid, dot-separated labels.
   * - No leading or trailing hyphens in domain labels.
   * - An alphabetic final domain label of at least two characters.
   *
   * This is not a complete RFC email validator. Production validation
   * should use TITech's canonical validation module.
   */
  const EMAIL_PATTERN =
    /^(?!\.)(?!.*\.\.)[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

  function validateEmail(email) {
    return typeof email === 'string' && EMAIL_PATTERN.test(email);
  }

  test.each([
    'user@example.com',
    'test.user@example.co.uk',
    'first+tag@example.org',
    'user123@subdomain.example.com',
  ])('accepts a structurally valid email: %s', (email) => {
    expect(validateEmail(email)).toBe(true);
  });

  test.each([
    '',
    'invalid',
    'user@',
    '@example.com',
    'user@example',
    'user example@example.com',
    'user@@example.com',
    'user@example..com',
    'user..name@example.com',
    '.user@example.com',
    'user.@example.com',
    'user@-example.com',
    'user@example-.com',
    'user@example.c',
    ' user@example.com',
    'user@example.com ',
    null,
    undefined,
    123,
  ])('rejects an invalid email input: %s', (email) => {
    expect(validateEmail(email)).toBe(false);
  });
});

// ============================================================================
// CURRENCY FORMATTING
// ============================================================================

describe('Utility Functions — Amount Formatting', () => {
  function formatCurrency(amount, currency = 'USD') {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new TypeError('Amount must be a finite number');
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  }

  test.each([
    [1000, '$1,000.00'],
    [1000.5, '$1,000.50'],
    [0, '$0.00'],
    [-1000, '-$1,000.00'],
    [0.01, '$0.01'],
  ])('formats USD amount %s correctly', (amount, expected) => {
    expect(formatCurrency(amount, 'USD')).toBe(expected);
  });

  test('supports the Kenyan shilling currency', () => {
    expect(formatCurrency(1000, 'KES')).toContain('1,000');
  });

  test('supports the Ugandan shilling currency', () => {
    expect(formatCurrency(1000, 'UGX')).toContain('1,000');
  });

  test('supports an explicit currency code', () => {
    expect(() => formatCurrency(1000, 'EUR')).not.toThrow();
  });

  test.each([
    NaN,
    Infinity,
    -Infinity,
    null,
    undefined,
    '1000',
  ])('rejects a non-finite or non-numeric amount: %s', (amount) => {
    expect(() => formatCurrency(amount)).toThrow(TypeError);
  });

  test('rejects an invalid currency code', () => {
    expect(() => formatCurrency(1000, 'INVALID')).toThrow(RangeError);
  });
});

// ============================================================================
// DATE UTILITIES
// ============================================================================

describe('Utility Functions — Date Utilities', () => {
  /**
   * Adds one calendar month in UTC.
   *
   * If the target month has fewer days, clamps to its final day:
   * 2024-01-31 -> 2024-02-29
   * 2023-01-31 -> 2023-02-28
   *
   * This is an explicit test-local policy. Confirm that it matches TITech's
   * contractual due-date policy before using it for financial schedules.
   */
  function getMonthLater(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError('A valid Date is required');
    }

    const year = date.getUTCFullYear();
    const monthIndex = date.getUTCMonth() + 1;
    const targetYear = year + Math.floor(monthIndex / 12);
    const targetMonth = monthIndex % 12;
    const originalDay = date.getUTCDate();

    const lastDayOfTargetMonth = new Date(
      Date.UTC(targetYear, targetMonth + 1, 0),
    ).getUTCDate();

    return new Date(Date.UTC(
      targetYear,
      targetMonth,
      Math.min(originalDay, lastDayOfTargetMonth),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ));
  }

  function formatDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError('A valid Date is required');
    }

    return date.toISOString().slice(0, 10);
  }

  test('calculates the following calendar month', () => {
    const input = new Date('2024-01-15T10:30:00.000Z');
    const result = getMonthLater(input);

    expect(result.toISOString()).toBe('2024-02-15T10:30:00.000Z');
  });

  test('clamps January 31 to the last day of February in a leap year', () => {
    const result = getMonthLater(
      new Date('2024-01-31T12:00:00.000Z'),
    );

    expect(result.toISOString()).toBe('2024-02-29T12:00:00.000Z');
  });

  test('clamps January 31 to the last day of February in a non-leap year', () => {
    const result = getMonthLater(
      new Date('2023-01-31T12:00:00.000Z'),
    );

    expect(result.toISOString()).toBe('2023-02-28T12:00:00.000Z');
  });

  test('handles December-to-January rollover', () => {
    const result = getMonthLater(
      new Date('2026-12-15T12:00:00.000Z'),
    );

    expect(result.toISOString()).toBe('2027-01-15T12:00:00.000Z');
  });

  test('does not mutate the original date', () => {
    const input = new Date('2024-01-31T10:30:00.000Z');
    const originalTimestamp = input.getTime();

    getMonthLater(input);

    expect(input.getTime()).toBe(originalTimestamp);
  });

  test('formats a date as YYYY-MM-DD in UTC', () => {
    expect(
      formatDate(new Date('2024-01-15T10:30:00.000Z')),
    ).toBe('2024-01-15');
  });

  test('rejects invalid date values', () => {
    expect(() => formatDate(new Date(NaN))).toThrow(TypeError);
    expect(() => getMonthLater(new Date(NaN))).toThrow(TypeError);
    expect(() => formatDate('2024-01-15')).toThrow(TypeError);
  });
});

// ============================================================================
// PASSWORD VALIDATION
// ============================================================================

describe('Utility Functions — Password Validation', () => {
  /**
   * Test-local policy:
   * - At least 8 characters.
   * - At least one uppercase letter.
   * - At least one lowercase letter.
   * - At least one digit.
   * - At least one approved special character.
   *
   * This policy deliberately allows only the characters in the expression.
   * Align it with the actual production password policy before adoption.
   */
  const PASSWORD_PATTERN =
    /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!*?&])[A-Za-z\d@$!*?&]{8,}$/;

  function validatePassword(password) {
    return typeof password === 'string'
      && PASSWORD_PATTERN.test(password);
  }

  test.each([
    'SecurePass123!',
    'MyPassword@123',
    'Abcd1234$',
    'TITech2026!',
  ])('accepts a password meeting the policy: %s', (password) => {
    expect(validatePassword(password)).toBe(true);
  });

  test.each([
    'weak',
    'NoSpecial123',
    'nouppercas3!',
    'NOLOWERCASE3!',
    'NoDigits!',
    'Ab1!',
    'Password 123!',
    'Password123#',
    '',
    null,
    undefined,
    12345678,
  ])('rejects a password that violates the policy: %s', (password) => {
    expect(validatePassword(password)).toBe(false);
  });

  test('enforces the minimum length boundary', () => {
    expect(validatePassword('Aa1!xxxx')).toBe(true);
    expect(validatePassword('Aa1!xxx')).toBe(false);
  });
});

// ============================================================================
// JSON WEB TOKEN UTILITIES
// ============================================================================

describe('Utility Functions — JSON Web Token Utilities', () => {
  function createToken(data, options = {}) {
    return jwt.sign(data, JWT_TEST_SECRET, {
      expiresIn: '1h',
      ...options,
    });
  }

  function verifyToken(token) {
    try {
      return jwt.verify(token, JWT_TEST_SECRET);
    } catch {
      return null;
    }
  }

  test('creates and verifies a valid token', () => {
    const data = {
      userId: '123',
      email: 'test@example.com',
    };

    const token = createToken(data);
    const decoded = verifyToken(token);

    expect(decoded).toBeTruthy();
    expect(decoded.userId).toBe('123');
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.exp).toEqual(expect.any(Number));
  });

  test('rejects expired tokens', () => {
    const token = createToken(
      { userId: '123' },
      { expiresIn: '-1s' },
    );

    expect(verifyToken(token)).toBeNull();
  });

  test('rejects a token with a tampered payload', () => {
    const token = createToken({ userId: '123' });
    const [header, payload, signature] = token.split('.');
    const decodedPayload = jwt.decode(token);

    const tamperedPayload = Buffer.from(
      JSON.stringify({
        ...decodedPayload,
        userId: 'attacker-controlled-user',
      }),
    ).toString('base64url');

    const tamperedToken = [
      header,
      tamperedPayload,
      signature,
    ].join('.');

    expect(verifyToken(tamperedToken)).toBeNull();
  });

  test('rejects a token signed with the wrong secret', () => {
    const token = jwt.sign(
      { userId: '123' },
      'different-test-secret',
      { expiresIn: '1h' },
    );

    expect(verifyToken(token)).toBeNull();
  });

  test.each([
    '',
    'not-a-jwt',
    'header.payload',
    null,
    undefined,
    123,
  ])('rejects malformed token input: %s', (token) => {
    expect(verifyToken(token)).toBeNull();
  });
});

// ============================================================================
// ARRAY UTILITIES
// ============================================================================

describe('Utility Functions — Array Utilities', () => {
  function chunk(array, size) {
    if (!Array.isArray(array)) {
      throw new TypeError('Input must be an array');
    }

    if (!Number.isInteger(size) || size <= 0) {
      throw new RangeError('Chunk size must be a positive integer');
    }

    const result = [];

    for (let index = 0; index < array.length; index += size) {
      result.push(array.slice(index, index + size));
    }

    return result;
  }

  function unique(array) {
    if (!Array.isArray(array)) {
      throw new TypeError('Input must be an array');
    }

    return [...new Set(array)];
  }

  function sum(array) {
    if (!Array.isArray(array)) {
      throw new TypeError('Input must be an array');
    }

    if (!array.every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )) {
      throw new TypeError('Array values must be finite numbers');
    }

    return array.reduce((accumulator, value) => accumulator + value, 0);
  }

  test('chunks an array into fixed-size groups', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
  });

  test('returns an empty array when chunking an empty array', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  test('does not mutate the source array when chunking', () => {
    const source = [1, 2, 3, 4];
    const original = [...source];

    chunk(source, 2);

    expect(source).toEqual(original);
  });

  test.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
  ])('rejects invalid chunk size: %s', (size) => {
    expect(() => chunk([1, 2, 3], size)).toThrow(RangeError);
  });

  test('rejects non-array input when chunking', () => {
    expect(() => chunk('123', 2)).toThrow(TypeError);
  });

  test('returns unique values while preserving their original order', () => {
    expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });

  test('handles empty arrays and repeated NaN values', () => {
    expect(unique([])).toEqual([]);
    expect(unique([NaN, NaN, 1])).toEqual([NaN, 1]);
  });

  test('sums finite numeric values', () => {
    expect(sum([1, 2, 3, 4, 5])).toBe(15);
    expect(sum([-2, 2, 10])).toBe(10);
    expect(sum([])).toBe(0);
  });

  test('rejects non-numeric and non-finite values when summing', () => {
    expect(() => sum([1, '2', 3])).toThrow(TypeError);
    expect(() => sum([1, NaN])).toThrow(TypeError);
    expect(() => sum([1, Infinity])).toThrow(TypeError);
  });
});

// ============================================================================
// ASYNCHRONOUS ERROR HANDLING
// ============================================================================

describe('Utility Functions — Error Handling', () => {
  function asyncHandler(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('Handler must be a function');
    }

    return (req, res, next) => Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  }

  test('forwards asynchronous errors to next', async () => {
    const error = new Error('Test asynchronous error');
    const mockNext = jest.fn();

    const handler = asyncHandler(async () => {
      throw error;
    });

    await handler({}, {}, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockNext).toHaveBeenCalledWith(error);
  });

  test('forwards synchronous errors to next', async () => {
    const error = new Error('Test synchronous error');
    const mockNext = jest.fn();

    const handler = asyncHandler(() => {
      throw error;
    });

    await handler({}, {}, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockNext).toHaveBeenCalledWith(error);
  });

  test('does not call next when the handler succeeds', async () => {
    const mockNext = jest.fn();

    const handler = asyncHandler(async (_req, res) => {
      res.status = 200;
      return 'success';
    });

    const response = {};
    const result = await handler({}, response, mockNext);

    expect(result).toBe('success');
    expect(response.status).toBe(200);
    expect(mockNext).not.toHaveBeenCalled();
  });

  test('rejects an invalid handler at construction time', () => {
    expect(() => asyncHandler(null)).toThrow(TypeError);
  });
});

// ============================================================================
// CACHE UTILITIES
// ============================================================================

describe('Utility Functions — Cache Utilities', () => {
  /**
   * Test-local cache with an injectable clock so expiration tests are
   * deterministic and do not depend on real timers.
   */
  class Cache {
    constructor(ttl = 60000, now = () => Date.now()) {
      if (!Number.isFinite(ttl) || ttl < 0) {
        throw new RangeError('TTL must be a finite nonnegative number');
      }

      if (typeof now !== 'function') {
        throw new TypeError('Clock must be a function');
      }

      this.data = new Map();
      this.ttl = ttl;
      this.now = now;
    }

    set(key, value) {
      this.data.set(key, {
        value,
        expiresAt: this.now() + this.ttl,
      });
    }

    get(key) {
      const item = this.data.get(key);

      if (!item) {
        return null;
      }

      if (item.expiresAt <= this.now()) {
        this.data.delete(key);
        return null;
      }

      return item.value;
    }

    clear() {
      this.data.clear();
    }
  }

  test('caches and retrieves values', () => {
    const cache = new Cache(1000, () => 1000);

    cache.set('key1', 'value1');

    expect(cache.get('key1')).toBe('value1');
  });

  test('returns null for a missing key', () => {
    const cache = new Cache();

    expect(cache.get('missing')).toBeNull();
  });

  test('expires a value at the TTL boundary', () => {
    let now = 1000;
    const cache = new Cache(100, () => now);

    cache.set('key1', 'value1');

    now = 1099;
    expect(cache.get('key1')).toBe('value1');

    now = 1100;
    expect(cache.get('key1')).toBeNull();
    expect(cache.data.has('key1')).toBe(false);
  });

  test('refreshes expiry when a value is replaced', () => {
    let now = 1000;
    const cache = new Cache(100, () => now);

    cache.set('key1', 'first');

    now = 1050;
    cache.set('key1', 'second');

    now = 1100;
    expect(cache.get('key1')).toBe('second');

    now = 1150;
    expect(cache.get('key1')).toBeNull();
  });

  test('clears all cached entries', () => {
    const cache = new Cache();

    cache.set('a', 1);
    cache.set('b', 2);

    cache.clear();

    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
    expect(cache.data.size).toBe(0);
  });

  test('rejects invalid TTL values', () => {
    expect(() => new Cache(-1)).toThrow(RangeError);
    expect(() => new Cache(NaN)).toThrow(RangeError);
    expect(() => new Cache(Infinity)).toThrow(RangeError);
  });

  test('rejects an invalid clock', () => {
    expect(() => new Cache(1000, null)).toThrow(TypeError);
  });
});

// ============================================================================
// PAGINATION UTILITIES
// ============================================================================

describe('Utility Functions — Pagination Utilities', () => {
  function paginate(items, page = 1, limit = 10) {
    if (!Array.isArray(items)) {
      throw new TypeError('Items must be an array');
    }

    if (!Number.isInteger(page) || page < 1) {
      throw new RangeError('Page must be a positive integer');
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('Limit must be a positive integer');
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
  }

  test('returns the requested page', () => {
    const items = Array.from({ length: 25 }, (_value, index) => index + 1);
    const result = paginate(items, 2, 10);

    expect(result.items).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);

    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      pages: 3,
    });
  });

  test('applies default page and limit values', () => {
    const result = paginate([1, 2, 3]);

    expect(result.items).toEqual([1, 2, 3]);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.pages).toBe(1);
  });

  test('returns an empty item list for an out-of-range page', () => {
    const result = paginate([1, 2, 3], 5, 2);

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(3);
    expect(result.pagination.pages).toBe(2);
  });

  test('reports zero pages for an empty collection', () => {
    const result = paginate([], 1, 10);

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.pages).toBe(0);
  });

  test('does not mutate the original items array', () => {
    const items = [1, 2, 3, 4, 5];
    const original = [...items];

    paginate(items, 2, 2);

    expect(items).toEqual(original);
  });

  test.each([
    [0, 10],
    [-1, 10],
    [1.5, 10],
    [1, 0],
    [1, -1],
    [1, 2.5],
  ])('rejects invalid page/limit arguments: page=%s, limit=%s', (
    page,
    limit,
  ) => {
    expect(() => paginate([1, 2, 3], page, limit)).toThrow(RangeError);
  });

  test('rejects non-array items', () => {
    expect(() => paginate('not-an-array')).toThrow(TypeError);
  });
});