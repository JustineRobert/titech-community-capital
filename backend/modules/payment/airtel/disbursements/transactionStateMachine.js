'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Transaction State Machine
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/transactionStateMachine.js
 *
 * Architectural role
 * ------------------
 * Canonical workflow/state-transition boundary for the Airtel outbound
 * disbursement bounded context.
 *
 *   Request / Provider Evidence / Reconciliation Evidence
 *                         |
 *                         v
 *               Transaction State Machine
 *                         |
 *             +-----------+-----------+
 *             |                       |
 *             v                       v
 *       Atomic persistence        Audit / Events
 *             |
 *             v
 *       Disbursement Service
 *             |
 *             +----> Provider Adapter
 *             +----> Financial Core
 *
 * Responsibilities
 * ----------------
 * - Validate Airtel disbursement state names and transition legality.
 * - Apply canonical state transitions using tenant/provider/operation scope.
 * - Enforce optimistic concurrency and fingerprint/idempotency guards.
 * - Provide explicit execution-claim, retry, reconciliation, compensation,
 *   refund, reversal, cancellation, expiration and escalation helpers.
 * - Treat ambiguous/pending/unknown provider outcomes as unresolved financial
 *   states that require status/reconciliation rather than blind retry.
 * - Preserve the original financial identity across retries.
 * - Keep corrective operations linked to, but distinct from, the original
 *   financial identity.
 * - Publish sanitized audit/event evidence after state changes.
 * - Provide deterministic transition fingerprints and operational diagnostics.
 *
 * Non-responsibilities
 * --------------------
 * - No Airtel HTTP/API calls.
 * - No provider authentication or credential handling.
 * - No ledger/journal writes.
 * - No balance or wallet mutation.
 * - No financial settlement/finality authority.
 * - No KYC/AML/sanctions/fraud adjudication.
 * - No maker-checker approval implementation.
 * - No reconciliation adjudication.
 * - No direct payment execution.
 *
 * Financial safety principles
 * ---------------------------
 * 1. The state machine is workflow truth, not accounting truth.
 * 2. Provider PENDING/UNKNOWN/AMBIGUOUS states cannot be converted into SUCCESS
 *    or FAILURE by inference.
 * 3. Duplicate requests for the same state/fingerprint may be treated as
 *    idempotent, but conflicting identity reuse fails safely.
 * 4. Every mutation is tenant-scoped.
 * 5. State changes use atomic compare-and-set when available and can be made
 *    mandatory by configuration.
 * 6. Retry never creates a new financial transaction identity.
 * 7. A retry from a confirmed ambiguous/provider-pending state is blocked and
 *    redirected to status/reconciliation.
 * 8. Corrective/reversal transitions are explicitly action-scoped and remain
 *    linked to the original transaction identity.
 * 9. Historical transitions are append-only through the repository's timeline
 *    facility where available; this module never deletes state history.
 * 10. Audit/event failure does not silently roll back a committed state change.
 *
 * Repository contract
 * -------------------
 * Preferred atomic method:
 *
 * repository.transition({
 *   disbursementId,
 *   tenantId,
 *   provider,
 *   operation,
 *   fromState,
 *   toState,
 *   action,
 *   expectedVersion,
 *   expectedFingerprint,
 *   expectedIdempotencyKey,
 *   actorId,
 *   patch,
 * })
 *
 * Compatible methods are detected at runtime so the module can bridge the
 * repository variants already present in the repository during consolidation.
 * Production configuration may require the atomic method.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  PROVIDER,
  OPERATION,
  SCHEMA_VERSION,
  ACTIONS,
  COMMANDS,
  DISBURSEMENT_STATES,
  TERMINAL_DISBURSEMENT_STATES,
  ACTIVE_DISBURSEMENT_STATES,
  ALLOWED_DISBURSEMENT_TRANSITIONS,
  PROVIDER_OUTCOMES,
  PROVIDER_RESULT_CATEGORIES,
  PROVIDER_EXECUTION_STATES,
  AMBIGUOUS_PROVIDER_OUTCOMES,
  RECONCILIATION_STATES,
  RECONCILIATION_OUTCOMES,
  COMPENSATION_TYPES,
  ERROR_CODES,
  RETRY_DECISIONS,
  UNSAFE_OFFLINE_STATES,
  isUnsafeOfflineState,
  canTransitionDisbursement,
} from './constants.js';

export {
  PROVIDER,
  OPERATION,
  SCHEMA_VERSION,
  ACTIONS,
  COMMANDS,
  DISBURSEMENT_STATES,
  TERMINAL_DISBURSEMENT_STATES,
  ACTIVE_DISBURSEMENT_STATES,
  ALLOWED_DISBURSEMENT_TRANSITIONS,
  PROVIDER_OUTCOMES,
  PROVIDER_RESULT_CATEGORIES,
  PROVIDER_EXECUTION_STATES,
  AMBIGUOUS_PROVIDER_OUTCOMES,
  RECONCILIATION_STATES,
  RECONCILIATION_OUTCOMES,
  COMPENSATION_TYPES,
  ERROR_CODES,
  RETRY_DECISIONS,
  UNSAFE_OFFLINE_STATES,
};

export const ENGINE_NAME =
  'airtel-disbursement-transaction-state-machine';

export const ENGINE_VERSION =
  '3.1.0';

export const COMPONENT =
  ENGINE_NAME;

export const STATE_MACHINE_OUTCOMES =
  Object.freeze({
    TRANSITIONED:
      'TRANSITIONED',

    IDEMPOTENT:
      'IDEMPOTENT',

    REJECTED:
      'REJECTED',

    RETRY_READY:
      'RETRY_READY',

    CLAIMED:
      'CLAIMED',

    ALREADY_CLAIMED:
      'ALREADY_CLAIMED',

    REQUIRES_STATUS_CHECK:
      'REQUIRES_STATUS_CHECK',

    REQUIRES_RECONCILIATION:
      'REQUIRES_RECONCILIATION',

    REQUIRES_REVIEW:
      'REQUIRES_REVIEW',
  });

export const RETRYABLE_STATES =
  Object.freeze([
    DISBURSEMENT_STATES.FAILED,
    DISBURSEMENT_STATES.VALIDATION_FAILED,
  ]);

export const NON_RETRYABLE_UNCERTAIN_STATES =
  Object.freeze([
    DISBURSEMENT_STATES.AMBIGUOUS,
    DISBURSEMENT_STATES.PROVIDER_PENDING,
    DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
    DISBURSEMENT_STATES.RECONCILING,
  ]);

export const EXECUTABLE_STATES =
  Object.freeze([
    DISBURSEMENT_STATES.APPROVED,
    DISBURSEMENT_STATES.QUEUED,
  ]);

export const PROVIDER_FINAL_STATES =
  Object.freeze([
    DISBURSEMENT_STATES.SUCCESS,
    DISBURSEMENT_STATES.FAILED,
    DISBURSEMENT_STATES.AMBIGUOUS,
    DISBURSEMENT_STATES.PROVIDER_PENDING,
  ]);

export const DEFAULT_CONFIG =
  Object.freeze({
    requireTenantId:
      true,

    requireAirtelProvider:
      true,

    requireDisbursementOperation:
      true,

    requireDisbursementId:
      true,

    requireExpectedVersionForMutation:
      true,

    requireExpectedFingerprintForMutation:
      true,

    requireOriginalIdempotencyKeyForFinancialMutation:
      true,

    requireAtomicTransition:
      true,

    requireAtomicExecutionClaim:
      true,

    requireAtomicRetryRearm:
      true,

    allowSameStateIdempotency:
      true,

    allowHistoricalTerminalReconciliation:
      false,

    allowCompatibilityReversalTransition:
      true,

    allowCompatibilityRetryRearm:
      true,

    preserveTimeline:
      true,

    maxVersion:
      Number.MAX_SAFE_INTEGER,

    maxDisbursementIdLength:
      240,

    maxTransactionIdLength:
      240,

    maxReferenceLength:
      240,

    maxTenantIdLength:
      160,

    maxFingerprintLength:
      128,

    maxIdempotencyKeyLength:
      320,

    maxActorIdLength:
      200,

    maxReasonLength:
      1000,

    maxMetadataDepth:
      5,

    maxMetadataKeys:
      64,

    maxMetadataArrayLength:
      100,

    maxMetadataStringLength:
      2048,

    maxTimelineEntries:
      500,

    failClosedOnAuditError:
      false,

    failClosedOnEventError:
      false,
  });

const PRIVATE_KEYS =
  new Set([
    '__proto__',
    'prototype',
    'constructor',
  ]);

const UNSAFE_KEY =
  /(^\$)|\./;

const SECRET_KEY =
  /(password|secret|token|authorization|cookie|set-cookie|otp|pin|cvv|cvc|pan|private.?key|api.?key|client.?secret|credential|signature|raw(request|response)|provider.?payload)/i;

const SUCCESS_PROVIDER_OUTCOMES =
  new Set([
    'SUCCESS',
    'SUCCEEDED',
    'SUCCESSFUL',
    'COMPLETED',
    'SETTLED',
    'POSTED',
    'PAID',
    'CONFIRMED',
  ]);

const FAILURE_PROVIDER_OUTCOMES =
  new Set([
    'FAILURE',
    'FAILED',
    'REJECTED',
    'DECLINED',
    'DENIED',
    'CANCELLED',
    'CANCELED',
    'EXPIRED',
  ]);

const PENDING_PROVIDER_OUTCOMES =
  new Set([
    'PENDING',
    'PROCESSING',
    'INITIATED',
    'SUBMITTED',
    'QUEUED',
    'ACCEPTED',
  ]);

const AMBIGUOUS_PROVIDER_OUTCOME_SET =
  new Set([
    'AMBIGUOUS',
    'UNKNOWN',
    'TIMEOUT',
    'NO_RESPONSE',
    'INDETERMINATE',
  ]);

const noop = () =>
  undefined;

const isPlainObject = (
  value,
) =>
  value !== null &&
  typeof value ===
    'object' &&
  !Array.isArray(
    value,
  ) &&
  !(
    value instanceof Date
  );

const isFunction = (
  value,
) =>
  typeof value ===
  'function';

const upper = (
  value,
) => {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const normalized =
    String(value)
      .trim()
      .toUpperCase();

  return (
    normalized || undefined
  );
};

const bounded = (
  value,
  maxLength,
) => {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  return normalized
    ? normalized.slice(
        0,
        maxLength,
      )
    : undefined;
};

const integer = (
  value,
  fallback =
    undefined,
) => {
  const n =
    Number(value);

  if (
    !Number.isInteger(
      n,
    )
  ) {
    return fallback;
  }

  return n;
};

const clone = (
  value,
) => {
  if (
    value === undefined
  ) {
    return undefined;
  }

  try {
    return structuredClone(
      value,
    );
  } catch {
    try {
      return JSON.parse(
        JSON.stringify(
          value,
        ),
      );
    } catch {
      return value;
    }
  }
};

const stableSerialize = (
  value,
) => {
  if (
    value === undefined
  ) {
    return 'undefined';
  }

  if (
    value === null
  ) {
    return 'null';
  }

  if (
    value instanceof Date
  ) {
    return `date:${value.toISOString()}`;
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return `bigint:${value}`;
  }

  if (
    Array.isArray(value)
  ) {
    return `[${value
      .map(
        stableSerialize,
      )
      .join(',')}]`;
  }

  if (
    isPlainObject(value)
  ) {
    return `{${Object.keys(
      value,
    )
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(
            key,
          )}:${stableSerialize(
            value[key],
          )}`,
      )
      .join(',')}}`;
  }

  if (
    typeof value ===
      'number' &&
    Object.is(
      value,
      -0,
    )
  ) {
    return '0';
  }

  return JSON.stringify(
    value,
  );
};

const sha256 = (
  value,
) =>
  createHash('sha256')
    .update(
      typeof value ===
        'string'
        ? value
        : stableSerialize(
            value,
          ),
    )
    .digest('hex');

const nowMs = (
  clock,
) => {
  try {
    const value =
      clock?.now?.();

    if (
      value instanceof
      Date
    ) {
      return value.getTime();
    }

    if (
      Number.isFinite(
        value,
      )
    ) {
      return value;
    }
  } catch {
    // Fall through.
  }

  return Date.now();
};

const nowDate = (
  clock,
) =>
  new Date(
    nowMs(clock),
  );

const nowIso = (
  clock,
) =>
  nowDate(
    clock,
  ).toISOString();

const sanitize = (
  value,
  depth,
  config,
) => {
  const currentDepth =
    depth ?? 0;

  if (
    currentDepth >
    config.maxMetadataDepth
  ) {
    return '[TRUNCATED]';
  }

  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (
    typeof value ===
    'string'
  ) {
    return value.length >
      config.maxMetadataStringLength
      ? `${value.slice(
          0,
          config.maxMetadataStringLength,
        )}…`
      : value;
  }

  if (
    typeof value ===
      'number' ||
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
    Array.isArray(value)
  ) {
    return value
      .slice(
        0,
        config.maxMetadataArrayLength,
      )
      .map(
        (item) =>
          sanitize(
            item,
            currentDepth + 1,
            config,
          ),
      );
  }

  if (
    !isPlainObject(
      value,
    )
  ) {
    return String(value);
  }

  const output =
    {};

  for (
    const key of Object.keys(
      value,
    ).slice(
      0,
      config.maxMetadataKeys,
    )
  ) {
    if (
      PRIVATE_KEYS.has(
        key,
      ) ||
      UNSAFE_KEY.test(
        key,
      )
    ) {
      continue;
    }

    output[key] =
      SECRET_KEY.test(
        key,
      )
        ? '[REDACTED]'
        : sanitize(
            value[key],
            currentDepth + 1,
            config,
          );
  }

  return output;
};

const actorIdOf = (
  actor,
) =>
  bounded(
    actor?.actorId ??
      actor?.userId ??
      actor?.principalId ??
      actor?.id,
    200,
  );

const isTerminalStateLocal =
  (
    state,
  ) =>
    TERMINAL_DISBURSEMENT_STATES.includes(
      upper(state),
    );

const isActiveState = (
  state,
) =>
  ACTIVE_DISBURSEMENT_STATES.includes(
    upper(state),
  );

const isKnownState = (
  state,
) =>
  Object.values(
    DISBURSEMENT_STATES,
  ).includes(
    upper(state),
  );

const normalizeExpectedVersion =
  (
    value,
  ) => {
    const version =
      integer(
        value,
        undefined,
      );

    if (
      version === undefined ||
      version < 1
    ) {
      return undefined;
    }

    return version;
  };

const normalizeProviderOutcome =
  (
    value,
  ) => {
    const normalized =
      upper(value);

    if (!normalized) {
      return PROVIDER_OUTCOMES.UNKNOWN;
    }

    if (
      SUCCESS_PROVIDER_OUTCOMES.has(
        normalized,
      )
    ) {
      return PROVIDER_OUTCOMES.SUCCESS;
    }

    if (
      FAILURE_PROVIDER_OUTCOMES.has(
        normalized,
      )
    ) {
      return PROVIDER_OUTCOMES.FAILURE;
    }

    if (
      PENDING_PROVIDER_OUTCOMES.has(
        normalized,
      )
    ) {
      return PROVIDER_OUTCOMES.PENDING;
    }

    if (
      AMBIGUOUS_PROVIDER_OUTCOME_SET.has(
        normalized,
      )
    ) {
      return PROVIDER_OUTCOMES.AMBIGUOUS;
    }

    return PROVIDER_OUTCOMES.UNKNOWN;
  };

const normalizeOutcomeCategory =
  (
    outcome,
  ) => {
    const normalized =
      normalizeProviderOutcome(
        outcome,
      );

    if (
      normalized ===
      PROVIDER_OUTCOMES.SUCCESS
    ) {
      return PROVIDER_RESULT_CATEGORIES
        .TERMINAL_SUCCESS;
    }

    if (
      normalized ===
      PROVIDER_OUTCOMES.FAILURE
    ) {
      return PROVIDER_RESULT_CATEGORIES
        .TERMINAL_FAILURE;
    }

    if (
      normalized ===
      PROVIDER_OUTCOMES.PENDING
    ) {
      return PROVIDER_RESULT_CATEGORIES
        .ACCEPTED_PENDING;
    }

    if (
      normalized ===
      PROVIDER_OUTCOMES.AMBIGUOUS
    ) {
      return PROVIDER_RESULT_CATEGORIES
        .AMBIGUOUS;
    }

    return PROVIDER_RESULT_CATEGORIES
      .UNKNOWN;
  };

const normalizeReconciliationState =
  (
    value,
  ) =>
    upper(value) ??
    RECONCILIATION_STATES.NOT_RUN;

const buildTransitionFingerprint =
  ({
    tenantId,
    provider,
    operation,
    disbursementId,
    transactionId,
    reference,
    fromState,
    toState,
    action,
    expectedVersion,
    originalIdempotencyKey,
    disbursementFingerprint,
    compensationIdempotencyKey,
  }) =>
    sha256({
      schemaVersion:
        SCHEMA_VERSION,

      tenantId,

      provider,

      operation,

      disbursementId,

      transactionId,

      reference,

      fromState,

      toState,

      action,

      expectedVersion,

      originalIdempotencyKeyHash:
        originalIdempotencyKey
          ? sha256(
              originalIdempotencyKey,
            )
          : null,

      disbursementFingerprint:
        disbursementFingerprint ??
        null,

      compensationIdempotencyKeyHash:
        compensationIdempotencyKey
          ? sha256(
              compensationIdempotencyKey,
            )
          : null,
    });

/**
 * The canonical constants module is intentionally the source of truth.
 *
 * This normalizer only removes undefined/legacy-invalid edges so a malformed
 * historical constant does not make the state-machine import itself fail.
 * The diagnostics API exposes those discrepancies rather than silently hiding
 * them.
 */
const normalizeCanonicalTransitionMap =
  () => {
    const warnings =
      [];

    const normalized =
      {};

    for (
      const state of Object.values(
        DISBURSEMENT_STATES,
      )
    ) {
      const configured =
        ALLOWED_DISBURSEMENT_TRANSITIONS?.[
          state
        ];

      const validTargets =
        Array.isArray(
          configured,
        )
          ? configured.filter(
              (
                target,
              ) =>
                typeof target ===
                  'string' &&
                isKnownState(
                  target,
                ),
            )
          : [];

      if (
        Array.isArray(
          configured,
        ) &&
        configured.some(
          (
            target,
          ) =>
            typeof target !==
              'string' ||
            !isKnownState(
              target,
            ),
        )
      ) {
        warnings.push({
          state,
          invalidTargets:
            configured.filter(
              (
                target,
              ) =>
                typeof target !==
                  'string' ||
                !isKnownState(
                  target,
                ),
            ),
        });
      }

      normalized[state] =
        Object.freeze([
          ...new Set(
            validTargets,
          ),
        ]);
    }

    return {
      map:
        Object.freeze(
          normalized,
        ),

      warnings:
        Object.freeze(
          warnings.map(
            (
              entry,
            ) =>
              Object.freeze({
                state:
                  entry.state,

                invalidTargets:
                  Object.freeze([
                    ...entry.invalidTargets,
                  ]),
              }),
          ),
        ),
    };
  };

const CANONICAL_TRANSITIONS =
  normalizeCanonicalTransitionMap();

/**
 * Explicit compatibility edges are action-scoped. They are not promoted into
 * the generic canonical state transition map.
 *
 * 1. FAILED -> APPROVED for an explicit RETRY re-arm. This exists because the
 *    current disbursement service calls stateMachine.prepareRetry(...) and then
 *    execute(...); the canonical constants presently do not contain a retry
 *    re-arm edge.
 *
 * 2. SUCCESS -> REVERSED for an explicit REVERSE action. The current canonical
 *    constants contain a historical `REVERSAL` reference although that state is
 *    not defined; the actual terminal state used by the disbursement domain is
 *    REVERSED.
 */
const COMPATIBILITY_ACTION_TRANSITIONS =
  Object.freeze({
    RETRY:
      Object.freeze({
        [DISBURSEMENT_STATES.FAILED]:
          DISBURSEMENT_STATES.APPROVED,
      }),

    REVERSE:
      Object.freeze({
        [DISBURSEMENT_STATES.SUCCESS]:
          DISBURSEMENT_STATES.REVERSED,
      }),
  });

export const CANONICAL_TRANSITION_WARNINGS =
  CANONICAL_TRANSITIONS.warnings;

export const EFFECTIVE_TRANSITION_MAP =
  Object.freeze(
    Object.fromEntries(
      Object.entries(
        CANONICAL_TRANSITIONS.map,
      ).map(
        (
          [state, targets],
        ) => [
          state,

          Object.freeze([
            ...targets,

            ...Object.values(
              COMPATIBILITY_ACTION_TRANSITIONS,
            )
              .map(
                (
                  actions,
                ) =>
                  actions[state],
              )
              .filter(
                Boolean,
              ),
          ].filter(
            (
              value,
              index,
              list,
            ) =>
              list.indexOf(
                value,
              ) === index,
          )),
        ],
      ),
    ),
  );

export const ACTION_TRANSITIONS =
  COMPATIBILITY_ACTION_TRANSITIONS;

export class AirtelTransactionStateMachineError
  extends Error
{
  constructor(
    message,
    code =
      'AIRTEL_TRANSACTION_STATE_MACHINE_ERROR',
    details = {},
    options = {},
  ) {
    super(
      message,
      options.cause
        ? {
            cause:
              options.cause,
          }
        : undefined,
    );

    this.name =
      'AirtelTransactionStateMachineError';

    this.code =
      code;

    this.component =
      COMPONENT;

    this.provider =
      PROVIDER;

    this.operation =
      upper(
        options.operation ??
          OPERATION,
      );

    this.details =
      details ??
      {};

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.httpStatus =
      Number.isInteger(
        options.httpStatus,
      )
        ? options.httpStatus
        : 400;
  }

  toJSON() {
    return {
      name:
        this.name,

      code:
        this.code,

      message:
        this.message,

      component:
        this.component,

      provider:
        this.provider,

      operation:
        this.operation,

      details:
        this.details,

      retryable:
        this.retryable,

      httpStatus:
        this.httpStatus,
    };
  }
}

export class AirtelTransactionStateMachine {
  constructor(
    options = {},
  ) {
    if (
      !isPlainObject(
        options,
      )
    ) {
      throw new AirtelTransactionStateMachineError(
        'State-machine options must be a plain object.',
        'STATE_MACHINE_INVALID_OPTIONS',
        {},
        {
          httpStatus:
            500,
        },
      );
    }

    this.config =
      Object.freeze({
        ...DEFAULT_CONFIG,

        ...(
          options.config ??
          options.configuration ??
          {}
        ),
      });

    this.repository =
      options.repository ??
      options.disbursementRepository ??
      options.store ??
      null;

    this.auditService =
      options.auditService ??
      options.audit ??
      null;

    this.eventBus =
      options.eventBus ??
      options.eventPublisher ??
      options.outboxService ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.logger =
      options.logger ??
      null;

    this.clock =
      options.clock ??
      {
        now:
          () => Date.now(),
      };

    this.idFactory =
      isFunction(
        options.idFactory,
      )
        ? options.idFactory
        : () =>
            randomUUID();

    this.statistics = {
      transitions:
        0,

      idempotentTransitions:
        0,

      rejectedTransitions:
        0,

      staleConcurrencyConflicts:
        0,

      retriesPrepared:
        0,

      retriesBlocked:
        0,

      executionClaims:
        0,

      executionClaimConflicts:
        0,

      providerAccepted:
        0,

      providerPending:
        0,

      providerAmbiguous:
        0,

      providerSuccess:
        0,

      providerFailure:
        0,

      reconciliationsRequired:
        0,

      reconciliationsCompleted:
        0,

      compensationsRequired:
        0,

      compensationsCompleted:
        0,

      refundsRequired:
        0,

      refundsCompleted:
        0,

      reversalsCompleted:
        0,

      cancellations:
        0,

      expirations:
        0,

      escalations:
        0,

      auditFailures:
        0,

      eventFailures:
        0,

      repositoryFailures:
        0,
    };
  }

  #throw(
    code,
    message,
    details = {},
    options = {},
  ) {
    throw new AirtelTransactionStateMachineError(
      message,
      code,
      sanitize(
        details,
        0,
        this.config,
      ),
      {
        ...options,

        operation:
          options.operation ??
          OPERATION,
      },
    );
  }

  #log(
    level,
    message,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[
          level
        ] ??
        this.logger?.log ??
        this.logger?.info;

      method?.call?.(
        this.logger,
        {
          component:
            COMPONENT,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          ...sanitize(
            context,
            0,
            this.config,
          ),
        },
        message,
      );
    } catch {
      // Logging cannot influence financial state.
    }
  }

  #metric(
    name,
    labels = {},
  ) {
    try {
      const method =
        this.metrics?.increment ??
        this.metrics?.inc ??
        this.metrics?.counter;

      method?.call?.(
        this.metrics,
        name,
        sanitize(
          labels,
          0,
          this.config,
        ),
      );
    } catch {
      // Metrics are non-authoritative.
    }
  }

  #repoMethod(
    ...names
  ) {
    for (
      const name of names
    ) {
      if (
        isFunction(
          this.repository?.[
            name
          ],
        )
      ) {
        return {
          name,

          fn:
            this.repository[
              name
            ].bind(
              this.repository,
            ),
        };
      }
    }

    return null;
  }

  #nowVersion(
    current,
  ) {
    const version =
      normalizeExpectedVersion(
        current?.version,
      ) ?? 1;

    if (
      version >=
      this.config.maxVersion
    ) {
      this.#throw(
        'STATE_MACHINE_VERSION_OVERFLOW',
        'Transaction version has reached the configured maximum.',
        {
          version,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    return version;
  }

  #requireContext(
    input = {},
    {
      requireExpectedVersion =
        this.config
          .requireExpectedVersionForMutation,

      requireExpectedFingerprint =
        this.config
          .requireExpectedFingerprintForMutation,

      requireOriginalIdempotencyKey =
        false,
    } = {},
  ) {
    if (
      !isPlainObject(
        input,
      )
    ) {
      this.#throw(
        'STATE_MACHINE_INVALID_INPUT',
        'State-machine input must be a plain object.',
        {},
        {
          httpStatus:
            422,
        },
      );
    }

    const tenantId =
      bounded(
        input.tenantId,
        this.config
          .maxTenantIdLength,
      );

    if (
      this.config
        .requireTenantId &&
      !tenantId
    ) {
      this.#throw(
        'STATE_MACHINE_TENANT_REQUIRED',
        'tenantId is required.',
        {},
        {
          httpStatus:
            422,
        },
      );
    }

    const provider =
      upper(
        input.provider ??
          PROVIDER,
      );

    if (
      this.config
        .requireAirtelProvider &&
      provider !==
        PROVIDER
    ) {
      this.#throw(
        'STATE_MACHINE_PROVIDER_SCOPE_VIOLATION',
        'Only AIRTEL is supported by this transaction state machine.',
        {
          provider,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    const operation =
      upper(
        input.operation ??
          OPERATION,
      );

    if (
      this.config
        .requireDisbursementOperation &&
      operation !==
        OPERATION
    ) {
      this.#throw(
        'STATE_MACHINE_OPERATION_SCOPE_VIOLATION',
        'The Airtel disbursement state machine accepts only the DISBURSEMENT operation.',
        {
          operation,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    const disbursementId =
      bounded(
        input.disbursementId ??
          input.paymentId ??
          input.commandId ??
          input.id,
        this.config
          .maxDisbursementIdLength,
      );

    if (
      this.config
        .requireDisbursementId &&
      !disbursementId
    ) {
      this.#throw(
        'STATE_MACHINE_DISBURSEMENT_ID_REQUIRED',
        'disbursementId is required.',
        {},
        {
          httpStatus:
            422,
        },
      );
    }

    const transactionId =
      bounded(
        input.transactionId ??
          input.financialTransactionId ??
          input.paymentId,
        this.config
          .maxTransactionIdLength,
      );

    const reference =
      bounded(
        input.reference ??
          input.paymentReference ??
          input.externalReference,
        this.config
          .maxReferenceLength,
      );

    const originalIdempotencyKey =
      bounded(
        input.originalIdempotencyKey ??
          input.idempotencyKey ??
          input.headers?.[
            'idempotency-key'
          ],
        this.config
          .maxIdempotencyKeyLength,
      );

    if (
      requireOriginalIdempotencyKey &&
      this.config
        .requireOriginalIdempotencyKeyForFinancialMutation &&
      !originalIdempotencyKey
    ) {
      this.#throw(
        'STATE_MACHINE_IDEMPOTENCY_KEY_REQUIRED',
        'The originating financial idempotency key is required for this mutation.',
        {},
        {
          httpStatus:
            422,
        },
      );
    }

    const expectedVersion =
      normalizeExpectedVersion(
        input.expectedVersion ??
          input.version,
      );

    if (
      requireExpectedVersion &&
      expectedVersion ===
        undefined
    ) {
      this.#throw(
        'STATE_MACHINE_EXPECTED_VERSION_REQUIRED',
        'expectedVersion is required for a state mutation.',
        {},
        {
          httpStatus:
            422,
        },
      );
    }

    const expectedFingerprint =
      bounded(
        input.expectedFingerprint ??
          input.disbursementFingerprint ??
          input.transactionFingerprint ??
          input.fingerprint,
        this.config
          .maxFingerprintLength,
      );

    if (
      requireExpectedFingerprint &&
      !expectedFingerprint
    ) {
      this.#throw(
        'STATE_MACHINE_EXPECTED_FINGERPRINT_REQUIRED',
        'expectedFingerprint is required for a state mutation.',
        {},
        {
          httpStatus:
            422,
        },
      );
    }

    const actor =
      isPlainObject(
        input.actor,
      )
        ? {
            actorId:
              bounded(
                actorIdOf(
                  input.actor,
                ),
                this.config
                  .maxActorIdLength,
              ),

            role:
              upper(
                input.actor.role ??
                  input.actor.actorRole,
              ),

            tenantId:
              bounded(
                input.actor.tenantId,
                this.config
                  .maxTenantIdLength,
              ),
          }
        : undefined;

    if (
      actor?.tenantId &&
      actor.tenantId !==
        tenantId
    ) {
      this.#throw(
        'STATE_MACHINE_ACTOR_TENANT_MISMATCH',
        'Actor tenant does not match the disbursement tenant.',
        {},
        {
          httpStatus:
            403,
        },
      );
    }

    const offlineState =
      upper(
        input.offlineState ??
          input.syncState,
      );

    if (
      offlineState &&
      UNSAFE_OFFLINE_STATES?.includes?.(
        offlineState,
      )
    ) {
      this.#throw(
        ERROR_CODES.OFFLINE_UNSAFE ??
          'STATE_MACHINE_OFFLINE_UNSAFE',
        'The requested state mutation cannot finalize an unresolved offline operation.',
        {
          offlineState,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    return {
      tenantId,

      provider,

      operation,

      disbursementId,

      transactionId,

      reference,

      originalIdempotencyKey,

      expectedVersion,

      expectedFingerprint,

      actor,

      actorId:
        actor?.actorId ??
        bounded(
          input.actorId ??
            input.requestedBy ??
            input.requestedById,
          this.config
            .maxActorIdLength,
        ),

      offlineState,

      correlationId:
        bounded(
          input.correlationId,
          240,
        ),

      requestId:
        bounded(
          input.requestId,
          240,
        ),

      traceId:
        bounded(
          input.traceId,
          240,
        ),
    };
  }

  #assertRecordScope(
    record,
    context,
  ) {
    if (!record) {
      this.#throw(
        'STATE_MACHINE_RECORD_REQUIRED',
        'Disbursement record is required.',
        {},
        {
          httpStatus:
            404,
        },
      );
    }

    if (
      record.tenantId !==
      context.tenantId
    ) {
      this.#throw(
        'STATE_MACHINE_TENANT_SCOPE_MISMATCH',
        'Disbursement record belongs to a different tenant.',
        {},
        {
          httpStatus:
            404,
        },
      );
    }

    if (
      upper(
        record.provider ??
          PROVIDER,
      ) !==
      PROVIDER
    ) {
      this.#throw(
        'STATE_MACHINE_RECORD_PROVIDER_MISMATCH',
        'Disbursement record provider is outside the Airtel state-machine scope.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    if (
      upper(
        record.operation ??
          OPERATION,
      ) !==
      OPERATION
    ) {
      this.#throw(
        'STATE_MACHINE_RECORD_OPERATION_MISMATCH',
        'Disbursement record operation is outside the state-machine scope.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    if (
      context.disbursementId &&
      String(
        record.disbursementId ??
          record._id ??
          '',
      ) !==
        String(
          context.disbursementId,
        )
    ) {
      this.#throw(
        'STATE_MACHINE_DISBURSEMENT_SCOPE_MISMATCH',
        'Disbursement record identity does not match the requested identity.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    return true;
  }

  #assertIdentityGuards(
    record,
    context,
  ) {
    if (
      context.transactionId &&
      record.transactionId &&
      String(
        context.transactionId,
      ) !==
        String(
          record.transactionId,
        )
    ) {
      this.#throw(
        'STATE_MACHINE_TRANSACTION_ID_MISMATCH',
        'Transaction identity does not match the persisted disbursement.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    if (
      context.reference &&
      record.reference &&
      String(
        context.reference,
      ) !==
        String(
          record.reference,
        )
    ) {
      this.#throw(
        'STATE_MACHINE_REFERENCE_MISMATCH',
        'Reference does not match the persisted disbursement.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    if (
      context.originalIdempotencyKey &&
      record.originalIdempotencyKey &&
      String(
        context.originalIdempotencyKey,
      ) !==
        String(
          record.originalIdempotencyKey,
        )
    ) {
      this.#throw(
        'STATE_MACHINE_IDEMPOTENCY_IDENTITY_MISMATCH',
        'Original idempotency identity does not match the persisted disbursement.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    if (
      context.expectedFingerprint &&
      record.disbursementFingerprint &&
      String(
        context.expectedFingerprint,
      ) !==
        String(
          record.disbursementFingerprint,
        )
    ) {
      this.#throw(
        ERROR_CODES.STALE_SCOPE ??
          'STATE_MACHINE_STALE_SCOPE',
        'Disbursement fingerprint no longer matches the persisted execution scope.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    return true;
  }

  #resolveTarget(
    fromState,
    toState,
    action,
  ) {
    const from =
      upper(
        fromState,
      );

    const to =
      upper(
        toState,
      );

    const normalizedAction =
      upper(action);

    if (
      !isKnownState(
        from,
      ) ||
      !isKnownState(
        to,
      )
    ) {
      return {
        allowed:
          false,

        compatibility:
          false,

        reason:
          'UNKNOWN_STATE',
      };
    }

    if (
      CANONICAL_TRANSITIONS
        .map[from]
        ?.includes(
          to,
        )
    ) {
      return {
        allowed:
          true,

        compatibility:
          false,

        reason:
          'CANONICAL_TRANSITION',
      };
    }

    const actionEdges =
      COMPATIBILITY_ACTION_TRANSITIONS[
        normalizedAction
      ];

    if (
      actionEdges &&
      actionEdges[from] ===
        to
    ) {
      return {
        allowed:
          normalizedAction ===
            'RETRY'
            ? this.config
                .allowCompatibilityRetryRearm
            : this.config
                .allowCompatibilityReversalTransition,

        compatibility:
          true,

        reason:
          normalizedAction ===
            'RETRY'
            ? 'COMPATIBILITY_RETRY_REARM'
            : 'COMPATIBILITY_REVERSAL',
      };
    }

    return {
      allowed:
        false,

      compatibility:
        false,

      reason:
        'TRANSITION_NOT_ALLOWED',
    };
  }

  canTransition(
    fromState,
    toState,
    options = {},
  ) {
    return this.#resolveTarget(
      fromState,
      toState,
      options.action,
    ).allowed;
  }

  assertTransition(
    fromState,
    toState,
    {
      action,
      allowSameState =
        this.config
          .allowSameStateIdempotency,
    } = {},
  ) {
    const from =
      upper(
        fromState,
      );

    const to =
      upper(
        toState,
      );

    if (
      !isKnownState(
        from,
      )
    ) {
      this.#throw(
        ERROR_CODES.INVALID_STATE_TRANSITION ??
          'STATE_MACHINE_INVALID_CURRENT_STATE',
        `Unknown current disbursement state ${from}.`,
        {
          fromState:
            from,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    if (
      !isKnownState(
        to,
      )
    ) {
      this.#throw(
        ERROR_CODES.INVALID_STATE_TRANSITION ??
          'STATE_MACHINE_INVALID_TARGET_STATE',
        `Unknown target disbursement state ${to}.`,
        {
          toState:
            to,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    if (
      from === to &&
      allowSameState
    ) {
      return {
        allowed:
          true,

        sameState:
          true,

        compatibility:
          false,

        reason:
          'IDEMPOTENT_SAME_STATE',
      };
    }

    const resolved =
      this.#resolveTarget(
        from,
        to,
        action,
      );

    if (
      !resolved.allowed
    ) {
      this.statistics
        .rejectedTransitions++;

      this.#throw(
        ERROR_CODES.INVALID_STATE_TRANSITION ??
          'STATE_MACHINE_INVALID_STATE_TRANSITION',
        `Cannot transition disbursement from ${from} to ${to}.`,
        {
          fromState:
            from,

          toState:
            to,

          action:
            upper(action),

          reason:
            resolved.reason,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    return {
      allowed:
        true,

      sameState:
        false,

      compatibility:
        resolved.compatibility,

      reason:
        resolved.reason,
    };
  }

  async #findRecord(
    context,
  ) {
    if (
      !this.repository
    ) {
      this.#throw(
        'STATE_MACHINE_REPOSITORY_REQUIRED',
        'A disbursement repository is required.',
        {},
        {
          retryable:
            true,

          httpStatus:
            503,
        },
      );
    }

    const method =
      this.#repoMethod(
        'findByIdForTenant',
        'findByDisbursementIdForTenant',
        'findOneForTenant',
        'findById',
        'getById',
        'getDisbursement',
        'findDisbursementById',
      );

    if (
      !method
    ) {
      this.#throw(
        'STATE_MACHINE_REPOSITORY_LOOKUP_UNAVAILABLE',
        'Disbursement repository lookup is unavailable.',
        {},
        {
          retryable:
            true,

          httpStatus:
            503,
        },
      );
    }

    try {
      let record;

      if (
        method.name ===
          'findByIdForTenant' ||
        method.name ===
          'findByDisbursementIdForTenant'
      ) {
        record =
          await method.fn(
            context.tenantId,
            context.disbursementId,
            {
              provider:
                PROVIDER,

              operation:
                OPERATION,

              session:
                context.session,
            },
          );
      } else if (
        method.name ===
        'findOneForTenant'
      ) {
        record =
          await method.fn(
            context.tenantId,
            {
              disbursementId:
                context.disbursementId,

              provider:
                PROVIDER,

              operation:
                OPERATION,
            },
            {
              session:
                context.session,
            },
          );
      } else {
        record =
          await method.fn(
            context.disbursementId,
            {
              tenantId:
                context.tenantId,

              provider:
                PROVIDER,

              operation:
                OPERATION,

              session:
                context.session,
            },
          );
      }

      if (
        !record
      ) {
        this.#throw(
          'STATE_MACHINE_DISBURSEMENT_NOT_FOUND',
          'Airtel disbursement was not found within the tenant scope.',
          {
            disbursementId:
              context.disbursementId,
          },
          {
            httpStatus:
              404,
          },
        );
      }

      this.#assertRecordScope(
        record,
        context,
      );

      return clone(
        record,
      );
    } catch (
      error
    ) {
      if (
        error instanceof
        AirtelTransactionStateMachineError
      ) {
        throw error;
      }

      this.statistics
        .repositoryFailures++;

      this.#log(
        'error',
        'Airtel disbursement state-machine lookup failed.',
        {
          tenantId:
            context.tenantId,

          disbursementId:
            context.disbursementId,

          message:
            error?.message,
        },
      );

      this.#throw(
        'STATE_MACHINE_REPOSITORY_LOOKUP_FAILED',
        'Disbursement repository lookup failed.',
        {},
        {
          retryable:
            true,

          httpStatus:
            503,

          cause:
            error,
        },
      );
    }
  }

  async get(
    input = {},
  ) {
    const context =
      this.#requireContext(
        input,
        {
          requireExpectedVersion:
            false,

          requireExpectedFingerprint:
            false,

          requireOriginalIdempotencyKey:
            false,
        },
      );

    return this.#findRecord(
      context,
    );
  }

  async #writeTransition(
    {
      context,
      record,
      fromState,
      toState,
      action,
      patch,
      transitionFingerprint,
      timelineEntry,
      compatibility =
        false,
    },
  ) {
    const expectedVersion =
      normalizeExpectedVersion(
        context.expectedVersion ??
          record.version,
      );

    const currentVersion =
      this.#nowVersion(
        record,
      );

    if (
      expectedVersion !==
        undefined &&
      expectedVersion !==
        currentVersion
    ) {
      this.statistics
        .staleConcurrencyConflicts++;

      this.#throw(
        ERROR_CODES.STALE_VERSION ??
          'STATE_MACHINE_STALE_VERSION',
        'Disbursement version no longer matches the requested transition.',
        {
          expectedVersion,
          currentVersion,
        },
        {
          httpStatus:
            409,

          retryable:
            true,
        },
      );
    }

    const atomic =
      this.#repoMethod(
        'transitionDisbursement',
        'atomicTransition',
        'compareAndSetTransition',
        'transition',
        'compareAndSetStatus',
      );

    if (
      atomic
    ) {
      try {
        const result =
          await atomic.fn({
            disbursementId:
              context.disbursementId,

            tenantId:
              context.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            fromState,

            toState,

            fromStatus:
              fromState,

            nextStatus:
              toState,

            action:
              upper(action) ??
              toState,

            expectedVersion:
              expectedVersion ??
              currentVersion,

            expectedFingerprint:
              context.expectedFingerprint ??
              record.disbursementFingerprint,

            expectedIdempotencyKey:
              context.originalIdempotencyKey ??
              record.originalIdempotencyKey,

            actorId:
              context.actorId,

            transitionFingerprint,

            compatibility,

            patch:
              sanitize(
                patch,
                0,
                this.config,
              ),

            timelineEntry:
              this.config
                .preserveTimeline
                ? sanitize(
                    timelineEntry,
                    0,
                    this.config,
                  )
                : undefined,

            session:
              context.session,
          });

        if (
          result
        ) {
          return this.#project(
            result,
          );
        }

        const latest =
          await this.#findRecord(
            context,
          );

        if (
          upper(
            latest.state ??
              latest.status,
          ) ===
          toState
        ) {
          this.statistics
            .idempotentTransitions++;

          return this.#project(
            latest,
          );
        }

        this.statistics
          .staleConcurrencyConflicts++;

        this.#throw(
          ERROR_CODES.STALE_VERSION ??
            'STATE_MACHINE_TRANSITION_REJECTED',
          'Atomic state transition was rejected, likely due to a concurrent writer.',
          {
            disbursementId:
              context.disbursementId,

            fromState,

            toState,
          },
          {
            httpStatus:
              409,

            retryable:
              true,
          },
        );
      } catch (
        error
      ) {
        if (
          error instanceof
          AirtelTransactionStateMachineError
        ) {
          throw error;
        }

        this.statistics
          .repositoryFailures++;

        this.#log(
          'error',
          'Atomic Airtel disbursement state transition failed.',
          {
            disbursementId:
              context.disbursementId,

            fromState,

            toState,

            message:
              error?.message,
          },
        );

        this.#throw(
          'STATE_MACHINE_ATOMIC_TRANSITION_FAILED',
          'Atomic disbursement state transition failed.',
          {},
          {
            retryable:
              true,

            httpStatus:
              503,

            cause:
              error,
          },
        );
      }
    }

    if (
      this.config
        .requireAtomicTransition
    ) {
      this.#throw(
        'STATE_MACHINE_ATOMIC_TRANSITION_REQUIRED',
        'Atomic compare-and-set state transitions are required in production.',
        {
          disbursementId:
            context.disbursementId,
        },
        {
          retryable:
            true,

          httpStatus:
            503,
        },
      );
    }

    const fallback =
      this.#repoMethod(
        'updateState',
        'updateDisbursementState',
        'updateForTenant',
        'updateDisbursement',
        'patchDisbursement',
        'patch',
        'update',
      );

    if (
      !fallback
    ) {
      this.#throw(
        'STATE_MACHINE_REPOSITORY_UPDATE_UNAVAILABLE',
        'No repository state-update operation is configured.',
        {},
        {
          retryable:
            true,

          httpStatus:
            503,
        },
      );
    }

    try {
      let result;

      if (
        fallback.name ===
        'updateForTenant'
      ) {
        result =
          await fallback.fn(
            context.tenantId,
            {
              disbursementId:
                context.disbursementId,

              provider:
                PROVIDER,

              operation:
                OPERATION,
            },
            sanitize(
              patch,
              0,
              this.config,
            ),
            {
              session:
                context.session,
            },
          );
      } else {
        result =
          await fallback.fn(
            context.disbursementId,
            sanitize(
              patch,
              0,
              this.config,
            ),
            {
              tenantId:
                context.tenantId,

              provider:
                PROVIDER,

              operation:
                OPERATION,

              expectedVersion:
                expectedVersion ??
                currentVersion,

              expectedFingerprint:
                context.expectedFingerprint ??
                record.disbursementFingerprint,

              session:
                context.session,
            },
          );
      }

      if (
        !result
      ) {
        this.#throw(
          'STATE_MACHINE_REPOSITORY_UPDATE_EMPTY_RESULT',
          'Repository state update returned no result.',
          {},
          {
            retryable:
              true,

            httpStatus:
              503,
          },
        );
      }

      return this.#project(
        result,
      );
    } catch (
      error
    ) {
      if (
        error instanceof
        AirtelTransactionStateMachineError
      ) {
        throw error;
      }

      this.statistics
        .repositoryFailures++;

      this.#throw(
        'STATE_MACHINE_REPOSITORY_UPDATE_FAILED',
        'Disbursement state persistence failed.',
        {},
        {
          retryable:
            true,

          httpStatus:
            503,

          cause:
            error,
        },
      );
    }
  }

  #timelineEntry({
    context,
    fromState,
    toState,
    action,
    reason,
    now,
  }) {
    return {
      eventId:
        this.idFactory(),

      previousState:
        upper(fromState),

      state:
        upper(toState),

      action:
        upper(action),

      reason:
        bounded(
          reason,
          this.config
            .maxReasonLength,
        ),

      occurredAt:
        now,

      actorId:
        bounded(
          context.actorId,
          this.config
            .maxActorIdLength,
        ),

      correlationId:
        context.correlationId,

      requestId:
        context.requestId,

      traceId:
        context.traceId,

      provider:
        PROVIDER,

      operation:
        OPERATION,
    };
  }

  #buildPatch({
    context,
    record,
    fromState,
    toState,
    action,
    reason,
    extraPatch =
      {},
  }) {
    const currentVersion =
      this.#nowVersion(
        record,
      );

    const now =
      nowDate(
        this.clock,
      );

    const timelineEntry =
      this.#timelineEntry({
        context,

        fromState,

        toState,

        action,

        reason,

        now,
      });

    const existingTimeline =
      Array.isArray(
        record.timeline,
      )
        ? record.timeline
        : [];

    const timeline =
      this.config
        .preserveTimeline
        ? [
            ...existingTimeline,
            timelineEntry,
          ].slice(
            -this.config
              .maxTimelineEntries,
          )
        : undefined;

    return {
      state:
        toState,

      status:
        toState,

      previousState:
        fromState,

      lastAction:
        upper(action),

      lastTransitionReason:
        bounded(
          reason,
          this.config
            .maxReasonLength,
        ),

      updatedAt:
        now,

      version:
        currentVersion + 1,

      ...(timeline
        ? {
            timeline,
          }
        : {}),

      ...sanitize(
        extraPatch,
        0,
        this.config,
      ),
    };
  }

  async #audit(
    action,
    context,
    record,
    extra = {},
  ) {
    const method =
      this.auditService?.append ??
      this.auditService?.record ??
      this.auditService?.write ??
      this.auditService?.createAuditLog;

    if (
      !isFunction(method)
    ) {
      return null;
    }

    const payload =
      sanitize(
        {
          schemaVersion:
            SCHEMA_VERSION,

          component:
            COMPONENT,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          action,

          tenantId:
            context.tenantId,

          disbursementId:
            context.disbursementId,

          transactionId:
            context.transactionId ??
            record?.transactionId,

          reference:
            context.reference ??
            record?.reference,

          fromState:
            extra.fromState,

          toState:
            extra.toState ??
            record?.state,

          state:
            record?.state,

          version:
            record?.version,

          transitionFingerprint:
            extra.transitionFingerprint,

          originalIdempotencyKeyHash:
            (
              context.originalIdempotencyKey ??
              record?.originalIdempotencyKey
            )
              ? sha256(
                  context.originalIdempotencyKey ??
                  record.originalIdempotencyKey,
                )
              : undefined,

          actorId:
            context.actorId,

          compatibility:
            Boolean(
              extra.compatibility,
            ),

          reason:
            bounded(
              extra.reason,
              this.config
                .maxReasonLength,
            ),

          occurredAt:
            nowIso(
              this.clock,
            ),
        },
        0,
        this.config,
      );

    try {
      return await method.call(
        this.auditService,
        {
          ...payload,

          auditFingerprint:
            sha256(
              payload,
            ),
        },
      );
    } catch (
      error
    ) {
      this.statistics
        .auditFailures++;

      this.#log(
        'error',
        'Airtel state-machine audit publication failed.',
        {
          action,

          disbursementId:
            context.disbursementId,

          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnAuditError
      ) {
        this.#throw(
          ERROR_CODES.AUDIT_UNAVAILABLE ??
            'STATE_MACHINE_AUDIT_UNAVAILABLE',
          'State-machine audit boundary is unavailable.',
          {},
          {
            retryable:
              true,

            httpStatus:
              503,
          },
        );
      }

      return null;
    }
  }

  async #emit(
    type,
    context,
    record,
    extra = {},
  ) {
    const method =
      this.eventBus?.publish ??
      this.eventBus?.enqueue ??
      this.eventBus?.emit;

    if (
      !isFunction(method)
    ) {
      return null;
    }

    const event =
      sanitize(
        {
          eventId:
            this.idFactory(),

          type,

          schemaVersion:
            SCHEMA_VERSION,

          component:
            COMPONENT,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          occurredAt:
            nowIso(
              this.clock,
            ),

          tenantId:
            context.tenantId,

          disbursementId:
            context.disbursementId,

          transactionId:
            context.transactionId ??
            record?.transactionId,

          reference:
            context.reference ??
            record?.reference,

          state:
            record?.state,

          version:
            record?.version,

          transitionFingerprint:
            extra.transitionFingerprint,

          payload: {
            action:
              upper(
                extra.action,
              ),

            fromState:
              upper(
                extra.fromState,
              ),

            toState:
              upper(
                extra.toState ??
                  record?.state,
              ),

            reason:
              bounded(
                extra.reason,
                this.config
                  .maxReasonLength,
              ),

            providerOutcome:
              upper(
                extra.providerOutcome,
              ),

            reconciliationState:
              upper(
                extra.reconciliationState,
              ),
          },
        },
        0,
        this.config,
      );

    try {
      return await method.call(
        this.eventBus,
        event,
      );
    } catch (
      error
    ) {
      this.statistics
        .eventFailures++;

      this.#log(
        'error',
        'Airtel state-machine event publication failed.',
        {
          type,

          disbursementId:
            context.disbursementId,

          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnEventError
      ) {
        this.#throw(
          ERROR_CODES.EVENT_PUBLICATION_FAILED ??
            'STATE_MACHINE_EVENT_PUBLICATION_FAILED',
          'State-machine event publication failed.',
          {},
          {
            retryable:
              true,

            httpStatus:
              503,
          },
        );
      }

      return null;
    }
  }

  #project(
    record,
  ) {
    if (!record) {
      return null;
    }

    const output =
      clone(record) ??
      {};

    for (
      const key of [
        'providerRequest',
        'providerResponse',
        'rawProviderRequest',
        'rawProviderResponse',
        'credentials',
        'secret',
        'token',
      ]
    ) {
      delete output[key];
    }

    return output;
  }

  async transition(
    input = {},
  ) {
    const context =
      this.#requireContext(
        input,
        {
          requireExpectedVersion:
            this.config
              .requireExpectedVersionForMutation,

          requireExpectedFingerprint:
            this.config
              .requireExpectedFingerprintForMutation,

          requireOriginalIdempotencyKey:
            input.requireOriginalIdempotencyKey ??
            this.config
              .requireOriginalIdempotencyKeyForFinancialMutation,
        },
      );

    const record =
      input.record
        ? clone(input.record)
        : await this.#findRecord(
            {
              ...context,

              session:
                input.session,
            },
          );

    this.#assertRecordScope(
      record,
      context,
    );

    this.#assertIdentityGuards(
      record,
      context,
    );

    const fromState =
      upper(
        record.state ??
          record.status,
      );

    const toState =
      upper(
        input.toState ??
          input.nextState ??
          input.nextStatus ??
          input.status,
      );

    const action =
      upper(
        input.action ??
          toState,
      );

    const transition =
      this.assertTransition(
        fromState,
        toState,
        {
          action,
        },
      );

    if (
      transition.sameState
    ) {
      this.statistics
        .idempotentTransitions++;

      return {
        outcome:
          STATE_MACHINE_OUTCOMES.IDEMPOTENT,

        state:
          fromState,

        status:
          fromState,

        disbursementId:
          context.disbursementId,

        tenantId:
          context.tenantId,

        version:
          record.version,

        transactionFingerprint:
          record.disbursementFingerprint,

        transitionFingerprint:
          buildTransitionFingerprint({
            tenantId:
              context.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            disbursementId:
              context.disbursementId,

            transactionId:
              context.transactionId ??
              record.transactionId,

            reference:
              context.reference ??
              record.reference,

            fromState,

            toState,

            action,

            expectedVersion:
              context.expectedVersion ??
              record.version,

            originalIdempotencyKey:
              context.originalIdempotencyKey ??
              record.originalIdempotencyKey,

            disbursementFingerprint:
              record.disbursementFingerprint,
          }),

        record:
          this.#project(
            record,
          ),
      };
    }

    const transitionFingerprint =
      buildTransitionFingerprint({
        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        disbursementId:
          context.disbursementId,

        transactionId:
          context.transactionId ??
          record.transactionId,

        reference:
          context.reference ??
          record.reference,

        fromState,

        toState,

        action,

        expectedVersion:
          context.expectedVersion ??
          record.version,

        originalIdempotencyKey:
          context.originalIdempotencyKey ??
          record.originalIdempotencyKey,

        disbursementFingerprint:
          record.disbursementFingerprint,

        compensationIdempotencyKey:
          input.compensationIdempotencyKey,
      });

    const patch =
      this.#buildPatch({
        context,

        record,

        fromState,

        toState,

        action,

        reason:
          input.reason ??
          input.reasonCode,

        extraPatch:
          input.patch ??
          {},
      });

    const updated =
      await this.#writeTransition({
        context: {
          ...context,

          session:
            input.session,
        },

        record,

        fromState,

        toState,

        action,

        patch,

        transitionFingerprint,

        timelineEntry:
          patch.timeline?.[
            patch.timeline.length -
            1
          ],

        compatibility:
          transition.compatibility,
      });

    this.statistics
      .transitions++;

    if (
      toState ===
      DISBURSEMENT_STATES.SUCCESS
    ) {
      this.statistics
        .providerSuccess++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.FAILED
    ) {
      this.statistics
        .providerFailure++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.RECONCILIATION_REQUIRED
    ) {
      this.statistics
        .reconciliationsRequired++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.RECONCILED
    ) {
      this.statistics
        .reconciliationsCompleted++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.COMPENSATION_REQUIRED
    ) {
      this.statistics
        .compensationsRequired++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.COMPENSATED
    ) {
      this.statistics
        .compensationsCompleted++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.REFUND_REQUIRED
    ) {
      this.statistics
        .refundsRequired++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.REFUNDED
    ) {
      this.statistics
        .refundsCompleted++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.REVERSED
    ) {
      this.statistics
        .reversalsCompleted++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.CANCELLED
    ) {
      this.statistics
        .cancellations++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.EXPIRED
    ) {
      this.statistics
        .expirations++;
    }

    if (
      toState ===
      DISBURSEMENT_STATES.ESCALATED
    ) {
      this.statistics
        .escalations++;
    }

    await this.#audit(
      'DISBURSEMENT_STATE_TRANSITIONED',
      context,
      updated,
      {
        action,

        fromState,

        toState,

        reason:
          input.reason ??
          input.reasonCode,

        compatibility:
          transition.compatibility,

        transitionFingerprint,
      },
    );

    await this.#emit(
      'AIRTEL_DISBURSEMENT_STATE_CHANGED',
      context,
      updated,
      {
        action,

        fromState,

        toState,

        reason:
          input.reason ??
          input.reasonCode,

        transitionFingerprint,
      },
    );

    this.#metric(
      'airtel.disbursement.state_transition.total',
      {
        fromState,

        toState,

        action,
      },
    );

    return {
      outcome:
        STATE_MACHINE_OUTCOMES.TRANSITIONED,

      state:
        toState,

      status:
        toState,

      disbursementId:
        context.disbursementId,

      tenantId:
        context.tenantId,

      fromState,

      toState,

      action,

      version:
        updated.version,

      compatibility:
        transition.compatibility,

      transitionFingerprint,

      record:
        updated,
    };
  }

  transitionDisbursement(
    input = {},
  ) {
    return this.transition(
      input,
    );
  }

  move(
    input = {},
  ) {
    return this.transition(
      input,
    );
  }

  async claimForExecution(
    input = {},
  ) {
    const context =
      this.#requireContext(
        input,
        {
          requireExpectedVersion:
            true,

          requireExpectedFingerprint:
            true,

          requireOriginalIdempotencyKey:
            true,
        },
      );

    let record =
      input.record
        ? clone(
            input.record,
          )
        : await this.#findRecord(
            {
              ...context,

              session:
                input.session,
            },
          );

    this.#assertRecordScope(
      record,
      context,
    );

    this.#assertIdentityGuards(
      record,
      context,
    );

    const currentState =
      upper(
        record.state ??
          record.status,
      );

    if (
      currentState ===
      DISBURSEMENT_STATES.EXECUTING
    ) {
      this.statistics
        .executionClaimConflicts++;

      return {
        claimed:
          false,

        outcome:
          STATE_MACHINE_OUTCOMES.ALREADY_CLAIMED,

        code:
          'EXECUTION_ALREADY_CLAIMED',

        record,
      };
    }

    if (
      currentState !==
        DISBURSEMENT_STATES.QUEUED &&
      currentState !==
        DISBURSEMENT_STATES.APPROVED
    ) {
      this.#throw(
        ERROR_CODES.INVALID_STATE_TRANSITION ??
          'STATE_MACHINE_EXECUTION_STATE_INVALID',
        `Disbursement cannot be claimed for execution from ${currentState}.`,
        {
          currentState,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    const toState =
      DISBURSEMENT_STATES.EXECUTING;

    const action =
      ACTIONS.EXECUTE;

    this.assertTransition(
      currentState,
      toState,
      {
        action,
      },
    );

    const transitionFingerprint =
      buildTransitionFingerprint({
        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        disbursementId:
          context.disbursementId,

        transactionId:
          context.transactionId ??
          record.transactionId,

        reference:
          context.reference ??
          record.reference,

        fromState:
          currentState,

        toState,

        action,

        expectedVersion:
          context.expectedVersion,

        originalIdempotencyKey:
          context.originalIdempotencyKey,

        disbursementFingerprint:
          record.disbursementFingerprint,
      });

    const attempts =
      integer(
        record.attempts,
        0,
      ) + 1;

    const updated =
      await this.#writeTransition({
        context: {
          ...context,

          session:
            input.session,
        },

        record,

        fromState:
          currentState,

        toState,

        action,

        patch:
          this.#buildPatch({
            context,

            record,

            fromState:
              currentState,

            toState,

            action,

            reason:
              input.reason ??
              'EXECUTION_CLAIMED',

            extraPatch: {
              attempts,

              executionClaimedAt:
                nowDate(
                  this.clock,
                ),

              executionClaimedBy:
                context.actorId ??
                'system:airtel-disbursement',
            },
          }),

        transitionFingerprint,

        timelineEntry:
          this.#timelineEntry({
            context,

            fromState:
              currentState,

            toState,

            action,

            reason:
              input.reason ??
              'EXECUTION_CLAIMED',

            now:
              nowDate(
                this.clock,
              ),
          }),
      });

    this.statistics
      .executionClaims++;

    await this.#audit(
      'DISBURSEMENT_EXECUTION_CLAIMED',
      context,
      updated,
      {
        action,

        fromState:
          currentState,

        toState,

        transitionFingerprint,
      },
    );

    await this.#emit(
      'AIRTEL_DISBURSEMENT_EXECUTION_CLAIMED',
      context,
      updated,
      {
        action,

        fromState:
          currentState,

        toState,

        transitionFingerprint,
      },
    );

    return {
      claimed:
        true,

      outcome:
        STATE_MACHINE_OUTCOMES.CLAIMED,

      code:
        'EXECUTION_CLAIMED',

      transitionFingerprint,

      record:
        updated,
    };
  }

  claimDisbursement(
    input = {},
  ) {
    return this.claimForExecution(
      input,
    );
  }

  atomicClaim(
    input = {},
  ) {
    return this.claimForExecution(
      input,
    );
  }

  async prepareRetry(
    input = {},
  ) {
    const context =
      this.#requireContext(
        input,
        {
          requireExpectedVersion:
            true,

          requireExpectedFingerprint:
            true,

          requireOriginalIdempotencyKey:
            true,
        },
      );

    let record =
      input.record
        ? clone(
            input.record,
          )
        : await this.#findRecord(
            {
              ...context,

              session:
                input.session,
            },
          );

    this.#assertRecordScope(
      record,
      context,
    );

    this.#assertIdentityGuards(
      record,
      context,
    );

    const state =
      upper(
        record.state ??
          record.status,
      );

    if (
      state ===
        DISBURSEMENT_STATES.SUCCESS ||
      state ===
        DISBURSEMENT_STATES.COMPENSATED ||
      state ===
        DISBURSEMENT_STATES.REFUNDED ||
      state ===
        DISBURSEMENT_STATES.REVERSED
    ) {
      this.statistics
        .retriesBlocked++;

      return {
        outcome:
          STATE_MACHINE_OUTCOMES.IDEMPOTENT,

        retryable:
          false,

        code:
          'DISBURSEMENT_ALREADY_FINAL',

        nextAction:
          RETRY_DECISIONS.NO_RETRY,

        record,
      };
    }

    if (
      NON_RETRYABLE_UNCERTAIN_STATES.includes(
        state,
      )
    ) {
      this.statistics
        .retriesBlocked++;

      return {
        outcome:
          STATE_MACHINE_OUTCOMES.REQUIRES_STATUS_CHECK,

        retryable:
          false,

        code:
          'AMBIGUOUS_OUTCOME_REQUIRES_STATUS_CHECK',

        nextAction:
          state ===
            DISBURSEMENT_STATES.RECONCILIATION_REQUIRED ||
          state ===
            DISBURSEMENT_STATES.RECONCILING
            ? RETRY_DECISIONS.RECONCILE
            : RETRY_DECISIONS.STATUS_CHECK,

        record,
      };
    }

    if (
      !RETRYABLE_STATES.includes(
        state,
      )
    ) {
      this.statistics
        .retriesBlocked++;

      return {
        outcome:
          STATE_MACHINE_OUTCOMES.REQUIRES_REVIEW,

        retryable:
          false,

        code:
          'DISBURSEMENT_RETRY_NOT_ALLOWED_FROM_STATE',

        nextAction:
          RETRY_DECISIONS.REVIEW,

        record,
      };
    }

    const nextState =
      DISBURSEMENT_STATES.APPROVED;

    const action =
      ACTIONS.RETRY;

    const transition =
      this.#resolveTarget(
        state,
        nextState,
        action,
      );

    if (
      !transition.allowed
    ) {
      this.#throw(
        ERROR_CODES.INVALID_STATE_TRANSITION ??
          'STATE_MACHINE_RETRY_REARM_NOT_AVAILABLE',
        'The configured state machine does not permit the explicit retry re-arm.',
        {
          state,

          nextState,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    const retryAttempt =
      integer(
        record.retryAttempts,
        0,
      ) + 1;

    const retryFingerprint =
      sha256({
        schemaVersion:
          SCHEMA_VERSION,

        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        disbursementId:
          context.disbursementId,

        originalIdempotencyKeyHash:
          context.originalIdempotencyKey
            ? sha256(
                context.originalIdempotencyKey,
              )
            : null,

        retryAttempt,

        priorState:
          state,

        priorVersion:
          record.version,
      });

    const transitionFingerprint =
      buildTransitionFingerprint({
        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        disbursementId:
          context.disbursementId,

        transactionId:
          context.transactionId ??
          record.transactionId,

        reference:
          context.reference ??
          record.reference,

        fromState:
          state,

        toState:
          nextState,

        action,

        expectedVersion:
          context.expectedVersion,

        originalIdempotencyKey:
          context.originalIdempotencyKey,

        disbursementFingerprint:
          record.disbursementFingerprint,
      });

    const updated =
      await this.#writeTransition({
        context: {
          ...context,

          session:
            input.session,
        },

        record,

        fromState:
          state,

        toState:
          nextState,

        action,

        patch:
          this.#buildPatch({
            context,

            record,

            fromState:
              state,

            toState:
              nextState,

            action,

            reason:
              input.reason ??
              'SAFE_RETRY_REARM',

            extraPatch: {
              retryAttempts:
                retryAttempt,

              lastRetryAt:
                nowDate(
                  this.clock,
                ),

              retryFingerprint,

              retryDecision:
                RETRY_DECISIONS.RETRY,

              retrySourceState:
                state,

              providerOutcome:
                record.providerOutcome,
            },
          }),

        transitionFingerprint,

        timelineEntry:
          this.#timelineEntry({
            context,

            fromState:
              state,

            toState:
              nextState,

            action,

            reason:
              input.reason ??
              'SAFE_RETRY_REARM',

            now:
              nowDate(
                this.clock,
              ),
          }),

        compatibility:
          true,
      });

    this.statistics
      .retriesPrepared++;

    await this.#audit(
      'DISBURSEMENT_RETRY_PREPARED',
      context,
      updated,
      {
        action,

        fromState:
          state,

        toState:
          nextState,

        retryAttempt,

        retryFingerprint,

        transitionFingerprint,

        compatibility:
          true,
      },
    );

    await this.#emit(
      'AIRTEL_DISBURSEMENT_RETRY_PREPARED',
      context,
      updated,
      {
        action,

        fromState:
          state,

        toState:
          nextState,

        retryAttempt,

        transitionFingerprint,
      },
    );

    return {
      outcome:
        STATE_MACHINE_OUTCOMES.RETRY_READY,

      retryable:
        true,

      code:
        'DISBURSEMENT_RETRY_REARMED',

      nextAction:
        RETRY_DECISIONS.RETRY,

      state:
        nextState,

      retryAttempt,

      retryFingerprint,

      transitionFingerprint,

      originalIdempotencyKey:
        context.originalIdempotencyKey,

      record:
        updated,
    };
  }

  retryDisbursement(
    input = {},
  ) {
    return this.prepareRetry(
      input,
    );
  }

  requeue(
    input = {},
  ) {
    return this.prepareRetry(
      input,
    );
  }

  async markProviderAccepted(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.PROVIDER_ACCEPTED,

      action:
        ACTIONS.EXECUTE,

      reason:
        input.reason ??
        'PROVIDER_ACCEPTED',

      patch: {
        providerOutcome:
          PROVIDER_OUTCOMES.ACCEPTED,

        providerExecutionState:
          PROVIDER_EXECUTION_STATES.ACCEPTED,

        providerResultCategory:
          PROVIDER_RESULT_CATEGORIES.ACCEPTED_PENDING,

        providerTransactionId:
          bounded(
            input.providerTransactionId,
            this.config
              .maxTransactionIdLength,
          ),

        providerReference:
          bounded(
            input.providerReference,
            this.config
              .maxReferenceLength,
          ),

        providerStatus:
          bounded(
            input.providerStatus,
            128,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markProviderPending(
    input = {},
  ) {
    this.statistics
      .providerPending++;

    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.PROVIDER_PENDING,

      action:
        ACTIONS.EXECUTE,

      reason:
        input.reason ??
        'PROVIDER_PENDING',

      patch: {
        providerOutcome:
          PROVIDER_OUTCOMES.PENDING,

        providerExecutionState:
          PROVIDER_EXECUTION_STATES.PENDING,

        providerResultCategory:
          PROVIDER_RESULT_CATEGORIES.ACCEPTED_PENDING,

        providerTransactionId:
          bounded(
            input.providerTransactionId,
            this.config
              .maxTransactionIdLength,
          ),

        providerReference:
          bounded(
            input.providerReference,
            this.config
              .maxReferenceLength,
          ),

        providerStatus:
          bounded(
            input.providerStatus,
            128,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markProviderAmbiguous(
    input = {},
  ) {
    this.statistics
      .providerAmbiguous++;

    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.AMBIGUOUS,

      action:
        ACTIONS.MARK_AMBIGUOUS,

      reason:
        input.reason ??
        'PROVIDER_OUTCOME_AMBIGUOUS',

      patch: {
        providerOutcome:
          PROVIDER_OUTCOMES.AMBIGUOUS,

        providerExecutionState:
          PROVIDER_EXECUTION_STATES.AMBIGUOUS,

        providerResultCategory:
          PROVIDER_RESULT_CATEGORIES.AMBIGUOUS,

        financialExecutionState:
          'AMBIGUOUS',

        providerTransactionId:
          bounded(
            input.providerTransactionId,
            this.config
              .maxTransactionIdLength,
          ),

        providerReference:
          bounded(
            input.providerReference,
            this.config
              .maxReferenceLength,
          ),

        providerStatus:
          bounded(
            input.providerStatus,
            128,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markProviderSuccess(
    input = {},
  ) {
    this.statistics
      .providerSuccess++;

    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.SUCCESS,

      action:
        ACTIONS.MARK_SETTLED,

      reason:
        input.reason ??
        'PROVIDER_AND_FINANCIAL_CORE_CONFIRMED_SUCCESS',

      patch: {
        providerOutcome:
          PROVIDER_OUTCOMES.SUCCESS,

        providerExecutionState:
          PROVIDER_EXECUTION_STATES.SUCCESS,

        providerResultCategory:
          PROVIDER_RESULT_CATEGORIES.TERMINAL_SUCCESS,

        financialExecutionState:
          input.financialExecutionState ??
          'CONFIRMED',

        settledAt:
          input.settledAt ??
          nowDate(
            this.clock,
          ),

        providerTransactionId:
          bounded(
            input.providerTransactionId,
            this.config
              .maxTransactionIdLength,
          ),

        providerReference:
          bounded(
            input.providerReference,
            this.config
              .maxReferenceLength,
          ),

        providerStatus:
          bounded(
            input.providerStatus,
            128,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markProviderFailure(
    input = {},
  ) {
    this.statistics
      .providerFailure++;

    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.FAILED,

      action:
        ACTIONS.MARK_FAILED,

      reason:
        input.reason ??
        'PROVIDER_CONFIRMED_FAILURE',

      patch: {
        providerOutcome:
          PROVIDER_OUTCOMES.FAILURE,

        providerExecutionState:
          PROVIDER_EXECUTION_STATES.FAILURE,

        providerResultCategory:
          PROVIDER_RESULT_CATEGORIES.TERMINAL_FAILURE,

        financialExecutionState:
          input.financialExecutionState ??
          'FAILED',

        failureCode:
          bounded(
            input.failureCode ??
              input.code,
            160,
          ),

        failureReason:
          bounded(
            input.failureReason ??
              input.reason,
            this.config
              .maxReasonLength,
          ),

        providerTransactionId:
          bounded(
            input.providerTransactionId,
            this.config
              .maxTransactionIdLength,
          ),

        providerReference:
          bounded(
            input.providerReference,
            this.config
              .maxReferenceLength,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async applyProviderOutcome(
    input = {},
  ) {
    const rawOutcome =
      normalizeProviderOutcome(
        input.providerOutcome ??
          input.outcome ??
          input.status,
      );

    const category =
      normalizeOutcomeCategory(
        rawOutcome,
      );

    if (
      rawOutcome ===
      PROVIDER_OUTCOMES.SUCCESS
    ) {
      return this.markProviderSuccess({
        ...input,

        providerOutcome:
          rawOutcome,

        providerResultCategory:
          category,
      });
    }

    if (
      rawOutcome ===
      PROVIDER_OUTCOMES.FAILURE
    ) {
      return this.markProviderFailure({
        ...input,

        providerOutcome:
          rawOutcome,

        providerResultCategory:
          category,
      });
    }

    if (
      rawOutcome ===
      PROVIDER_OUTCOMES.PENDING
    ) {
      return this.markProviderPending({
        ...input,

        providerOutcome:
          rawOutcome,

        providerResultCategory:
          category,
      });
    }

    return this.markProviderAmbiguous({
      ...input,

      providerOutcome:
        PROVIDER_OUTCOMES.AMBIGUOUS,

      providerResultCategory:
        category,
    });
  }

  async markReconciliationRequired(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,

      action:
        ACTIONS.RECONCILE,

      reason:
        input.reason ??
        'RECONCILIATION_REQUIRED',

      patch: {
        reconciliationState:
          input.reconciliationState ??
          RECONCILIATION_STATES.NOT_RUN,

        reconciliationOutcome:
          input.reconciliationOutcome ??
          RECONCILIATION_OUTCOMES.AMBIGUOUS,

        reconciliationRequiredAt:
          input.reconciliationRequiredAt ??
          nowDate(
            this.clock,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markReconciling(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.RECONCILING,

      action:
        ACTIONS.RECONCILE,

      reason:
        input.reason ??
        'RECONCILIATION_STARTED',

      patch: {
        reconciliationState:
          RECONCILIATION_STATES.RUNNING,

        reconciliationStartedAt:
          input.reconciliationStartedAt ??
          nowDate(
            this.clock,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markReconciled(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.RECONCILED,

      action:
        ACTIONS.MARK_RECONCILED,

      reason:
        input.reason ??
        'RECONCILIATION_CONFIRMED',

      patch: {
        reconciliationState:
          input.reconciliationState ??
          RECONCILIATION_STATES.CONFIRMED_SUCCESS,

        reconciliationOutcome:
          input.reconciliationOutcome ??
          RECONCILIATION_OUTCOMES.MATCHED,

        reconciliationReference:
          bounded(
            input.reconciliationReference ??
              input.reference,
            this.config
              .maxReferenceLength,
          ),

        reconciledAt:
          input.reconciledAt ??
          nowDate(
            this.clock,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markReconciliationFailure(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.RECONCILED,

      action:
        ACTIONS.MARK_RECONCILED,

      reason:
        input.reason ??
        'RECONCILIATION_CONFIRMED_PROVIDER_FAILURE',

      patch: {
        reconciliationState:
          RECONCILIATION_STATES.CONFIRMED_FAILURE,

        reconciliationOutcome:
          RECONCILIATION_OUTCOMES.CONFIRMED_FAILURE,

        reconciliationReference:
          bounded(
            input.reconciliationReference ??
              input.reference,
            this.config
              .maxReferenceLength,
          ),

        reconciledAt:
          input.reconciledAt ??
          nowDate(
            this.clock,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markCompensationRequired(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.COMPENSATION_REQUIRED,

      action:
        ACTIONS.COMPENSATE,

      reason:
        input.reason ??
        'COMPENSATION_REQUIRED',

      patch: {
        compensationRequiredAt:
          input.compensationRequiredAt ??
          nowDate(
            this.clock,
          ),

        compensationType:
          input.compensationType ??
          COMPENSATION_TYPES.CORRECTION,

        compensationReasonCode:
          bounded(
            input.reasonCode ??
              input.code,
            160,
          ),

        compensationIdempotencyKey:
          bounded(
            input.compensationIdempotencyKey,
            this.config
              .maxIdempotencyKeyLength,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async beginCompensation(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.COMPENSATING,

      action:
        ACTIONS.COMPENSATE,

      reason:
        input.reason ??
        'COMPENSATION_STARTED',

      patch: {
        compensationStartedAt:
          input.compensationStartedAt ??
          nowDate(
            this.clock,
          ),

        compensationIdempotencyKey:
          bounded(
            input.compensationIdempotencyKey,
            this.config
              .maxIdempotencyKeyLength,
          ),

        compensationType:
          input.compensationType ??
          COMPENSATION_TYPES.CORRECTION,

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markCompensated(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.COMPENSATED,

      action:
        ACTIONS.COMPENSATE,

      reason:
        input.reason ??
        'COMPENSATION_COMPLETED',

      patch: {
        compensationCompletedAt:
          input.compensationCompletedAt ??
          nowDate(
            this.clock,
          ),

        compensationOutcome:
          input.compensationOutcome ??
          'COMPLETED',

        compensationIdempotencyKey:
          bounded(
            input.compensationIdempotencyKey,
            this.config
              .maxIdempotencyKeyLength,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markRefundRequired(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.REFUND_REQUIRED,

      action:
        ACTIONS.COMPENSATE,

      reason:
        input.reason ??
        'REFUND_REQUIRED',

      patch: {
        refundRequiredAt:
          input.refundRequiredAt ??
          nowDate(
            this.clock,
          ),

        refundReasonCode:
          bounded(
            input.reasonCode ??
              input.code,
            160,
          ),

        refundIdempotencyKey:
          bounded(
            input.refundIdempotencyKey ??
              input.compensationIdempotencyKey,
            this.config
              .maxIdempotencyKeyLength,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async beginRefund(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.REFUNDING,

      action:
        ACTIONS.COMPENSATE,

      reason:
        input.reason ??
        'REFUND_STARTED',

      patch: {
        refundStartedAt:
          input.refundStartedAt ??
          nowDate(
            this.clock,
          ),

        refundIdempotencyKey:
          bounded(
            input.refundIdempotencyKey ??
              input.compensationIdempotencyKey,
            this.config
              .maxIdempotencyKeyLength,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async markRefunded(
    input = {},
  ) {
    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.REFUNDED,

      action:
        ACTIONS.COMPENSATE,

      reason:
        input.reason ??
        'REFUND_COMPLETED',

      patch: {
        refundCompletedAt:
          input.refundCompletedAt ??
          nowDate(
            this.clock,
          ),

        refundOutcome:
          input.refundOutcome ??
          'COMPLETED',

        refundIdempotencyKey:
          bounded(
            input.refundIdempotencyKey ??
              input.compensationIdempotencyKey,
            this.config
              .maxIdempotencyKeyLength,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async reverse(
    input = {},
  ) {
    const compensationKey =
      bounded(
        input.compensationIdempotencyKey ??
          input.reversalIdempotencyKey ??
          input.compensationKey,
        this.config
          .maxIdempotencyKeyLength,
      );

    if (
      !compensationKey
    ) {
      this.#throw(
        'STATE_MACHINE_REVERSAL_IDEMPOTENCY_REQUIRED',
        'A distinct reversal/compensation idempotency key is required.',
        {},
        {
          httpStatus:
            422,
        },
      );
    }

    const originalKey =
      bounded(
        input.originalIdempotencyKey ??
          input.idempotencyKey,
        this.config
          .maxIdempotencyKeyLength,
      );

    if (
      originalKey &&
      originalKey ===
        compensationKey
    ) {
      this.#throw(
        'STATE_MACHINE_REVERSAL_IDENTITY_COLLISION',
        'Reversal idempotency identity must be distinct from the originating financial identity.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    return this.transition({
      ...input,

      originalIdempotencyKey:
        originalKey,

      compensationIdempotencyKey:
        compensationKey,

      toState:
        DISBURSEMENT_STATES.REVERSED,

      action:
        ACTIONS.REVERSE ??
        'REVERSE',

      reason:
        input.reason ??
        'DISBURSEMENT_REVERSED',

      requireOriginalIdempotencyKey:
        Boolean(
          originalKey,
        ),

      patch: {
        reversalCompletedAt:
          input.reversalCompletedAt ??
          nowDate(
            this.clock,
          ),

        reversalIdempotencyKey:
          compensationKey,

        originalIdempotencyKey:
          originalKey,

        reversalReason:
          bounded(
            input.reason ??
              input.reasonCode,
            this.config
              .maxReasonLength,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  reverseDisbursement(
    input = {},
  ) {
    return this.reverse(
      input,
    );
  }

  async cancel(
    input = {},
  ) {
    const context =
      this.#requireContext(
        input,
        {
          requireExpectedVersion:
            true,

          requireExpectedFingerprint:
            true,

          requireOriginalIdempotencyKey:
            false,
        },
      );

    const record =
      input.record
        ? clone(
            input.record,
          )
        : await this.#findRecord(
            {
              ...context,

              session:
                input.session,
            },
          );

    this.#assertRecordScope(
      record,
      context,
    );

    this.#assertIdentityGuards(
      record,
      context,
    );

    const state =
      upper(
        record.state ??
          record.status,
      );

    if (
      [
        DISBURSEMENT_STATES.EXECUTING,
        DISBURSEMENT_STATES.PROVIDER_ACCEPTED,
        DISBURSEMENT_STATES.PROVIDER_PENDING,
        DISBURSEMENT_STATES.SUCCESS,
        DISBURSEMENT_STATES.AMBIGUOUS,
      ].includes(state)
    ) {
      this.#throw(
        ERROR_CODES.INVALID_STATE_TRANSITION ??
          'STATE_MACHINE_CANCEL_NOT_SAFE',
        'A disbursement with provider or financial activity cannot be cancelled through the normal cancellation path.',
        {
          state,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    const reason =
      bounded(
        input.reason ??
          input.reasonCode,
        this.config
          .maxReasonLength,
      );

    if (!reason) {
      this.#throw(
        'STATE_MACHINE_CANCELLATION_REASON_REQUIRED',
        'A cancellation reason is required.',
        {},
        {
          httpStatus:
            422,
        },
      );
    }

    this.statistics
      .cancellations++;

    return this.transition({
      ...input,

      record,

      tenantId:
        context.tenantId,

      disbursementId:
        context.disbursementId,

      expectedVersion:
        context.expectedVersion,

      expectedFingerprint:
        context.expectedFingerprint,

      toState:
        DISBURSEMENT_STATES.CANCELLED,

      action:
        ACTIONS.CANCEL,

      reason,

      patch: {
        cancellationReason:
          reason,

        cancelledAt:
          nowDate(
            this.clock,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async expire(
    input = {},
  ) {
    const reason =
      bounded(
        input.reason ??
          'DISBURSEMENT_EXPIRED',
        this.config
          .maxReasonLength,
      );

    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.EXPIRED,

      action:
        ACTIONS.CANCEL,

      reason,

      patch: {
        expiredAt:
          input.expiredAt ??
          nowDate(
            this.clock,
          ),

        expirationReason:
          reason,

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async reject(
    input = {},
  ) {
    const reason =
      bounded(
        input.reason ??
          input.reasonCode,
        this.config
          .maxReasonLength,
      );

    if (!reason) {
      this.#throw(
        'STATE_MACHINE_REJECTION_REASON_REQUIRED',
        'A rejection reason is required.',
        {},
        {
          httpStatus:
            422,
        },
      );
    }

    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.REJECTED,

      action:
        ACTIONS.REJECT,

      reason,

      patch: {
        rejectionReason:
          reason,

        rejectedAt:
          input.rejectedAt ??
          nowDate(
            this.clock,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async escalate(
    input = {},
  ) {
    const reason =
      bounded(
        input.reason ??
          input.reasonCode,
        this.config
          .maxReasonLength,
      ) ??
      'DISBURSEMENT_ESCALATED';

    this.statistics
      .escalations++;

    return this.transition({
      ...input,

      toState:
        DISBURSEMENT_STATES.ESCALATED,

      action:
        ACTIONS.ESCALATE,

      reason,

      patch: {
        escalatedAt:
          input.escalatedAt ??
          nowDate(
            this.clock,
          ),

        escalationReason:
          reason,

        escalationPriority:
          upper(
            input.priority,
          ),

        ...(
          input.patch ??
          {}
        ),
      },
    });
  }

  async requireStatusCheck(
    input = {},
  ) {
    const context =
      this.#requireContext(
        input,
        {
          requireExpectedVersion:
            false,

          requireExpectedFingerprint:
            false,

          requireOriginalIdempotencyKey:
            false,
        },
      );

    const record =
      input.record
        ? clone(
            input.record,
          )
        : await this.#findRecord(
            context,
          );

    this.#assertRecordScope(
      record,
      context,
    );

    const state =
      upper(
        record.state ??
          record.status,
      );

    return {
      outcome:
        STATE_MACHINE_OUTCOMES.REQUIRES_STATUS_CHECK,

      code:
        'STATUS_CHECK_REQUIRED',

      nextAction:
        RETRY_DECISIONS.STATUS_CHECK,

      tenantId:
        context.tenantId,

      disbursementId:
        context.disbursementId,

      state,

      providerOutcome:
        normalizeProviderOutcome(
          record.providerOutcome,
        ),

      providerResultCategory:
        normalizeOutcomeCategory(
          record.providerOutcome,
        ),
    };
  }

  async assertExecutionReady(
    input = {},
  ) {
    const context =
      this.#requireContext(
        input,
        {
          requireExpectedVersion:
            false,

          requireExpectedFingerprint:
            false,

          requireOriginalIdempotencyKey:
            false,
        },
      );

    const record =
      input.record
        ? clone(
            input.record,
          )
        : await this.#findRecord(
            context,
          );

    this.#assertRecordScope(
      record,
      context,
    );

    const state =
      upper(
        record.state ??
          record.status,
      );

    if (
      state ===
      DISBURSEMENT_STATES.SUCCESS
    ) {
      return {
        executable:
          false,

        outcome:
          STATE_MACHINE_OUTCOMES.IDEMPOTENT,

        code:
          'DISBURSEMENT_ALREADY_SETTLED',

        state,

        record,
      };
    }

    if (
      NON_RETRYABLE_UNCERTAIN_STATES.includes(
        state,
      )
    ) {
      return {
        executable:
          false,

        outcome:
          STATE_MACHINE_OUTCOMES.REQUIRES_STATUS_CHECK,

        code:
          'DISBURSEMENT_REQUIRES_STATUS_OR_RECONCILIATION',

        nextAction:
          state.includes(
            'RECONCILIATION',
          )
            ? RETRY_DECISIONS.RECONCILE
            : RETRY_DECISIONS.STATUS_CHECK,

        state,

        record,
      };
    }

    if (
      EXECUTABLE_STATES.includes(
        state,
      )
    ) {
      return {
        executable:
          true,

        outcome:
          'EXECUTABLE',

        state,

        record,
      };
    }

    return {
      executable:
        false,

      outcome:
        STATE_MACHINE_OUTCOMES.REQUIRES_REVIEW,

      code:
        'DISBURSEMENT_NOT_EXECUTABLE_FROM_STATE',

      nextAction:
        RETRY_DECISIONS.REVIEW,

      state,

      record,
    };
  }

  isTerminal(
    state,
  ) {
    return isTerminalStateLocal(
      state,
    );
  }

  isActive(
    state,
  ) {
    return isActiveState(
      state,
    );
  }

  isKnownState(
    state,
  ) {
    return isKnownState(
      state,
    );
  }

  allowedTransitions(
    state,
    {
      action = undefined,
    } = {},
  ) {
    const normalized =
      upper(state);

    const canonical =
      CANONICAL_TRANSITIONS
        .map[normalized] ??
      [];

    if (
      !action
    ) {
      return Object.freeze([
        ...canonical,
      ]);
    }

    const compatible =
      COMPATIBILITY_ACTION_TRANSITIONS[
        upper(action)
      ]?.[
        normalized
      ];

    return Object.freeze([
      ...new Set([
        ...canonical,

        ...(compatible
          ? [
              compatible,
            ]
          : []),
      ]),
    ]);
  }

  classifyProviderOutcome(
    value,
  ) {
    const outcome =
      normalizeProviderOutcome(
        value,
      );

    return Object.freeze({
      outcome,

      category:
        normalizeOutcomeCategory(
          outcome,
        ),

      ambiguous:
        new Set(
          AMBIGUOUS_PROVIDER_OUTCOMES ??
            [],
        ).has(
          outcome,
        ) ||
        outcome ===
          PROVIDER_OUTCOMES.PENDING,

      requiresStatusCheck:
        outcome ===
          PROVIDER_OUTCOMES.PENDING ||
        outcome ===
          PROVIDER_OUTCOMES.AMBIGUOUS ||
        outcome ===
          PROVIDER_OUTCOMES.UNKNOWN,
    });
  }

  transitionFingerprint(
    input = {},
  ) {
    return buildTransitionFingerprint(
      input,
    );
  }

  validateRecord(
    record,
  ) {
    const findings =
      [];

    if (
      !isPlainObject(
        record,
      )
    ) {
      findings.push({
        code:
          'RECORD_NOT_OBJECT',

        severity:
          'HIGH',
      });

      return {
        valid:
          false,

        findings,
      };
    }

    if (
      !record.tenantId
    ) {
      findings.push({
        code:
          'TENANT_ID_MISSING',

        severity:
          'CRITICAL',
      });
    }

    if (
      upper(
        record.provider,
      ) !==
        PROVIDER
    ) {
      findings.push({
        code:
          'PROVIDER_SCOPE_INVALID',

        severity:
          'CRITICAL',
      });
    }

    if (
      upper(
        record.operation,
      ) !==
        OPERATION
    ) {
      findings.push({
        code:
          'OPERATION_SCOPE_INVALID',

        severity:
          'CRITICAL',
      });
    }

    const state =
      upper(
        record.state ??
          record.status,
      );

    if (
      !isKnownState(
        state,
      )
    ) {
      findings.push({
        code:
          'STATE_INVALID',

        severity:
          'CRITICAL',
      });
    }

    const version =
      normalizeExpectedVersion(
        record.version,
      );

    if (
      version === undefined
    ) {
      findings.push({
        code:
          'VERSION_INVALID',

        severity:
          'HIGH',
      });
    }

    if (
      this.config
        .requireOriginalIdempotencyKeyForFinancialMutation &&
      !record.originalIdempotencyKey
    ) {
      findings.push({
        code:
          'ORIGINAL_IDEMPOTENCY_KEY_MISSING',

        severity:
          'HIGH',
      });
    }

    if (
      NON_RETRYABLE_UNCERTAIN_STATES.includes(
        state,
      )
    ) {
      const outcome =
        normalizeProviderOutcome(
          record.providerOutcome,
        );

      if (
        outcome ===
          PROVIDER_OUTCOMES.SUCCESS &&
        state ===
          DISBURSEMENT_STATES.AMBIGUOUS
      ) {
        findings.push({
          code:
            'SUCCESS_OUTCOME_IN_AMBIGUOUS_STATE',

          severity:
            'HIGH',
        });
      }
    }

    return {
      valid:
        findings.length === 0,

      findings,
    };
  }

  validateDependencies() {
    if (
      !this.repository
    ) {
      this.#throw(
        'STATE_MACHINE_REPOSITORY_REQUIRED',
        'Repository dependency is required.',
        {},
        {
          httpStatus:
            500,
        },
      );
    }

    const lookup =
      this.#repoMethod(
        'findByIdForTenant',
        'findByDisbursementIdForTenant',
        'findOneForTenant',
        'findById',
        'getById',
        'getDisbursement',
        'findDisbursementById',
      );

    const atomic =
      this.#repoMethod(
        'transitionDisbursement',
        'atomicTransition',
        'compareAndSetTransition',
        'transition',
        'compareAndSetStatus',
      );

    if (
      !lookup
    ) {
      this.#throw(
        'STATE_MACHINE_LOOKUP_METHOD_REQUIRED',
        'A tenant-scoped disbursement lookup method is required.',
        {},
        {
          httpStatus:
            500,
        },
      );
    }

    if (
      this.config
        .requireAtomicTransition &&
      !atomic
    ) {
      this.#throw(
        'STATE_MACHINE_ATOMIC_TRANSITION_REQUIRED',
        'An atomic repository transition method is required by configuration.',
        {},
        {
          httpStatus:
            500,
        },
      );
    }

    return {
      lookup:
        true,

      atomicTransition:
        Boolean(
          atomic,
        ),

      healthy:
        Boolean(
          lookup &&
          (
            atomic ||
            !this.config
              .requireAtomicTransition
          ),
        ),
    };
  }

  health() {
    const lookup =
      Boolean(
        this.#repoMethod(
          'findByIdForTenant',
          'findByDisbursementIdForTenant',
          'findOneForTenant',
          'findById',
          'getById',
          'getDisbursement',
          'findDisbursementById',
        ),
      );

    const atomic =
      Boolean(
        this.#repoMethod(
          'transitionDisbursement',
          'atomicTransition',
          'compareAndSetTransition',
          'transition',
          'compareAndSetStatus',
        ),
      );

    const healthy =
      Boolean(
        this.repository &&
        lookup &&
        (
          atomic ||
          !this.config
            .requireAtomicTransition
        ),
      );

    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      healthy,

      status:
        healthy
          ? 'UP'
          : 'DEGRADED',

      dependencies: {
        repository:
          Boolean(
            this.repository,
          ),

        lookup,

        atomicTransition:
          atomic,

        audit:
          Boolean(
            this.auditService,
          ),

        eventBus:
          Boolean(
            this.eventBus,
          ),
      },

      controls: {
        tenantIsolation:
          this.config
            .requireTenantId,

        expectedVersion:
          this.config
            .requireExpectedVersionForMutation,

        expectedFingerprint:
          this.config
            .requireExpectedFingerprintForMutation,

        originalIdempotency:
          this.config
            .requireOriginalIdempotencyKeyForFinancialMutation,

        atomicTransition:
          this.config
            .requireAtomicTransition,

        atomicExecutionClaim:
          this.config
            .requireAtomicExecutionClaim,

        retryRearmCompatibility:
          this.config
            .allowCompatibilityRetryRearm,

        reversalCompatibility:
          this.config
            .allowCompatibilityReversalTransition,

        ambiguousOutcomeStatusGate:
          true,

        directLedgerMutation:
          false,

        directBalanceMutation:
          false,

        directProviderCall:
          false,
      },

      transitionWarnings:
        CANONICAL_TRANSITION_WARNINGS,

      statistics:
        this.statistics,
    };
  }

  readiness() {
    return this.health();
  }

  capabilities() {
    return Object.freeze({
      tenantScoped:
        true,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      canonicalStateVocabulary:
        true,

      deterministicTransitionFingerprint:
        true,

      optimisticConcurrency:
        true,

      atomicClaim:
        true,

      retryPreservesOriginalFinancialIdentity:
        true,

      ambiguousOutcomeBlocksBlindRetry:
        true,

      reconciliationFirstForAmbiguity:
        true,

      directProviderCall:
        false,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      directWalletMutation:
        false,

      financialFinalityAuthority:
        false,

      compensationCreatesNewFinancialIdentity:
        true,

      compatibilityRetryRearm:
        this.config
          .allowCompatibilityRetryRearm,

      compatibilityReversal:
        this.config
          .allowCompatibilityReversalTransition,
    });
  }

  diagnostics() {
    return Object.freeze({
      component:
        COMPONENT,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      health:
        this.health(),

      capabilities:
        this.capabilities(),

      states: {
        all:
          Object.values(
            DISBURSEMENT_STATES,
          ),

        terminal:
          [
            ...TERMINAL_DISBURSEMENT_STATES,
          ],

        active:
          [
            ...ACTIVE_DISBURSEMENT_STATES,
          ],

        executable:
          [
            ...EXECUTABLE_STATES,
          ],
      },

      transitions: {
        canonical:
          CANONICAL_TRANSITIONS.map,

        effective:
          EFFECTIVE_TRANSITION_MAP,

        actionScopedCompatibility:
          ACTION_TRANSITIONS,

        warnings:
          CANONICAL_TRANSITION_WARNINGS,
      },

      financialSafety: {
        writesLedger:
          false,

        mutatesBalance:
          false,

        mutatesWallet:
          false,

        callsProvider:
          false,

        authoritativeBoundary:
          'TITECH_FINANCIAL_CORE',

        stateMachineIsNotSettlementAuthority:
          true,
      },
    });
  }

  statisticsSnapshot() {
    return {
      ...this.statistics,
    };
  }

  resetStatistics() {
    for (
      const key of Object.keys(
        this.statistics,
      )
    ) {
      this.statistics[key] =
        0;
    }

    return this.statisticsSnapshot();
  }
}

export const createTransactionStateMachine =
  (
    options = {},
  ) =>
    new AirtelTransactionStateMachine(
      options,
    );

export const createAirtelTransactionStateMachine =
  createTransactionStateMachine;

export const createAirtelDisbursementTransactionStateMachine =
  createTransactionStateMachine;

export const TransactionStateMachine =
  AirtelTransactionStateMachine;

export const AirtelDisbursementStateMachine =
  AirtelTransactionStateMachine;

export const defaultTransactionStateMachine =
  createTransactionStateMachine();

export const transactionStateMachine =
  defaultTransactionStateMachine;

export const canTransition = (
  fromState,
  toState,
  options = {},
) =>
  defaultTransactionStateMachine.canTransition(
    fromState,
    toState,
    options,
  );

export const isTerminalState = (
  state,
) =>
  isTerminalStateLocal(
    state,
  );

export const isActiveTransactionState = (
  state,
) =>
  isActiveState(
    state,
  );

export const buildStateTransitionFingerprint =
  buildTransitionFingerprint;

export default AirtelTransactionStateMachine;