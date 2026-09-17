'use strict';

/**
 * TITech Community Capital LTD
 * Enterprise Settlement State Machine
 *
 * File:
 *   backend/modules/payment/settlement/settlementStateMachine.js
 *
 * Architectural Role
 * ------------------
 * Canonical lifecycle/state-transition authority for payment settlements.
 *
 * This module defines which settlement states are valid and which transitions
 * are permitted. It provides deterministic transition validation without
 * performing persistence, ledger posting, balance mutation, provider calls,
 * reconciliation, or external side effects.
 *
 * Responsibilities
 * ----------------
 * - Define canonical settlement lifecycle states.
 * - Define explicit legal state transitions.
 * - Validate transition requests.
 * - Prevent illegal state regression.
 * - Protect terminal financial states.
 * - Validate transition metadata and reasons where required.
 * - Expose deterministic transition helpers for services/repositories/workers.
 * - Provide transition history metadata suitable for audit/outbox workflows.
 *
 * Explicit Non-Responsibilities
 * -----------------------------
 * - Does not mutate MongoDB.
 * - Does not update balances.
 * - Does not post ledger entries.
 * - Does not initiate or confirm provider payments.
 * - Does not perform reconciliation.
 * - Does not perform authorization.
 * - Does not write audit records directly.
 * - Does not publish events directly.
 *
 * Financial Safety Principle
 * --------------------------
 * State transitions describe financial lifecycle state. A transition into
 * SETTLED is only valid when the caller has already established the financial
 * conditions required by the domain:
 *
 *   provider evidence
 *        +
 *   validation
 *        +
 *   reconciliation
 *        +
 *   authoritative financial posting
 *        ↓
 *      SETTLED
 *
 * Therefore this state machine MUST NOT be used as proof that money settled.
 * The authoritative financial service and reconciliation layer remain
 * responsible for establishing that fact.
 *
 * Module Format
 * -------------
 * CommonJS.
 */

const crypto = require('crypto');

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const STATES = Object.freeze({
  RECEIVED: 'RECEIVED',
  VALIDATING: 'VALIDATING',
  PROCESSING: 'PROCESSING',
  POSTED: 'POSTED',
  SETTLED: 'SETTLED',

  FAILED: 'FAILED',
  REVERSED: 'REVERSED',

  /*
   * Operationally important states required by the enterprise settlement
   * lifecycle. They allow the system to represent uncertainty explicitly
   * rather than incorrectly collapsing everything into FAILED or SETTLED.
   */
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  DISPUTED: 'DISPUTED',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW'
});

const TERMINAL_STATES = Object.freeze([
  STATES.SETTLED,
  STATES.FAILED,
  STATES.REVERSED,
  STATES.CANCELLED
]);

const RECOVERABLE_STATES = Object.freeze([
  STATES.RECEIVED,
  STATES.VALIDATING,
  STATES.PROCESSING,
  STATES.POSTED,
  STATES.TIMEOUT,
  STATES.REQUIRES_RECONCILIATION,
  STATES.REQUIRES_REVIEW,
  STATES.DISPUTED
]);

const TRANSITIONS = Object.freeze({
  [STATES.RECEIVED]: Object.freeze([
    STATES.VALIDATING,
    STATES.CANCELLED
  ]),

  [STATES.VALIDATING]: Object.freeze([
    STATES.PROCESSING,
    STATES.FAILED,
    STATES.REQUIRES_REVIEW,
    STATES.CANCELLED
  ]),

  [STATES.PROCESSING]: Object.freeze([
    STATES.POSTED,
    STATES.FAILED,
    STATES.TIMEOUT,
    STATES.REQUIRES_RECONCILIATION,
    STATES.REQUIRES_REVIEW,
    STATES.CANCELLED
  ]),

  [STATES.POSTED]: Object.freeze([
    STATES.SETTLED,
    STATES.FAILED,
    STATES.TIMEOUT,
    STATES.REQUIRES_RECONCILIATION,
    STATES.REQUIRES_REVIEW,
    STATES.DISPUTED
  ]),

  /*
   * A settled transaction cannot be silently edited into another normal
   * lifecycle state. Corrective financial behavior must use explicit
   * reversal/dispute workflows.
   */
  [STATES.SETTLED]: Object.freeze([
    STATES.REVERSED,
    STATES.DISPUTED
  ]),

  [STATES.FAILED]: Object.freeze([
    STATES.REVERSED
  ]),

  [STATES.REVERSED]: Object.freeze([]),

  [STATES.TIMEOUT]: Object.freeze([
    STATES.PROCESSING,
    STATES.POSTED,
    STATES.REQUIRES_RECONCILIATION,
    STATES.REQUIRES_REVIEW,
    STATES.FAILED,
    STATES.CANCELLED
  ]),

  [STATES.CANCELLED]: Object.freeze([]),

  [STATES.DISPUTED]: Object.freeze([
    STATES.REQUIRES_REVIEW,
    STATES.REVERSED
  ]),

  [STATES.REQUIRES_RECONCILIATION]: Object.freeze([
    STATES.PROCESSING,
    STATES.POSTED,
    STATES.REQUIRES_REVIEW,
    STATES.SETTLED,
    STATES.REVERSED
  ]),

  [STATES.REQUIRES_REVIEW]: Object.freeze([
    STATES.VALIDATING,
    STATES.PROCESSING,
    STATES.POSTED,
    STATES.REQUIRES_RECONCILIATION,
    STATES.SETTLED,
    STATES.FAILED,
    STATES.CANCELLED,
    STATES.REVERSED
  ])
});

const EVENTS = Object.freeze({
  CREATED: 'SETTLEMENT_CREATED',
  VALIDATION_STARTED: 'SETTLEMENT_VALIDATION_STARTED',
  PROCESSING_STARTED: 'SETTLEMENT_PROCESSING_STARTED',
  POSTED: 'SETTLEMENT_POSTED',
  SETTLED: 'SETTLEMENT_SETTLED',
  FAILED: 'SETTLEMENT_FAILED',
  REVERSED: 'SETTLEMENT_REVERSED',
  TIMEOUT: 'SETTLEMENT_TIMEOUT',
  CANCELLED: 'SETTLEMENT_CANCELLED',
  DISPUTED: 'SETTLEMENT_DISPUTED',
  RECONCILIATION_REQUIRED:
    'SETTLEMENT_RECONCILIATION_REQUIRED',
  REVIEW_REQUIRED:
    'SETTLEMENT_REVIEW_REQUIRED'
});

const REQUIRED_REASONS = new Set([
  STATES.FAILED,
  STATES.REVERSED,
  STATES.CANCELLED,
  STATES.TIMEOUT,
  STATES.DISPUTED,
  STATES.REQUIRES_RECONCILIATION,
  STATES.REQUIRES_REVIEW
]);

const MAX_REASON_LENGTH = 2000;
const MAX_ACTOR_ID_LENGTH = 256;
const MAX_OPERATION_ID_LENGTH = 256;

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

class SettlementStateTransitionError extends Error {
  constructor(
    message,
    code = 'INVALID_SETTLEMENT_TRANSITION',
    details = undefined
  ) {
    super(message);

    this.name = 'SettlementStateTransitionError';
    this.code = code;

    if (details !== undefined) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        SettlementStateTransitionError
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Normalize identifiers while preserving their business meaning.
 *
 * @param {*} value
 * @param {number} [maxLength]
 * @returns {string|undefined}
 */
function normalizeId(
  value,
  maxLength = MAX_OPERATION_ID_LENGTH
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  const normalized =
    typeof value === 'object' &&
    typeof value.toString === 'function'
      ? value.toString()
      : String(value);

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

/**
 * Normalize a reason.
 *
 * @param {*} value
 * @returns {string|undefined}
 */
function normalizeReason(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const reason = String(value).trim();

  if (!reason) {
    return undefined;
  }

  return reason.length > MAX_REASON_LENGTH
    ? reason.slice(0, MAX_REASON_LENGTH)
    : reason;
}

/**
 * Normalize a state name.
 *
 * @param {*} state
 * @returns {string|undefined}
 */
function normalizeState(state) {
  if (
    state === undefined ||
    state === null
  ) {
    return undefined;
  }

  const normalized =
    String(state)
      .trim()
      .toUpperCase();

  return normalized || undefined;
}

/**
 * Generate a transition operation identifier.
 *
 * @returns {string}
 */
function createOperationId() {
  return `transition_${crypto.randomUUID()}`;
}

/**
 * Return whether a state is known.
 *
 * @param {*} state
 * @returns {boolean}
 */
function isKnownState(state) {
  return Object.prototype.hasOwnProperty.call(
    STATES,
    String(state || '')
  );
}

/**
 * Return whether a state is terminal.
 *
 * @param {*} state
 * @returns {boolean}
 */
function isTerminal(state) {
  const normalized = normalizeState(state);

  return TERMINAL_STATES.includes(
    normalized
  );
}

/**
 * Return whether a state can be recovered/processed further.
 *
 * @param {*} state
 * @returns {boolean}
 */
function isRecoverable(state) {
  const normalized = normalizeState(state);

  return RECOVERABLE_STATES.includes(
    normalized
  );
}

/**
 * Return permitted target states.
 *
 * @param {*} from
 * @returns {string[]}
 */
function allowedTransitions(from) {
  const normalized = normalizeState(from);

  if (!normalized) {
    return [];
  }

  return Array.from(
    TRANSITIONS[normalized] || []
  );
}

/**
 * Determine whether a transition is explicitly permitted.
 *
 * @param {*} from
 * @param {*} to
 * @returns {boolean}
 */
function canTransition(from, to) {
  const source = normalizeState(from);
  const target = normalizeState(to);

  if (
    !source ||
    !target ||
    !isKnownState(source) ||
    !isKnownState(target)
  ) {
    return false;
  }

  return TRANSITIONS[source]?.includes(
    target
  ) === true;
}

/**
 * Determine canonical event for target state.
 *
 * @param {string} target
 * @returns {string}
 */
function eventForTarget(target) {
  switch (normalizeState(target)) {
    case STATES.VALIDATING:
      return EVENTS.VALIDATION_STARTED;

    case STATES.PROCESSING:
      return EVENTS.PROCESSING_STARTED;

    case STATES.POSTED:
      return EVENTS.POSTED;

    case STATES.SETTLED:
      return EVENTS.SETTLED;

    case STATES.FAILED:
      return EVENTS.FAILED;

    case STATES.REVERSED:
      return EVENTS.REVERSED;

    case STATES.TIMEOUT:
      return EVENTS.TIMEOUT;

    case STATES.CANCELLED:
      return EVENTS.CANCELLED;

    case STATES.DISPUTED:
      return EVENTS.DISPUTED;

    case STATES.REQUIRES_RECONCILIATION:
      return EVENTS.RECONCILIATION_REQUIRED;

    case STATES.REQUIRES_REVIEW:
      return EVENTS.REVIEW_REQUIRED;

    default:
      return undefined;
  }
}

/**
 * Validate transition context.
 *
 * @param {object} context
 * @param {string} target
 */
function validateContext(
  context = {},
  target
) {
  const normalizedTarget =
    normalizeState(target);

  const reason =
    normalizeReason(
      context.reason
    );

  if (
    REQUIRED_REASONS.has(
      normalizedTarget
    ) &&
    !reason
  ) {
    throw new SettlementStateTransitionError(
      `A reason is required when transitioning to ${normalizedTarget}.`,
      'TRANSITION_REASON_REQUIRED',
      {
        target:
          normalizedTarget
      }
    );
  }

  const actorId =
    normalizeId(
      context.actorId,
      MAX_ACTOR_ID_LENGTH
    );

  const operationId =
    normalizeId(
      context.operationId ||
        context.requestId ||
        context.idempotencyKey,
      MAX_OPERATION_ID_LENGTH
    );

  return {
    reason,
    actorId,
    operationId,
    correlationId:
      normalizeId(
        context.correlationId
      ),
    requestId:
      normalizeId(
        context.requestId
      ),
    actorType:
      context.actorType
        ? String(
            context.actorType
          ).trim()
        : undefined,
    source:
      context.source
        ? String(
            context.source
          ).trim()
        : undefined
  };
}

/**
 * Resolve a semantic transition error.
 *
 * @param {string} from
 * @param {string} to
 * @returns {SettlementStateTransitionError}
 */
function createTransitionError(
  from,
  to
) {
  const source =
    normalizeState(from);

  const target =
    normalizeState(to);

  if (!source) {
    return new SettlementStateTransitionError(
      'Current settlement state is required.',
      'CURRENT_STATE_REQUIRED'
    );
  }

  if (!target) {
    return new SettlementStateTransitionError(
      'Target settlement state is required.',
      'TARGET_STATE_REQUIRED'
    );
  }

  if (!isKnownState(source)) {
    return new SettlementStateTransitionError(
      `Unknown settlement state: ${source}.`,
      'UNKNOWN_CURRENT_STATE',
      {
        from: source,
        to: target
      }
    );
  }

  if (!isKnownState(target)) {
    return new SettlementStateTransitionError(
      `Unknown settlement target state: ${target}.`,
      'UNKNOWN_TARGET_STATE',
      {
        from: source,
        to: target
      }
    );
  }

  if (
    source ===
    target
  ) {
    return new SettlementStateTransitionError(
      `Settlement is already in state ${source}.`,
      'NO_STATE_CHANGE',
      {
        from: source,
        to: target
      }
    );
  }

  if (
    isTerminal(source) &&
    !canTransition(
      source,
      target
    )
  ) {
    return new SettlementStateTransitionError(
      `Terminal settlement state ${source} cannot transition to ${target}.`,
      'TERMINAL_STATE_IMMUTABLE',
      {
        from: source,
        to: target
      }
    );
  }

  return new SettlementStateTransitionError(
    `Invalid settlement transition ${source} -> ${target}.`,
    'INVALID_SETTLEMENT_TRANSITION',
    {
      from: source,
      to: target,
      allowed:
        allowedTransitions(source)
    }
  );
}

/* -------------------------------------------------------------------------- */
/* State machine                                                              */
/* -------------------------------------------------------------------------- */

class SettlementStateMachine {
  /**
   * Return whether a transition is valid.
   *
   * @param {string} from
   * @param {string} to
   * @returns {boolean}
   */
  canTransition(
    from,
    to
  ) {
    return canTransition(
      from,
      to
    );
  }

  /**
   * Return permitted transitions from a state.
   *
   * @param {string} from
   * @returns {string[]}
   */
  allowedTransitions(
    from
  ) {
    return allowedTransitions(
      from
    );
  }

  /**
   * Return whether a state is known.
   *
   * @param {string} state
   * @returns {boolean}
   */
  isKnownState(
    state
  ) {
    return isKnownState(
      normalizeState(state)
    );
  }

  /**
   * Return whether the supplied state is terminal.
   *
   * @param {string} state
   * @returns {boolean}
   */
  isTerminal(
    state
  ) {
    return isTerminal(
      state
    );
  }

  /**
   * Return whether the state is recoverable.
   *
   * @param {string} state
   * @returns {boolean}
   */
  isRecoverable(
    state
  ) {
    return isRecoverable(
      state
    );
  }

  /**
   * Validate a transition without mutating anything.
   *
   * @param {string} from
   * @param {string} to
   * @param {object} [context]
   * @returns {object}
   */
  validate(
    from,
    to,
    context = {}
  ) {
    const source =
      normalizeState(from);

    const target =
      normalizeState(to);

    if (
      !canTransition(
        source,
        target
      )
    ) {
      throw createTransitionError(
        source,
        target
      );
    }

    const normalizedContext =
      validateContext(
        context,
        target
      );

    return Object.freeze({
      valid: true,
      from: source,
      to: target,
      event:
        eventForTarget(target),
      terminal:
        isTerminal(target),
      recoverable:
        isRecoverable(target),
      context:
        normalizedContext
    });
  }

  /**
   * Execute a pure state transition.
   *
   * This function does NOT persist anything. The returned object is intended
   * to be persisted by the settlement repository using an atomic
   * expected-state compare-and-set operation.
   *
   * @param {object} settlement
   * @param {string} next
   * @param {object} [context]
   * @returns {object}
   */
  transition(
    settlement,
    next,
    context = {}
  ) {
    if (
      !settlement ||
      typeof settlement !==
        'object'
    ) {
      throw new SettlementStateTransitionError(
        'Settlement object is required.',
        'SETTLEMENT_REQUIRED'
      );
    }

    const current =
      normalizeState(
        settlement.status
      );

    const target =
      normalizeState(next);

    const validation =
      this.validate(
        current,
        target,
        context
      );

    const operationId =
      validation.context
        .operationId ||
      createOperationId();

    const changedAt =
      context.now
        ? new Date(
            context.now
          )
        : new Date();

    if (
      Number.isNaN(
        changedAt.getTime()
      )
    ) {
      throw new SettlementStateTransitionError(
        'Invalid transition timestamp.',
        'INVALID_TRANSITION_TIMESTAMP'
      );
    }

    /*
     * Preserve the existing settlement shape and add a non-destructive
     * transition metadata block.
     *
     * No database write occurs here.
     */
    const updated = {
      ...settlement,

      status:
        target,

      updatedAt:
        changedAt,

      stateTransition: {
        operationId,

        from:
          current,

        to:
          target,

        event:
          validation.event,

        changedAt,

        reason:
          validation.context
            .reason,

        actorId:
          validation.context
            .actorId,

        actorType:
          validation.context
            .actorType,

        correlationId:
          validation.context
            .correlationId,

        requestId:
          validation.context
            .requestId,

        source:
          validation.context
            .source
      }
    };

    /*
     * Remove undefined transition metadata fields so strict schemas and
     * downstream serializers do not receive accidental undefined properties.
     */
    for (
      const [key, value] of Object.entries(
        updated.stateTransition
      )
    ) {
      if (
        value ===
        undefined
      ) {
        delete updated.stateTransition[
          key
        ];
      }
    }

    return updated;
  }

  /**
   * Build a persistence-safe compare-and-set command.
   *
   * Repositories should use this to perform an atomic update similar to:
   *
   *   updateOne(
   *     {
   *       tenantId,
   *       _id: settlementId,
   *       status: expectedStatus
   *     },
   *     {
   *       $set: {
   *         status: nextStatus,
   *         updatedAt
   *       }
   *     }
   *   )
   *
   * The repository remains responsible for the actual database mutation.
   *
   * @param {object} settlement
   * @param {string} next
   * @param {object} [context]
   * @returns {object}
   */
  buildTransitionCommand(
    settlement,
    next,
    context = {}
  ) {
    if (
      !settlement ||
      typeof settlement !==
        'object'
    ) {
      throw new SettlementStateTransitionError(
        'Settlement object is required.',
        'SETTLEMENT_REQUIRED'
      );
    }

    const current =
      normalizeState(
        settlement.status
      );

    const target =
      normalizeState(next);

    const validation =
      this.validate(
        current,
        target,
        context
      );

    const changedAt =
      context.now
        ? new Date(
            context.now
          )
        : new Date();

    if (
      Number.isNaN(
        changedAt.getTime()
      )
    ) {
      throw new SettlementStateTransitionError(
        'Invalid transition timestamp.',
        'INVALID_TRANSITION_TIMESTAMP'
      );
    }

    const operationId =
      validation.context
        .operationId ||
      createOperationId();

    return Object.freeze({
      expectedStatus:
        current,

      nextStatus:
        target,

      updatedAt:
        changedAt,

      operationId,

      event:
        validation.event,

      terminal:
        validation.terminal,

      recoverable:
        validation.recoverable,

      metadata: Object.freeze({
        reason:
          validation.context
            .reason,

        actorId:
          validation.context
            .actorId,

        actorType:
          validation.context
            .actorType,

        correlationId:
          validation.context
            .correlationId,

        requestId:
          validation.context
            .requestId,

        source:
          validation.context
            .source
      })
    });
  }

  /**
   * Assert that a settlement can become SETTLED.
   *
   * This is intentionally a lifecycle guard only. It does NOT validate
   * reconciliation, provider evidence, ledger posting, or balance changes.
   *
   * @param {string} from
   * @param {object} [context]
   * @returns {object}
   */
  assertCanSettle(
    from,
    context = {}
  ) {
    return this.validate(
      from,
      STATES.SETTLED,
      context
    );
  }

  /**
   * Assert that a settlement can be reversed.
   *
   * @param {string} from
   * @param {object} [context]
   * @returns {object}
   */
  assertCanReverse(
    from,
    context = {}
  ) {
    return this.validate(
      from,
      STATES.REVERSED,
      {
        ...context,
        reason:
          context.reason ||
          'Explicit settlement reversal'
      }
    );
  }

  /**
   * Assert that a settlement requires reconciliation.
   *
   * @param {string} from
   * @param {object} [context]
   * @returns {object}
   */
  assertRequiresReconciliation(
    from,
    context = {}
  ) {
    return this.validate(
      from,
      STATES.REQUIRES_RECONCILIATION,
      context
    );
  }

  /**
   * Assert that a settlement requires manual review.
   *
   * @param {string} from
   * @param {object} [context]
   * @returns {object}
   */
  assertRequiresReview(
    from,
    context = {}
  ) {
    return this.validate(
      from,
      STATES.REQUIRES_REVIEW,
      context
    );
  }

  /**
   * Return a serializable definition of the state machine.
   *
   * Useful for diagnostics, tests, documentation generation, and API/admin
   * tooling.
   *
   * @returns {object}
   */
  definition() {
    return {
      states: {
        ...STATES
      },

      transitions: Object.fromEntries(
        Object.entries(
          TRANSITIONS
        ).map(
          ([from, to]) => [
            from,
            Array.from(to)
          ]
        )
      ),

      terminalStates:
        Array.from(
          TERMINAL_STATES
        ),

      recoverableStates:
        Array.from(
          RECOVERABLE_STATES
        ),

      events: {
        ...EVENTS
      }
    };
  }

  /**
   * Validate the machine definition itself.
   *
   * This is useful as a startup/test invariant.
   *
   * @returns {object}
   */
  selfCheck() {
    const stateValues =
      new Set(
        Object.values(
          STATES
        )
      );

    const errors = [];

    for (
      const [from, targets] of
        Object.entries(
          TRANSITIONS
        )
    ) {
      if (
        !stateValues.has(
          from
        )
      ) {
        errors.push(
          `Unknown source state: ${from}`
        );
      }

      for (
        const target of targets
      ) {
        if (
          !stateValues.has(
            target
          )
        ) {
          errors.push(
            `Unknown target state: ${target}`
          );
        }
      }
    }

    for (
      const terminal of
        TERMINAL_STATES
    ) {
      if (
        !stateValues.has(
          terminal
        )
      ) {
        errors.push(
          `Unknown terminal state: ${terminal}`
        );
      }
    }

    if (
      errors.length >
      0
    ) {
      throw new SettlementStateTransitionError(
        'Settlement state machine definition is invalid.',
        'INVALID_STATE_MACHINE_DEFINITION',
        {
          errors
        }
      );
    }

    return {
      valid: true,
      stateCount:
        stateValues.size,
      transitionCount:
        Object.values(
          TRANSITIONS
        ).reduce(
          (count, values) =>
            count +
            values.length,
          0
        )
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton + compatibility exports                                          */
/* -------------------------------------------------------------------------- */

const stateMachine =
  new SettlementStateMachine();

/*
 * Fail fast during development/test startup if this module is malformed.
 * This is deterministic and does not touch external dependencies.
 */
stateMachine.selfCheck();

module.exports =
  stateMachine;

module.exports.SettlementStateMachine =
  SettlementStateMachine;

module.exports.SettlementStateTransitionError =
  SettlementStateTransitionError;

module.exports.STATES =
  STATES;

module.exports.TRANSITIONS =
  TRANSITIONS;

module.exports.EVENTS =
  EVENTS;

module.exports.TERMINAL_STATES =
  TERMINAL_STATES;

module.exports.RECOVERABLE_STATES =
  RECOVERABLE_STATES;

module.exports.canTransition =
  canTransition;

module.exports.allowedTransitions =
  allowedTransitions;

module.exports.isTerminal =
  isTerminal;

module.exports.isRecoverable =
  isRecoverable;

module.exports.isKnownState =
  isKnownState;

module.exports.normalizeState =
  normalizeState;