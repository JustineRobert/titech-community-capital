'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Stage 01d SaaS Billing Reconciliation Service
 * ============================================================================
 *
 * File:
 * backend/services/commercial/stage01dReconciliationService.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Enterprise comparison/classification engine for controlled SaaS billing
 * shadow execution.
 *
 * The service answers one question:
 *
 *     "What happened when the shadow billing result was compared with the
 *      authoritative legacy billing result?"
 *
 * It does NOT answer:
 *
 *     "How frequently does this happen?"
 *
 * That responsibility belongs to:
 *
 *     stage01dTelemetryService.js
 *
 * ============================================================================
 * ARCHITECTURAL POSITION
 * ============================================================================
 *
 *              Legacy Billing
 *                    │
 *                    │ authoritative result
 *                    ▼
 *            ┌─────────────────┐
 *            │                 │
 *            │  Reconciliation │
 *            │     Service     │
 *            │                 │
 *            └────────┬────────┘
 *                     │
 *                     │ comparison
 *                     │ classification
 *                     ▼
 *              Reconciliation
 *                  Record
 *                     │
 *                     ▼
 *             Telemetry Service
 *                     │
 *                     ▼
 *             Parity / Risk /
 *             Readiness Metrics
 *
 * Shadow Billing ─────┘
 *
 * ============================================================================
 * CRITICAL INVARIANTS
 * ============================================================================
 *
 * 1. Legacy billing remains authoritative.
 * 2. Shadow billing is observational.
 * 3. This service NEVER posts financial entries.
 * 4. This service NEVER changes invoices.
 * 5. This service NEVER captures payments.
 * 6. This service NEVER changes subscriptions.
 * 7. This service NEVER performs automatic cut-over.
 * 8. Reconciliation is deterministic.
 * 9. Monetary comparison is performed without floating-point equality.
 * 10. Field-level differences are structured and machine-readable.
 * 11. Missing components are explicit divergences.
 * 12. Configuration differences are independently classified.
 * 13. Normalization differences are distinguishable from monetary differences.
 *
 * ============================================================================
 */

const SERVICE_NAME =
  'titech-stage01d-reconciliation-service';

const SERVICE_VERSION =
  '1.0.0';

const STAGE =
  '01d';

const MODE =
  'shadow';

/**
 * ============================================================================
 * CLASSIFICATIONS
 * ============================================================================
 */

const CLASSIFICATIONS = Object.freeze({
  EXACT_MATCH:
    'exact_match',

  TOLERANCE_MATCH:
    'tolerance_match',

  MONETARY_DIVERGENCE:
    'monetary_divergence',

  LINE_ITEM_DIVERGENCE:
    'line_item_divergence',

  MISSING_COMPONENT:
    'missing_component',

  CONFIGURATION_DIVERGENCE:
    'configuration_divergence',

  NORMALIZATION_MISMATCH:
    'normalization_mismatch',

  FIELD_DIVERGENCE:
    'field_divergence',

  EXECUTION_FAILURE:
    'execution_failure',

  INCONCLUSIVE:
    'inconclusive',
});

/**
 * ============================================================================
 * STATUSES
 * ============================================================================
 */

const STATUSES = Object.freeze({
  EXACT:
    'exact',

  WITHIN_TOLERANCE:
    'within_tolerance',

  DIVERGED:
    'diverged',

  FAILED:
    'failed',

  INCONCLUSIVE:
    'inconclusive',
});

/**
 * ============================================================================
 * SEVERITIES
 * ============================================================================
 */

const SEVERITIES = Object.freeze({
  LOW:
    'low',

  MEDIUM:
    'medium',

  HIGH:
    'high',

  CRITICAL:
    'critical',
});

/**
 * ============================================================================
 * MATCH TYPES
 * ============================================================================
 */

const MATCH_TYPES = Object.freeze({
  EXACT:
    'exact',

  TOLERANCE:
    'tolerance',

  DIVERGENCE:
    'divergence',

  FAILURE:
    'failure',

  INCONCLUSIVE:
    'inconclusive',
});

/**
 * ============================================================================
 * DEFAULT POLICY
 * ============================================================================
 *
 * Monetary values are represented internally as arbitrary-precision decimal
 * strings. The comparison tolerance is expressed as a decimal amount.
 *
 * Example:
 *
 *     toleranceAmount: "0.01"
 *
 * means differences <= 0.01 are eligible for tolerance matching.
 */

const DEFAULT_POLICY = Object.freeze({
  monetaryToleranceAmount:
    '0.00',

  /**
   * Maximum acceptable relative monetary difference in basis points.
   *
   * 1 bp = 0.01%.
   *
   * 100 bps = 1%.
   *
   * This is an additional safety boundary. A result must satisfy both:
   *
   *     absolute tolerance
   *     AND
   *     relative tolerance
   *
   * when relative tolerance is configured.
   */
  monetaryToleranceBps:
    0,

  enableRelativeTolerance:
    false,

  /**
   * Whether zero-value missing line items are treated as meaningful.
   */
  treatZeroValueMissingComponentAsDivergence:
    true,

  /**
   * Field comparison behavior.
   */
  ignorePaths: [],

  /**
   * Fields that are intentionally volatile and should not produce a
   * reconciliation divergence.
   */
  volatilePaths: [
    'generatedAt',
    'createdAt',
    'updatedAt',
    'executionId',
    'requestId',
    'traceId',
    'durationMs',
  ],

  /**
   * Known monetary fields.
   */
  monetaryPaths: [
    'total',
    'totalAmount',
    'subtotal',
    'subtotalAmount',
    'tax',
    'taxAmount',
    'fee',
    'feeAmount',
    'discount',
    'discountAmount',
    'amount',
    'netAmount',
    'grossAmount',
    'chargeAmount',
  ],

  /**
   * Default line-item identity candidates.
   */
  lineItemIdentityFields: [
    'componentId',
    'componentCode',
    'code',
    'id',
    'key',
    'name',
    'type',
  ],

  /**
   * Fields that should be interpreted as configuration.
   */
  configurationPaths: [
    'configuration',
    'config',
    'billingConfiguration',
    'pricingConfiguration',
    'feeConfiguration',
    'taxConfiguration',
    'discountConfiguration',
  ],

  /**
   * Severity thresholds.
   */
  highSeverityBps:
    100,

  criticalSeverityBps:
    1000,

  highSeverityAbsoluteAmount:
    '1000',

  criticalSeverityAbsoluteAmount:
    '10000',
});

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class Stage01dReconciliationError extends Error {
  constructor(
    message,
    code = 'STAGE01D_RECONCILIATION_ERROR',
    details = undefined,
  ) {
    super(message);

    this.name =
      'Stage01dReconciliationError';

    this.code =
      code;

    this.details =
      details;

    Error.captureStackTrace?.(
      this,
      Stage01dReconciliationError,
    );
  }
}

/**
 * ============================================================================
 * OBJECT HELPERS
 * ============================================================================
 */

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function cloneValue(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (
    value instanceof Date
  ) {
    return new Date(
      value.getTime(),
    );
  }

  if (
    typeof value?.toString ===
      'function' &&
    value?._bsontype
  ) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(
      cloneValue,
    );
  }

  if (isPlainObject(value)) {
    const output = {};

    for (
      const [
        key,
        child,
      ] of Object.entries(value)
    ) {
      output[key] =
        cloneValue(child);
    }

    return output;
  }

  return value;
}

function getPath(
  object,
  path,
  fallback = undefined,
) {
  if (
    object === null ||
    object === undefined
  ) {
    return fallback;
  }

  const parts =
    String(path).split('.');

  let current =
    object;

  for (
    const part of parts
  ) {
    if (
      current === null ||
      current === undefined
    ) {
      return fallback;
    }

    current =
      current[part];
  }

  return current === undefined
    ? fallback
    : current;
}

function hasPath(
  object,
  path,
) {
  if (
    object === null ||
    object === undefined
  ) {
    return false;
  }

  const parts =
    String(path).split('.');

  let current =
    object;

  for (
    const part of parts
  ) {
    if (
      !Object.prototype.hasOwnProperty.call(
        current,
        part,
      )
    ) {
      return false;
    }

    current =
      current[part];
  }

  return true;
}

function normalizeString(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value)
    .trim()
    .replace(/\s+/g, ' ');
}

function stableStringify(
  value,
) {
  if (
    value === undefined
  ) {
    return '__undefined__';
  }

  if (
    value === null
  ) {
    return 'null';
  }

  if (
    Array.isArray(value)
  ) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  if (
    isPlainObject(value)
  ) {
    return `{${Object.keys(value)
      .sort()
      .map(
        key =>
          `${JSON.stringify(
            key,
          )}:${stableStringify(
            value[key],
          )}`,
      )
      .join(',')}}`;
  }

  if (
    value instanceof Date
  ) {
    return JSON.stringify(
      value.toISOString(),
    );
  }

  return JSON.stringify(
    value,
  );
}

function valuesEquivalent(
  left,
  right,
) {
  if (
    left === right
  ) {
    return true;
  }

  if (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined
  ) {
    return (
      left === right
    );
  }

  if (
    typeof left === 'string' &&
    typeof right === 'string'
  ) {
    return (
      left.trim() ===
      right.trim()
    );
  }

  if (
    isPlainObject(left) &&
    isPlainObject(right)
  ) {
    return (
      stableStringify(left) ===
      stableStringify(right)
    );
  }

  if (
    Array.isArray(left) &&
    Array.isArray(right)
  ) {
    return (
      stableStringify(left) ===
      stableStringify(right)
    );
  }

  return false;
}

/**
 * ============================================================================
 * EXACT DECIMAL REPRESENTATION
 * ============================================================================
 *
 * JavaScript Number is deliberately NOT used to determine monetary equality.
 *
 * Values such as:
 *
 *     0.1 + 0.2
 *
 * must never become the basis for financial reconciliation.
 *
 * We represent decimals as:
 *
 *     sign
 *     integer coefficient
 *     decimal scale
 *
 * using BigInt.
 * ============================================================================
 */

function decimalParts(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return {
      sign: 1n,
      coefficient: 0n,
      scale: 0,
    };
  }

  let stringValue =
    typeof value === 'string'
      ? value.trim()
      : value?.toString?.();

  if (
    !stringValue
  ) {
    throw new Stage01dReconciliationError(
      'Unable to normalize monetary value.',
      'INVALID_MONETARY_VALUE',
      {
        value,
      },
    );
  }

  stringValue =
    stringValue
      .replace(/,/g, '')
      .trim();

  /**
   * Decimal128 may sometimes be serialized as:
   *
   *     Decimal128('123.45')
   *
   * Handle the common wrapper defensively.
   */
  const wrapperMatch =
    stringValue.match(
      /^Decimal128\(['"](.+)['"]\)$/,
    );

  if (
    wrapperMatch
  ) {
    stringValue =
      wrapperMatch[1];
  }

  const scientificMatch =
    stringValue.match(
      /^([+-]?)(\d+(?:\.\d+)?)(?:[eE]([+-]?\d+))?$/,
    );

  if (
    !scientificMatch
  ) {
    throw new Stage01dReconciliationError(
      `Invalid monetary value: ${stringValue}`,
      'INVALID_MONETARY_VALUE',
      {
        value,
      },
    );
  }

  const sign =
    scientificMatch[1] === '-'
      ? -1n
      : 1n;

  const coefficientString =
    scientificMatch[2];

  const exponent =
    Number(
      scientificMatch[3] ||
        0,
    );

  const decimalIndex =
    coefficientString.indexOf('.');

  const scale =
    decimalIndex === -1
      ? 0
      : coefficientString.length -
        decimalIndex -
        1;

  const digits =
    coefficientString.replace(
      '.',
      '',
    );

  let coefficient =
    BigInt(digits);

  const adjustedScale =
    scale - exponent;

  if (
    adjustedScale < 0
  ) {
    coefficient *=
      10n **
      BigInt(
        Math.abs(
          adjustedScale,
        ),
      );

    return {
      sign,
      coefficient,
      scale: 0,
    };
  }

  return {
    sign,
    coefficient,
    scale:
      adjustedScale,
  };
}

function normalizeDecimal(
  value,
) {
  const parts =
    decimalParts(value);

  if (
    parts.coefficient === 0n
  ) {
    return {
      sign: 1n,
      coefficient: 0n,
      scale: 0,
    };
  }

  let {
    coefficient,
    scale,
    sign,
  } = parts;

  while (
    scale > 0 &&
    coefficient % 10n === 0n
  ) {
    coefficient /=
      10n;

    scale -= 1;
  }

  return {
    sign,
    coefficient,
    scale,
  };
}

function alignDecimals(
  left,
  right,
) {
  const a =
    normalizeDecimal(left);

  const b =
    normalizeDecimal(right);

  const scale =
    Math.max(
      a.scale,
      b.scale,
    );

  const leftCoefficient =
    a.sign *
    a.coefficient *
    10n **
      BigInt(
        scale -
          a.scale,
      );

  const rightCoefficient =
    b.sign *
    b.coefficient *
    10n **
      BigInt(
        scale -
          b.scale,
      );

  return {
    leftCoefficient,
    rightCoefficient,
    scale,
  };
}

function decimalCompare(
  left,
  right,
) {
  const {
    leftCoefficient,
    rightCoefficient,
  } = alignDecimals(
    left,
    right,
  );

  if (
    leftCoefficient ===
    rightCoefficient
  ) {
    return 0;
  }

  return leftCoefficient >
    rightCoefficient
    ? 1
    : -1;
}

function decimalSubtract(
  left,
  right,
) {
  const {
    leftCoefficient,
    rightCoefficient,
    scale,
  } = alignDecimals(
    left,
    right,
  );

  return {
    coefficient:
      leftCoefficient -
      rightCoefficient,

    scale,
  };
}

function decimalAbsolute(
  value,
) {
  const normalized =
    normalizeDecimal(value);

  return {
    coefficient:
      normalized.coefficient,

    scale:
      normalized.scale,
  };
}

function decimalToString(
  value,
) {
  const coefficient =
    value.coefficient;

  const scale =
    value.scale;

  if (
    coefficient === 0n
  ) {
    return '0';
  }

  const negative =
    coefficient < 0n;

  let digits =
    (
      negative
        ? -coefficient
        : coefficient
    ).toString();

  if (
    scale === 0
  ) {
    return `${
      negative
        ? '-'
        : ''
    }${digits}`;
  }

  if (
    digits.length <= scale
  ) {
    digits =
      digits.padStart(
        scale + 1,
        '0',
      );
  }

  const position =
    digits.length -
    scale;

  return `${
    negative
      ? '-'
      : ''
  }${digits.slice(
    0,
    position,
  )}.${digits.slice(
    position,
  )}`;
}

function decimalAbsDifference(
  left,
  right,
) {
  const difference =
    decimalSubtract(
      left,
      right,
    );

  return decimalToString(
    decimalAbsolute(
      difference,
    ),
  );
}

function decimalGreaterThan(
  left,
  right,
) {
  return (
    decimalCompare(
      left,
      right,
    ) > 0
  );
}

function decimalLessThanOrEqual(
  left,
  right,
) {
  return (
    decimalCompare(
      left,
      right,
    ) <= 0
  );
}

/**
 * ============================================================================
 * DECIMAL RELATIVE DIFFERENCE
 * ============================================================================
 *
 * Used for basis-point severity classification.
 *
 * The result is intentionally a Number because this is telemetry/classification
 * metadata rather than a monetary posting calculation.
 */

function decimalToNumber(
  value,
) {
  const normalized =
    normalizeDecimal(value);

  const stringValue =
    decimalToString({
      coefficient:
        normalized.sign *
        normalized.coefficient,

      scale:
        normalized.scale,
    });

  const number =
    Number(stringValue);

  return Number.isFinite(number)
    ? number
    : 0;
}

function calculateBasisPoints(
  difference,
  baseline,
) {
  const differenceNumber =
    Math.abs(
      decimalToNumber(
        difference,
      ),
    );

  const baselineNumber =
    Math.abs(
      decimalToNumber(
        baseline,
      ),
    );

  if (
    baselineNumber === 0
  ) {
    return differenceNumber ===
      0
      ? 0
      : Infinity;
  }

  return (
    differenceNumber /
    baselineNumber
  ) *
  10000;
}

/**
 * ============================================================================
 * PATH HELPERS
 * ============================================================================
 */

function normalizePath(
  path,
) {
  return String(path)
    .replace(
      /\[(\d+)\]/g,
      '.$1',
    )
    .replace(
      /^\./,
      '',
    );
}

function shouldIgnorePath(
  path,
  policy,
) {
  const normalized =
    normalizePath(path);

  const ignored =
    [
      ...(policy.ignorePaths ||
        []),

      ...(policy.volatilePaths ||
        []),
    ];

  return ignored.some(
    candidate => {
      const normalizedCandidate =
        normalizePath(
          candidate,
        );

      return (
        normalized ===
          normalizedCandidate ||
        normalized.startsWith(
          `${normalizedCandidate}.`,
        )
      );
    },
  );
}

/**
 * ============================================================================
 * RECONCILIATION SERVICE
 * ============================================================================
 */

class Stage01dReconciliationService {
  constructor({
    reconciliationRepository = null,
    telemetryService = null,
    logger = null,
    clock = () => new Date(),
    policy = {},
  } = {}) {
    this.reconciliationRepository =
      reconciliationRepository;

    this.telemetryService =
      telemetryService;

    this.logger =
      logger;

    this.clock =
      clock;

    this.policy = {
      ...DEFAULT_POLICY,
      ...policy,
    };
  }

  /**
   * ==========================================================================
   * LOGGING
   * ==========================================================================
   */

  log(
    level,
    message,
    metadata = {},
  ) {
    try {
      if (
        this.logger &&
        typeof this.logger[level] ===
          'function'
      ) {
        this.logger[level](
          message,
          {
            service:
              SERVICE_NAME,

            version:
              SERVICE_VERSION,

            stage: STAGE,

            mode: MODE,

            ...metadata,
          },
        );
      }
    } catch {
      /**
       * Reconciliation logging must never become a billing execution failure.
       */
    }
  }

  /**
   * ==========================================================================
   * MAIN RECONCILIATION ENTRY POINT
   * ==========================================================================
   *
   * Input:
   *
   * {
   *   executionId,
   *   reconciliationKey,
   *   tenantId,
   *   operation,
   *   legacyResult,
   *   shadowResult,
   *   context,
   *   configuration,
   *   tolerance
   * }
   *
   * Output:
   *
   * A deterministic reconciliation record.
   */

  reconcile({
    executionId,
    reconciliationKey,
    tenantId,
    operation,
    legacyResult,
    shadowResult,
    context = {},
    legacyConfiguration = undefined,
    shadowConfiguration = undefined,
    toleranceAmount = undefined,
    metadata = {},
  } = {}) {
    const startedAt =
      this.clock();

    this.validateInput({
      executionId,
      reconciliationKey,
      tenantId,
      operation,
      legacyResult,
      shadowResult,
    });

    const effectiveTolerance =
      toleranceAmount !==
        undefined
        ? toleranceAmount
        : this.policy
            .monetaryToleranceAmount;

    const legacyNormalized =
      this.normalizeBillingResult(
        legacyResult,
      );

    const shadowNormalized =
      this.normalizeBillingResult(
        shadowResult,
      );

    const normalizationDifferences =
      this.compareNormalization(
        legacyResult,
        shadowResult,
      );

    const monetary =
      this.compareMonetaryResults(
        legacyNormalized,
        shadowNormalized,
        effectiveTolerance,
      );

    const lineItems =
      this.compareLineItems(
        legacyNormalized.lineItems,
        shadowNormalized.lineItems,
        effectiveTolerance,
      );

    const configuration =
      this.compareConfigurations(
        legacyConfiguration ??
          legacyNormalized.configuration,

        shadowConfiguration ??
          shadowNormalized.configuration,
      );

    const fields =
      this.compareFields(
        legacyNormalized,
        shadowNormalized,
        {
          path: '',
          toleranceAmount:
            effectiveTolerance,
        },
      );

    const classifications =
      this.buildClassifications({
        monetary,
        lineItems,
        configuration,
        normalizationDifferences,
        fields,
      });

    const status =
      this.resolveStatus(
        classifications,
        {
          monetary,
          lineItems,
          configuration,
          normalizationDifferences,
          fields,
        },
      );

    const matchType =
      this.resolveMatchType(
        status,
      );

    const severity =
      this.resolveSeverity({
        monetary,
        lineItems,
        configuration,
        normalizationDifferences,
        fields,
        status,
      });

    const fieldDifferences =
      this.buildStructuredDifferences({
        monetary,
        lineItems,
        configuration,
        normalizationDifferences,
        fields,
      });

    const result =
      this.buildReconciliationRecord({
        executionId,
        reconciliationKey,
        tenantId,
        operation,

        legacyResult:
          legacyNormalized,

        shadowResult:
          shadowNormalized,

        context,

        monetary,
        lineItems,
        configuration,
        normalizationDifferences,
        fields,

        classifications,
        status,
        matchType,
        severity,

        fieldDifferences,

        toleranceAmount:
          effectiveTolerance,

        metadata,

        startedAt,
      });

    this.log(
      status ===
        STATUSES.DIVERGED
        ? 'warn'
        : 'debug',

      'Stage 01d reconciliation completed.',

      {
        executionId,
        reconciliationKey,
        tenantId,
        operation,
        status,
        matchType,
        severity,
        classifications,
      },
    );

    return result;
  }

  /**
   * ==========================================================================
   * INPUT VALIDATION
   * ==========================================================================
   */

  validateInput({
    executionId,
    reconciliationKey,
    tenantId,
    operation,
    legacyResult,
    shadowResult,
  }) {
    const required = {
      executionId,
      reconciliationKey,
      tenantId,
      operation,
      legacyResult,
      shadowResult,
    };

    for (
      const [
        key,
        value,
      ] of Object.entries(
        required,
      )
    ) {
      if (
        value ===
          undefined ||
        value ===
          null ||
        value === ''
      ) {
        throw new Stage01dReconciliationError(
          `${key} is required.`,
          'INVALID_RECONCILIATION_INPUT',
          {
            field: key,
          },
        );
      }
    }

    if (
      !isPlainObject(
        legacyResult,
      )
    ) {
      throw new Stage01dReconciliationError(
        'legacyResult must be an object.',
        'INVALID_LEGACY_RESULT',
      );
    }

    if (
      !isPlainObject(
        shadowResult,
      )
    ) {
      throw new Stage01dReconciliationError(
        'shadowResult must be an object.',
        'INVALID_SHADOW_RESULT',
      );
    }
  }

  /**
   * ==========================================================================
   * BILLING RESULT NORMALIZATION
   * ==========================================================================
   *
   * Normalization deliberately does not hide meaningful financial differences.
   *
   * It standardizes:
   *
   *   - totals
   *   - line items
   *   - configuration
   *   - currency
   *   - common monetary aliases
   */

  normalizeBillingResult(
    result,
  ) {
    const cloned =
      cloneValue(result);

    const total =
      this.firstDefined(
        cloned.total,
        cloned.totalAmount,
        cloned.amount,
        cloned.netAmount,
        cloned.grossAmount,
        0,
      );

    const subtotal =
      this.firstDefined(
        cloned.subtotal,
        cloned.subtotalAmount,
        0,
      );

    const tax =
      this.firstDefined(
        cloned.tax,
        cloned.taxAmount,
        0,
      );

    const fee =
      this.firstDefined(
        cloned.fee,
        cloned.feeAmount,
        0,
      );

    const discount =
      this.firstDefined(
        cloned.discount,
        cloned.discountAmount,
        0,
      );

    const lineItems =
      this.extractLineItems(
        cloned,
      );

    const configuration =
      this.extractConfiguration(
        cloned,
      );

    const currency =
      this.firstDefined(
        cloned.currency,
        cloned.currencyCode,
        getPath(
          cloned,
          'money.currency',
        ),
        getPath(
          cloned,
          'amount.currency',
        ),
        null,
      );

    return {
      ...cloned,

      total,

      subtotal,

      tax,

      fee,

      discount,

      currency,

      lineItems,

      configuration,
    };
  }

  firstDefined(
    ...values
  ) {
    for (
      const value of values
    ) {
      if (
        value !==
          undefined &&
        value !==
          null
      ) {
        return value;
      }
    }

    return undefined;
  }

  /**
   * ==========================================================================
   * LINE ITEM EXTRACTION
   * ==========================================================================
   */

  extractLineItems(
    result,
  ) {
    const candidates = [
      result.lineItems,
      result.items,
      result.components,
      result.charges,
      result.fees,
      result.billingComponents,
    ];

    for (
      const candidate of
        candidates
    ) {
      if (
        Array.isArray(
          candidate,
        )
      ) {
        return candidate.map(
          item =>
            cloneValue(item),
        );
      }
    }

    return [];
  }

  /**
   * ==========================================================================
   * CONFIGURATION EXTRACTION
   * ==========================================================================
   */

  extractConfiguration(
    result,
  ) {
    for (
      const path of
        this.policy
          .configurationPaths
    ) {
      if (
        hasPath(
          result,
          path,
        )
      ) {
        return cloneValue(
          getPath(
            result,
            path,
          ),
        );
      }
    }

    return null;
  }

  /**
   * ==========================================================================
   * NORMALIZATION COMPARISON
   * ==========================================================================
   *
   * Detects semantic normalization differences without treating normalization
   * itself as a monetary divergence.
   */

  compareNormalization(
    legacy,
    shadow,
  ) {
    const differences = [];

    const aliases = [
      {
        canonical:
          'total',

        legacy:
          this.firstDefined(
            legacy.total,
            legacy.totalAmount,
            legacy.amount,
          ),

        shadow:
          this.firstDefined(
            shadow.total,
            shadow.totalAmount,
            shadow.amount,
          ),
      },

      {
        canonical:
          'subtotal',

        legacy:
          this.firstDefined(
            legacy.subtotal,
            legacy.subtotalAmount,
          ),

        shadow:
          this.firstDefined(
            shadow.subtotal,
            shadow.subtotalAmount,
          ),
      },

      {
        canonical:
          'tax',

        legacy:
          this.firstDefined(
            legacy.tax,
            legacy.taxAmount,
          ),

        shadow:
          this.firstDefined(
            shadow.tax,
            shadow.taxAmount,
          ),
      },

      {
        canonical:
          'fee',

        legacy:
          this.firstDefined(
            legacy.fee,
            legacy.feeAmount,
          ),

        shadow:
          this.firstDefined(
            shadow.fee,
            shadow.feeAmount,
          ),
      },

      {
        canonical:
          'discount',

        legacy:
          this.firstDefined(
            legacy.discount,
            legacy.discountAmount,
          ),

        shadow:
          this.firstDefined(
            shadow.discount,
            shadow.discountAmount,
          ),
      },
    ];

    for (
      const alias of aliases
    ) {
      const legacyHas =
        alias.legacy !==
          undefined &&
        alias.legacy !==
          null;

      const shadowHas =
        alias.shadow !==
          undefined &&
        alias.shadow !==
          null;

      if (
        legacyHas &&
        shadowHas &&
        decimalCompare(
          alias.legacy,
          alias.shadow,
        ) === 0
      ) {
        continue;
      }

      if (
        legacyHas !==
        shadowHas
      ) {
        differences.push({
          type:
            'alias_presence',

          path:
            alias.canonical,

          legacyPresent:
            legacyHas,

          shadowPresent:
            shadowHas,

          legacyValue:
            alias.legacy,

          shadowValue:
            alias.shadow,
        });
      }
    }

    const legacyCurrency =
      normalizeString(
        legacy.currency,
      );

    const shadowCurrency =
      normalizeString(
        shadow.currency,
      );

    if (
      legacyCurrency !==
      shadowCurrency
    ) {
      differences.push({
        type:
          'currency_normalization',

        path:
          'currency',

        legacyValue:
          legacyCurrency,

        shadowValue:
          shadowCurrency,
      });
    }

    return differences;
  }

  /**
   * ==========================================================================
   * MONETARY COMPARISON
   * ==========================================================================
   */

  compareMonetaryResults(
    legacy,
    shadow,
    toleranceAmount,
  ) {
    const fields = [
      'total',
      'subtotal',
      'tax',
      'fee',
      'discount',
    ];

    const differences = [];

    let totalAbsoluteDelta =
      '0';

    for (
      const field of
        fields
    ) {
      const legacyValue =
        this.firstDefined(
          legacy[field],
          0,
        );

      const shadowValue =
        this.firstDefined(
          shadow[field],
          0,
        );

      const difference =
        decimalAbsDifference(
          legacyValue,
          shadowValue,
        );

      const withinTolerance =
        decimalLessThanOrEqual(
          difference,
          toleranceAmount,
        );

      if (
        decimalCompare(
          difference,
          '0',
        ) !== 0
      ) {
        differences.push({
          path:
            field,

          legacyValue:
            String(
              legacyValue,
            ),

          shadowValue:
            String(
              shadowValue,
            ),

          absoluteDifference:
            difference,

          withinTolerance,
        });

        const accumulated =
          decimalSubtract(
            totalAbsoluteDelta,
            `-${difference}`,
          );

        totalAbsoluteDelta =
          decimalToString(
            accumulated,
          );
      }
    }

    const totalDifference =
      decimalAbsDifference(
        legacy.total,
        shadow.total,
      );

    const baseline =
      decimalAbsolute(
        legacy.total,
      );

    const relativeBasisPoints =
      calculateBasisPoints(
        totalDifference,
        decimalToString({
          coefficient:
            baseline.coefficient,

          scale:
            baseline.scale,
        }),
      );

    return {
      exact:
        differences.length === 0,

      withinTolerance:
        differences.every(
          item =>
            item.withinTolerance,
        ),

      legacyTotal:
        String(
          legacy.total ?? 0,
        ),

      shadowTotal:
        String(
          shadow.total ?? 0,
        ),

      absoluteDelta:
        totalDifference,

      totalAbsoluteDelta,

      relativeBasisPoints,

      differences,
    };
  }

  /**
   * ==========================================================================
   * LINE ITEM COMPARISON
   * ==========================================================================
   */

  compareLineItems(
    legacyItems = [],
    shadowItems = [],
    toleranceAmount,
  ) {
    const legacyMap =
      this.indexLineItems(
        legacyItems,
      );

    const shadowMap =
      this.indexLineItems(
        shadowItems,
      );

    const keys =
      new Set([
        ...legacyMap.keys(),
        ...shadowMap.keys(),
      ]);

    const differences = [];

    let exactCount = 0;
    let toleranceCount = 0;
    let missingCount = 0;

    for (
      const key of keys
    ) {
      const legacyItem =
        legacyMap.get(key);

      const shadowItem =
        shadowMap.get(key);

      if (
        !legacyItem
      ) {
        missingCount += 1;

        differences.push({
          type:
            'missing_legacy_component',

          key,

          legacy:
            null,

          shadow:
            cloneValue(
              shadowItem,
            ),
        });

        continue;
      }

      if (
        !shadowItem
      ) {
        missingCount += 1;

        differences.push({
          type:
            'missing_shadow_component',

          key,

          legacy:
            cloneValue(
              legacyItem,
            ),

          shadow:
            null,
        });

        continue;
      }

      const legacyAmount =
        this.extractLineItemAmount(
          legacyItem,
        );

      const shadowAmount =
        this.extractLineItemAmount(
          shadowItem,
        );

      const amountDifference =
        decimalAbsDifference(
          legacyAmount,
          shadowAmount,
        );

      const amountWithinTolerance =
        decimalLessThanOrEqual(
          amountDifference,
          toleranceAmount,
        );

      const fieldDifferences =
        this.compareFields(
          legacyItem,
          shadowItem,
          {
            path:
              `lineItems.${key}`,
            toleranceAmount,
          },
        );

      if (
        fieldDifferences.length ===
        0
      ) {
        exactCount += 1;
        continue;
      }

      if (
        amountWithinTolerance
      ) {
        toleranceCount += 1;
      }

      differences.push({
        type:
          'line_item_difference',

        key,

        amount: {
          legacy:
            String(
              legacyAmount,
            ),

          shadow:
            String(
              shadowAmount,
            ),

          absoluteDifference:
            amountDifference,

          withinTolerance:
            amountWithinTolerance,
        },

        fieldDifferences,
      });
    }

    return {
      exact:
        differences.length === 0,

      withinTolerance:
        differences.every(
          difference => {
            if (
              difference.type ===
              'line_item_difference'
            ) {
              return Boolean(
                difference.amount
                  ?.withinTolerance,
              );
            }

            return false;
          },
        ) &&
        missingCount === 0,

      legacyCount:
        legacyItems.length,

      shadowCount:
        shadowItems.length,

      exactCount,

      toleranceCount,

      missingCount,

      differences,
    };
  }

  /**
   * ==========================================================================
   * LINE ITEM INDEXING
   * ==========================================================================
   */

  indexLineItems(
    items,
  ) {
    const map =
      new Map();

    for (
      const item of
        items || []
    ) {
      const key =
        this.lineItemKey(
          item,
        );

      if (
        map.has(key)
      ) {
        /**
         * Duplicate component identities are themselves a divergence signal.
         * Preserve deterministic behavior by suffixing the duplicate key.
         */
        let suffix = 2;

        let candidate =
          `${key}#${suffix}`;

        while (
          map.has(candidate)
        ) {
          suffix += 1;

          candidate =
            `${key}#${suffix}`;
        }

        map.set(
          candidate,
          item,
        );
      } else {
        map.set(
          key,
          item,
        );
      }
    }

    return map;
  }

  lineItemKey(
    item,
  ) {
    for (
      const field of
        this.policy
          .lineItemIdentityFields
    ) {
      const value =
        getPath(
          item,
          field,
        );

      if (
        value !==
          undefined &&
        value !==
          null &&
        value !== ''
      ) {
        return String(value);
      }
    }

    /**
     * Deterministic fallback.
     */
    return stableStringify(
      item,
    );
  }

  extractLineItemAmount(
    item,
  ) {
    return this.firstDefined(
      item.amount,
      item.total,
      item.totalAmount,
      item.netAmount,
      item.grossAmount,
      item.feeAmount,
      item.chargeAmount,
      0,
    );
  }

  /**
   * ==========================================================================
   * CONFIGURATION COMPARISON
   * ==========================================================================
   */

  compareConfigurations(
    legacy,
    shadow,
  ) {
    if (
      legacy === undefined &&
      shadow === undefined
    ) {
      return {
        present:
          false,

        exact:
          true,

        differences: [],
      };
    }

    const differences =
      this.compareFields(
        legacy,
        shadow,
        {
          path:
            'configuration',

          toleranceAmount:
            this.policy
              .monetaryToleranceAmount,

          configurationMode:
            true,
        },
      );

    return {
      present:
        legacy !==
          undefined ||
        shadow !==
          undefined,

      exact:
        differences.length === 0,

      differences,
    };
  }

  /**
   * ==========================================================================
   * RECURSIVE FIELD COMPARISON
   * ==========================================================================
   *
   * Produces machine-readable differences:
   *
   * {
   *   path,
   *   type,
   *   legacyValue,
   *   shadowValue
   * }
   */

  compareFields(
    legacy,
    shadow,
    {
      path = '',
      toleranceAmount =
        this.policy
          .monetaryToleranceAmount,
      configurationMode = false,
    } = {},
  ) {
    const differences = [];

    if (
      shouldIgnorePath(
        path,
        this.policy,
      )
    ) {
      return differences;
    }

    if (
      valuesEquivalent(
        legacy,
        shadow,
      )
    ) {
      return differences;
    }

    if (
      legacy === undefined ||
      shadow === undefined
    ) {
      differences.push({
        path,

        type:
          legacy === undefined
            ? 'missing_legacy_field'
            : 'missing_shadow_field',

        legacyValue:
          cloneValue(legacy),

        shadowValue:
          cloneValue(shadow),

        configuration:
          configurationMode,
      });

      return differences;
    }

    if (
      legacy === null ||
      shadow === null
    ) {
      differences.push({
        path,

        type:
          'null_mismatch',

        legacyValue:
          cloneValue(legacy),

        shadowValue:
          cloneValue(shadow),

        configuration:
          configurationMode,
      });

      return differences;
    }

    if (
      isPlainObject(
        legacy,
      ) &&
      isPlainObject(
        shadow,
      )
    ) {
      const keys =
        new Set([
          ...Object.keys(
            legacy,
          ),

          ...Object.keys(
            shadow,
          ),
        ]);

      for (
        const key of keys
      ) {
        const childPath =
          path
            ? `${path}.${key}`
            : key;

        differences.push(
          ...this.compareFields(
            legacy[key],
            shadow[key],
            {
              path:
                childPath,

              toleranceAmount,

              configurationMode,
            },
          ),
        );
      }

      return differences;
    }

    if (
      Array.isArray(
        legacy,
      ) &&
      Array.isArray(
        shadow,
      )
    ) {
      if (
        legacy.length !==
        shadow.length
      ) {
        differences.push({
          path,

          type:
            'array_length_mismatch',

          legacyValue:
            legacy.length,

          shadowValue:
            shadow.length,

          configuration:
            configurationMode,
        });
      }

      const max =
        Math.max(
          legacy.length,
          shadow.length,
        );

      for (
        let index = 0;
        index < max;
        index += 1
      ) {
        const childPath =
          `${path}[${index}]`;

        differences.push(
          ...this.compareFields(
            legacy[index],
            shadow[index],
            {
              path:
                childPath,

              toleranceAmount,

              configurationMode,
            },
          ),
        );
      }

      return differences;
    }

    /**
     * Monetary fields receive exact decimal comparison.
     */
    if (
      this.isMonetaryPath(
        path,
      )
    ) {
      try {
        const difference =
          decimalAbsDifference(
            legacy,
            shadow,
          );

        const withinTolerance =
          decimalLessThanOrEqual(
            difference,
            toleranceAmount,
          );

        if (
          !withinTolerance
        ) {
          differences.push({
            path,

            type:
              'monetary_field_divergence',

            legacyValue:
              String(legacy),

            shadowValue:
              String(shadow),

            absoluteDifference:
              difference,

            withinTolerance:
              false,

            configuration:
              configurationMode,
          });
        }

        return differences;
      } catch {
        /**
         * If a supposedly monetary field cannot be parsed as a decimal,
         * classify it as a normalization mismatch rather than silently
         * converting it to Number.
         */
        differences.push({
          path,

          type:
            'normalization_mismatch',

          legacyValue:
            cloneValue(legacy),

          shadowValue:
            cloneValue(shadow),

          configuration:
            configurationMode,
        });

        return differences;
      }
    }

    differences.push({
      path,

      type:
        configurationMode
          ? 'configuration_field_divergence'
          : 'field_divergence',

      legacyValue:
        cloneValue(legacy),

      shadowValue:
        cloneValue(shadow),

      configuration:
        configurationMode,
    });

    return differences;
  }

  /**
   * ==========================================================================
   * MONETARY PATH DETECTION
   * ==========================================================================
   */

  isMonetaryPath(
    path,
  ) {
    const normalized =
      normalizePath(
        path,
      ).toLowerCase();

    return this.policy
      .monetaryPaths
      .some(candidate => {
        const normalizedCandidate =
          normalizePath(
            candidate,
          ).toLowerCase();

        return (
          normalized ===
            normalizedCandidate ||
          normalized.endsWith(
            `.${normalizedCandidate}`,
          ) ||
          normalized.endsWith(
            normalizedCandidate,
          )
        );
      });
  }

  /**
   * ==========================================================================
   * CLASSIFICATION
   * ==========================================================================
   */

  buildClassifications({
    monetary,
    lineItems,
    configuration,
    normalizationDifferences,
    fields,
  }) {
    const classifications =
      [];

    if (
      monetary.exact &&
      lineItems.exact &&
      configuration.exact &&
      normalizationDifferences.length ===
        0 &&
      fields.length === 0
    ) {
      classifications.push(
        CLASSIFICATIONS.EXACT_MATCH,
      );

      return classifications;
    }

    if (
      normalizationDifferences.length >
      0
    ) {
      classifications.push(
        CLASSIFICATIONS.NORMALIZATION_MISMATCH,
      );
    }

    if (
      !configuration.exact
    ) {
      classifications.push(
        CLASSIFICATIONS.CONFIGURATION_DIVERGENCE,
      );
    }

    if (
      lineItems.missingCount >
      0
    ) {
      classifications.push(
        CLASSIFICATIONS.MISSING_COMPONENT,
      );
    }

    if (
      !lineItems.exact
    ) {
      classifications.push(
        CLASSIFICATIONS.LINE_ITEM_DIVERGENCE,
      );
    }

    if (
      !monetary.exact
    ) {
      if (
        monetary.withinTolerance
      ) {
        classifications.push(
          CLASSIFICATIONS.TOLERANCE_MATCH,
        );
      } else {
        classifications.push(
          CLASSIFICATIONS.MONETARY_DIVERGENCE,
        );
      }
    }

    if (
      fields.length >
      0
    ) {
      const hasConfiguration =
        fields.some(
          field =>
            field.configuration ===
            true,
        );

      if (
        hasConfiguration
      ) {
        if (
          !classifications.includes(
            CLASSIFICATIONS.CONFIGURATION_DIVERGENCE,
          )
        ) {
          classifications.push(
            CLASSIFICATIONS.CONFIGURATION_DIVERGENCE,
          );
        }
      } else {
        classifications.push(
          CLASSIFICATIONS.FIELD_DIVERGENCE,
        );
      }
    }

    /**
     * If all differences are monetary differences within tolerance and there
     * are no structural/configuration differences, the result qualifies as a
     * tolerance match.
     */
    if (
      monetary.withinTolerance &&
      lineItems.withinTolerance &&
      configuration.exact &&
      normalizationDifferences.length ===
        0
    ) {
      if (
        !classifications.includes(
          CLASSIFICATIONS.TOLERANCE_MATCH,
        )
      ) {
        classifications.push(
          CLASSIFICATIONS.TOLERANCE_MATCH,
        );
      }
    }

    return [
      ...new Set(
        classifications,
      ),
    ];
  }

  /**
   * ==========================================================================
   * STATUS
   * ==========================================================================
   */

  resolveStatus(
    classifications,
    {
      monetary,
      lineItems,
      configuration,
      normalizationDifferences,
      fields,
    },
  ) {
    if (
      classifications.includes(
        CLASSIFICATIONS.EXECUTION_FAILURE,
      )
    ) {
      return STATUSES.FAILED;
    }

    if (
      classifications.includes(
        CLASSIFICATIONS.INCONCLUSIVE,
      )
    ) {
      return STATUSES.INCONCLUSIVE;
    }

    if (
      monetary.exact &&
      lineItems.exact &&
      configuration.exact &&
      normalizationDifferences.length ===
        0 &&
      fields.length === 0
    ) {
      return STATUSES.EXACT;
    }

    /**
     * Tolerance is allowed only when structural and configuration parity
     * remains intact.
     */
    if (
      monetary.withinTolerance &&
      lineItems.withinTolerance &&
      configuration.exact &&
      normalizationDifferences.length ===
        0
    ) {
      return STATUSES.WITHIN_TOLERANCE;
    }

    return STATUSES.DIVERGED;
  }

  /**
   * ==========================================================================
   * MATCH TYPE
   * ==========================================================================
   */

  resolveMatchType(
    status,
  ) {
    switch (status) {
      case STATUSES.EXACT:
        return MATCH_TYPES.EXACT;

      case STATUSES.WITHIN_TOLERANCE:
        return MATCH_TYPES.TOLERANCE;

      case STATUSES.DIVERGED:
        return MATCH_TYPES.DIVERGENCE;

      case STATUSES.FAILED:
        return MATCH_TYPES.FAILURE;

      default:
        return MATCH_TYPES.INCONCLUSIVE;
    }
  }

  /**
   * ==========================================================================
   * SEVERITY
   * ==========================================================================
   */

  resolveSeverity({
    monetary,
    lineItems,
    configuration,
    normalizationDifferences,
    fields,
    status,
  }) {
    if (
      status ===
        STATUSES.EXACT ||
      status ===
        STATUSES.WITHIN_TOLERANCE
    ) {
      return SEVERITIES.LOW;
    }

    /**
     * Configuration divergence is operationally significant because a
     * billing result may appear numerically plausible while being produced
     * from the wrong commercial policy.
     */
    if (
      !configuration.exact
    ) {
      return SEVERITIES.HIGH;
    }

    /**
     * Missing billing components are high severity by default.
     */
    if (
      lineItems.missingCount >
      0
    ) {
      return SEVERITIES.HIGH;
    }

    /**
     * Normalization mismatches require review because the comparison itself
     * may not be semantically trustworthy.
     */
    if (
      normalizationDifferences.length >
      0
    ) {
      return SEVERITIES.HIGH;
    }

    if (
      monetary.relativeBasisPoints >=
      this.policy
        .criticalSeverityBps
    ) {
      return SEVERITIES.CRITICAL;
    }

    if (
      monetary.relativeBasisPoints >=
      this.policy
        .highSeverityBps
    ) {
      return SEVERITIES.HIGH;
    }

    if (
      fields.length >
      0 ||
      !lineItems.exact ||
      !monetary.exact
    ) {
      return SEVERITIES.MEDIUM;
    }

    return SEVERITIES.LOW;
  }

  /**
   * ==========================================================================
   * STRUCTURED DIFFERENCES
   * ==========================================================================
   */

  buildStructuredDifferences({
    monetary,
    lineItems,
    configuration,
    normalizationDifferences,
    fields,
  }) {
    const differences = [];

    for (
      const difference of
        normalizationDifferences
    ) {
      differences.push({
        category:
          CLASSIFICATIONS.NORMALIZATION_MISMATCH,

        ...difference,
      });
    }

    for (
      const difference of
        monetary.differences
    ) {
      differences.push({
        category:
          CLASSIFICATIONS.MONETARY_DIVERGENCE,

        ...difference,
      });
    }

    for (
      const difference of
        lineItems.differences
    ) {
      const category =
        difference.type.includes(
          'missing',
        )
          ? CLASSIFICATIONS.MISSING_COMPONENT
          : CLASSIFICATIONS.LINE_ITEM_DIVERGENCE;

      differences.push({
        category,

        ...difference,
      });
    }

    for (
      const difference of
        configuration.differences
    ) {
      differences.push({
        category:
          CLASSIFICATIONS.CONFIGURATION_DIVERGENCE,

        ...difference,
      });
    }

    for (
      const difference of
        fields
    ) {
      differences.push({
        category:
          difference.configuration
            ? CLASSIFICATIONS.CONFIGURATION_DIVERGENCE
            : CLASSIFICATIONS.FIELD_DIVERGENCE,

        ...difference,
      });
    }

    return differences;
  }

  /**
   * ==========================================================================
   * RECONCILIATION RECORD
   * ==========================================================================
   */

  buildReconciliationRecord({
    executionId,
    reconciliationKey,
    tenantId,
    operation,

    legacyResult,
    shadowResult,

    context,

    monetary,
    lineItems,
    configuration,
    normalizationDifferences,
    fields,

    classifications,
    status,
    matchType,
    severity,

    fieldDifferences,

    toleranceAmount,

    metadata,

    startedAt,
  }) {
    const completedAt =
      this.clock();

    const executionDurationMs =
      Math.max(
        0,
        completedAt.getTime() -
          startedAt.getTime(),
      );

    const exactMatch =
      status ===
      STATUSES.EXACT;

    const withinTolerance =
      status ===
        STATUSES.EXACT ||
      status ===
        STATUSES.WITHIN_TOLERANCE;

    const diverged =
      status ===
      STATUSES.DIVERGED;

    const executionFailed =
      status ===
      STATUSES.FAILED;

    return {
      schemaVersion:
        'stage01d.reconciliation.v1',

      service:
        SERVICE_NAME,

      serviceVersion:
        SERVICE_VERSION,

      stage:
        STAGE,

      mode:
        MODE,

      executionId,

      reconciliationKey,

      tenantId,

      operation,

      observedAt:
        completedAt,

      status,

      matchType,

      classification:
        classifications[0] ||
        CLASSIFICATIONS.INCONCLUSIVE,

      classifications,

      severity,

      exactMatch,

      withinTolerance,

      diverged,

      executionFailed,

      /**
       * Legacy remains the authoritative result.
       */
      authoritativeSource:
        'legacy',

      authoritativeResult:
        cloneValue(
          legacyResult,
        ),

      shadowResult:
        cloneValue(
          shadowResult,
        ),

      context:
        cloneValue(
          context,
        ),

      comparison: {
        monetary: {
          legacyTotal:
            monetary.legacyTotal,

          shadowTotal:
            monetary.shadowTotal,

          absoluteDelta:
            monetary.absoluteDelta,

          relativeBasisPoints:
            Number.isFinite(
              monetary.relativeBasisPoints,
            )
              ? monetary.relativeBasisPoints
              : null,

          exact:
            monetary.exact,

          withinTolerance:
            monetary.withinTolerance,

          toleranceAmount:
            String(
              toleranceAmount,
            ),

          fieldDifferences:
            cloneValue(
              monetary.differences,
            ),
        },

        lineItems: {
          legacyCount:
            lineItems.legacyCount,

          shadowCount:
            lineItems.shadowCount,

          exactCount:
            lineItems.exactCount,

          toleranceCount:
            lineItems.toleranceCount,

          missingCount:
            lineItems.missingCount,

          exact:
            lineItems.exact,

          withinTolerance:
            lineItems.withinTolerance,

          differences:
            cloneValue(
              lineItems.differences,
            ),
        },

        configuration: {
          present:
            configuration.present,

          exact:
            configuration.exact,

          differences:
            cloneValue(
              configuration.differences,
            ),
        },

        normalization: {
          exact:
            normalizationDifferences.length ===
            0,

          differences:
            cloneValue(
              normalizationDifferences,
            ),
        },

        fields: {
          differenceCount:
            fields.length,

          differences:
            cloneValue(
              fields,
            ),
        },
      },

      differences:
        fieldDifferences,

      metrics: {
        monetaryDivergence:
          monetary.absoluteDelta,

        monetaryDivergenceBasisPoints:
          Number.isFinite(
            monetary.relativeBasisPoints,
          )
            ? monetary.relativeBasisPoints
            : null,

        lineItemDifferenceCount:
          lineItems.differences.length,

        missingComponentCount:
          lineItems.missingCount,

        configurationDifferenceCount:
          configuration.differences.length,

        normalizationDifferenceCount:
          normalizationDifferences.length,

        fieldDifferenceCount:
          fields.length,
      },

      execution: {
        startedAt,

        completedAt,

        durationMs:
          executionDurationMs,
      },

      metadata:
        cloneValue(
          metadata,
        ),

      governance: {
        shadowOnly:
          true,

        automaticCutover:
          false,

        legacyBillingRemainsAuthoritative:
          true,
      },

      createdAt:
        completedAt,

      updatedAt:
        completedAt,
    };
  }

  /**
   * ==========================================================================
   * PERSIST RECONCILIATION
   * ==========================================================================
   *
   * Persistence is deliberately separated from comparison.
   */

  async reconcileAndPersist(
    input,
  ) {
    const record =
      this.reconcile(
        input,
      );

    if (
      !this.reconciliationRepository
    ) {
      return record;
    }

    if (
      typeof this
        .reconciliationRepository
        .upsert !==
      'function'
    ) {
      throw new Stage01dReconciliationError(
        'Reconciliation repository does not expose upsert().',
        'REPOSITORY_CONTRACT_ERROR',
      );
    }

    const persisted =
      await this
        .reconciliationRepository
        .upsert(
          record,
        );

    return (
      persisted ||
      record
    );
  }

  /**
   * ==========================================================================
   * SAFE TELEMETRY EMISSION
   * ==========================================================================
   *
   * Telemetry is downstream and non-authoritative. A telemetry failure must
   * never mutate the reconciliation result.
   */

  emitTelemetry(
    reconciliation,
  ) {
    if (
      !this.telemetryService
    ) {
      return null;
    }

    try {
      if (
        typeof this
          .telemetryService
          .recordExecutionObservation !==
        'function'
      ) {
        return null;
      }

      return this
        .telemetryService
        .recordExecutionObservation(
          reconciliation,
        );
    } catch (error) {
      this.log(
        'error',
        'Stage 01d telemetry emission failed.',
        {
          executionId:
            reconciliation
              ?.executionId,

          error:
            error.message,
        },
      );

      return null;
    }
  }

  /**
   * ==========================================================================
   * RECONCILE, PERSIST AND EMIT
   * ==========================================================================
   *
   * This convenience method preserves the architectural order:
   *
   *     compare
   *       ↓
   *     persist reconciliation
   *       ↓
   *     emit telemetry
   *
   * Telemetry never decides the reconciliation result.
   */

  async reconcilePersistAndEmit(
    input,
  ) {
    const reconciliation =
      await this
        .reconcileAndPersist(
          input,
        );

    const telemetry =
      this.emitTelemetry(
        reconciliation,
      );

    return {
      reconciliation,

      telemetry,
    };
  }

  /**
   * ==========================================================================
   * EXECUTION FAILURE RECORD
   * ==========================================================================
   *
   * Shadow execution can fail before a comparable billing result exists.
   * This method provides an explicit failure reconciliation record rather
   * than pretending the observation was a billing divergence.
   */

  buildExecutionFailureRecord({
    executionId,
    reconciliationKey,
    tenantId,
    operation,
    error,
    context = {},
    metadata = {},
  } = {}) {
    if (
      !executionId ||
      !reconciliationKey ||
      !tenantId ||
      !operation
    ) {
      throw new Stage01dReconciliationError(
        'Execution failure record requires executionId, reconciliationKey, tenantId and operation.',
        'INVALID_FAILURE_RECORD_INPUT',
      );
    }

    const now =
      this.clock();

    return {
      schemaVersion:
        'stage01d.reconciliation.v1',

      service:
        SERVICE_NAME,

      serviceVersion:
        SERVICE_VERSION,

      stage:
        STAGE,

      mode:
        MODE,

      executionId,

      reconciliationKey,

      tenantId,

      operation,

      observedAt:
        now,

      status:
        STATUSES.FAILED,

      matchType:
        MATCH_TYPES.FAILURE,

      classification:
        CLASSIFICATIONS.EXECUTION_FAILURE,

      classifications: [
        CLASSIFICATIONS.EXECUTION_FAILURE,
      ],

      severity:
        SEVERITIES.HIGH,

      exactMatch:
        false,

      withinTolerance:
        false,

      diverged:
        false,

      executionFailed:
        true,

      authoritativeSource:
        'legacy',

      authoritativeResult:
        null,

      shadowResult:
        null,

      context:
        cloneValue(
          context,
        ),

      comparison: {
        monetary: null,

        lineItems: null,

        configuration: null,

        normalization: null,

        fields: null,
      },

      differences: [
        {
          category:
            CLASSIFICATIONS.EXECUTION_FAILURE,

          path:
            'execution',

          type:
            'shadow_execution_failure',

          legacyValue:
            null,

          shadowValue:
            null,

          error: {
            code:
              error?.code ||
              'SHADOW_EXECUTION_FAILED',

            message:
              error?.message ||
              String(error),
          },
        },
      ],

      execution: {
        failed:
          true,

        failureCode:
          error?.code ||
          'SHADOW_EXECUTION_FAILED',
      },

      metadata:
        cloneValue(
          metadata,
        ),

      governance: {
        shadowOnly:
          true,

        automaticCutover:
          false,

        legacyBillingRemainsAuthoritative:
          true,
      },

      createdAt:
        now,

      updatedAt:
        now,
    };
  }

  /**
   * ==========================================================================
   * CONFIGURATION HASH / FINGERPRINT
   * ==========================================================================
   *
   * Useful to upstream shadow execution code when it wants to explicitly
   * record which configuration was used by each billing engine.
   *
   * This is intentionally a deterministic string rather than a cryptographic
   * security primitive.
   */

  configurationFingerprint(
    configuration,
  ) {
    return stableStringify(
      configuration ?? null,
    );
  }

  /**
   * ==========================================================================
   * SERVICE METADATA
   * ==========================================================================
   */

  getMetadata() {
    return {
      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      stage:
        STAGE,

      mode:
        MODE,

      responsibilities: [
        'exact-result-comparison',
        'monetary-tolerance-comparison',
        'line-item-comparison',
        'missing-component-detection',
        'configuration-comparison',
        'normalization-mismatch-detection',
        'field-level-difference-generation',
        'divergence-classification',
        'severity-classification',
        'reconciliation-record-construction',
      ],

      prohibitedActions: [
        'authoritative-billing-mutation',
        'invoice-posting',
        'ledger-posting',
        'payment-capture',
        'subscription-mutation',
        'automatic-cutover',
        'legacy-billing-modification',
      ],

      authoritativeBillingPath:
        'legacy',
    };
  }
}

/**
 * ============================================================================
 * FACTORY
 * ============================================================================
 */

function createStage01dReconciliationService(
  dependencies = {},
) {
  return new Stage01dReconciliationService(
    dependencies,
  );
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  Stage01dReconciliationService;

module.exports.Stage01dReconciliationService =
  Stage01dReconciliationService;

module.exports.Stage01dReconciliationError =
  Stage01dReconciliationError;

module.exports.createStage01dReconciliationService =
  createStage01dReconciliationService;

module.exports.CLASSIFICATIONS =
  CLASSIFICATIONS;

module.exports.STATUSES =
  STATUSES;

module.exports.SEVERITIES =
  SEVERITIES;

module.exports.MATCH_TYPES =
  MATCH_TYPES;

module.exports.DEFAULT_POLICY =
  DEFAULT_POLICY;

module.exports.SERVICE_NAME =
  SERVICE_NAME;

module.exports.SERVICE_VERSION =
  SERVICE_VERSION;

module.exports.STAGE =
  STAGE;

module.exports.MODE =
  MODE;