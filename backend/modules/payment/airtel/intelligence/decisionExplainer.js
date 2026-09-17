'use strict';

/**
 * =============================================================================
 * TITech Community Capital
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/decisionExplainer.js
 *
 * Purpose:
 *   Enterprise explainability boundary for Airtel intelligence and decision
 *   support.
 *
 * Architectural Role
 * ------------------
 *   Converts machine-generated or rule-generated decision data into a
 *   deterministic, human-readable, auditable explanation.
 *
 *   The explainer combines:
 *
 *     - decision
 *     - policy outcome
 *     - risk signals
 *     - fraud signals
 *     - failure signals
 *     - reconciliation evidence
 *     - provider health
 *     - routing information
 *     - confidence metadata
 *     - model metadata
 *     - historical/reference evidence
 *
 *   into a normalized explanation structure suitable for:
 *
 *     - operations dashboards
 *     - audit investigations
 *     - support tooling
 *     - manual review queues
 *     - incident analysis
 *     - API responses
 *     - executive intelligence
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 *   This module MUST NOT:
 *
 *     - authorize payments
 *     - reject payments on its own
 *     - settle transactions
 *     - mutate balances
 *     - post ledger entries
 *     - perform provider HTTP calls
 *     - verify provider signatures
 *     - authenticate users
 *     - make regulatory/compliance determinations
 *     - replace the AI decision engine
 *     - replace the autonomous router
 *     - silently modify source decisions
 *
 * Explainability Principles
 * -------------------------
 *   1. Explanation is evidence derived, not authority derived.
 *   2. The original decision is never silently rewritten.
 *   3. Advisory AI output remains explicitly advisory.
 *   4. Facts, signals, policy rules and interpretations are separated.
 *   5. Confidence is metadata, not proof of correctness.
 *   6. Missing evidence is represented explicitly.
 *   7. Contradictory signals are surfaced rather than hidden.
 *   8. Sensitive provider credentials never enter explanations.
 *   9. Tenant identity is mandatory.
 *  10. Financial values remain exact strings and are never converted through
 *      JavaScript Number for financial reasoning.
 *
 * Security Principles
 * -------------------
 *   - tenant isolation
 *   - bounded explanation size
 *   - sensitive-field redaction
 *   - source provenance
 *   - deterministic explanation IDs
 *   - safe diagnostics
 *   - no credential leakage
 *   - no arbitrary code/model execution
 *
 * Module Format
 * -------------
 *   CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const SERVICE_NAME =
  'airtel.decisionExplainer';

const PROVIDER =
  'AIRTEL';

const VERSION =
  '1.0.0';

const MAX_TENANT_ID_LENGTH =
  256;

const MAX_REFERENCE_LENGTH =
  256;

const MAX_REASON_LENGTH =
  4096;

const MAX_SIGNAL_NAME_LENGTH =
  128;

const MAX_SIGNAL_VALUE_LENGTH =
  1024;

const MAX_EVIDENCE_ITEMS =
  100;

const MAX_FACTS =
  100;

const MAX_CONTRADICTIONS =
  50;

const MAX_OBJECT_DEPTH =
  6;

const MAX_STRING_LENGTH =
  4096;

const MAX_EXPLANATION_BYTES =
  128 * 1024;

const MAX_FACT_SCORE =
  100;

const MIN_FACT_SCORE =
  0;

const DECISION =
  Object.freeze({
    PROCEED:
      'PROCEED',

    REVIEW:
      'REVIEW',

    RETRY:
      'RETRY',

    ESCALATE:
      'ESCALATE',

    REPAIR:
      'REPAIR',

    REJECT:
      'REJECT',

    UNKNOWN:
      'UNKNOWN',
  });

const EXPLANATION_TYPE =
  Object.freeze({
    DECISION:
      'DECISION',

    POLICY:
      'POLICY',

    RISK:
      'RISK',

    FRAUD:
      'FRAUD',

    FAILURE:
      'FAILURE',

    RECONCILIATION:
      'RECONCILIATION',

    ROUTING:
      'ROUTING',

    OPERATIONAL:
      'OPERATIONAL',

    COMPOSITE:
      'COMPOSITE',
  });

const SEVERITY =
  Object.freeze({
    INFO:
      'INFO',

    LOW:
      'LOW',

    MEDIUM:
      'MEDIUM',

    HIGH:
      'HIGH',

    CRITICAL:
      'CRITICAL',
  });

const EVIDENCE_CLASS =
  Object.freeze({
    FACT:
      'FACT',

    SIGNAL:
      'SIGNAL',

    POLICY:
      'POLICY',

    MODEL:
      'MODEL',

    PROVIDER:
      'PROVIDER',

    RECONCILIATION:
      'RECONCILIATION',

    OPERATIONAL:
      'OPERATIONAL',

    UNKNOWN:
      'UNKNOWN',
  });

const SENSITIVE_KEYS =
  new Set([
    'password',
    'passwd',
    'passcode',
    'pin',
    'otp',
    'token',
    'access_token',
    'accesstoken',
    'refresh_token',
    'refreshtoken',
    'id_token',
    'idtoken',
    'client_secret',
    'clientsecret',
    'secret',
    'api_key',
    'apikey',
    'authorization',
    'proxy_authorization',
    'proxyauthorization',
    'cookie',
    'set_cookie',
    'setcookie',
    'private_key',
    'privatekey',
    'encryption_key',
    'encryptionkey',
    'credential',
    'credentials',
    'signature_secret',
    'signaturesecret',
  ]);

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class DecisionExplainerError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'DecisionExplainerError';

    this.code =
      options.code ||
      'AIRTEL_DECISION_EXPLAINER_ERROR';

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 500;

    this.retryable =
      options.retryable === true;

    this.tenantId =
      options.tenantId ||
      null;

    this.explanationId =
      options.explanationId ||
      null;

    this.correlationId =
      options.correlationId ||
      null;

    this.cause =
      options.cause ||
      null;

    if (
      Error.captureStackTrace
    ) {
      Error.captureStackTrace(
        this,
        DecisionExplainerError,
      );
    }
  }
}

class DecisionExplainerValidationError
  extends DecisionExplainerError {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        ...options,
        code:
          options.code ||
          'AIRTEL_DECISION_EXPLAINER_VALIDATION_ERROR',
        statusCode:
          options.statusCode ||
          400,
        retryable:
          false,
      },
    );

    this.name =
      'DecisionExplainerValidationError';
  }
}

class DecisionExplainerDependencyError
  extends DecisionExplainerError {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        ...options,
        code:
          options.code ||
          'AIRTEL_DECISION_EXPLAINER_DEPENDENCY_ERROR',
        statusCode:
          options.statusCode ||
          503,
        retryable:
          options.retryable !== false,
      },
    );

    this.name =
      'DecisionExplainerDependencyError';
  }
}

/**
 * =============================================================================
 * Primitive Helpers
 * =============================================================================
 */

function isPlainObject(
  value,
) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(
      value,
    );

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

function isFunction(
  value,
) {
  return typeof value ===
    'function';
}

function normalizeString(
  value,
  {
    name =
      'value',
    required =
      false,
    maxLength =
      MAX_STRING_LENGTH,
  } = {},
) {
  if (
    value === null ||
    value === undefined
  ) {
    if (required) {
      throw new DecisionExplainerValidationError(
        `${name} is required.`,
        {
          code:
            'AIRTEL_DECISION_EXPLAINER_REQUIRED_FIELD',
        },
      );
    }

    return null;
  }

  if (
    typeof value !==
      'string' &&
    typeof value !==
      'number' &&
    typeof value !==
      'boolean'
  ) {
    throw new DecisionExplainerValidationError(
      `${name} must be a string-compatible primitive.`,
      {
        code:
          'AIRTEL_DECISION_EXPLAINER_INVALID_STRING',
      },
    );
  }

  const normalized =
    String(value).trim();

  if (
    !normalized
  ) {
    if (required) {
      throw new DecisionExplainerValidationError(
        `${name} must not be empty.`,
        {
          code:
            'AIRTEL_DECISION_EXPLAINER_EMPTY_FIELD',
        },
      );
    }

    return null;
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new DecisionExplainerValidationError(
      `${name} exceeds the maximum permitted length.`,
      {
        code:
          'AIRTEL_DECISION_EXPLAINER_FIELD_TOO_LARGE',
      },
    );
  }

  return normalized;
}

function normalizeTenantId(
  value,
) {
  return normalizeString(
    value,
    {
      name:
        'tenantId',
      required:
        true,
      maxLength:
        MAX_TENANT_ID_LENGTH,
    },
  );
}

function normalizeDecision(
  value,
) {
  const normalized =
    normalizeString(
      value,
      {
        name:
          'decision',
        maxLength:
          64,
      },
    );

  if (
    !normalized
  ) {
    return DECISION.UNKNOWN;
  }

  const upper =
    normalized.toUpperCase();

  return Object.values(
    DECISION,
  ).includes(
    upper,
  )
    ? upper
    : DECISION.UNKNOWN;
}

function normalizeSeverity(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return SEVERITY.INFO;
  }

  const normalized =
    String(value)
      .trim()
      .toUpperCase();

  if (
    Object.values(
      SEVERITY,
    ).includes(
      normalized,
    )
  ) {
    return normalized;
  }

  return SEVERITY.INFO;
}

function normalizeExplanationType(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return EXPLANATION_TYPE.COMPOSITE;
  }

  const normalized =
    String(value)
      .trim()
      .toUpperCase();

  return Object.values(
    EXPLANATION_TYPE,
  ).includes(
    normalized,
  )
    ? normalized
    : EXPLANATION_TYPE.COMPOSITE;
}

function normalizeEvidenceClass(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return EVIDENCE_CLASS.UNKNOWN;
  }

  const normalized =
    String(value)
      .trim()
      .toUpperCase();

  return Object.values(
    EVIDENCE_CLASS,
  ).includes(
    normalized,
  )
    ? normalized
    : EVIDENCE_CLASS.UNKNOWN;
}

function normalizeScore(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const score =
    Number(value);

  if (
    !Number.isFinite(
      score,
    )
  ) {
    return null;
  }

  return Math.min(
    MAX_FACT_SCORE,
    Math.max(
      MIN_FACT_SCORE,
      score,
    ),
  );
}

/**
 * Exact monetary representation.
 *
 * This module does not perform monetary arithmetic. It only validates that
 * supplied monetary values are represented as strings.
 */
function normalizeMoney(
  value,
  name =
    'amount',
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (
    !/^-?\d+(?:\.\d+)?$/.test(
      normalized,
    )
  ) {
    throw new DecisionExplainerValidationError(
      `${name} must be represented as a plain decimal string.`,
      {
        code:
          'AIRTEL_DECISION_EXPLAINER_INVALID_MONEY',
      },
    );
  }

  return normalized;
}

function normalizeDate(
  value,
  {
    name =
      'date',
    defaultValue =
      null,
  } = {},
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return defaultValue;
  }

  if (
    value instanceof Date
  ) {
    if (
      Number.isNaN(
        value.getTime(),
      )
    ) {
      throw new DecisionExplainerValidationError(
        `${name} is invalid.`,
        {
          code:
            'AIRTEL_DECISION_EXPLAINER_INVALID_DATE',
        },
      );
    }

    return new Date(
      value.getTime(),
    );
  }

  const parsed =
    new Date(value);

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    throw new DecisionExplainerValidationError(
      `${name} is invalid.`,
      {
        code:
          'AIRTEL_DECISION_EXPLAINER_INVALID_DATE',
      },
    );
  }

  return parsed;
}

function normalizeBoolean(
  value,
  defaultValue =
    false,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return defaultValue;
  }

  if (
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
      'string'
  ) {
    const normalized =
      value.trim().toLowerCase();

    if (
      ['true', '1', 'yes'].includes(
        normalized,
      )
    ) {
      return true;
    }

    if (
      ['false', '0', 'no'].includes(
        normalized,
      )
    ) {
      return false;
    }
  }

  return Boolean(value);
}

/**
 * =============================================================================
 * Sanitization
 * =============================================================================
 */

function isSensitiveKey(
  key,
) {
  const normalized =
    String(key)
      .replace(
        /[\s-]/g,
        '',
      )
      .toLowerCase();

  return SENSITIVE_KEYS.has(
    normalized,
  );
}

function sanitize(
  value,
  depth = 0,
) {
  if (
    depth >
    MAX_OBJECT_DEPTH
  ) {
    return '[TRUNCATED_DEPTH]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value ===
      'string'
  ) {
    if (
      value.length >
      MAX_STRING_LENGTH
    ) {
      return (
        value.slice(
          0,
          MAX_STRING_LENGTH,
        ) +
        '[TRUNCATED]'
      );
    }

    return value;
  }

  if (
    typeof value ===
      'number'
  ) {
    return Number.isFinite(
      value,
    )
      ? value
      : null;
  }

  if (
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
      'bigint'
  ) {
    return value.toString();
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Buffer.isBuffer(value)
  ) {
    return `[BUFFER:${value.length} bytes]`;
  }

  if (
    Array.isArray(value)
  ) {
    const output =
      value
        .slice(
          0,
          MAX_EVIDENCE_ITEMS,
        )
        .map(
          item =>
            sanitize(
              item,
              depth + 1,
            ),
        );

    if (
      value.length >
      MAX_EVIDENCE_ITEMS
    ) {
      output.push(
        `[TRUNCATED_ITEMS:${value.length - MAX_EVIDENCE_ITEMS}]`,
      );
    }

    return output;
  }

  if (
    typeof value ===
      'object'
  ) {
    const output = {};

    for (
      const key of Object.keys(
        value,
      ).slice(
        0,
        MAX_FACTS,
      )
    ) {
      if (
        isSensitiveKey(
          key,
        )
      ) {
        output[key] =
          '[REDACTED]';

        continue;
      }

      output[key] =
        sanitize(
          value[key],
          depth + 1,
        );
    }

    return output;
  }

  return String(value);
}

/**
 * =============================================================================
 * Stable Hashing
 * =============================================================================
 */

function stableSort(
  value,
) {
  if (
    Array.isArray(value)
  ) {
    return value.map(
      stableSort,
    );
  }

  if (
    !isPlainObject(value)
  ) {
    return value;
  }

  return Object.keys(
    value,
  )
    .sort()
    .reduce(
      (
        result,
        key,
      ) => {
        result[key] =
          stableSort(
            value[key],
          );

        return result;
      },
      {},
    );
}

function stableStringify(
  value,
) {
  return JSON.stringify(
    stableSort(
      value,
    ),
  );
}

function sha256(
  value,
) {
  return crypto
    .createHash(
      'sha256',
    )
    .update(
      typeof value ===
        'string'
        ? value
        : stableStringify(
            value,
          ),
      'utf8',
    )
    .digest('hex');
}

/**
 * =============================================================================
 * Context Resolution
 * =============================================================================
 */

function resolveTenantId(
  input = {},
) {
  return normalizeTenantId(
    input.tenantId ||
      input.context?.tenantId ||
      input.context?.tenant?.tenantId ||
      input.context?.tenant?.id,
  );
}

function resolveCorrelationId(
  input = {},
) {
  return normalizeString(
    input.correlationId ||
      input.context?.correlationId ||
      input.context?.correlation?.id,
    {
      name:
        'correlationId',
      maxLength:
        256,
    },
  );
}

function resolveReference(
  input = {},
) {
  return normalizeString(
    input.decisionId ||
      input.commandId ||
      input.transactionId ||
      input.providerTransactionId ||
      input.callbackId ||
      input.reference,
    {
      name:
        'reference',
      maxLength:
        MAX_REFERENCE_LENGTH,
    },
  );
}

/**
 * =============================================================================
 * Evidence Normalization
 * =============================================================================
 */

function normalizeEvidence(
  evidence,
  {
    defaultClass =
      EVIDENCE_CLASS.UNKNOWN,
  } = {},
) {
  if (
    evidence === null ||
    evidence === undefined
  ) {
    return [];
  }

  const source =
    Array.isArray(
      evidence,
    )
      ? evidence
      : [evidence];

  return source
    .slice(
      0,
      MAX_EVIDENCE_ITEMS,
    )
    .map(
      (
        item,
        index,
      ) => {
        if (
          !isPlainObject(
            item,
          )
        ) {
          return {
            id:
              `evidence-${index + 1}`,

            class:
              defaultClass,

            type:
              'VALUE',

            value:
              sanitize(
                item,
              ),

            source:
              'UNKNOWN',
          };
        }

        const name =
          normalizeString(
            item.name ||
              item.key ||
              item.signal ||
              item.factor ||
              `evidence-${index + 1}`,
            {
              name:
                'evidence.name',
              maxLength:
                MAX_SIGNAL_NAME_LENGTH,
            },
          );

        const severity =
          normalizeSeverity(
            item.severity,
          );

        const score =
          normalizeScore(
            item.score ??
              item.weight ??
              item.confidence,
          );

        return {
          id:
            normalizeString(
              item.id ||
                item.evidenceId,
              {
                name:
                  'evidence.id',
                maxLength:
                  MAX_REFERENCE_LENGTH,
              },
            ) ||
            `evidence-${index + 1}`,

          class:
            normalizeEvidenceClass(
              item.class ||
                item.evidenceClass ||
                defaultClass,
            ),

          type:
            normalizeString(
              item.type,
              {
                name:
                  'evidence.type',
                maxLength:
                  64,
              },
            ) ||
            'SIGNAL',

          name,

          value:
            sanitize(
              item.value ??
                item.observation ??
                item.result,
            ),

          severity,

          score,

          direction:
            normalizeString(
              item.direction,
              {
                name:
                  'evidence.direction',
                maxLength:
                  32,
              },
            ),

          source:
            normalizeString(
              item.source ||
                item.origin ||
                item.service,
              {
                name:
                  'evidence.source',
                maxLength:
                  128,
              },
            ) ||
            'UNKNOWN',

          reference:
            normalizeString(
              item.reference ||
                item.referenceId,
              {
                name:
                  'evidence.reference',
                maxLength:
                  MAX_REFERENCE_LENGTH,
              },
            ),

          rationale:
            normalizeString(
              item.rationale ||
                item.reason ||
                item.explanation,
              {
                name:
                  'evidence.rationale',
                maxLength:
                  MAX_REASON_LENGTH,
              },
            ),

          metadata:
            sanitize(
              item.metadata ||
                {},
            ),
        };
      },
    );
}

function normalizeFacts(
  facts,
) {
  if (
    facts === null ||
    facts === undefined
  ) {
    return [];
  }

  const source =
    Array.isArray(
      facts,
    )
      ? facts
      : [
          facts,
        ];

  return source
    .slice(
      0,
      MAX_FACTS,
    )
    .map(
      (
        fact,
        index,
      ) => ({
        id:
          normalizeString(
            fact?.id ||
              fact?.factId,
            {
              name:
                'fact.id',
              maxLength:
                MAX_REFERENCE_LENGTH,
            },
          ) ||
          `fact-${index + 1}`,

        statement:
          normalizeString(
            fact?.statement ||
              fact?.message ||
              fact?.reason ||
              fact,
            {
              name:
                'fact.statement',
              maxLength:
                MAX_REASON_LENGTH,
            },
          ) ||
          'No factual statement was supplied.',

        source:
          normalizeString(
            fact?.source ||
              fact?.origin,
            {
              name:
                'fact.source',
              maxLength:
                128,
            },
          ) ||
          'UNKNOWN',

        severity:
          normalizeSeverity(
            fact?.severity,
          ),

        reference:
          normalizeString(
            fact?.reference ||
              fact?.referenceId,
            {
              name:
                'fact.reference',
              maxLength:
                MAX_REFERENCE_LENGTH,
            },
          ),
      }),
    );
}

function normalizeContradictions(
  contradictions,
) {
  if (
    contradictions === null ||
    contradictions === undefined
  ) {
    return [];
  }

  const source =
    Array.isArray(
      contradictions,
    )
      ? contradictions
      : [
          contradictions,
        ];

  return source
    .slice(
      0,
      MAX_CONTRADICTIONS,
    )
    .map(
      (
        item,
        index,
      ) => ({
        id:
          normalizeString(
            item?.id,
            {
              name:
                'contradiction.id',
              maxLength:
                MAX_REFERENCE_LENGTH,
            },
          ) ||
          `contradiction-${index + 1}`,

        signalA:
          normalizeString(
            item?.signalA ||
              item?.left,
            {
              name:
                'contradiction.signalA',
              maxLength:
                MAX_SIGNAL_NAME_LENGTH,
            },
          ),

        signalB:
          normalizeString(
            item?.signalB ||
              item?.right,
            {
              name:
                'contradiction.signalB',
              maxLength:
                MAX_SIGNAL_NAME_LENGTH,
            },
          ),

        description:
          normalizeString(
            item?.description ||
              item?.reason ||
              item,
            {
              name:
                'contradiction.description',
              maxLength:
                MAX_REASON_LENGTH,
            },
          ) ||
          'Conflicting evidence was detected.',

        severity:
          normalizeSeverity(
            item?.severity ||
              SEVERITY.MEDIUM,
          ),
      }),
    );
}

/**
 * =============================================================================
 * Explanation Text Generation
 * =============================================================================
 */

function decisionSentence(
  decision,
) {
  switch (
    decision
  ) {
    case DECISION.PROCEED:
      return 'The available evidence supports proceeding under the applicable operational policy.';

    case DECISION.REVIEW:
      return 'The available evidence indicates that human or controlled review is appropriate before a consequential action is taken.';

    case DECISION.RETRY:
      return 'The available evidence indicates that a bounded retry may be appropriate, subject to retry policy and idempotency controls.';

    case DECISION.ESCALATE:
      return 'The available evidence indicates that the case should be escalated to an appropriate operational or incident workflow.';

    case DECISION.REPAIR:
      return 'The available evidence indicates that a controlled repair workflow may be required before normal processing can continue.';

    case DECISION.REJECT:
      return 'The decision indicates that the current conditions do not satisfy the applicable processing criteria.';

    default:
      return 'The system could not establish a recognized decision outcome from the supplied evidence.';
  }
}

function severityPrefix(
  severity,
) {
  switch (
    severity
  ) {
    case SEVERITY.CRITICAL:
      return 'Critical signal:';

    case SEVERITY.HIGH:
      return 'High-severity signal:';

    case SEVERITY.MEDIUM:
      return 'Moderate signal:';

    case SEVERITY.LOW:
      return 'Low-severity signal:';

    default:
      return 'Signal:';
  }
}

function summarizeEvidence(
  evidence,
) {
  if (
    !Array.isArray(
      evidence,
    ) ||
    evidence.length ===
      0
  ) {
    return [];
  }

  return evidence
    .slice(
      0,
      20,
    )
    .map(
      item => {
        const prefix =
          severityPrefix(
            item.severity,
          );

        const name =
          item.name ||
          'Unnamed signal';

        let valueText =
          '';

        if (
          item.value !==
            undefined &&
          item.value !== null
        ) {
          valueText =
            ` ${String(
              item.value,
            ).slice(
              0,
              512,
            )}`;
        }

        return `${prefix} ${name}.${valueText}`.trim();
      },
    );
}

function buildNarrative(
  {
    decision,
    policyOutcome,
    evidence,
    contradictions,
    missingEvidence,
    advisoryOnly,
  },
) {
  const paragraphs = [];

  paragraphs.push(
    decisionSentence(
      decision,
    ),
  );

  if (
    policyOutcome
  ) {
    paragraphs.push(
      `Policy outcome: ${policyOutcome}.`,
    );
  }

  const evidenceSummary =
    summarizeEvidence(
      evidence,
    );

  if (
    evidenceSummary.length
  ) {
    paragraphs.push(
      `Key evidence: ${evidenceSummary.join(' ')}`,
    );
  } else {
    paragraphs.push(
      'No supporting evidence was supplied to the explainer.',
    );
  }

  if (
    contradictions &&
    contradictions.length
  ) {
    paragraphs.push(
      `Conflicting signals are present (${contradictions.length}), so the explanation should not be interpreted as unqualified certainty.`,
    );
  }

  if (
    missingEvidence &&
    missingEvidence.length
  ) {
    paragraphs.push(
      `Important evidence is unavailable: ${missingEvidence
        .slice(
          0,
          10,
        )
        .join(
          ', ',
        )}.`,
    );
  }

  if (
    advisoryOnly
  ) {
    paragraphs.push(
      'This explanation is advisory and does not itself authorize, settle, reject, or modify a financial transaction.',
    );
  }

  return paragraphs.join(
    ' ',
  );
}

/**
 * =============================================================================
 * Deterministic Explanation Identity
 * =============================================================================
 */

function createExplanationId(
  {
    tenantId,
    decision,
    decisionId,
    correlationId,
    evidenceHash,
  },
) {
  return `airtel-explanation-${sha256(
    [
      tenantId,
      PROVIDER,
      decision,
      decisionId || '',
      correlationId || '',
      evidenceHash || '',
    ].join('|'),
  )}`;
}

/**
 * =============================================================================
 * Decision Explainer
 * =============================================================================
 */

class DecisionExplainer {
  constructor(
    options = {},
  ) {
    this.service =
      SERVICE_NAME;

    this.provider =
      PROVIDER;

    this.version =
      VERSION;

    this.repository =
      options.repository ||
      null;

    this.logger =
      options.logger ||
      null;

    this.observability =
      options.observability ||
      null;

    this.modelRegistry =
      options.modelRegistry ||
      null;

    this.policyEngine =
      options.policyEngine ||
      null;

    this.startedAt =
      new Date();

    this.metrics = {
      explanationsCreated:
        0,

      explanationsFailed:
        0,

      policyEnrichments:
        0,

      modelEnrichments:
        0,

      contradictionsDetected:
        0,

      missingEvidenceCases:
        0,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Logging
   * ---------------------------------------------------------------------------
   */

  log(
    level,
    payload,
  ) {
    try {
      if (
        this.logger &&
        isFunction(
          this.logger[level],
        )
      ) {
        this.logger[level](
          payload,
        );
      }
    } catch {
      /**
       * Logging must not alter explanation semantics.
       */
    }
  }

  observe(
    event,
    data = {},
  ) {
    try {
      if (
        this.observability &&
        isFunction(
          this.observability.increment,
        )
      ) {
        this.observability.increment(
          event,
          1,
          data,
        );
      }

      if (
        this.observability &&
        isFunction(
          this.observability.record,
        )
      ) {
        this.observability.record(
          event,
          data,
        );
      }
    } catch {
      /**
       * Telemetry is non-authoritative.
       */
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Normalize Input
   * ---------------------------------------------------------------------------
   */

  normalizeInput(
    input,
  ) {
    if (
      !isPlainObject(
        input,
      )
    ) {
      throw new DecisionExplainerValidationError(
        'Decision explanation input must be a plain object.',
        {
          code:
            'AIRTEL_DECISION_EXPLAINER_INVALID_INPUT',
        },
      );
    }

    const tenantId =
      resolveTenantId(
        input,
      );

    const correlationId =
      resolveCorrelationId(
        input,
      );

    const decisionId =
      normalizeString(
        input.decisionId ||
          input.commandId ||
          input.id,
        {
          name:
            'decisionId',
          maxLength:
            MAX_REFERENCE_LENGTH,
        },
      );

    const decision =
      normalizeDecision(
        input.decision ||
          input.result?.decision ||
          input.recommendation ||
          input.result?.recommendation,
      );

    const explanationType =
      normalizeExplanationType(
        input.explanationType ||
          input.type,
      );

    const advisoryOnly =
      normalizeBoolean(
        input.advisoryOnly ??
          input.result?.advisoryOnly,
        true,
      );

    const amount =
      normalizeMoney(
        input.amount ??
          input.result?.amount,
        'amount',
      );

    const amountMinor =
      normalizeMoney(
        input.amountMinor ??
          input.result?.amountMinor,
        'amountMinor',
      );

    const currency =
      normalizeString(
        input.currency ||
          input.result?.currency,
        {
          name:
            'currency',
          maxLength:
            16,
        },
      )?.toUpperCase() ||
      null;

    const riskLevel =
      normalizeSeverity(
        input.riskLevel ||
          input.risk?.level ||
          input.result?.riskLevel,
      );

    const confidence =
      normalizeScore(
        input.confidence ??
          input.result?.confidence,
      );

    const decisionReason =
      normalizeString(
        input.reason ||
          input.rationale ||
          input.result?.reason ||
          input.result?.rationale,
        {
          name:
            'decisionReason',
          maxLength:
            MAX_REASON_LENGTH,
        },
      );

    const policyOutcome =
      normalizeString(
        input.policyOutcome ||
          input.policy?.outcome ||
          input.result?.policyOutcome,
        {
          name:
            'policyOutcome',
          maxLength:
            MAX_REASON_LENGTH,
        },
      );

    const evidence =
      normalizeEvidence(
        input.evidence ||
          input.signals ||
          input.riskSignals ||
          input.result?.evidence ||
          input.result?.signals,
        {
          defaultClass:
            EVIDENCE_CLASS.SIGNAL,
        },
      );

    const facts =
      normalizeFacts(
        input.facts ||
          input.observations ||
          input.result?.facts,
      );

    const contradictions =
      normalizeContradictions(
        input.contradictions ||
          input.conflicts ||
          input.result?.contradictions,
      );

    const missingEvidence =
      Array.isArray(
        input.missingEvidence ||
          input.result?.missingEvidence,
      )
        ? input.missingEvidence
            .slice(
              0,
              MAX_EVIDENCE_ITEMS,
            )
            .map(
              value =>
                normalizeString(
                  value,
                  {
                    name:
                      'missingEvidence',
                    maxLength:
                      MAX_SIGNAL_NAME_LENGTH,
                  },
                ),
            )
            .filter(Boolean)
        : [];

    const providerHealth =
      sanitize(
        input.providerHealth ||
          input.result?.providerHealth ||
          {},
      );

    const routing =
      sanitize(
        input.routing ||
          input.route ||
          input.result?.routing ||
          {},
      );

    const fraud =
      sanitize(
        input.fraud ||
          input.fraudPrediction ||
          input.result?.fraud ||
          {},
      );

    const failure =
      sanitize(
        input.failure ||
          input.failurePrediction ||
          input.result?.failure ||
          {},
      );

    const reconciliation =
      sanitize(
        input.reconciliation ||
          input.result?.reconciliation ||
          {},
      );

    const model =
      sanitize(
        input.model ||
          input.modelMetadata ||
          input.result?.model ||
          {},
      );

    const policy =
      sanitize(
        input.policy ||
          input.result?.policy ||
          {},
      );

    const metadata =
      sanitize(
        input.metadata ||
          {},
      );

    return {
      provider:
        PROVIDER,

      service:
        this.service,

      version:
        this.version,

      tenantId,

      correlationId,

      decisionId,

      decision,

      explanationType,

      advisoryOnly,

      amount,

      amountMinor,

      currency,

      riskLevel,

      confidence,

      decisionReason,

      policyOutcome,

      evidence,

      facts,

      contradictions,

      missingEvidence,

      providerHealth,

      routing,

      fraud,

      failure,

      reconciliation,

      model,

      policy,

      metadata,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Evidence Quality
   * ---------------------------------------------------------------------------
   */

  evaluateEvidenceQuality(
    input,
  ) {
    const factors = {
      evidencePresent:
        input.evidence.length >
        0,

      factsPresent:
        input.facts.length >
        0,

      policyPresent:
        Boolean(
          input.policyOutcome ||
            Object.keys(
              input.policy || {},
            ).length,
        ),

      modelPresent:
        Object.keys(
          input.model || {},
        ).length >
        0,

      contradictionFree:
        input.contradictions.length ===
        0,

      missingEvidenceFree:
        input.missingEvidence.length ===
        0,
    };

    let quality =
      0;

    /**
     * This is a quality index for explanation completeness, not a probability
     * of decision correctness.
     */
    if (
      factors.evidencePresent
    ) {
      quality += 30;
    }

    if (
      factors.factsPresent
    ) {
      quality += 15;
    }

    if (
      factors.policyPresent
    ) {
      quality += 15;
    }

    if (
      factors.modelPresent
    ) {
      quality += 10;
    }

    if (
      factors.contradictionFree
    ) {
      quality += 15;
    }

    if (
      factors.missingEvidenceFree
    ) {
      quality += 15;
    }

    return {
      index:
        quality,

      factors,

      classification:
        quality >= 90
          ? 'HIGH'
          : quality >= 70
            ? 'MEDIUM'
            : quality >= 40
              ? 'LOW'
              : 'INSUFFICIENT',
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Model Explanation
   * ---------------------------------------------------------------------------
   */

  async enrichModelExplanation(
    input,
    options = {},
  ) {
    if (
      !this.modelRegistry
    ) {
      return {
        available:
          false,

        source:
          'INPUT_ONLY',

        metadata:
          input.model,
      };
    }

    try {
      const result =
        await this.invokeDependency(
          this.modelRegistry,
          [
            'explain',
            'describe',
            'getModelMetadata',
            'get',
          ],
          [
            input.model,
            {
              tenantId:
                input.tenantId,

              correlationId:
                input.correlationId,

              decisionId:
                input.decisionId,

              ...options,
            },
          ],
          {
            dependencyName:
              'modelRegistry',
            required:
              false,
          },
        );

      this.metrics.modelEnrichments +=
        1;

      return {
        available:
          Boolean(result),

        source:
          'MODEL_REGISTRY',

        metadata:
          sanitize(
            result ||
              input.model ||
              {},
          ),
      };
    } catch (error) {
      /**
       * Model metadata is enrichment rather than financial authority.
       */
      this.log(
        'warn',
        {
          service:
            this.service,
          event:
            'decision.explainer.model_enrichment_failed',
          tenantId:
            input.tenantId,
          code:
            error?.code ||
            'MODEL_ENRICHMENT_ERROR',
        },
      );

      return {
        available:
          false,

        source:
          'MODEL_REGISTRY_UNAVAILABLE',

        metadata:
          input.model,
      };
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Policy Explanation
   * ---------------------------------------------------------------------------
   */

  async enrichPolicyExplanation(
    input,
    options = {},
  ) {
    if (
      !this.policyEngine
    ) {
      return {
        available:
          Boolean(
            input.policyOutcome ||
              Object.keys(
                input.policy || {},
              ).length,
          ),

        source:
          'INPUT_ONLY',

        policy:
          input.policy,
      };
    }

    try {
      const result =
        await this.invokeDependency(
          this.policyEngine,
          [
            'explain',
            'describe',
            'evaluateExplanation',
            'getExplanation',
          ],
          [
            {
              decision:
                input.decision,

              riskLevel:
                input.riskLevel,

              tenantId:
                input.tenantId,

              policy:
                input.policy,

              evidence:
                input.evidence,
            },

            options,
          ],
          {
            dependencyName:
              'policyEngine',
            required:
              false,
          },
        );

      this.metrics.policyEnrichments +=
        1;

      return {
        available:
          Boolean(result),

        source:
          'POLICY_ENGINE',

        policy:
          sanitize(
            result ||
              input.policy ||
              {},
          ),
      };
    } catch (error) {
      this.log(
        'warn',
        {
          service:
            this.service,
          event:
            'decision.explainer.policy_enrichment_failed',
          tenantId:
            input.tenantId,
          code:
            error?.code ||
            'POLICY_ENRICHMENT_ERROR',
        },
      );

      return {
        available:
          false,

        source:
          'POLICY_ENGINE_UNAVAILABLE',

        policy:
          input.policy,
      };
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Generic Dependency Invocation
   * ---------------------------------------------------------------------------
   */

  async invokeDependency(
    dependency,
    methods,
    args,
    {
      dependencyName =
        'dependency',
      required =
        false,
    } = {},
  ) {
    if (
      !dependency
    ) {
      if (
        required
      ) {
        throw new DecisionExplainerDependencyError(
          `${dependencyName} is not configured.`,
          {
            code:
              'AIRTEL_DECISION_EXPLAINER_DEPENDENCY_NOT_CONFIGURED',
          },
        );
      }

      return null;
    }

    if (
      isFunction(
        dependency,
      )
    ) {
      return dependency(
        ...args,
      );
    }

    for (
      const method of methods
    ) {
      if (
        isFunction(
          dependency[method],
        )
      ) {
        return dependency[
          method
        ](
          ...args,
        );
      }
    }

    if (
      !required
    ) {
      return null;
    }

    throw new DecisionExplainerDependencyError(
      `${dependencyName} exposes no supported explainability method.`,
      {
        code:
          'AIRTEL_DECISION_EXPLAINER_METHOD_UNAVAILABLE',
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Explanation Construction
   * ---------------------------------------------------------------------------
   */

  async explain(
    input,
    options = {},
  ) {
    try {
      const normalized =
        this.normalizeInput(
          input,
        );

      const model =
        await this.enrichModelExplanation(
          normalized,
          options,
        );

      const policy =
        await this.enrichPolicyExplanation(
          normalized,
          options,
        );

      const evidenceQuality =
        this.evaluateEvidenceQuality(
          normalized,
        );

      if (
        normalized.contradictions
          .length
      ) {
        this.metrics.contradictionsDetected +=
          normalized.contradictions
            .length;
      }

      if (
        normalized.missingEvidence
          .length
      ) {
        this.metrics.missingEvidenceCases +=
          1;
      }

      const evidenceForHash =
        {
          decision:
            normalized.decision,

          evidence:
            normalized.evidence,

          facts:
            normalized.facts,

          contradictions:
            normalized.contradictions,

          missingEvidence:
            normalized.missingEvidence,

          policyOutcome:
            normalized.policyOutcome,

          riskLevel:
            normalized.riskLevel,
        };

      const evidenceHash =
        sha256(
          evidenceForHash,
        );

      const explanationId =
        createExplanationId(
          {
            tenantId:
              normalized.tenantId,

            decision:
              normalized.decision,

            decisionId:
              normalized.decisionId,

            correlationId:
              normalized.correlationId,

            evidenceHash,
          },
        );

      const narrative =
        buildNarrative(
          {
            decision:
              normalized.decision,

            policyOutcome:
              normalized.policyOutcome ||
              normalized.policy?.outcome ||
              null,

            evidence:
              normalized.evidence,

            contradictions:
              normalized.contradictions,

            missingEvidence:
              normalized.missingEvidence,

            advisoryOnly:
              normalized.advisoryOnly,
          },
        );

      const explanation = {
        provider:
          PROVIDER,

        service:
          this.service,

        version:
          this.version,

        explanationId,

        tenantId:
          normalized.tenantId,

        correlationId:
          normalized.correlationId,

        decisionId:
          normalized.decisionId,

        decision:
          normalized.decision,

        explanationType:
          normalized.explanationType,

        advisoryOnly:
          normalized.advisoryOnly,

        financialAuthority:
          false,

        settlementAuthority:
          false,

        ledgerAuthority:
          false,

        amount:
          normalized.amount,

        amountMinor:
          normalized.amountMinor,

        currency:
          normalized.currency,

        riskLevel:
          normalized.riskLevel,

        /**
         * Confidence is supplied by the upstream decision system. It is not
         * independently converted into a probability or certainty claim.
         */
        confidence:
          normalized.confidence,

        evidenceQuality,

        summary:
          decisionSentence(
            normalized.decision,
          ),

        narrative,

        decisionReason:
          normalized.decisionReason,

        policy:
          {
            ...normalized.policy,

            enrichment:
              policy,
          },

        model:
          {
            ...normalized.model,

            enrichment:
              model,
          },

        facts:
          normalized.facts,

        evidence:
          normalized.evidence,

        contradictions:
          normalized.contradictions,

        missingEvidence:
          normalized.missingEvidence,

        fraud:
          normalized.fraud,

        failure:
          normalized.failure,

        reconciliation:
          normalized.reconciliation,

        providerHealth:
          normalized.providerHealth,

        routing:
          normalized.routing,

        metadata:
          normalized.metadata,

        provenance:
          {
            evidenceHash,

            explanationMethod:
              'DETERMINISTIC_EVIDENCE_PROJECTION',

            sourceDecisionPreserved:
              true,

            originalDecision:
              normalized.decision,

            generatedAt:
              new Date(),
          },
      };

      const serialized =
        stableStringify(
          explanation,
        );

      const bytes =
        Buffer.byteLength(
          serialized,
          'utf8',
        );

      if (
        bytes >
        MAX_EXPLANATION_BYTES
      ) {
        throw new DecisionExplainerValidationError(
          'Generated decision explanation exceeds the configured size limit.',
          {
            code:
              'AIRTEL_DECISION_EXPLAINER_OUTPUT_TOO_LARGE',
            tenantId:
              normalized.tenantId,
            explanationId,
          },
        );
      }

      this.metrics.explanationsCreated +=
        1;

      this.observe(
        'airtel.decision.explainer.created',
        {
          tenantId:
            normalized.tenantId,

          decision:
            normalized.decision,

          explanationType:
            normalized.explanationType,

          evidenceQuality:
            evidenceQuality.classification,
        },
      );

      return explanation;
    } catch (error) {
      this.metrics.explanationsFailed +=
        1;

      if (
        error instanceof
        DecisionExplainerError
      ) {
        throw error;
      }

      throw new DecisionExplainerError(
        'Unable to construct Airtel decision explanation.',
        {
          code:
            'AIRTEL_DECISION_EXPLANATION_FAILED',
          cause:
            error,
        },
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Specialized Explanation APIs
   * ---------------------------------------------------------------------------
   */

  async explainDecision(
    input,
    options = {},
  ) {
    return this.explain(
      {
        ...input,
        explanationType:
          EXPLANATION_TYPE.DECISION,
      },
      options,
    );
  }

  async explainRisk(
    input,
    options = {},
  ) {
    return this.explain(
      {
        ...input,
        explanationType:
          EXPLANATION_TYPE.RISK,
      },
      options,
    );
  }

  async explainFraud(
    input,
    options = {},
  ) {
    return this.explain(
      {
        ...input,
        explanationType:
          EXPLANATION_TYPE.FRAUD,
      },
      options,
    );
  }

  async explainFailure(
    input,
    options = {},
  ) {
    return this.explain(
      {
        ...input,
        explanationType:
          EXPLANATION_TYPE.FAILURE,
      },
      options,
    );
  }

  async explainReconciliation(
    input,
    options = {},
  ) {
    return this.explain(
      {
        ...input,
        explanationType:
          EXPLANATION_TYPE.RECONCILIATION,
      },
      options,
    );
  }

  async explainRouting(
    input,
    options = {},
  ) {
    return this.explain(
      {
        ...input,
        explanationType:
          EXPLANATION_TYPE.ROUTING,
      },
      options,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Executive Summary
   * ---------------------------------------------------------------------------
   */

  async executiveSummary(
    input,
    options = {},
  ) {
    const explanation =
      await this.explain(
        {
          ...input,
          explanationType:
            EXPLANATION_TYPE.COMPOSITE,
        },
        options,
      );

    return {
      provider:
        explanation.provider,

      tenantId:
        explanation.tenantId,

      correlationId:
        explanation.correlationId,

      explanationId:
        explanation.explanationId,

      decision:
        explanation.decision,

      riskLevel:
        explanation.riskLevel,

      confidence:
        explanation.confidence,

      evidenceQuality:
        explanation.evidenceQuality,

      summary:
        explanation.summary,

      keyReasons:
        explanation.evidence
          .slice(
            0,
            10,
          )
          .map(
            item => ({
              name:
                item.name,

              severity:
                item.severity,

              rationale:
                item.rationale,

              source:
                item.source,
            }),
          ),

      contradictions:
        explanation.contradictions,

      missingEvidence:
        explanation.missingEvidence,

      advisoryOnly:
        true,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Repository Persistence
   * ---------------------------------------------------------------------------
   *
   * Persistence is optional. The explainer remains usable as a pure projection
   * component. When persistence is configured, callers may save explanations
   * for operational/audit investigation.
   */

  async persist(
    explanation,
    options = {},
  ) {
    if (
      !this.repository
    ) {
      return {
        persisted:
          false,

        reason:
          'repository-not-configured',

        explanation,
      };
    }

    const safe =
      sanitize(
        explanation,
      );

    try {
      const result =
        await this.invokeDependency(
          this.repository,
          [
            'create',
            'save',
            'insert',
            'upsert',
            'store',
          ],
          [
            safe,
            options,
          ],
          {
            dependencyName:
              'explanationRepository',
            required:
              true,
          },
        );

      return {
        persisted:
          true,

        document:
          result ||
          safe,
      };
    } catch (error) {
      throw new DecisionExplainerDependencyError(
        'Decision explanation persistence failed.',
        {
          code:
            'AIRTEL_DECISION_EXPLAINER_PERSISTENCE_FAILED',
          tenantId:
            explanation.tenantId,
          explanationId:
            explanation.explanationId,
          cause:
            error,
        },
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Explain + Persist
   * ---------------------------------------------------------------------------
   */

  async explainAndPersist(
    input,
    options = {},
  ) {
    const explanation =
      await this.explain(
        input,
        options,
      );

    const persistence =
      await this.persist(
        explanation,
        options,
      );

    return {
      explanation,
      persistence,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Query
   * ---------------------------------------------------------------------------
   */

  async get(
    tenantId,
    explanationId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedExplanationId =
      normalizeString(
        explanationId,
        {
          name:
            'explanationId',
          required:
            true,
          maxLength:
            MAX_REFERENCE_LENGTH,
        },
      );

    if (
      !this.repository
    ) {
      return null;
    }

    return this.invokeDependency(
      this.repository,
      [
        'findById',
        'getById',
        'findOne',
        'get',
      ],
      [
        normalizedTenantId,
        normalizedExplanationId,
        options,
      ],
      {
        dependencyName:
          'explanationRepository',
        required:
          false,
      },
    );
  }

  async list(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const limit =
      Math.min(
        Math.max(
          Number(
            options.limit ||
              50,
          ),
          1,
        ),
        200,
      );

    const skip =
      Math.max(
        Number(
          options.skip ||
            0,
        ),
        0,
      );

    if (
      !this.repository
    ) {
      return {
        tenantId:
          normalizedTenantId,

        items:
          [],

        limit,

        skip,

        nextSkip:
          null,
      };
    }

    const filter =
      {
        ...sanitize(
          options.filter ||
            {},
        ),

        /**
         * Method argument is authoritative; caller-supplied tenantId cannot
         * override it.
         */
        tenantId:
          normalizedTenantId,
      };

    const result =
      await this.invokeDependency(
        this.repository,
        [
          'list',
          'find',
          'query',
        ],
        [
          filter,
          {
            ...options,
            limit,
            skip,
          },
        ],
        {
          dependencyName:
            'explanationRepository',
          required:
            false,
        },
      );

    const items =
      Array.isArray(
        result,
      )
        ? result
        : result?.items ||
          result?.documents ||
          [];

    return {
      tenantId:
        normalizedTenantId,

      items,

      limit,

      skip,

      nextSkip:
        items.length ===
        limit
          ? skip + limit
          : null,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Health
   * ---------------------------------------------------------------------------
   */

  async health() {
    let repositoryHealthy =
      null;

    if (
      this.repository
    ) {
      try {
        if (
          isFunction(
            this.repository.health,
          )
        ) {
          const result =
            await this.invokeDependency(
              this.repository,
              [
                'health',
              ],
              [],
              {
                dependencyName:
                  'explanationRepository',
                required:
                  false,
              },
            );

          repositoryHealthy =
            result?.healthy !==
              false &&
            result?.status !==
              'DOWN';
        } else if (
          isFunction(
            this.repository.ping,
          )
        ) {
          repositoryHealthy =
            (await this.invokeDependency(
              this.repository,
              [
                'ping',
              ],
              [],
              {
                dependencyName:
                  'explanationRepository',
                required:
                  false,
              },
            )) !== false;
        } else {
          repositoryHealthy =
            true;
        }
      } catch {
        repositoryHealthy =
          false;
      }
    }

    return {
      service:
        this.service,

      provider:
        this.provider,

      version:
        this.version,

      status:
        repositoryHealthy ===
          false
          ? 'DEGRADED'
          : 'UP',

      healthy:
        true,

      checks: {
        deterministicProjection:
          true,

        tenantIsolation:
          true,

        sensitiveDataRedaction:
          true,

        exactMoneyRepresentation:
          true,

        sourceDecisionPreservation:
          true,

        advisoryBoundary:
          true,

        repositoryConfigured:
          Boolean(
            this.repository,
          ),

        repositoryHealthy,
      },

      metrics:
        {
          ...this.metrics,
        },
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Diagnostics
   * ---------------------------------------------------------------------------
   */

  diagnostics() {
    return {
      service:
        this.service,

      provider:
        this.provider,

      version:
        this.version,

      startedAt:
        this.startedAt,

      dependencies: {
        repository:
          Boolean(
            this.repository,
          ),

        modelRegistry:
          Boolean(
            this.modelRegistry,
          ),

        policyEngine:
          Boolean(
            this.policyEngine,
          ),
      },

      guarantees: {
        deterministicExplanation:
          true,

        sourceDecisionPreserved:
          true,

        advisoryOnly:
          true,

        financialAuthority:
          false,

        settlementAuthority:
          false,

        ledgerAuthority:
          false,

        providerHttpExecution:
          false,

        sensitiveCredentialPersistence:
          false,

        tenantIsolation:
          true,

        exactMoneyRepresentation:
          true,

        contradictionDisclosure:
          true,

        missingEvidenceDisclosure:
          true,
      },

      limits: {
        maxEvidenceItems:
          MAX_EVIDENCE_ITEMS,

        maxFacts:
          MAX_FACTS,

        maxContradictions:
          MAX_CONTRADICTIONS,

        maxExplanationBytes:
          MAX_EXPLANATION_BYTES,
      },

      metrics:
        {
          ...this.metrics,
        },
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Dependency Injection
   * ---------------------------------------------------------------------------
   */

  setRepository(
    repository,
  ) {
    if (
      !repository ||
      typeof repository !==
        'object'
    ) {
      throw new DecisionExplainerValidationError(
        'A valid explanation repository is required.',
        {
          code:
            'AIRTEL_DECISION_EXPLAINER_INVALID_REPOSITORY',
        },
      );
    }

    this.repository =
      repository;

    return this;
  }

  setDependency(
    name,
    dependency,
  ) {
    const allowed =
      new Set([
        'repository',
        'modelRegistry',
        'policyEngine',
        'logger',
        'observability',
      ]);

    if (
      !allowed.has(
        name,
      )
    ) {
      throw new DecisionExplainerValidationError(
        `Unsupported decision explainer dependency "${name}".`,
        {
          code:
            'AIRTEL_DECISION_EXPLAINER_DEPENDENCY_NOT_ALLOWED',
        },
      );
    }

    this[name] =
      dependency;

    return this;
  }

  /**
   * ---------------------------------------------------------------------------
   * Lifecycle
   * ---------------------------------------------------------------------------
   */

  async initialize(
    options = {},
  ) {
    if (
      this.repository &&
      isFunction(
        this.repository.initialize,
      )
    ) {
      await this.invokeDependency(
        this.repository,
        [
          'initialize',
        ],
        [
          options,
        ],
        {
          dependencyName:
            'explanationRepository',
          required:
            false,
        },
      );
    }

    return {
      status:
        'READY',

      service:
        this.service,

      provider:
        this.provider,

      version:
        this.version,
    };
  }

  async close(
    options = {},
  ) {
    if (
      this.repository &&
      isFunction(
        this.repository.close,
      )
    ) {
      await this.invokeDependency(
        this.repository,
        [
          'close',
        ],
        [
          options,
        ],
        {
          dependencyName:
            'explanationRepository',
          required:
            false,
        },
      );
    }

    return {
      status:
        'CLOSED',

      service:
        this.service,

      provider:
        this.provider,
    };
  }
}

/**
 * =============================================================================
 * Factory
 * =============================================================================
 */

function createDecisionExplainer(
  options = {},
) {
  return new DecisionExplainer(
    options,
  );
}

/**
 * =============================================================================
 * Default Singleton
 * =============================================================================
 *
 * No database or external provider initialization occurs at module import time.
 * Dependencies are injected by the Airtel composition root.
 * =============================================================================
 */

const decisionExplainer =
  createDecisionExplainer();

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
  decisionExplainer;

module.exports.DecisionExplainer =
  DecisionExplainer;

module.exports.DecisionExplainerError =
  DecisionExplainerError;

module.exports.DecisionExplainerValidationError =
  DecisionExplainerValidationError;

module.exports.DecisionExplainerDependencyError =
  DecisionExplainerDependencyError;

module.exports.createDecisionExplainer =
  createDecisionExplainer;

module.exports.normalizeDecision =
  normalizeDecision;

module.exports.normalizeEvidence =
  normalizeEvidence;

module.exports.normalizeFacts =
  normalizeFacts;

module.exports.normalizeContradictions =
  normalizeContradictions;

module.exports.sanitize =
  sanitize;

module.exports.sha256 =
  sha256;

module.exports.createExplanationId =
  createExplanationId;

module.exports.DECISION =
  DECISION;

module.exports.EXPLANATION_TYPE =
  EXPLANATION_TYPE;

module.exports.SEVERITY =
  SEVERITY;

module.exports.EVIDENCE_CLASS =
  EVIDENCE_CLASS;

module.exports.SERVICE_NAME =
  SERVICE_NAME;

module.exports.PROVIDER =
  PROVIDER;

module.exports.VERSION =
  VERSION;