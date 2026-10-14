
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDecimal,
  normalizeDecimal,
  add,
  subtract,
  compare,
  isPositive,
  isZero,
} from '../../../services/financial/money.js';

const NORMALIZATION_CASES = [
  ['0', '0'],
  ['0.00', '0'],
  ['000.0000', '0'],
  ['00010.5000', '10.5'],
  ['0000.0400', '0.04'],
  ['00123.4500', '123.45'],
  ['1000.000', '1000'],
  ['0.00000001', '0.00000001'],
  [
    '999999999999999999.9900',
    '999999999999999999.99',
  ],
];

const INVALID_DECIMAL_STRINGS = [
  '',
  '1e3',
  '-1',
  '-0.01',
  'NaN',
  'Infinity',
  '-Infinity',
  '1.2.3',
  '1..0',
  '.',
  '1,000',
];

test('normalizes exact decimal strings into canonical representations', () => {
  for (const [input, expected] of NORMALIZATION_CASES) {
    assert.equal(
      normalizeDecimal(input),
      expected,
      `normalizeDecimal(${JSON.stringify(input)}) must produce ${expected}`,
    );
  }
});

test('normalization is idempotent for canonical decimal values', () => {
  const values = [
    '0',
    '0.01',
    '10.5',
    '1000',
    '999999999999999999.99',
    '0.00000001',
  ];

  for (const value of values) {
    const normalized = normalizeDecimal(value);

    assert.equal(
      normalizeDecimal(normalized),
      normalized,
      `Normalizing ${value} twice must not change its representation`,
    );
  }
});

test('adds decimal strings exactly without floating-point arithmetic', () => {
  const cases = [
    ['0.10', '0.20', '0.3'],
    ['0', '0', '0'],
    ['0.00', '1.20', '1.2'],
    ['1.2', '0.003', '1.203'],
    ['0.999', '0.001', '1'],
    ['9.99', '0.01', '10'],
    [
      '999999999999999999.99',
      '0.01',
      '1000000000000000000',
    ],
    [
      '0.000000000000000001',
      '0.000000000000000009',
      '0.00000000000000001',
    ],
  ];

  for (const [left, right, expected] of cases) {
    assert.equal(
      add(left, right),
      expected,
      `${left} + ${right} must equal ${expected} exactly`,
    );
  }
});

test('subtracts decimal strings exactly with correct borrowing', () => {
  const cases = [
    ['1000.00', '0.01', '999.99'],
    ['1.00', '0.01', '0.99'],
    ['1.000', '0.001', '0.999'],
    ['10.00', '9.99', '0.01'],
    ['1.230', '0.23', '1'],
    ['2.50', '2.500', '0'],
    ['100', '0.01', '99.99'],
  ];

  for (const [left, right, expected] of cases) {
    assert.equal(
      subtract(left, right),
      expected,
      `${left} - ${right} must equal ${expected} exactly`,
    );
  }
});

test('compares monetary values exactly across equivalent decimal formats', () => {
  const cases = [
    ['1.230', '1.23', 0],
    ['0', '0.000', 0],
    ['00010.50', '10.5', 0],
    ['1.24', '1.23', 1],
    ['1.22', '1.23', -1],
    ['10', '9.99', 1],
    ['0.99', '1', -1],
    [
      '1000000000000000000',
      '999999999999999999.99',
      1,
    ],
    ['0.00000002', '0.00000001', 1],
  ];

  for (const [left, right, expected] of cases) {
    assert.equal(
      compare(left, right),
      expected,
      `compare(${left}, ${right}) must return ${expected}`,
    );
  }
});

test('comparison is consistent when operand order is reversed', () => {
  const cases = [
    ['0.01', '0.02'],
    ['1.20', '1.2'],
    ['999999999999999999.99', '1000000000000000000'],
  ];

  for (const [left, right] of cases) {
    const forward = compare(left, right);
    const reverse = compare(right, left);

    assert.equal(
      forward,
      -reverse,
      `Comparison must be antisymmetric for ${left} and ${right}`,
    );
  }
});

test('positive and zero predicates handle normalized decimal values', () => {
  assert.equal(isPositive('0.01'), true);
  assert.equal(isPositive('0000.0100'), true);
  assert.equal(isPositive('999999999999999999.99'), true);

  assert.equal(isPositive('0'), false);
  assert.equal(isPositive('0.00'), false);
  assert.equal(isPositive('000.0000'), false);

  assert.equal(isZero('0'), true);
  assert.equal(isZero('0.00'), true);
  assert.equal(isZero('000.0000'), true);

  assert.equal(isZero('0.01'), false);
  assert.equal(isZero('1.00'), false);
  assert.equal(isZero('0.00000001'), false);
});

test('assertDecimal rejects malformed, negative and scientific-notation strings', () => {
  for (const value of INVALID_DECIMAL_STRINGS) {
    assert.throws(
      () => assertDecimal(value),
      undefined,
      `assertDecimal must reject ${JSON.stringify(value)}`,
    );
  }
});

test('assertDecimal rejects JavaScript floating-point input', () => {
  assert.throws(
    () => assertDecimal(0.1),
    undefined,
    'A JavaScript floating-point number must not be accepted as a decimal string',
  );
});

test('arithmetic functions validate their operands', () => {
  const invalidOperations = [
    ['add: invalid left operand', () => add('1e3', '1')],
    ['add: invalid right operand', () => add('1', 'NaN')],
    ['subtract: invalid left operand', () => subtract('-1', '0')],
    ['subtract: invalid right operand', () => subtract('1', '1.2.3')],
    ['compare: invalid left operand', () => compare('Infinity', '1')],
    ['compare: invalid right operand', () => compare('1', '1e3')],
  ];

  for (const [description, operation] of invalidOperations) {
    assert.throws(
      operation,
      undefined,
      `${description} must fail validation`,
    );
  }
});

test('arithmetic functions reject JavaScript numeric operands', () => {
  assert.throws(
    () => add(0.1, '0.2'),
    undefined,
    'Addition must not silently accept a floating-point operand',
  );

  assert.throws(
    () => subtract('1', 0.1),
    undefined,
    'Subtraction must not silently accept a floating-point operand',
  );

  assert.throws(
    () => compare(1.23, '1.23'),
    undefined,
    'Comparison must not silently coerce a JavaScript number',
  );
});