/**
 * ============================================================================
 * TITech Capital LTD
 * File: backend/tests/unit/utils/validateInput.test.js
 * Validation Utility Tests — Native ESM
 * ============================================================================
 *
 * Test coverage:
 * - Required input validation
 * - String validation
 * - Numeric and financial range validation
 * - Boolean validation
 * - Date validation
 * - Enumeration validation
 * - Email validation
 * - International phone validation
 * - MongoDB ObjectId validation
 * - Loan amount and interest-rate validation
 * - Loan application validation
 *
 * Module strategy:
 * - Backend package uses "type": "module".
 * - Production validation functions are imported directly.
 * - Jest APIs are imported explicitly from @jest/globals.
 * - No CommonJS require() or module.exports statements are used.
 * ============================================================================
 */

import mongoose from 'mongoose';

import {
  describe,
  test,
  expect,
} from '@jest/globals';

import {
  validateInput,
  validateString,
  validateNumber,
  validateBoolean,
  validateDate,
  validateEnum,
  validateEmail,
  validatePhoneNumber,
  validateObjectId,
  validateLoanAmount,
  validateInterestRate,
  validateLoanApplication,
} from '../../../utils/validateInput.js';

/* ============================================================================
 * REQUIRED INPUT
 * ========================================================================== */

describe('Validation Utility', () => {
  describe('validateInput', () => {
    test('should validate valid input', () => {
      expect(validateInput('Igune')).toBe(true);
    });

    test('should reject undefined', () => {
      expect(() =>
        validateInput(undefined, 'Name'),
      ).toThrow('Name is required');
    });

    test('should reject null', () => {
      expect(() =>
        validateInput(null, 'Name'),
      ).toThrow('Name is required');
    });

    test('should reject an empty string', () => {
      expect(() =>
        validateInput('', 'Name'),
      ).toThrow('Name is required');
    });

    test('should accept boolean false as a supplied value', () => {
      expect(validateInput(false, 'IsActive')).toBe(true);
    });

    test('should accept numeric zero as a supplied value', () => {
      expect(validateInput(0, 'Balance')).toBe(true);
    });
  });

  /* ==========================================================================
   * STRING VALIDATION
   * ========================================================================= */

  describe('validateString', () => {
    test('should validate a string', () => {
      expect(validateString('Igune', 'Name')).toBe(true);
    });

    test('should reject a string below the minimum length', () => {
      expect(() =>
        validateString('A', 'Name', {
          minLength: 3,
        }),
      ).toThrow();
    });

    test('should reject non-string input', () => {
      expect(() =>
        validateString(123, 'Name'),
      ).toThrow();
    });

    test('should reject a string exceeding the maximum length', () => {
      expect(() =>
        validateString('Robert', 'Name', {
          maxLength: 3,
        }),
      ).toThrow();
    });

    test('should reject whitespace-only input when trimming is enabled', () => {
      expect(() =>
        validateString('   ', 'Name'),
      ).toThrow();
    });
  });

  /* ==========================================================================
   * NUMBER VALIDATION
   * ========================================================================= */

  describe('validateNumber', () => {
    test('should validate a number', () => {
      expect(validateNumber(100, 'Amount')).toBe(true);
    });

    test('should reject an amount below the minimum', () => {
      expect(() =>
        validateNumber(-1, 'Amount', {
          min: 0,
        }),
      ).toThrow();
    });

    test('should reject a non-numeric string', () => {
      expect(() =>
        validateNumber('abc', 'Amount'),
      ).toThrow();
    });

    test('should reject NaN', () => {
      expect(() =>
        validateNumber(Number.NaN, 'Amount'),
      ).toThrow();
    });

    test('should reject positive infinity', () => {
      expect(() =>
        validateNumber(Number.POSITIVE_INFINITY, 'Amount'),
      ).toThrow();
    });

    test('should reject negative infinity', () => {
      expect(() =>
        validateNumber(Number.NEGATIVE_INFINITY, 'Amount'),
      ).toThrow();
    });

    test('should enforce the upper boundary', () => {
      expect(
        validateNumber(100, 'Amount', {
          min: 0,
          max: 100,
        }),
      ).toBe(true);

      expect(() =>
        validateNumber(101, 'Amount', {
          min: 0,
          max: 100,
        }),
      ).toThrow();
    });
  });

  /* ==========================================================================
   * BOOLEAN VALIDATION
   * ========================================================================= */

  describe('validateBoolean', () => {
    test('should validate true', () => {
      expect(validateBoolean(true, 'IsActive')).toBe(true);
    });

    test('should validate false', () => {
      expect(validateBoolean(false, 'IsActive')).toBe(true);
    });

    test('should reject a string instead of a boolean', () => {
      expect(() =>
        validateBoolean('true', 'IsActive'),
      ).toThrow();
    });

    test('should reject numeric values', () => {
      expect(() =>
        validateBoolean(1, 'IsActive'),
      ).toThrow();
    });
  });

  /* ==========================================================================
   * DATE VALIDATION
   * ========================================================================= */

  describe('validateDate', () => {
    test('should validate a valid date string', () => {
      expect(
        validateDate('2027-01-01', 'Date'),
      ).toBe(true);
    });

    test('should validate a Date instance', () => {
      expect(
        validateDate(
          new Date('2027-01-01T12:00:00Z'),
          'Date',
        ),
      ).toBe(true);
    });

    test('should reject an invalid date', () => {
      expect(() =>
        validateDate('invalid-date', 'Date'),
      ).toThrow();
    });

    test('should reject an invalid Date instance', () => {
      expect(() =>
        validateDate(new Date(Number.NaN), 'Date'),
      ).toThrow();
    });

    test('should enforce future-only dates', () => {
      expect(
        validateDate('2099-01-01T00:00:00Z', 'Date', {
          futureOnly: true,
        }),
      ).toBe(true);

      expect(() =>
        validateDate('2000-01-01T00:00:00Z', 'Date', {
          futureOnly: true,
        }),
      ).toThrow();
    });

    test('should enforce past-only dates', () => {
      expect(
        validateDate('2000-01-01T00:00:00Z', 'Date', {
          pastOnly: true,
        }),
      ).toBe(true);

      expect(() =>
        validateDate('2099-01-01T00:00:00Z', 'Date', {
          pastOnly: true,
        }),
      ).toThrow();
    });
  });

  /* ==========================================================================
   * ENUM VALIDATION
   * ========================================================================= */

  describe('validateEnum', () => {
    const allowedStatuses = [
      'ACTIVE',
      'INACTIVE',
    ];

    test('should validate an allowed enum value', () => {
      expect(
        validateEnum(
          'ACTIVE',
          'Status',
          allowedStatuses,
        ),
      ).toBe(true);
    });

    test('should reject a value outside the enum', () => {
      expect(() =>
        validateEnum(
          'PENDING',
          'Status',
          allowedStatuses,
        ),
      ).toThrow();
    });

    test('should reject a non-array allowed-values argument', () => {
      expect(() =>
        validateEnum('ACTIVE', 'Status', 'ACTIVE'),
      ).toThrow();
    });
  });

  /* ==========================================================================
   * EMAIL VALIDATION
   * ========================================================================= */

  describe('validateEmail', () => {
    test('should validate a valid email address', () => {
      expect(
        validateEmail('igune@test.com'),
      ).toBe(true);
    });

    test('should validate an email with a subdomain', () => {
      expect(
        validateEmail('member@mail.example.co.ug'),
      ).toBe(true);
    });

    test('should reject an invalid email address', () => {
      expect(() =>
        validateEmail('invalid-email'),
      ).toThrow();
    });

    test('should reject an email without a domain', () => {
      expect(() =>
        validateEmail('member@'),
      ).toThrow();
    });

    test('should reject an email without a local part', () => {
      expect(() =>
        validateEmail('@example.com'),
      ).toThrow();
    });
  });

  /* ==========================================================================
   * PHONE VALIDATION
   * ========================================================================= */

  describe('validatePhoneNumber', () => {
    test('should validate a Ugandan international number', () => {
      expect(
        validatePhoneNumber('+256772123546'),
      ).toBe(true);
    });

    test('should validate a Kenyan international number', () => {
      expect(
        validatePhoneNumber('+254712345678'),
      ).toBe(true);
    });

    test('should reject a malformed phone number', () => {
      expect(() =>
        validatePhoneNumber('123'),
      ).toThrow();
    });

    test('should reject a number without the international prefix', () => {
      expect(() =>
        validatePhoneNumber('0772123546'),
      ).toThrow();
    });

    test('should reject a number containing non-numeric characters', () => {
      expect(() =>
        validatePhoneNumber('+25677ABC1234'),
      ).toThrow();
    });
  });

  /* ==========================================================================
   * MONGODB OBJECT ID VALIDATION
   * ========================================================================= */

  describe('validateObjectId', () => {
    test('should validate an ObjectId instance', () => {
      const id = new mongoose.Types.ObjectId();

      expect(validateObjectId(id)).toBe(true);
    });

    test('should validate a canonical ObjectId string', () => {
      const id = new mongoose.Types.ObjectId().toHexString();

      expect(validateObjectId(id)).toBe(true);
    });

    test('should reject an invalid ObjectId', () => {
      expect(() =>
        validateObjectId('invalid-id'),
      ).toThrow();
    });

    test('should reject an arbitrary number as an ObjectId', () => {
      expect(() =>
        validateObjectId(123),
      ).toThrow();
    });
  });

  /* ==========================================================================
   * LOAN AMOUNT VALIDATION
   * ========================================================================= */

  describe('validateLoanAmount', () => {
    test('should validate a positive loan amount', () => {
      expect(validateLoanAmount(500000)).toBe(true);
    });

    test('should reject a zero loan amount', () => {
      expect(() =>
        validateLoanAmount(0),
      ).toThrow();
    });

    test('should reject a negative loan amount', () => {
      expect(() =>
        validateLoanAmount(-1000),
      ).toThrow();
    });

    test('should reject a non-finite loan amount', () => {
      expect(() =>
        validateLoanAmount(Number.POSITIVE_INFINITY),
      ).toThrow();
    });
  });

  /* ==========================================================================
   * INTEREST RATE VALIDATION
   * ========================================================================= */

  describe('validateInterestRate', () => {
    test('should validate a normal interest rate', () => {
      expect(validateInterestRate(15)).toBe(true);
    });

    test('should accept the zero-percent boundary', () => {
      expect(validateInterestRate(0)).toBe(true);
    });

    test('should accept the 100-percent boundary', () => {
      expect(validateInterestRate(100)).toBe(true);
    });

    test('should reject a rate above 100 percent', () => {
      expect(() =>
        validateInterestRate(150),
      ).toThrow();
    });

    test('should reject a negative rate', () => {
      expect(() =>
        validateInterestRate(-1),
      ).toThrow();
    });
  });

  /* ==========================================================================
   * LOAN APPLICATION VALIDATION
   * ========================================================================= */

  describe('validateLoanApplication', () => {
    function createValidLoanApplication(overrides = {}) {
      return {
        memberId: new mongoose.Types.ObjectId(),
        groupId: new mongoose.Types.ObjectId(),
        amount: 1000000,
        interestRate: 12,
        repaymentPeriod: 12,
        ...overrides,
      };
    }

    test('should validate a valid loan application', () => {
      expect(
        validateLoanApplication(
          createValidLoanApplication(),
        ),
      ).toBe(true);
    });

    test('should reject an invalid loan amount', () => {
      expect(() =>
        validateLoanApplication(
          createValidLoanApplication({
            amount: 0,
          }),
        ),
      ).toThrow();
    });

    test('should reject an invalid member ObjectId', () => {
      expect(() =>
        validateLoanApplication(
          createValidLoanApplication({
            memberId: 'invalid-member-id',
          }),
        ),
      ).toThrow();
    });

    test('should reject an invalid group ObjectId', () => {
      expect(() =>
        validateLoanApplication(
          createValidLoanApplication({
            groupId: 'invalid-group-id',
          }),
        ),
      ).toThrow();
    });

    test('should reject an excessive interest rate', () => {
      expect(() =>
        validateLoanApplication(
          createValidLoanApplication({
            interestRate: 150,
          }),
        ),
      ).toThrow();
    });

    test('should reject a fractional repayment period', () => {
      expect(() =>
        validateLoanApplication(
          createValidLoanApplication({
            repaymentPeriod: 12.5,
          }),
        ),
      ).toThrow();
    });

    test('should reject a null loan application', () => {
      expect(() =>
        validateLoanApplication(null),
      ).toThrow();
    });

    test('should reject a non-object loan application', () => {
      expect(() =>
        validateLoanApplication('invalid-payload'),
      ).toThrow();
    });
  });
});