"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Money Utility
 * ============================================================================
 *
 * File:
 *   backend/utils/money.js
 *
 * Purpose:
 *   Canonical exact monetary arithmetic utility for TITech Community Capital.
 *
 * Architectural Role:
 *
 *   Transaction Service
 *          │
 *          ├───────────────┐
 *          ▼               ▼
 *   BalanceRepository   LedgerService
 *          │               │
 *          └───────┬───────┘
 *                  ▼
 *              Money Utility
 *                  │
 *                  ▼
 *            MongoDB Decimal128
 *
 * ============================================================================
 * FINANCIAL SAFETY MODEL
 * ============================================================================
 *
 * JavaScript Number is NOT used for monetary arithmetic.
 *
 * Example of the problem this utility prevents:
 *
 *   0.1 + 0.2 !== 0.3
 *
 * Internally this utility represents decimal values using:
 *
 *   BigInt coefficient + decimal scale
 *
 * Example:
 *
 *   "123.45"
 *
 * becomes conceptually:
 *
 *   coefficient = 12345n
 *   scale       = 2
 *
 * Arithmetic therefore remains exact.
 *
 * ============================================================================
 * CORE PRINCIPLES
 * ============================================================================
 *
 * ✓ No floating-point monetary arithmetic.
 * ✓ No implicit Number conversion.
 * ✓ MongoDB Decimal128 interoperability.
 * ✓ Exact addition and subtraction.
 * ✓ Exact comparison.
 * ✓ Exact integer multiplication.
 * ✓ Exact division with explicit rounding.
 * ✓ Explicit decimal quantization.
 * ✓ Explicit rounding modes.
 * ✓ Currency-aware Money objects.
 * ✓ Immutable Money instances.
 * ✓ Negative values supported where legitimate.
 * ✓ Non-negative validation available.
 * ✓ Zero handling is deterministic.
 * ✓ Invalid monetary values are rejected.
 * ✓ NaN and Infinity are rejected.
 * ✓ Scientific notation is supported.
 * ✓ Decimal128 values are preserved without floating-point conversion.
 * ✓ Safe serialization to strings.
 * ✓ Suitable for financial repositories and ledger services.
 *
 * ============================================================================
 * IMPORTANT ARCHITECTURAL RULE
 * ============================================================================
 *
 * This utility performs arithmetic only.
 *
 * It does NOT:
 *
 *   - authorize transactions
 *   - authorize withdrawals
 *   - authorize deposits
 *   - authorize transfers
 *   - mutate Account documents
 *   - create ledger entries
 *   - start MongoDB sessions
 *   - commit MongoDB transactions
 *   - perform provider operations
 *   - perform KYC/AML decisions
 *   - enforce tenant authorization
 *
 * Those responsibilities belong to the appropriate service/repository layers.
 *
 * ============================================================================
 * CURRENCY
 * ============================================================================
 *
 * Currency is optional at the primitive utility level but strongly recommended
 * for Money instances used by financial services.
 *
 * Currency values must use ISO-style uppercase alphabetic identifiers.
 *
 * Examples:
 *
 *   UGX
 *   USD
 *   EUR
 *   KES
 *   TZS
 *
 * The utility intentionally permits 3-16 uppercase alphabetic characters so
 * that future TITech-supported currencies can be introduced without changing
 * this low-level arithmetic boundary.
 *
 * ============================================================================
 * ROUNDING
 * ============================================================================
 *
 * Supported rounding modes:
 *
 *   HALF_UP
 *   HALF_DOWN
 *   HALF_EVEN
 *   UP
 *   DOWN
 *   CEILING
 *   FLOOR
 *
 * Default:
 *
 *   HALF_UP
 *
 * Financial code should explicitly select the rounding policy whenever
 * rounding is required.
 *
 * ============================================================================
 */

const mongoose = require("mongoose");

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const CURRENCY_REGEX = /^[A-Z]{3,16}$/;

const MAX_CURRENCY_LENGTH = 16;

/**
 * Decimal128 supports up to 34 significant decimal digits.
 *
 * This utility uses BigInt internally, so the arithmetic representation itself
 * is not restricted to 34 digits. Values are ultimately validated when they
 * are converted back to Decimal128.
 */
const DECIMAL128_MAX_PRECISION = 34;

/**
 * Maximum practical decimal scale accepted by this utility.
 *
 * Decimal128 itself permits a much wider exponent range, but financial
 * application values should remain bounded to prevent pathological inputs.
 */
const MAX_SCALE = 6143;

const ROUNDING_MODES = Object.freeze({
    HALF_UP: "HALF_UP",
    HALF_DOWN: "HALF_DOWN",
    HALF_EVEN: "HALF_EVEN",
    UP: "UP",
    DOWN: "DOWN",
    CEILING: "CEILING",
    FLOOR: "FLOOR"
});

const ROUNDING_MODE_VALUES = Object.freeze(
    Object.values(ROUNDING_MODES)
);

/**
 * ============================================================================
 * Error Classes
 * ============================================================================
 */

/**
 * Base money error.
 */
class MoneyError extends Error {
    constructor(message, code = "MONEY_ERROR") {
        super(message);

        this.name = "MoneyError";
        this.code = code;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, MoneyError);
        }
    }
}

/**
 * Invalid monetary input.
 */
class MoneyValidationError extends MoneyError {
    constructor(message) {
        super(message, "MONEY_VALIDATION_ERROR");
        this.name = "MoneyValidationError";
    }
}

/**
 * Currency mismatch.
 */
class CurrencyMismatchError extends MoneyError {
    constructor(expected, actual) {
        super(
            `Currency mismatch. Expected ${expected}, received ${actual}.`,
            "CURRENCY_MISMATCH"
        );

        this.name = "CurrencyMismatchError";
        this.expectedCurrency = expected;
        this.actualCurrency = actual;
    }
}

/**
 * Arithmetic error.
 */
class MoneyArithmeticError extends MoneyError {
    constructor(message) {
        super(message, "MONEY_ARITHMETIC_ERROR");
        this.name = "MoneyArithmeticError";
    }
}

/**
 * ============================================================================
 * Primitive Helpers
 * ============================================================================
 */

/**
 * Determine whether a value is a MongoDB Decimal128 instance.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isDecimal128(value) {
    return (
        value !== null &&
        value !== undefined &&
        mongoose.isDecimal128(value)
    );
}

/**
 * Normalize currency.
 *
 * @param {*} currency
 * @returns {string}
 */
function normalizeCurrency(currency) {
    if (typeof currency !== "string") {
        throw new MoneyValidationError(
            "Currency must be a string."
        );
    }

    const normalized = currency
        .trim()
        .toUpperCase();

    if (
        !normalized ||
        normalized.length > MAX_CURRENCY_LENGTH ||
        !CURRENCY_REGEX.test(normalized)
    ) {
        throw new MoneyValidationError(
            "Invalid monetary currency."
        );
    }

    return normalized;
}

/**
 * Normalize a decimal input into a string without using Number.
 *
 * Supported:
 *
 *   string
 *   Decimal128
 *   bigint
 *   integer-safe Number
 *   Money
 *
 * Unsafe/non-integer JavaScript Numbers are rejected intentionally.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeDecimalInput(value) {
    if (value instanceof Money) {
        return value.toString();
    }

    if (isDecimal128(value)) {
        return value.toString();
    }

    if (typeof value === "bigint") {
        return value.toString();
    }

    if (typeof value === "string") {
        const normalized = value.trim();

        if (!normalized) {
            throw new MoneyValidationError(
                "Monetary value cannot be empty."
            );
        }

        return normalized;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new MoneyValidationError(
                "Monetary value must be finite."
            );
        }

        /**
         * Only integer Numbers are accepted.
         *
         * Decimal JavaScript Numbers are rejected because their binary
         * floating-point representation cannot safely represent arbitrary
         * monetary decimals.
         */
        if (!Number.isInteger(value)) {
            throw new MoneyValidationError(
                "Decimal JavaScript Numbers are prohibited for monetary arithmetic. Use a string, bigint, Decimal128, or Money instance."
            );
        }

        if (!Number.isSafeInteger(value)) {
            throw new MoneyValidationError(
                "Unsafe JavaScript integer cannot be used as a monetary value."
            );
        }

        return String(value);
    }

    throw new MoneyValidationError(
        "Unsupported monetary value type."
    );
}

/**
 * ============================================================================
 * Decimal Parser
 * ============================================================================
 *
 * Converts:
 *
 *   "123.45"
 *   "-123.45"
 *   "1.2345E+3"
 *   "1E-6"
 *
 * into:
 *
 *   {
 *      coefficient: BigInt,
 *      scale: number
 *   }
 *
 * Meaning:
 *
 *   value = coefficient / 10^scale
 *
 * ============================================================================
 */

function parseDecimal(value) {
    const input = normalizeDecimalInput(value);

    /**
     * Decimal128 special values are deliberately prohibited.
     */
    if (
        input === "NaN" ||
        input === "+NaN" ||
        input === "-NaN" ||
        input === "Infinity" ||
        input === "+Infinity" ||
        input === "-Infinity"
    ) {
        throw new MoneyValidationError(
            "NaN and Infinity are not valid monetary values."
        );
    }

    const match = input.match(
        /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/
    );

    if (!match) {
        throw new MoneyValidationError(
            `Invalid monetary decimal value: ${input}`
        );
    }

    const sign = match[1] === "-" ? -1n : 1n;

    const integerPart = match[2] || "0";
    const fractionalPart =
        match[3] !== undefined
            ? match[3]
            : match[4] || "";

    const exponent = match[5]
        ? Number.parseInt(match[5], 10)
        : 0;

    if (!Number.isSafeInteger(exponent)) {
        throw new MoneyValidationError(
            "Decimal exponent is outside the supported range."
        );
    }

    let digits =
        `${integerPart}${fractionalPart}`;

    /**
     * Remove leading zeroes.
     */
    digits = digits.replace(
        /^0+(?=\d)/,
        ""
    );

    /**
     * Remove trailing fractional zeroes.
     *
     * This produces a canonical representation.
     */
    let scale = fractionalPart.length;

    digits = digits.replace(
        /0+$/,
        ""
    );

    /**
     * A value consisting entirely of zeroes is always represented as:
     *
     *   0 / 10^0
     */
    if (!digits) {
        return {
            coefficient: 0n,
            scale: 0
        };
    }

    /**
     * Scientific notation changes the decimal scale.
     *
     * Example:
     *
     *   1.23E+2
     *
     * coefficient = 123
     * scale       = 2
     * exponent    = +2
     *
     * final scale = 0
     */
    scale -= exponent;

    /**
     * If scale is negative, move the decimal point to the right.
     */
    if (scale < 0) {
        digits += "0".repeat(-scale);
        scale = 0;
    }

    /**
     * If scale is positive, preserve the decimal places.
     */
    if (scale > MAX_SCALE) {
        throw new MoneyValidationError(
            "Monetary decimal scale exceeds the supported limit."
        );
    }

    let coefficient = BigInt(digits);

    if (sign < 0n) {
        coefficient = -coefficient;
    }

    return {
        coefficient,
        scale
    };
}

/**
 * ============================================================================
 * Decimal Normalization
 * ============================================================================
 */

/**
 * Remove redundant trailing decimal zeroes.
 *
 * @param {{coefficient: bigint, scale: number}} decimal
 * @returns {{coefficient: bigint, scale: number}}
 */
function normalizeDecimal(decimal) {
    let coefficient = decimal.coefficient;
    let scale = decimal.scale;

    if (coefficient === 0n) {
        return {
            coefficient: 0n,
            scale: 0
        };
    }

    while (
        scale > 0 &&
        coefficient % 10n === 0n
    ) {
        coefficient /= 10n;
        scale -= 1;
    }

    return {
        coefficient,
        scale
    };
}

/**
 * ============================================================================
 * Decimal Formatting
 * ============================================================================
 */

/**
 * Convert an internal decimal representation into a canonical plain decimal
 * string.
 *
 * No scientific notation is emitted here.
 *
 * @param {{coefficient: bigint, scale: number}} decimal
 * @returns {string}
 */
function decimalToPlainString(decimal) {
    const normalized =
        normalizeDecimal(decimal);

    let coefficient =
        normalized.coefficient;

    const scale = normalized.scale;

    if (coefficient === 0n) {
        return "0";
    }

    const negative = coefficient < 0n;

    if (negative) {
        coefficient = -coefficient;
    }

    let digits = coefficient.toString();

    if (scale === 0) {
        return negative
            ? `-${digits}`
            : digits;
    }

    if (digits.length <= scale) {
        digits =
            `${"0".repeat(
                scale - digits.length + 1
            )}${digits}`;
    }

    const splitPosition =
        digits.length - scale;

    const integerPart =
        digits.slice(
            0,
            splitPosition
        );

    const fractionalPart =
        digits.slice(
            splitPosition
        );

    const result =
        `${integerPart}.${fractionalPart}`;

    return negative
        ? `-${result}`
        : result;
}

/**
 * ============================================================================
 * Decimal128 Conversion
 * ============================================================================
 */

/**
 * Convert a decimal representation to MongoDB Decimal128.
 *
 * @param {{coefficient: bigint, scale: number}} decimal
 * @returns {mongoose.Types.Decimal128}
 */
function decimalToDecimal128(decimal) {
    const normalized =
        normalizeDecimal(decimal);

    const plain =
        decimalToPlainString(normalized);

    /**
     * Decimal128 will reject values that exceed its representable range.
     *
     * We deliberately allow Decimal128 to perform the final BSON-level
     * validation rather than approximating the value ourselves.
     */
    try {
        return mongoose.Types.Decimal128.fromString(
            plain
        );
    } catch (error) {
        throw new MoneyValidationError(
            `Value cannot be represented as MongoDB Decimal128: ${plain}`
        );
    }
}

/**
 * ============================================================================
 * Decimal Comparison
 * ============================================================================
 */

/**
 * Align two decimal values to the same scale.
 *
 * @param {{coefficient: bigint, scale: number}} left
 * @param {{coefficient: bigint, scale: number}} right
 * @returns {{
 *   leftCoefficient: bigint,
 *   rightCoefficient: bigint,
 *   scale: number
 * }}
 */
function alignDecimals(left, right) {
    const targetScale =
        Math.max(
            left.scale,
            right.scale
        );

    const leftMultiplier =
        10n ** BigInt(
            targetScale - left.scale
        );

    const rightMultiplier =
        10n ** BigInt(
            targetScale - right.scale
        );

    return {
        leftCoefficient:
            left.coefficient *
            leftMultiplier,

        rightCoefficient:
            right.coefficient *
            rightMultiplier,

        scale: targetScale
    };
}

/**
 * Compare two decimals.
 *
 * Returns:
 *
 *   -1 => left < right
 *    0 => left === right
 *    1 => left > right
 *
 * @param {*} left
 * @param {*} right
 * @returns {number}
 */
function compareDecimals(left, right) {
    const leftDecimal =
        parseDecimal(left);

    const rightDecimal =
        parseDecimal(right);

    const aligned =
        alignDecimals(
            leftDecimal,
            rightDecimal
        );

    if (
        aligned.leftCoefficient <
        aligned.rightCoefficient
    ) {
        return -1;
    }

    if (
        aligned.leftCoefficient >
        aligned.rightCoefficient
    ) {
        return 1;
    }

    return 0;
}

/**
 * ============================================================================
 * Arithmetic Helpers
 * ============================================================================
 */

/**
 * Add decimals exactly.
 *
 * @param {*} left
 * @param {*} right
 * @returns {string}
 */
function addDecimals(left, right) {
    const leftDecimal =
        parseDecimal(left);

    const rightDecimal =
        parseDecimal(right);

    const aligned =
        alignDecimals(
            leftDecimal,
            rightDecimal
        );

    return decimalToPlainString(
        normalizeDecimal({
            coefficient:
                aligned.leftCoefficient +
                aligned.rightCoefficient,
            scale: aligned.scale
        })
    );
}

/**
 * Subtract decimals exactly.
 *
 * @param {*} left
 * @param {*} right
 * @returns {string}
 */
function subtractDecimals(left, right) {
    const leftDecimal =
        parseDecimal(left);

    const rightDecimal =
        parseDecimal(right);

    const aligned =
        alignDecimals(
            leftDecimal,
            rightDecimal
        );

    return decimalToPlainString(
        normalizeDecimal({
            coefficient:
                aligned.leftCoefficient -
                aligned.rightCoefficient,
            scale: aligned.scale
        })
    );
}

/**
 * Multiply a decimal by an integer exactly.
 *
 * The multiplier must be a bigint or a safe integer.
 *
 * @param {*} value
 * @param {*} multiplier
 * @returns {string}
 */
function multiplyByInteger(
    value,
    multiplier
) {
    const decimal =
        parseDecimal(value);

    let integerMultiplier;

    if (
        typeof multiplier ===
        "bigint"
    ) {
        integerMultiplier =
            multiplier;
    } else if (
        typeof multiplier ===
        "number" &&
        Number.isSafeInteger(
            multiplier
        )
    ) {
        integerMultiplier =
            BigInt(multiplier);
    } else if (
        typeof multiplier ===
        "string" &&
        /^[-+]?\d+$/.test(
            multiplier.trim()
        )
    ) {
        integerMultiplier =
            BigInt(
                multiplier.trim()
            );
    } else {
        throw new MoneyArithmeticError(
            "Integer multiplier must be a bigint, safe integer, or integer string."
        );
    }

    return decimalToPlainString(
        normalizeDecimal({
            coefficient:
                decimal.coefficient *
                integerMultiplier,
            scale: decimal.scale
        })
    );
}

/**
 * ============================================================================
 * Rounding
 * ============================================================================
 */

/**
 * Validate rounding mode.
 *
 * @param {string} mode
 * @returns {string}
 */
function normalizeRoundingMode(mode) {
    const normalized =
        String(
            mode ||
            ROUNDING_MODES.HALF_UP
        )
            .trim()
            .toUpperCase();

    if (
        !ROUNDING_MODE_VALUES.includes(
            normalized
        )
    ) {
        throw new MoneyValidationError(
            `Unsupported rounding mode: ${mode}`
        );
    }

    return normalized;
}

/**
 * Determine whether an integer coefficient is negative.
 *
 * @param {bigint} coefficient
 * @returns {boolean}
 */
function isNegative(coefficient) {
    return coefficient < 0n;
}

/**
 * Round a decimal to a target scale.
 *
 * Example:
 *
 *   roundDecimal("123.456", 2, "HALF_UP")
 *   => "123.46"
 *
 * @param {*} value
 * @param {number} targetScale
 * @param {string} roundingMode
 * @returns {string}
 */
function roundDecimal(
    value,
    targetScale,
    roundingMode = ROUNDING_MODES.HALF_UP
) {
    if (
        !Number.isInteger(
            targetScale
        ) ||
        targetScale < 0 ||
        targetScale > MAX_SCALE
    ) {
        throw new MoneyValidationError(
            "Target monetary scale must be a non-negative integer within the supported range."
        );
    }

    const mode =
        normalizeRoundingMode(
            roundingMode
        );

    const decimal =
        parseDecimal(value);

    /**
     * Nothing to round.
     */
    if (
        decimal.scale <=
        targetScale
    ) {
        const multiplier =
            10n ** BigInt(
                targetScale -
                decimal.scale
            );

        return decimalToPlainString({
            coefficient:
                decimal.coefficient *
                multiplier,
            scale: targetScale
        });
    }

    const divisor =
        10n ** BigInt(
            decimal.scale -
            targetScale
        );

    const negative =
        isNegative(
            decimal.coefficient
        );

    const absolute =
        negative
            ? -decimal.coefficient
            : decimal.coefficient;

    let quotient =
        absolute / divisor;

    const remainder =
        absolute % divisor;

    if (remainder === 0n) {
        return decimalToPlainString({
            coefficient:
                negative
                    ? -quotient
                    : quotient,
            scale: targetScale
        });
    }

    let increment = false;

    switch (mode) {
        case ROUNDING_MODES.DOWN:
            /**
             * Towards zero.
             */
            increment = false;
            break;

        case ROUNDING_MODES.UP:
            /**
             * Away from zero.
             */
            increment = true;
            break;

        case ROUNDING_MODES.CEILING:
            /**
             * Towards positive infinity.
             */
            increment = !negative;
            break;

        case ROUNDING_MODES.FLOOR:
            /**
             * Towards negative infinity.
             */
            increment = negative;
            break;

        case ROUNDING_MODES.HALF_UP: {
            const doubled =
                remainder * 2n;

            increment =
                doubled >= divisor;

            break;
        }

        case ROUNDING_MODES.HALF_DOWN: {
            const doubled =
                remainder * 2n;

            increment =
                doubled > divisor;

            break;
        }

        case ROUNDING_MODES.HALF_EVEN: {
            const doubled =
                remainder * 2n;

            if (
                doubled >
                divisor
            ) {
                increment = true;
            } else if (
                doubled <
                divisor
            ) {
                increment = false;
            } else {
                /**
                 * Exactly halfway:
                 *
                 * round toward the nearest even integer.
                 */
                increment =
                    quotient % 2n !==
                    0n;
            }

            break;
        }

        default:
            throw new MoneyValidationError(
                `Unsupported rounding mode: ${mode}`
            );
    }

    if (increment) {
        quotient += 1n;
    }

    const roundedCoefficient =
        negative
            ? -quotient
            : quotient;

    return decimalToPlainString({
        coefficient:
            roundedCoefficient,
        scale: targetScale
    });
}

/**
 * ============================================================================
 * Division
 * ============================================================================
 */

/**
 * Divide a decimal by an integer.
 *
 * Division always requires an explicit target scale because most monetary
 * divisions are not exact.
 *
 * @param {*} value
 * @param {*} divisor
 * @param {number} targetScale
 * @param {string} roundingMode
 * @returns {string}
 */
function divideByInteger(
    value,
    divisor,
    targetScale,
    roundingMode = ROUNDING_MODES.HALF_UP
) {
    let integerDivisor;

    if (
        typeof divisor ===
        "bigint"
    ) {
        integerDivisor =
            divisor;
    } else if (
        typeof divisor ===
            "number" &&
        Number.isSafeInteger(
            divisor
        )
    ) {
        integerDivisor =
            BigInt(divisor);
    } else if (
        typeof divisor ===
            "string" &&
        /^[-+]?\d+$/.test(
            divisor.trim()
        )
    ) {
        integerDivisor =
            BigInt(
                divisor.trim()
            );
    } else {
        throw new MoneyArithmeticError(
            "Divisor must be an integer."
        );
    }

    if (
        integerDivisor ===
        0n
    ) {
        throw new MoneyArithmeticError(
            "Division by zero is prohibited."
        );
    }

    const decimal =
        parseDecimal(value);

    /**
     * To divide:
     *
     * coefficient / 10^scale / divisor
     *
     * We increase the scale until enough precision exists for the requested
     * output scale.
     */
    const desiredScale =
        Number.isInteger(
            targetScale
        )
            ? targetScale
            : 0;

    if (
        desiredScale < 0 ||
        desiredScale > MAX_SCALE
    ) {
        throw new MoneyValidationError(
            "Target monetary scale is invalid."
        );
    }

    const workingScale =
        desiredScale +
        decimal.scale;

    const numerator =
        decimal.coefficient *
        (
            10n **
            BigInt(
                desiredScale
            )
        );

    const negative =
        numerator < 0n !==
        integerDivisor < 0n;

    const absoluteNumerator =
        numerator < 0n
            ? -numerator
            : numerator;

    const absoluteDivisor =
        integerDivisor < 0n
            ? -integerDivisor
            : integerDivisor;

    let quotient =
        absoluteNumerator /
        absoluteDivisor;

    const remainder =
        absoluteNumerator %
        absoluteDivisor;

    if (
        remainder !== 0n
    ) {
        const mode =
            normalizeRoundingMode(
                roundingMode
            );

        let increment = false;

        switch (mode) {
            case ROUNDING_MODES.DOWN:
                increment = false;
                break;

            case ROUNDING_MODES.UP:
                increment = true;
                break;

            case ROUNDING_MODES.CEILING:
                increment = !negative;
                break;

            case ROUNDING_MODES.FLOOR:
                increment = negative;
                break;

            case ROUNDING_MODES.HALF_UP:
                increment =
                    remainder * 2n >=
                    absoluteDivisor;
                break;

            case ROUNDING_MODES.HALF_DOWN:
                increment =
                    remainder * 2n >
                    absoluteDivisor;
                break;

            case ROUNDING_MODES.HALF_EVEN: {
                const doubled =
                    remainder * 2n;

                if (
                    doubled >
                    absoluteDivisor
                ) {
                    increment = true;
                } else if (
                    doubled ===
                    absoluteDivisor
                ) {
                    increment =
                        quotient % 2n !==
                        0n;
                }

                break;
            }

            default:
                throw new MoneyValidationError(
                    `Unsupported rounding mode: ${mode}`
                );
        }

        if (increment) {
            quotient += 1n;
        }
    }

    if (negative) {
        quotient = -quotient;
    }

    /**
     * The output coefficient has the requested target scale.
     */
    return decimalToPlainString({
        coefficient: quotient,
        scale: desiredScale
    });
}

/**
 ============================================================================
 * Money Class
 * ============================================================================
 */

/**
 * Immutable exact monetary value.
 *
 * Example:
 *
 *   const amount = Money.from("100.50", "UGX");
 *
 *   const result = amount.add(
 *       Money.from("25.25", "UGX")
 *   );
 *
 *   result.toString();
 *   // "125.75"
 *
 * Currency mismatch is rejected.
 */
class Money {
    /**
     * @param {{coefficient: bigint, scale: number}} decimal
     * @param {string|null} currency
     */
    constructor(
        decimal,
        currency = null
    ) {
        const normalized =
            normalizeDecimal(
                decimal
            );

        this._coefficient =
            normalized.coefficient;

        this._scale =
            normalized.scale;

        this._currency =
            currency === null
                ? null
                : normalizeCurrency(
                      currency
                  );

        /**
         * Prevent accidental mutation.
         */
        Object.freeze(this);
    }

    /**
     * Create Money.
     *
     * @param {*} value
     * @param {string|null} currency
     * @returns {Money}
     */
    static from(
        value,
        currency = null
    ) {
        if (
            value instanceof Money
        ) {
            if (
                currency === null ||
                currency === undefined
            ) {
                return value;
            }

            const normalizedCurrency =
                normalizeCurrency(
                    currency
                );

            if (
                value.currency !==
                normalizedCurrency
            ) {
                throw new CurrencyMismatchError(
                    normalizedCurrency,
                    value.currency
                );
            }

            return value;
        }

        return new Money(
            parseDecimal(value),
            currency === null ||
            currency === undefined
                ? null
                : currency
        );
    }

    /**
     * Create zero Money.
     *
     * @param {string|null} currency
     * @returns {Money}
     */
    static zero(
        currency = null
    ) {
        return new Money(
            {
                coefficient: 0n,
                scale: 0
            },
            currency
        );
    }

    /**
     * Create Money from MongoDB Decimal128.
     *
     * @param {mongoose.Types.Decimal128} value
     * @param {string|null} currency
     * @returns {Money}
     */
    static fromDecimal128(
        value,
        currency = null
    ) {
        if (
            !isDecimal128(value)
        ) {
            throw new MoneyValidationError(
                "Expected MongoDB Decimal128."
            );
        }

        return Money.from(
            value.toString(),
            currency
        );
    }

    /**
     * Return currency.
     *
     * @returns {string|null}
     */
    get currency() {
        return this._currency;
    }

    /**
     * Return decimal scale.
     *
     * @returns {number}
     */
    get scale() {
        return this._scale;
    }

    /**
     * Return true if zero.
     *
     * @returns {boolean}
     */
    isZero() {
        return (
            this._coefficient ===
            0n
        );
    }

    /**
     * Return true if negative.
     *
     * @returns {boolean}
     */
    isNegative() {
        return (
            this._coefficient <
            0n
        );
    }

    /**
     * Return true if positive.
     *
     * @returns {boolean}
     */
    isPositive() {
        return (
            this._coefficient >
            0n
        );
    }

    /**
     * Return absolute value.
     *
     * @returns {Money}
     */
    abs() {
        return new Money(
            {
                coefficient:
                    this._coefficient <
                    0n
                        ? -this._coefficient
                        : this._coefficient,
                scale: this._scale
            },
            this.currency
        );
    }

    /**
     * Return negated value.
     *
     * @returns {Money}
     */
    negate() {
        return new Money(
            {
                coefficient:
                    -this._coefficient,
                scale: this._scale
            },
            this.currency
        );
    }

    /**
     * Ensure another Money value has compatible currency.
     *
     * @param {Money} other
     */
    _assertCompatible(other) {
        if (
            !(
                other instanceof
                Money
            )
        ) {
            throw new MoneyValidationError(
                "Money operation requires another Money instance."
            );
        }

        if (
            this.currency !==
                null &&
            other.currency !==
                null &&
            this.currency !==
                other.currency
        ) {
            throw new CurrencyMismatchError(
                this.currency,
                other.currency
            );
        }
    }

    /**
     * Resolve resulting currency.
     *
     * @param {Money} other
     * @returns {string|null}
     */
    _resolveCurrency(other) {
        if (
            this.currency !==
            null
        ) {
            return this.currency;
        }

        return other.currency;
    }

    /**
     * Add another Money value.
     *
     * @param {Money} other
     * @returns {Money}
     */
    add(other) {
        this._assertCompatible(
            other
        );

        const decimal =
            parseDecimal(
                addDecimals(
                    this.toString(),
                    other.toString()
                )
            );

        return new Money(
            decimal,
            this._resolveCurrency(
                other
            )
        );
    }

    /**
     * Subtract another Money value.
     *
     * @param {Money} other
     * @returns {Money}
     */
    subtract(other) {
        this._assertCompatible(
            other
        );

        const decimal =
            parseDecimal(
                subtractDecimals(
                    this.toString(),
                    other.toString()
                )
            );

        return new Money(
            decimal,
            this._resolveCurrency(
                other
            )
        );
    }

    /**
     * Multiply by an integer.
     *
     * @param {number|string|bigint} multiplier
     * @returns {Money}
     */
    multiply(multiplier) {
        return new Money(
            parseDecimal(
                multiplyByInteger(
                    this.toString(),
                    multiplier
                )
            ),
            this.currency
        );
    }

    /**
     * Divide by an integer.
     *
     * @param {number|string|bigint} divisor
     * @param {number} targetScale
     * @param {string} roundingMode
     * @returns {Money}
     */
    divide(
        divisor,
        targetScale,
        roundingMode = ROUNDING_MODES.HALF_UP
    ) {
        return new Money(
            parseDecimal(
                divideByInteger(
                    this.toString(),
                    divisor,
                    targetScale,
                    roundingMode
                )
            ),
            this.currency
        );
    }

    /**
     * Quantize to a fixed decimal scale.
     *
     * Example:
     *
     *   Money.from("10.456", "USD")
     *       .quantize(2)
     *
     *   => 10.46 USD
     *
     * @param {number} targetScale
     * @param {string} roundingMode
     * @returns {Money}
     */
    quantize(
        targetScale,
        roundingMode = ROUNDING_MODES.HALF_UP
    ) {
        return new Money(
            parseDecimal(
                roundDecimal(
                    this.toString(),
                    targetScale,
                    roundingMode
                )
            ),
            this.currency
        );
    }

    /**
     * Compare with another Money value.
     *
     * @param {Money} other
     * @returns {number}
     */
    compare(other) {
        this._assertCompatible(
            other
        );

        return compareDecimals(
            this.toString(),
            other.toString()
        );
    }

    /**
     * Equality check.
     *
     * @param {Money} other
     * @returns {boolean}
     */
    equals(other) {
        if (
            !(
                other instanceof
                Money
            )
        ) {
            return false;
        }

        try {
            return (
                this.compare(
                    other
                ) === 0
            );
        } catch {
            return false;
        }
    }

    /**
     * Greater than.
     *
     * @param {Money} other
     * @returns {boolean}
     */
    greaterThan(other) {
        return (
            this.compare(other) >
            0
        );
    }

    /**
     * Greater than or equal.
     *
     * @param {Money} other
     * @returns {boolean}
     */
    greaterThanOrEqual(other) {
        return (
            this.compare(other) >=
            0
        );
    }

    /**
     * Less than.
     *
     * @param {Money} other
     * @returns {boolean}
     */
    lessThan(other) {
        return (
            this.compare(other) <
            0
        );
    }

    /**
     * Less than or equal.
     *
     * @param {Money} other
     * @returns {boolean}
     */
    lessThanOrEqual(other) {
        return (
            this.compare(other) <=
            0
        );
    }

    /**
     * Assert value is non-negative.
     *
     * @returns {Money}
     */
    assertNonNegative() {
        if (
            this.isNegative()
        ) {
            throw new MoneyValidationError(
                "Monetary value must be non-negative."
            );
        }

        return this;
    }

    /**
     * Assert value is strictly positive.
     *
     * @returns {Money}
     */
    assertPositive() {
        if (
            !this.isPositive()
        ) {
            throw new MoneyValidationError(
                "Monetary value must be greater than zero."
            );
        }

        return this;
    }

    /**
     * Convert to MongoDB Decimal128.
     *
     * @returns {mongoose.Types.Decimal128}
     */
    toDecimal128() {
        return decimalToDecimal128({
            coefficient:
                this._coefficient,
            scale: this._scale
        });
    }

    /**
     * Convert to canonical string.
     *
     * @returns {string}
     */
    toString() {
        return decimalToPlainString({
            coefficient:
                this._coefficient,
            scale: this._scale
        });
    }

    /**
     * Convert to JSON-safe representation.
     *
     * Monetary amount remains a string.
     *
     * @returns {object}
     */
    toJSON() {
        const result = {
            amount: this.toString()
        };

        if (
            this.currency !==
            null
        ) {
            result.currency =
                this.currency;
        }

        return result;
    }

    /**
     * Return primitive-style string representation.
     *
     * @returns {string}
     */
    valueOf() {
        return this.toString();
    }

    /**
     * Return a debug-friendly representation.
     *
     * @returns {string}
     */
    inspect() {
        if (
            this.currency
        ) {
            return `Money(${this.toString()} ${this.currency})`;
        }

        return `Money(${this.toString()})`;
    }
}

/**
 * ============================================================================
 * Static Utility Functions
 * ============================================================================
 */

/**
 * Parse any supported monetary value.
 *
 * @param {*} value
 * @returns {Money}
 */
function money(value) {
    return Money.from(value);
}

/**
 * Convert value to Decimal128.
 *
 * @param {*} value
 * @returns {mongoose.Types.Decimal128}
 */
function toDecimal128(value) {
    if (
        value instanceof Money
    ) {
        return value.toDecimal128();
    }

    return decimalToDecimal128(
        parseDecimal(value)
    );
}

/**
 * Convert value to canonical string.
 *
 * @param {*} value
 * @returns {string}
 */
function toMoneyString(value) {
    if (
        value instanceof Money
    ) {
        return value.toString();
    }

    return decimalToPlainString(
        parseDecimal(value)
    );
}

/**
 * Determine whether a value is a valid monetary decimal.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidMoney(value) {
    try {
        parseDecimal(value);
        return true;
    } catch {
        return false;
    }
}

/**
 * Determine whether a value is zero.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isZero(value) {
    return (
        parseDecimal(
            value
        ).coefficient === 0n
    );
}

/**
 * Determine whether a value is non-negative.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isNonNegative(value) {
    return (
        parseDecimal(
            value
        ).coefficient >=
        0n
    );
}

/**
 * Determine whether a value is positive.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isPositive(value) {
    return (
        parseDecimal(
            value
        ).coefficient >
        0n
    );
}

/**
 * Exact addition without explicitly constructing Money instances.
 *
 * @param {*} left
 * @param {*} right
 * @returns {string}
 */
function addMoney(left, right) {
    return addDecimals(
        left,
        right
    );
}

/**
 * Exact subtraction.
 *
 * @param {*} left
 * @param {*} right
 * @returns {string}
 */
function subtractMoney(
    left,
    right
) {
    return subtractDecimals(
        left,
        right
    );
}

/**
 * Exact integer multiplication.
 *
 * @param {*} value
 * @param {*} multiplier
 * @returns {string}
 */
function multiplyMoney(
    value,
    multiplier
) {
    return multiplyByInteger(
        value,
        multiplier
    );
}

/**
 * Exact integer division with explicit scale and rounding.
 *
 * @param {*} value
 * @param {*} divisor
 * @param {number} targetScale
 * @param {string} roundingMode
 * @returns {string}
 */
function divideMoney(
    value,
    divisor,
    targetScale,
    roundingMode = ROUNDING_MODES.HALF_UP
) {
    return divideByInteger(
        value,
        divisor,
        targetScale,
        roundingMode
    );
}

/**
 * ============================================================================
 * Balance Safety Helpers
 * ============================================================================
 */

/**
 * Assert that a monetary value is valid and non-negative.
 *
 * Useful for:
 *
 *   account.balance
 *   account.openingBalance
 *   account.reservedBalance
 *
 * @param {*} value
 * @returns {string}
 */
function assertNonNegativeMoney(
    value
) {
    const decimal =
        parseDecimal(value);

    if (
        decimal.coefficient <
        0n
    ) {
        throw new MoneyValidationError(
            "Monetary value must be non-negative."
        );
    }

    return decimalToPlainString(
        decimal
    );
}

/**
 * Assert that a monetary amount is strictly positive.
 *
 * @param {*} value
 * @returns {string}
 */
function assertPositiveMoney(
    value
) {
    const decimal =
        parseDecimal(value);

    if (
        decimal.coefficient <=
        0n
    ) {
        throw new MoneyValidationError(
            "Monetary value must be greater than zero."
        );
    }

    return decimalToPlainString(
        decimal
    );
}

/**
 * Assert that a monetary value does not exceed another value.
 *
 * @param {*} value
 * @param {*} maximum
 * @returns {string}
 */
function assertLessThanOrEqual(
    value,
    maximum
) {
    if (
        compareDecimals(
            value,
            maximum
        ) > 0
    ) {
        throw new MoneyValidationError(
            "Monetary value exceeds the permitted maximum."
        );
    }

    return toMoneyString(
        value
    );
}

/**
 * ============================================================================
 * Allocation
 * ============================================================================
 *
 * Split an amount into integer-weighted portions while preserving the exact
 * total.
 *
 * Example:
 *
 *   allocate("100.00", [1, 1, 1], 2)
 *
 * produces:
 *
 *   33.34
 *   33.33
 *   33.33
 *
 * The first portions receive any unavoidable remainder.
 *
 * This is useful for:
 *
 *   - fee distribution
 *   - commission distribution
 *   - group allocations
 *   - interest distribution
 *   - settlement allocation
 *
 * ============================================================================
 */

/**
 * Allocate Money according to integer weights.
 *
 * @param {*} value
 * @param {Array<number|string|bigint>} weights
 * @param {number} scale
 * @param {string} roundingMode
 * @returns {string[]}
 */
function allocateMoney(
    value,
    weights,
    scale,
    roundingMode = ROUNDING_MODES.DOWN
) {
    if (
        !Array.isArray(
            weights
        ) ||
        weights.length === 0
    ) {
        throw new MoneyValidationError(
            "Allocation weights must be a non-empty array."
        );
    }

    if (
        !Number.isInteger(scale) ||
        scale < 0 ||
        scale > MAX_SCALE
    ) {
        throw new MoneyValidationError(
            "Allocation scale is invalid."
        );
    }

    const parsedWeights =
        weights.map(
            (weight) => {
                if (
                    typeof weight ===
                    "bigint"
                ) {
                    return weight;
                }

                if (
                    typeof weight ===
                        "number" &&
                    Number.isSafeInteger(
                        weight
                    )
                ) {
                    return BigInt(
                        weight
                    );
                }

                if (
                    typeof weight ===
                        "string" &&
                    /^\d+$/.test(
                        weight.trim()
                    )
                ) {
                    return BigInt(
                        weight.trim()
                    );
                }

                throw new MoneyValidationError(
                    "Allocation weights must be non-negative integers."
                );
            }
        );

    if (
        parsedWeights.some(
            (weight) =>
                weight < 0n
        )
    ) {
        throw new MoneyValidationError(
            "Allocation weights cannot be negative."
        );
    }

    const totalWeight =
        parsedWeights.reduce(
            (
                sum,
                weight
            ) =>
                sum + weight,
            0n
        );

    if (
        totalWeight ===
        0n
    ) {
        throw new MoneyValidationError(
            "Total allocation weight must be greater than zero."
        );
    }

    /**
     * Quantize the total first.
     */
    const total =
        parseDecimal(
            roundDecimal(
                value,
                scale,
                roundingMode
            )
        );

    /**
     * Convert the amount into the smallest unit represented by the target
     * scale.
     */
    const targetScale =
        Math.max(
            total.scale,
            scale
        );

    const unitMultiplier =
        10n ** BigInt(
            targetScale -
            total.scale
        );

    const totalUnits =
        total.coefficient *
        unitMultiplier;

    const negative =
        totalUnits < 0n;

    const absoluteUnits =
        negative
            ? -totalUnits
            : totalUnits;

    const results =
        [];

    let allocated =
        0n;

    for (
        let index = 0;
        index <
        parsedWeights.length;
        index += 1
    ) {
        const weight =
            parsedWeights[index];

        let portion =
            (
                absoluteUnits *
                weight
            ) /
            totalWeight;

        /**
         * The final remainder is assigned deterministically below.
         */
        results.push(
            portion
        );

        allocated +=
            portion;
    }

    /**
     * Preserve the exact total.
     *
     * Any remainder is assigned one smallest unit at a time using a
     * deterministic left-to-right strategy.
     */
    let remainder =
        absoluteUnits -
        allocated;

    let index = 0;

    while (
        remainder > 0n
    ) {
        results[index] +=
            1n;

        remainder -=
            1n;

        index =
            (index + 1) %
            results.length;
    }

    return results.map(
        (portion) =>
            decimalToPlainString({
                coefficient:
                    negative
                        ? -portion
                        : portion,
                scale: targetScale
            })
    );
}

/**
 * ============================================================================
 * Decimal128 Precision Validation
 * ============================================================================
 */

/**
 * Count significant decimal digits.
 *
 * @param {*} value
 * @returns {number}
 */
function significantDigits(value) {
    const decimal =
        normalizeDecimal(
            parseDecimal(value)
        );

    if (
        decimal.coefficient ===
        0n
    ) {
        return 1;
    }

    return (
        decimal.coefficient < 0n
            ? (
                  -decimal.coefficient
              )
            : decimal.coefficient
    )
        .toString()
        .length;
}

/**
 * Determine whether the value fits within Decimal128 precision.
 *
 * @param {*} value
 * @returns {boolean}
 */
function fitsDecimal128Precision(
    value
) {
    try {
        return (
            significantDigits(
                value
            ) <=
            DECIMAL128_MAX_PRECISION
        );
    } catch {
        return false;
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {
    /**
     * Primary immutable Money abstraction.
     */
    Money,

    /**
     * Error types.
     */
    MoneyError,
    MoneyValidationError,
    MoneyArithmeticError,
    CurrencyMismatchError,

    /**
     * Constants.
     */
    ROUNDING_MODES,

    DECIMAL128_MAX_PRECISION,
    MAX_SCALE,

    /**
     * MongoDB helpers.
     */
    isDecimal128,
    toDecimal128,

    /**
     * Validation helpers.
     */
    isValidMoney,
    isZero,
    isNonNegative,
    isPositive,
    assertNonNegativeMoney,
    assertPositiveMoney,
    assertLessThanOrEqual,
    fitsDecimal128Precision,

    /**
     * String conversion.
     */
    toMoneyString,

    /**
     * Exact arithmetic.
     */
    addMoney,
    subtractMoney,
    multiplyMoney,
    divideMoney,

    /**
     * Decimal operations.
     */
    roundDecimal,
    compareDecimals,

    /**
     * Allocation.
     */
    allocateMoney,

    /**
     * Currency normalization.
     */
    normalizeCurrency
};