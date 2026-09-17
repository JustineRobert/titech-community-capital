'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Reconciliation & Repair Intelligence Engine
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/reconciliationRepairEngine.js
 *
 * Purpose:
 *   Diagnose Airtel-vs-TITech reconciliation discrepancies, classify their
 *   severity/repairability, generate deterministic repair plans, and optionally
 *   delegate approved repairs to the authoritative TITech financial/commercial
 *   service boundary.
 *
 * Responsibilities:
 *   - Provider/local/financial evidence normalization.
 *   - Exact monetary comparisons without floating-point arithmetic.
 *   - Discrepancy detection and classification.
 *   - Deterministic repair fingerprints and idempotency keys.
 *   - Dry-run and preview support.
 *   - Maker-checker enforcement for financial repairs.
 *   - Controlled execution through an injected repair adapter.
 *   - Safe logging/metrics.
 *
 * Non-responsibilities:
 *   - No direct Airtel API calls.
 *   - No direct MongoDB writes.
 *   - No direct balance mutation.
 *   - No direct ledger writes.
 *   - No blind financial reposting.
 *   - No replacement of the authoritative transaction/ledger service.
 *
 * Financial safety rule:
 *   Reconciliation evidence is diagnostic. A repair plan is not a financial
 *   posting. Any financial mutation must be performed by the existing
 *   authoritative TITech financial/commercial service boundary.
 *
 * Module format:
 *   Native ESM. No additional runtime dependencies.
 *
 * =============================================================================
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-reconciliation-repair-engine';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;

export const RECONCILIATION_STATUS = Object.freeze({
  CONSISTENT: 'CONSISTENT',
  MISMATCH: 'MISMATCH',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  BLOCKED: 'BLOCKED',
  REPAIRABLE: 'REPAIRABLE',
});

export const SEVERITY = Object.freeze({
  INFO: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const REPAIRABILITY = Object.freeze({
  NONE: 'NONE',
  REVIEW: 'REVIEW',
  CONTROLLED: 'CONTROLLED',
  FINANCIAL_CORE: 'FINANCIAL_CORE',
});

export const EXECUTION_MODES = Object.freeze({
  NONE: 'NONE',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  CONTROLLED: 'CONTROLLED',
  FINANCIAL_CORE: 'FINANCIAL_CORE',
});

export const REPAIR_ACTIONS = Object.freeze({
  NO_ACTION: 'NO_ACTION',
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  REFETCH_PROVIDER_STATUS: 'REFETCH_PROVIDER_STATUS',
  ATTACH_PROVIDER_REFERENCE: 'ATTACH_PROVIDER_REFERENCE',
  REPAIR_COMMERCIAL_LINKAGE: 'REPAIR_COMMERCIAL_LINKAGE',
  RECOVER_EXISTING_FINANCIAL_POSTING: 'RECOVER_EXISTING_FINANCIAL_POSTING',
  POST_FINANCIAL_SETTLEMENT: 'POST_FINANCIAL_SETTLEMENT',
  CREATE_FINANCIAL_REVERSAL: 'CREATE_FINANCIAL_REVERSAL',
  QUARANTINE_DUPLICATE: 'QUARANTINE_DUPLICATE',
});

const PROVIDER_SUCCESS = new Set([
  'SUCCESS',
  'COMPLETED',
  'COMPLETE',
  'PAID',
  'SETTLED',
]);

const PROVIDER_FAILURE = new Set([
  'FAILED',
  'FAILURE',
  'REJECTED',
  'DECLINED',
  'CANCELLED',
  'CANCELED',
  'EXPIRED',
]);

const PROVIDER_PENDING = new Set([
  'PENDING',
  'PROCESSING',
  'INITIATED',
  'SUBMITTED',
  'QUEUED',
  'UNKNOWN',
]);

const LOCAL_SUCCESS = new Set([
  'SUCCESS',
  'COMPLETED',
  'SETTLED',
  'PAID',
]);

const FINANCIAL_POSTED = new Set([
  'POSTED',
  'COMPLETED',
  'SETTLED',
  'SUCCESS',
]);

const FINANCIAL_REVERSED = new Set([
  'REVERSED',
  'REFUNDED',
  'CANCELLED',
  'CANCELED',
]);

const DEFAULTS = Object.freeze({
  provider: 'AIRTEL',
  requireTenantId: true,
  requirePaymentIdentity: true,
  makerCheckerForFinancialRepair: true,
  stalePendingAfterMs: 15 * 60 * 1000,
  maxRepairSteps: 12,
  maxReasonLength: 500,
  currencyStrict: true,
  referenceCaseSensitive: false,
  allowControlledExecution: true,
});

export class AirtelReconciliationRepairError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name =
      'AirtelReconciliationRepairError';

    this.code =
      options.code ||
      'AIRTEL_RECONCILIATION_REPAIR_ERROR';

    this.statusCode =
      options.statusCode ||
      500;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    this.cause =
      options.cause ||
      null;

    Error.captureStackTrace?.(
      this,
      AirtelReconciliationRepairError,
    );
  }
}

const isObject =
  value =>
    value !== null &&
    typeof value === 'object';

const isPlainObject =
  value => {
    if (!isObject(value)) {
      return false;
    }

    const proto =
      Object.getPrototypeOf(value);

    return (
      proto === Object.prototype ||
      proto === null
    );
  };

function clone(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(clone);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(
      ([key, nested]) => [
        key,
        clone(nested),
      ],
    ),
  );
}

function freezeDeep(
  value,
  seen = new WeakSet(),
) {
  if (
    !isObject(value) ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const nested of Object.values(value)
  ) {
    freezeDeep(
      nested,
      seen,
    );
  }

  return Object.freeze(value);
}

function normalizeId(
  value,
  field,
  maxLength = 256,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new AirtelReconciliationRepairError(
      `${field} exceeds the maximum allowed length.`,
      {
        code:
          'RECONCILIATION_IDENTIFIER_TOO_LONG',

        statusCode:
          422,

        details: {
          field,
          maxLength,
        },
      },
    );
  }

  return normalized;
}

function upper(
  value,
  fallback = null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const normalized =
    String(value).trim();

  return (
    normalized
      ? normalized.toUpperCase()
      : fallback
  );
}

function currency(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value)
      .trim()
      .toUpperCase();

  return /^[A-Z]{3}$/.test(
    normalized,
  )
    ? normalized
    : normalized || null;
}

function date(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const d =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(value);

  return Number.isNaN(
    d.getTime(),
  )
    ? null
    : d;
}

function now(clock) {
  try {
    const value =
      typeof clock === 'function'
        ? clock()
        : Date.now();

    const d =
      value instanceof Date
        ? new Date(
            value.getTime(),
          )
        : new Date(value);

    return Number.isNaN(
      d.getTime(),
    )
      ? new Date()
      : d;
  } catch {
    return new Date();
  }
}

function first(
  source,
  keys,
) {
  for (
    const key of keys
  ) {
    let value =
      source;

    for (
      const segment of String(
        key,
      )
        .split('.')
        .filter(Boolean)
    ) {
      if (
        value === null ||
        value === undefined
      ) {
        value =
          undefined;

        break;
      }

      value =
        value[
          segment
        ];
    }

    if (
      value !== undefined &&
      value !== null
    ) {
      return value;
    }
  }

  return null;
}

/**
 * ============================================================================
 * Exact Decimal Normalization
 * ============================================================================
 *
 * Money must never be compared through JavaScript floating-point arithmetic.
 * This helper supports MongoDB Decimal128-style values and numeric strings.
 * ============================================================================
 */

function decimal(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  let text =
    value?._bsontype ===
      'Decimal128'
      ? value.toString()
      : String(value).trim();

  if (
    !text ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(
      text,
    )
  ) {
    return null;
  }

  let negative =
    false;

  if (
    text.startsWith('-') ||
    text.startsWith('+')
  ) {
    negative =
      text.startsWith('-');

    text =
      text.slice(1);
  }

  let [
    integer = '0',
    fraction = '',
  ] =
    text.split('.');

  integer =
    integer.replace(
      /^0+(?=\d)/,
      '',
    ) || '0';

  fraction =
    fraction.replace(
      /0+$/,
      '',
    );

  const result =
    fraction
      ? `${integer}.${fraction}`
      : integer;

  return (
    negative &&
    result !== '0'
      ? `-${result}`
      : result
  );
}

function decimalParts(value) {
  const n =
    decimal(value);

  if (n === null) {
    return null;
  }

  let s =
    n;

  const negative =
    s.startsWith('-');

  if (negative) {
    s =
      s.slice(1);
  }

  let [
    integer = '0',
    fraction = '',
  ] =
    s.split('.');

  return {
    negative,
    integer,
    fraction,
  };
}

function compareDecimal(
  a,
  b,
) {
  const left =
    decimalParts(a);

  const right =
    decimalParts(b);

  if (!left || !right) {
    return null;
  }

  if (
    left.negative !==
    right.negative
  ) {
    return left.negative
      ? -1
      : 1;
  }

  const sign =
    left.negative
      ? -1
      : 1;

  if (
    left.integer.length !==
    right.integer.length
  ) {
    return (
      sign *
      (
        left.integer.length >
        right.integer.length
          ? 1
          : -1
      )
    );
  }

  if (
    left.integer !==
    right.integer
  ) {
    return (
      sign *
      (
        left.integer >
        right.integer
          ? 1
          : -1
      )
    );
  }

  const width =
    Math.max(
      left.fraction.length,
      right.fraction.length,
    );

  const lf =
    left.fraction.padEnd(
      width,
      '0',
    );

  const rf =
    right.fraction.padEnd(
      width,
      '0',
    );

  if (lf === rf) {
    return 0;
  }

  return (
    sign *
    (
      lf > rf
        ? 1
        : -1
    )
  );
}

function equalDecimal(
  a,
  b,
) {
  return (
    compareDecimal(
      a,
      b,
    ) === 0
  );
}

function sameString(
  a,
  b,
  caseSensitive = false,
) {
  if (
    a === null ||
    a === undefined ||
    b === null ||
    b === undefined
  ) {
    return null;
  }

  const left =
    String(a).trim();

  const right =
    String(b).trim();

  return caseSensitive
    ? left === right
    : left.toUpperCase() ===
      right.toUpperCase();
}

/**
 * ============================================================================
 * Deterministic Fingerprinting
 * ============================================================================
 */

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(stable);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce(
        (
          output,
          key,
        ) => {
          output[key] =
            stable(
              value[key],
            );

          return output;
        },
        {},
      );
  }

  if (
    typeof value ===
      'number' &&
    !Number.isFinite(value)
  ) {
    return String(value);
  }

  return value;
}

function fingerprint(value) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        stable(value),
      ),
    )
    .digest('hex');
}

function safeError(error) {
  if (!error) {
    return null;
  }

  return {
    name:
      error.name ||
      'Error',

    code:
      error.code ||
      null,

    message:
      error.message ||
      'Unknown error',
  };
}

function finding({
  code,
  severity,
  message,
  repairability =
    REPAIRABILITY.NONE,
  action =
    REPAIR_ACTIONS.REQUIRE_REVIEW,
  blocksFinancialExecution =
    false,
  evidence = {},
}) {
  return Object.freeze({
    code,
    severity,
    message,
    repairability,
    action,
    blocksFinancialExecution,
    evidence:
      clone(evidence),
  });
}

/**
 * ============================================================================
 * Engine
 * ============================================================================
 */

export class AirtelReconciliationRepairEngine {
  constructor(
    options = {},
  ) {
    const cfg =
      isPlainObject(options)
        ? options
        : {};

    this.config =
      freezeDeep({
        ...DEFAULTS,
        ...cfg,

        provider:
          upper(
            cfg.provider,
            DEFAULTS.provider,
          ),

        stalePendingAfterMs:
          Math.max(
            1000,
            Number(
              cfg.stalePendingAfterMs ??
              DEFAULTS.stalePendingAfterMs,
            ) ||
            DEFAULTS.stalePendingAfterMs,
          ),

        maxRepairSteps:
          Math.min(
            50,
            Math.max(
              1,
              Math.trunc(
                Number(
                  cfg.maxRepairSteps ??
                  DEFAULTS.maxRepairSteps,
                ) ||
                DEFAULTS.maxRepairSteps,
              ),
            ),
          ),

        maxReasonLength:
          Math.min(
            2000,
            Math.max(
              50,
              Math.trunc(
                Number(
                  cfg.maxReasonLength ??
                  DEFAULTS.maxReasonLength,
                ) ||
                DEFAULTS.maxReasonLength,
              ),
            ),
          ),
      });

    this.clock =
      typeof cfg.clock === 'function'
        ? cfg.clock
        : () => Date.now();

    this.logger =
      isObject(cfg.logger)
        ? cfg.logger
        : null;

    this.metrics =
      isObject(cfg.metrics)
        ? cfg.metrics
        : null;

    this.repairAdapter =
      cfg.repairAdapter ||
      cfg.adapter ||
      null;
  }

  /**
   * --------------------------------------------------------------------------
   * Health
   * --------------------------------------------------------------------------
   */

  health() {
    return Object.freeze({
      success: true,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      provider:
        this.config.provider,

      ready:
        true,

      stateless:
        true,

      repairAdapterConfigured:
        Boolean(
          this.repairAdapter,
        ),

      makerCheckerEnabled:
        Boolean(
          this.config
            .makerCheckerForFinancialRepair,
        ),
    });
  }

  /**
   * --------------------------------------------------------------------------
   * Reconcile
   * --------------------------------------------------------------------------
   */

  reconcileSync(
    input = {},
  ) {
    const context =
      this.#normalizeInput(
        input,
      );

    const generatedAt =
      now(this.clock);

    const evidence =
      this.#evidence(
        context,
      );

    const findings =
      this.#findings(
        context,
        evidence,
        generatedAt,
      );

    const status =
      this.#status(
        findings,
      );

    const confidence =
      this.#confidence(
        evidence,
        findings,
      );

    const reconciliationFingerprint =
      fingerprint({
        tenantId:
          context.tenantId,

        paymentId:
          context.paymentId,

        provider:
          context.provider,

        idempotencyKey:
          context.idempotencyKey,

        evidence,

        findings:
          findings.map(
            item => ({
              code:
                item.code,

              severity:
                item.severity,

              action:
                item.action,
            }),
          ),
      });

    const result = {
      success:
        true,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      generatedAt:
        generatedAt.toISOString(),

      tenantId:
        context.tenantId,

      paymentId:
        context.paymentId,

      provider:
        context.provider,

      status,

      confidence,

      fingerprint:
        reconciliationFingerprint,

      findings,

      summary: {
        findingCount:
          findings.length,

        criticalCount:
          findings.filter(
            item =>
              item.severity ===
              SEVERITY.CRITICAL,
          ).length,

        highCount:
          findings.filter(
            item =>
              item.severity ===
              SEVERITY.HIGH,
          ).length,

        actionableCount:
          findings.filter(
            item =>
              item.action !==
              REPAIR_ACTIONS.NO_ACTION,
          ).length,

        financialExecutionBlocked:
          findings.some(
            item =>
              item.blocksFinancialExecution,
          ),
      },

      evidence:
        this.#safeEvidence(
          evidence,
        ),
    };

    this.#observe(
      'reconcile',
      result,
    );

    return freezeDeep(
      result,
    );
  }

  async reconcile(
    input = {},
  ) {
    return this.reconcileSync(
      input,
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Repair plan
   * --------------------------------------------------------------------------
   */

  createRepairPlan(
    input = {},
  ) {
    const reconciliation =
      this.reconcileSync(
        input,
      );

    const context =
      this.#normalizeInput(
        input,
      );

    const steps =
      this.#steps(
        reconciliation,
        context,
      );

    const financialRepair =
      steps.some(
        step =>
          step.repairability ===
          REPAIRABILITY.FINANCIAL_CORE,
      );

    const blocked =
      reconciliation.findings.some(
        item =>
          item.blocksFinancialExecution,
      );

    const requiresApproval =
      financialRepair &&
      this.config
        .makerCheckerForFinancialRepair;

    const executionMode =
      blocked
        ? EXECUTION_MODES.MANUAL_REVIEW
        : financialRepair
          ? EXECUTION_MODES.FINANCIAL_CORE
          : steps.length
            ? EXECUTION_MODES.CONTROLLED
            : EXECUTION_MODES.NONE;

    const repairId =
      fingerprint({
        reconciliationFingerprint:
          reconciliation.fingerprint,

        steps:
          steps.map(
            step => ({
              findingCode:
                step.findingCode,

              action:
                step.action,

              repairability:
                step.repairability,
            }),
          ),
      }).slice(
        0,
        32,
      );

    const plan = {
      success:
        true,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      generatedAt:
        now(
          this.clock,
        ).toISOString(),

      repairId,

      repairIdempotencyKey:
        `airtel-repair:${context.tenantId || 'global'}:${repairId}`,

      tenantId:
        context.tenantId,

      paymentId:
        context.paymentId,

      provider:
        context.provider,

      reconciliationFingerprint:
        reconciliation.fingerprint,

      reconciliationStatus:
        reconciliation.status,

      executionMode,

      requiresApproval,

      requiresFinancialCore:
        financialRepair,

      blocked,

      steps,

      preconditions: [
        {
          code:
            'TENANT_MATCH',

          required:
            true,

          value:
            context.tenantId,
        },

        {
          code:
            'PAYMENT_IDENTITY_PRESENT',

          required:
            true,

          value:
            context.paymentId,
        },

        {
          code:
            'RECONCILIATION_FINGERPRINT',

          required:
            true,

          value:
            reconciliation.fingerprint,
        },

        {
          code:
            'NO_BLIND_REPOSTING',

          required:
            true,

          value:
            true,
        },
      ],

      invariants: [
        'Do not post financial value twice.',
        'Do not silently change a settled amount or currency.',
        'Do not cross tenant boundaries.',
        'Do not repair ambiguous evidence without review.',
        'Do not bypass the authoritative transaction/ledger boundary.',
      ],
    };

    if (
      steps.length >
      this.config.maxRepairSteps
    ) {
      throw new AirtelReconciliationRepairError(
        'Generated repair plan exceeds the configured safety limit.',
        {
          code:
            'REPAIR_PLAN_TOO_LARGE',

          statusCode:
            422,

          details: {
            maxRepairSteps:
              this.config.maxRepairSteps,
          },
        },
      );
    }

    this.#log(
      'info',
      {
        event:
          'airtel_reconciliation_repair_plan_created',

        tenantId:
          context.tenantId,

        paymentId:
          context.paymentId,

        repairId,

        executionMode,

        requiresApproval,

        stepCount:
          steps.length,

        blocked,
      },
    );

    return freezeDeep(
      plan,
    );
  }

  previewRepair(
    input = {},
  ) {
    const plan =
      this.createRepairPlan(
        input,
      );

    return freezeDeep({
      ...plan,

      preview:
        true,

      executable:
        Boolean(
          !plan.blocked &&
          this.repairAdapter,
        ),
    });
  }

  /**
   * --------------------------------------------------------------------------
   * Controlled execution
   * --------------------------------------------------------------------------
   *
   * Execution is deliberately adapter-driven. The adapter must call the
   * authoritative TITech commercial/financial services and enforce its own
   * transaction/session boundaries.
   * --------------------------------------------------------------------------
   */

  async executeRepair(
    plan,
    executionContext = {},
  ) {
    this.#assertPlan(
      plan,
    );

    const ctx =
      this.#executionContext(
        plan,
        executionContext,
      );

    this.#assertExecutionAllowed(
      plan,
      ctx,
    );

    if (
      ctx.dryRun
    ) {
      return freezeDeep({
        success:
          true,

        dryRun:
          true,

        executed:
          false,

        plan,

        message:
          'Dry-run completed. No financial or commercial mutation was attempted.',
      });
    }

    const executor =
      this.#executor();

    if (!executor) {
      throw new AirtelReconciliationRepairError(
        'Configured repair adapter does not expose a supported execution contract.',
        {
          code:
            'REPAIR_EXECUTOR_CONTRACT_INVALID',

          statusCode:
            503,

          details: {
            supportedMethods: [
              'applyRepairPlan',
              'executeRepairPlan',
              'repair',
              'execute',
            ],
          },
        },
      );
    }

    const payload = {
      plan,

      tenantId:
        plan.tenantId,

      paymentId:
        plan.paymentId,

      provider:
        plan.provider,

      repairId:
        plan.repairId,

      repairIdempotencyKey:
        ctx.executionIdempotencyKey,

      actor:
        ctx.actor,

      approval:
        ctx.approval,

      dryRun:
        false,

      requestId:
        ctx.requestId,

      correlationId:
        ctx.correlationId,

      session:
        ctx.session,

      reconciliationEngine:
        ENGINE_NAME,

      reconciliationEngineVersion:
        ENGINE_VERSION,
    };

    let result;

    try {
      result =
        await executor(
          payload,
        );
    } catch (error) {
      this.#log(
        'error',
        {
          event:
            'airtel_reconciliation_repair_execution_failed',

          tenantId:
            plan.tenantId,

          paymentId:
            plan.paymentId,

          repairId:
            plan.repairId,

          error:
            safeError(
              error,
            ),
        },
      );

      throw new AirtelReconciliationRepairError(
        'Controlled reconciliation repair execution failed.',
        {
          code:
            'REPAIR_EXECUTION_FAILED',

          statusCode:
            500,

          cause:
            error,

          details: {
            repairId:
              plan.repairId,
          },
        },
      );
    }

    const response = {
      success:
        true,

      executed:
        true,

      dryRun:
        false,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      repairId:
        plan.repairId,

      repairIdempotencyKey:
        ctx.executionIdempotencyKey,

      tenantId:
        plan.tenantId,

      paymentId:
        plan.paymentId,

      provider:
        plan.provider,

      result:
        result ?? null,
    };

    this.#observe(
      'repair_execution',
      response,
    );

    return freezeDeep(
      response,
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Input normalization
   * --------------------------------------------------------------------------
   */

  #normalizeInput(
    input,
  ) {
    if (
      !isPlainObject(input)
    ) {
      throw new AirtelReconciliationRepairError(
        'Reconciliation input must be a plain object.',
        {
          code:
            'RECONCILIATION_INPUT_INVALID',

          statusCode:
            422,
        },
      );
    }

    const tenantId =
      normalizeId(
        input.tenantId,
        'tenantId',
        128,
      );

    const paymentId =
      normalizeId(
        input.paymentId ??
        input.transactionId ??
        input.payment?.id ??
        input.payment?._id,
        'paymentId',
        256,
      );

    if (
      this.config.requireTenantId &&
      !tenantId
    ) {
      throw new AirtelReconciliationRepairError(
        'tenantId is required for reconciliation.',
        {
          code:
            'RECONCILIATION_TENANT_REQUIRED',

          statusCode:
            422,
        },
      );
    }

    if (
      this.config.requirePaymentIdentity &&
      !paymentId
    ) {
      throw new AirtelReconciliationRepairError(
        'paymentId is required for reconciliation.',
        {
          code:
            'RECONCILIATION_PAYMENT_ID_REQUIRED',

          statusCode:
            422,
        },
      );
    }

    const provider =
      upper(
        input.provider ??
        input.payment?.provider,
        this.config.provider,
      );

    if (
      provider !==
      this.config.provider
    ) {
      throw new AirtelReconciliationRepairError(
        `Provider ${provider} is outside this engine's configured scope.`,
        {
          code:
            'RECONCILIATION_PROVIDER_SCOPE_MISMATCH',

          statusCode:
            422,

          details: {
            expectedProvider:
              this.config.provider,

            receivedProvider:
              provider,
          },
        },
      );
    }

    return {
      tenantId,

      paymentId,

      provider,

      idempotencyKey:
        normalizeId(
          input.idempotencyKey ??
          input.payment?.idempotencyKey,
          'idempotencyKey',
          512,
        ),

      operation:
        upper(
          input.operation ??
          input.payment?.operation,
          'COLLECTION',
        ),

      expectedCurrency:
        currency(
          input.currency ??
          input.payment?.currency,
        ),

      providerSnapshot:
        isPlainObject(
          input.providerSnapshot,
        )
          ? clone(
              input.providerSnapshot,
            )
          : isPlainObject(
              input.providerRecord,
            )
            ? clone(
                input.providerRecord,
              )
            : {},

      localSnapshot:
        isPlainObject(
          input.localSnapshot,
        )
          ? clone(
              input.localSnapshot,
            )
          : isPlainObject(
              input.payment,
            )
            ? clone(
                input.payment,
              )
            : {},

      financialSnapshot:
        isPlainObject(
          input.financialSnapshot,
        )
          ? clone(
              input.financialSnapshot,
            )
          : isPlainObject(
              input.financial,
            )
            ? clone(
                input.financial,
              )
            : {},

      context:
        isPlainObject(
          input.context,
        )
          ? clone(
              input.context,
            )
          : {},
    };
  }

  /**
   * --------------------------------------------------------------------------
   * Evidence normalization
   * --------------------------------------------------------------------------
   */

  #evidence(
    context,
  ) {
    const p =
      context.providerSnapshot;

    const l =
      context.localSnapshot;

    const f =
      context.financialSnapshot;

    const providerStatus =
      upper(
        first(
          p,
          [
            'status',
            'transactionStatus',
            'paymentStatus',
          ],
        ),
        'UNKNOWN',
      );

    const localStatus =
      upper(
        first(
          l,
          [
            'status',
            'paymentStatus',
            'transactionStatus',
          ],
        ),
        'UNKNOWN',
      );

    const financialStatus =
      upper(
        first(
          f,
          [
            'status',
            'postingStatus',
            'transactionStatus',
          ],
        ),
        'UNKNOWN',
      );

    return {
      provider: {
        exists:
          Object.keys(p).length >
          0,

        status:
          providerStatus,

        success:
          PROVIDER_SUCCESS.has(
            providerStatus,
          ),

        failure:
          PROVIDER_FAILURE.has(
            providerStatus,
          ),

        pending:
          PROVIDER_PENDING.has(
            providerStatus,
          ),

        amount:
          decimal(
            first(
              p,
              [
                'amount',
                'paidAmount',
                'transactionAmount',
              ],
            ),
          ),

        currency:
          currency(
            first(
              p,
              [
                'currency',
                'transactionCurrency',
              ],
            ),
          ),

        providerTransactionId:
          normalizeId(
            first(
              p,
              [
                'providerTransactionId',
                'transactionId',
                'externalTransactionId',
                'id',
                '_id',
              ],
            ),
            'providerTransactionId',
            256,
          ),

        providerReference:
          normalizeId(
            first(
              p,
              [
                'providerReference',
                'reference',
                'externalReference',
                'receiptNumber',
              ],
            ),
            'providerReference',
            256,
          ),

        occurredAt:
          date(
            first(
              p,
              [
                'occurredAt',
                'completedAt',
                'transactionDate',
                'createdAt',
              ],
            ),
          ),
      },

      local: {
        exists:
          Object.keys(l).length >
          0,

        status:
          localStatus,

        success:
          LOCAL_SUCCESS.has(
            localStatus,
          ),

        failure:
          !LOCAL_SUCCESS.has(
            localStatus,
          ) &&
          localStatus !==
            'UNKNOWN',

        amount:
          decimal(
            first(
              l,
              [
                'amount',
                'paidAmount',
                'transactionAmount',
              ],
            ),
          ),

        currency:
          currency(
            first(
              l,
              [
                'currency',
                'transactionCurrency',
              ],
            ),
          ),

        providerTransactionId:
          normalizeId(
            first(
              l,
              [
                'providerTransactionId',
                'externalTransactionId',
                'providerId',
              ],
            ),
            'localProviderTransactionId',
            256,
          ),

        providerReference:
          normalizeId(
            first(
              l,
              [
                'providerReference',
                'externalReference',
                'reference',
                'receiptNumber',
              ],
            ),
            'localProviderReference',
            256,
          ),

        financialTransactionId:
          normalizeId(
            first(
              l,
              [
                'financialTransactionId',
                'ledgerTransactionId',
                'transactionId',
              ],
            ),
            'localFinancialTransactionId',
            256,
          ),

        updatedAt:
          date(
            first(
              l,
              [
                'updatedAt',
                'completedAt',
                'settledAt',
              ],
            ),
          ),
      },

      financial: {
        exists:
          Object.keys(f).length >
          0,

        status:
          financialStatus,

        posted:
          FINANCIAL_POSTED.has(
            financialStatus,
          ),

        reversed:
          FINANCIAL_REVERSED.has(
            financialStatus,
          ),

        amount:
          decimal(
            first(
              f,
              [
                'amount',
                'postedAmount',
                'transactionAmount',
              ],
            ),
          ),

        currency:
          currency(
            first(
              f,
              [
                'currency',
                'transactionCurrency',
              ],
            ),
          ),

        financialTransactionId:
          normalizeId(
            first(
              f,
              [
                'transactionId',
                'financialTransactionId',
                'id',
                '_id',
              ],
            ),
            'financialTransactionId',
            256,
          ),

        ledgerTransactionId:
          normalizeId(
            first(
              f,
              [
                'ledgerTransactionId',
                'journalId',
                'ledgerId',
              ],
            ) ??
            first(
              l,
              [
                'ledgerTransactionId',
                'journalId',
                'ledgerId',
              ],
            ),
            'ledgerTransactionId',
            256,
          ),

        postedAt:
          date(
            first(
              f,
              [
                'postedAt',
                'completedAt',
                'settledAt',
                'createdAt',
              ],
            ),
          ),
      },
    };
  }

  /**
   * --------------------------------------------------------------------------
   * Finding detection
   * --------------------------------------------------------------------------
   */

  #findings(
    context,
    e,
    generatedAt,
  ) {
    const out = [];

    const p =
      e.provider;

    const l =
      e.local;

    const f =
      e.financial;

    if (!p.exists) {
      out.push(
        finding({
          code:
            'PROVIDER_RECORD_MISSING',

          severity:
            SEVERITY.HIGH,

          message:
            'No authoritative Airtel provider record was supplied.',

          repairability:
            REPAIRABILITY.REVIEW,

          action:
            REPAIR_ACTIONS.REFETCH_PROVIDER_STATUS,
        }),
      );
    }

    if (!l.exists) {
      out.push(
        finding({
          code:
            'LOCAL_PAYMENT_RECORD_MISSING',

          severity:
            SEVERITY.HIGH,

          message:
            'No local TITech payment record was supplied.',

          repairability:
            p.success
              ? REPAIRABILITY.FINANCIAL_CORE
              : REPAIRABILITY.REVIEW,

          action:
            p.success
              ? REPAIR_ACTIONS
                  .RECOVER_EXISTING_FINANCIAL_POSTING
              : REPAIR_ACTIONS.REQUIRE_REVIEW,
        }),
      );
    }

    if (
      p.success &&
      !l.exists
    ) {
      out.push(
        finding({
          code:
            'PROVIDER_SUCCESS_LOCAL_MISSING',

          severity:
            SEVERITY.CRITICAL,

          message:
            'Airtel reports success while the TITech local payment record is missing.',

          repairability:
            REPAIRABILITY.FINANCIAL_CORE,

          action:
            REPAIR_ACTIONS
              .RECOVER_EXISTING_FINANCIAL_POSTING,

          evidence: {
            providerTransactionId:
              p.providerTransactionId,

            providerReference:
              p.providerReference,
          },
        }),
      );
    }

    if (
      p.success &&
      l.exists &&
      !l.success
    ) {
      out.push(
        finding({
          code:
            'PROVIDER_SUCCESS_LOCAL_NOT_SETTLED',

          severity:
            SEVERITY.CRITICAL,

          message:
            'Airtel reports success while TITech local payment state is not settled.',

          repairability:
            REPAIRABILITY.FINANCIAL_CORE,

          action:
            REPAIR_ACTIONS
              .RECOVER_EXISTING_FINANCIAL_POSTING,

          evidence: {
            providerStatus:
              p.status,

            localStatus:
              l.status,
          },
        }),
      );
    }

    if (
      p.failure &&
      l.success
    ) {
      out.push(
        finding({
          code:
            'PROVIDER_FAILURE_LOCAL_SUCCESS',

          severity:
            SEVERITY.CRITICAL,

          message:
            'Airtel reports failure while TITech local payment state is successful.',

          repairability:
            REPAIRABILITY.REVIEW,

          action:
            REPAIR_ACTIONS.REQUIRE_REVIEW,

          blocksFinancialExecution:
            true,

          evidence: {
            providerStatus:
              p.status,

            localStatus:
              l.status,
          },
        }),
      );
    }

    if (p.pending) {
      const referenceTime =
        p.occurredAt ||
        l.updatedAt ||
        generatedAt;

      const ageMs =
        Math.max(
          0,
          generatedAt.getTime() -
            referenceTime.getTime(),
        );

      if (
        ageMs >=
        this.config.stalePendingAfterMs
      ) {
        out.push(
          finding({
            code:
              'PROVIDER_PENDING_STALE',

            severity:
              SEVERITY.MEDIUM,

            message:
              'Provider payment remains pending beyond the configured reconciliation freshness window.',

            repairability:
              REPAIRABILITY.CONTROLLED,

            action:
              REPAIR_ACTIONS.REFETCH_PROVIDER_STATUS,

            evidence: {
              ageMs,

              stalePendingAfterMs:
                this.config.stalePendingAfterMs,
            },
          }),
        );
      }
    }

    if (
      p.amount !== null &&
      l.amount !== null &&
      !equalDecimal(
        p.amount,
        l.amount,
      )
    ) {
      out.push(
        finding({
          code:
            'PROVIDER_LOCAL_AMOUNT_MISMATCH',

          severity:
            SEVERITY.CRITICAL,

          message:
            'Provider amount and local amount do not match exactly.',

          repairability:
            REPAIRABILITY.NONE,

          action:
            REPAIR_ACTIONS.REQUIRE_REVIEW,

          blocksFinancialExecution:
            true,

          evidence: {
            providerAmount:
              p.amount,

            localAmount:
              l.amount,
          },
        }),
      );
    }

    if (
      l.success &&
      f.posted &&
      l.amount !== null &&
      f.amount !== null &&
      !equalDecimal(
        l.amount,
        f.amount,
      )
    ) {
      out.push(
        finding({
          code:
            'LOCAL_FINANCIAL_AMOUNT_MISMATCH',

          severity:
            SEVERITY.CRITICAL,

          message:
            'Local successful payment amount does not match authoritative financial posting amount.',

          repairability:
            REPAIRABILITY.NONE,

          action:
            REPAIR_ACTIONS.REQUIRE_REVIEW,

          blocksFinancialExecution:
            true,

          evidence: {
            localAmount:
              l.amount,

            financialAmount:
              f.amount,
          },
        }),
      );
    }

    if (
      this.config.currencyStrict &&
      p.currency &&
      l.currency &&
      p.currency !==
        l.currency
    ) {
      out.push(
        finding({
          code:
            'PROVIDER_LOCAL_CURRENCY_MISMATCH',

          severity:
            SEVERITY.CRITICAL,

          message:
            'Provider currency and local currency do not match.',

          repairability:
            REPAIRABILITY.NONE,

          action:
            REPAIR_ACTIONS.REQUIRE_REVIEW,

          blocksFinancialExecution:
            true,

          evidence: {
            providerCurrency:
              p.currency,

            localCurrency:
              l.currency,
          },
        }),
      );
    }

    if (
      this.config.currencyStrict &&
      l.currency &&
      f.currency &&
      l.currency !==
        f.currency
    ) {
      out.push(
        finding({
          code:
            'LOCAL_FINANCIAL_CURRENCY_MISMATCH',

          severity:
            SEVERITY.CRITICAL,

          message:
            'Local payment currency and financial posting currency do not match.',

          repairability:
            REPAIRABILITY.NONE,

          action:
            REPAIR_ACTIONS.REQUIRE_REVIEW,

          blocksFinancialExecution:
            true,

          evidence: {
            localCurrency:
              l.currency,

            financialCurrency:
              f.currency,
          },
        }),
      );
    }

    if (
      context.expectedCurrency &&
      l.currency &&
      context.expectedCurrency !==
        l.currency
    ) {
      out.push(
        finding({
          code:
            'EXPECTED_CURRENCY_MISMATCH',

          severity:
            SEVERITY.CRITICAL,

          message:
            'Expected payment currency does not match local payment currency.',

          repairability:
            REPAIRABILITY.NONE,

          action:
            REPAIR_ACTIONS.REQUIRE_REVIEW,

          blocksFinancialExecution:
            true,

          evidence: {
            expectedCurrency:
              context.expectedCurrency,

            localCurrency:
              l.currency,
          },
        }),
      );
    }

    if (
      p.providerTransactionId &&
      l.providerTransactionId &&
      !sameString(
        p.providerTransactionId,
        l.providerTransactionId,
        true,
      )
    ) {
      out.push(
        finding({
          code:
            'PROVIDER_TRANSACTION_ID_MISMATCH',

          severity:
            SEVERITY.HIGH,

          message:
            'Provider transaction identity differs between Airtel and TITech.',

          repairability:
            REPAIRABILITY.REVIEW,

          action:
            REPAIR_ACTIONS.REQUIRE_REVIEW,

          blocksFinancialExecution:
            true,

          evidence: {
            providerTransactionId:
              p.providerTransactionId,

            localProviderTransactionId:
              l.providerTransactionId,
          },
        }),
      );
    }

    if (
      p.providerReference &&
      l.providerReference &&
      !sameString(
        p.providerReference,
        l.providerReference,
        this.config.referenceCaseSensitive,
      )
    ) {
      out.push(
        finding({
          code:
            'PROVIDER_REFERENCE_MISMATCH',

          severity:
            SEVERITY.HIGH,

          message:
            'Provider reference differs between Airtel and TITech.',

          repairability:
            REPAIRABILITY.REVIEW,

          action:
            REPAIR_ACTIONS.REQUIRE_REVIEW,

          blocksFinancialExecution:
            true,

          evidence: {
            providerReference:
              p.providerReference,

            localProviderReference:
              l.providerReference,
          },
        }),
      );
    }

    if (
      p.success &&
      l.success &&
      p.providerReference &&
      !l.providerReference
    ) {
      out.push(
        finding({
          code:
            'LOCAL_PROVIDER_REFERENCE_MISSING',

          severity:
            SEVERITY.MEDIUM,

          message:
            'Provider reference is present but missing from the successful local payment record.',

          repairability:
            REPAIRABILITY.CONTROLLED,

          action:
            REPAIR_ACTIONS.ATTACH_PROVIDER_REFERENCE,

          evidence: {
            providerReference:
              p.providerReference,
          },
        }),
      );
    }

    if (
      l.success &&
      !f.posted
    ) {
      out.push(
        finding({
          code:
            'LOCAL_SUCCESS_FINANCIAL_POSTING_MISSING',

          severity:
            SEVERITY.CRITICAL,

          message:
            'Local payment is successful but no authoritative financial posting is present in the supplied evidence.',

          repairability:
            REPAIRABILITY.FINANCIAL_CORE,

          action:
            REPAIR_ACTIONS.POST_FINANCIAL_SETTLEMENT,

          evidence: {
            localStatus:
              l.status,

            financialStatus:
              f.status,
          },
        }),
      );
    }

    if (
      f.posted &&
      !l.success
    ) {
      out.push(
        finding({
          code:
            'FINANCIAL_POSTED_LOCAL_NOT_SUCCESS',

          severity:
            SEVERITY.HIGH,

          message:
            'Authoritative financial posting exists while local commercial payment state is not successful.',

          repairability:
            REPAIRABILITY.CONTROLLED,

          action:
            REPAIR_ACTIONS.REPAIR_COMMERCIAL_LINKAGE,

          evidence: {
            financialStatus:
              f.status,

            localStatus:
              l.status,
          },
        }),
      );
    }

    if (
      f.posted &&
      !f.ledgerTransactionId
    ) {
      out.push(
        finding({
          code:
            'FINANCIAL_LEDGER_LINK_MISSING',

          severity:
            SEVERITY.HIGH,

          message:
            'Financial posting evidence exists without ledger linkage.',

          repairability:
            REPAIRABILITY.REVIEW,

          action:
            REPAIR_ACTIONS.REQUIRE_REVIEW,

          blocksFinancialExecution:
            true,
        }),
      );
    }

    if (
      f.reversed &&
      l.success
    ) {
      out.push(
        finding({
          code:
            'FINANCIAL_REVERSED_LOCAL_SUCCESS',

          severity:
            SEVERITY.CRITICAL,

          message:
            'Financial evidence indicates reversal/refund while local payment remains successful.',

          repairability:
            REPAIRABILITY.REVIEW,

          action:
            REPAIR_ACTIONS.REQUIRE_REVIEW,

          blocksFinancialExecution:
            true,

          evidence: {
            financialStatus:
              f.status,

            localStatus:
              l.status,
          },
        }),
      );
    }

    if (
      p.success &&
      l.success &&
      f.posted &&
      out.length === 0
    ) {
      out.push(
        finding({
          code:
            'RECONCILIATION_MATCHED',

          severity:
            SEVERITY.INFO,

          message:
            'Provider, local and financial evidence are internally consistent.',

          repairability:
            REPAIRABILITY.NONE,

          action:
            REPAIR_ACTIONS.NO_ACTION,
        }),
      );
    }

    return Object.freeze(
      out,
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Reconciliation status
   * --------------------------------------------------------------------------
   */

  #status(
    findings,
  ) {
    if (
      findings.length === 1 &&
      findings[0].code ===
        'RECONCILIATION_MATCHED'
    ) {
      return RECONCILIATION_STATUS.CONSISTENT;
    }

    if (
      findings.some(
        item =>
          item.blocksFinancialExecution &&
          item.severity ===
            SEVERITY.CRITICAL,
      )
    ) {
      return RECONCILIATION_STATUS.BLOCKED;
    }

    if (
      findings.some(
        item =>
          item.repairability ===
          REPAIRABILITY.FINANCIAL_CORE,
      )
    ) {
      return RECONCILIATION_STATUS.REPAIRABLE;
    }

    if (
      findings.some(
        item =>
          item.repairability !==
          REPAIRABILITY.NONE,
      )
    ) {
      return RECONCILIATION_STATUS.REVIEW_REQUIRED;
    }

    return RECONCILIATION_STATUS.MISMATCH;
  }

  /**
   * --------------------------------------------------------------------------
   * Confidence calculation
   * --------------------------------------------------------------------------
   */

  #confidence(
    e,
    findings,
  ) {
    let score =
      1;

    if (
      !e.provider.exists
    ) {
      score -=
        0.30;
    }

    if (
      !e.local.exists
    ) {
      score -=
        0.30;
    }

    if (
      !e.financial.exists
    ) {
      score -=
        0.20;
    }

    score -=
      Math.min(
        0.35,

        findings.filter(
          item =>
            item.severity ===
              SEVERITY.CRITICAL ||
            item.severity ===
              SEVERITY.HIGH,
        ).length *
          0.08,
      );

    if (
      e.provider.amount !==
        null &&
      e.local.amount !==
        null
    ) {
      score +=
        0.05;
    }

    if (
      e.provider
        .providerTransactionId &&
      e.local
        .providerTransactionId
    ) {
      score +=
        0.05;
    }

    return Number(
      Math.max(
        0,
        Math.min(
          1,
          score,
        ),
      ).toFixed(
        4,
      ),
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Safe evidence projection
   * --------------------------------------------------------------------------
   */

  #safeEvidence(e) {
    return {
      provider: {
        exists:
          e.provider.exists,

        status:
          e.provider.status,

        amount:
          e.provider.amount,

        currency:
          e.provider.currency,

        providerTransactionId:
          e.provider.providerTransactionId,

        providerReference:
          e.provider.providerReference,

        occurredAt:
          e.provider.occurredAt
            ?.toISOString() ||
          null,
      },

      local: {
        exists:
          e.local.exists,

        status:
          e.local.status,

        amount:
          e.local.amount,

        currency:
          e.local.currency,

        providerTransactionId:
          e.local.providerTransactionId,

        providerReference:
          e.local.providerReference,

        financialTransactionId:
          e.local.financialTransactionId,

        updatedAt:
          e.local.updatedAt
            ?.toISOString() ||
          null,
      },

      financial: {
        exists:
          e.financial.exists,

        status:
          e.financial.status,

        amount:
          e.financial.amount,

        currency:
          e.financial.currency,

        financialTransactionId:
          e.financial
            .financialTransactionId,

        ledgerTransactionId:
          e.financial
            .ledgerTransactionId,

        postedAt:
          e.financial.postedAt
            ?.toISOString() ||
          null,
      },
    };
  }

  /**
   * --------------------------------------------------------------------------
   * Repair-step construction
   * --------------------------------------------------------------------------
   */

  #steps(
    reconciliation,
    context,
  ) {
    const unique =
      [];

    const seen =
      new Set();

    for (
      const item of
        reconciliation.findings
    ) {
      if (
        item.code ===
        'RECONCILIATION_MATCHED'
      ) {
        continue;
      }

      const key =
        `${item.code}:${item.action}`;

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(
        key,
      );

      unique.push({
        stepId:
          fingerprint({
            repair:
              reconciliation
                .fingerprint,

            code:
              item.code,

            action:
              item.action,
          }).slice(
            0,
            20,
          ),

        findingCode:
          item.code,

        action:
          item.action,

        severity:
          item.severity,

        repairability:
          item.repairability,

        blocksFinancialExecution:
          item
            .blocksFinancialExecution,

        tenantId:
          context.tenantId,

        paymentId:
          context.paymentId,

        provider:
          context.provider,

        precondition:
          this.#precondition(
            item.code,
          ),

        rationale:
          String(
            item.message,
          ).slice(
            0,
            this.config
              .maxReasonLength,
          ),

        requiredAuthority:
          item.repairability ===
          REPAIRABILITY.FINANCIAL_CORE
            ? 'TITECH_FINANCIAL_CORE'
            : 'TITECH_CONTROLLED_REPAIR',
      });
    }

    return Object.freeze(
      unique,
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Repair preconditions
   * --------------------------------------------------------------------------
   */

  #precondition(
    code,
  ) {
    const values = {
      PROVIDER_SUCCESS_LOCAL_MISSING:
        'Correlate the authoritative Airtel success to the TITech payment identity before any financial posting is considered.',

      PROVIDER_SUCCESS_LOCAL_NOT_SETTLED:
        'Verify Airtel identity, amount and currency before commercial/financial recovery.',

      LOCAL_SUCCESS_FINANCIAL_POSTING_MISSING:
        'Verify that no authoritative financial transaction already exists for the payment idempotency identity before posting.',

      FINANCIAL_POSTED_LOCAL_NOT_SUCCESS:
        'Recover the existing financial transaction and repair commercial linkage; do not post again.',

      PROVIDER_PENDING_STALE:
        'Refetch authoritative provider status before changing local payment state.',

      LOCAL_PROVIDER_REFERENCE_MISSING:
        'Confirm provider reference belongs to the same successful payment before attachment.',

      FINANCIAL_LEDGER_LINK_MISSING:
        'Locate the authoritative ledger/journal linkage; never synthesize a ledger identifier.',
    };

    return (
      values[code] ||
      'Evidence must remain consistent with the authoritative source before controlled repair.'
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Plan validation
   * --------------------------------------------------------------------------
   */

  #assertPlan(
    plan,
  ) {
    if (
      !isPlainObject(plan)
    ) {
      throw new AirtelReconciliationRepairError(
        'Repair plan must be a plain object.',
        {
          code:
            'REPAIR_PLAN_INVALID',

          statusCode:
            422,
        },
      );
    }

    if (
      plan.engine !==
        ENGINE_NAME ||
      plan.version !==
        ENGINE_VERSION
    ) {
      throw new AirtelReconciliationRepairError(
        'Repair plan was generated by an incompatible engine version.',
        {
          code:
            'REPAIR_PLAN_VERSION_MISMATCH',

          statusCode:
            409,
        },
      );
    }

    if (
      !plan.repairId ||
      !plan.repairIdempotencyKey
    ) {
      throw new AirtelReconciliationRepairError(
        'Repair plan is missing deterministic repair identity.',
        {
          code:
            'REPAIR_PLAN_IDENTITY_MISSING',

          statusCode:
            422,
        },
      );
    }
  }

  /**
   * --------------------------------------------------------------------------
   * Execution context
   * --------------------------------------------------------------------------
   */

  #executionContext(
    plan,
    input,
  ) {
    const actorRaw =
      isPlainObject(
        input.actor,
      )
        ? clone(
            input.actor,
          )
        : {};

    const actorId =
      normalizeId(
        actorRaw.id ??
        actorRaw.userId ??
        actorRaw._id,
        'actor.id',
        256,
      );

    const approvalRaw =
      isPlainObject(
        input.approval,
      )
        ? clone(
            input.approval,
          )
        : null;

    return {
      actor: {
        id:
          actorId,

        roles:
          Array.isArray(
            actorRaw.roles,
          )
            ? actorRaw.roles
                .map(
                  item =>
                    upper(
                      item,
                      null,
                    ),
                )
                .filter(Boolean)
            : [],
      },

      approval:
        approvalRaw
          ? {
              ...approvalRaw,

              approvalId:
                normalizeId(
                  approvalRaw.approvalId ??
                  approvalRaw.id ??
                  approvalRaw._id,
                  'approval.approvalId',
                  256,
                ),

              approverId:
                normalizeId(
                  approvalRaw.approverId ??
                  approvalRaw.userId ??
                  approvalRaw.actorId,
                  'approval.approverId',
                  256,
                ),

              approved:
                approvalRaw.approved ===
                true,
            }
          : null,

      executionIdempotencyKey:
        normalizeId(
          input.executionIdempotencyKey ??
          input.idempotencyKey ??
          plan.repairIdempotencyKey,
          'executionIdempotencyKey',
          512,
        ),

      requestId:
        normalizeId(
          input.requestId,
          'requestId',
          256,
        ),

      correlationId:
        normalizeId(
          input.correlationId,
          'correlationId',
          256,
        ),

      session:
        input.session ||
        null,

      dryRun:
        input.dryRun ===
        true,
    };
  }

  /**
   * --------------------------------------------------------------------------
   * Execution safety policy
   * --------------------------------------------------------------------------
   */

  #assertExecutionAllowed(
    plan,
    ctx,
  ) {
    if (
      !plan.tenantId
    ) {
      throw new AirtelReconciliationRepairError(
        'Repair execution requires tenant isolation.',
        {
          code:
            'REPAIR_TENANT_REQUIRED',

          statusCode:
            422,
        },
      );
    }

    if (
      plan.blocked &&
      !ctx.dryRun
    ) {
      throw new AirtelReconciliationRepairError(
        'Repair execution is blocked because the reconciliation evidence contains a financial safety conflict.',
        {
          code:
            'REPAIR_EXECUTION_BLOCKED',

          statusCode:
            409,

          details: {
            repairId:
              plan.repairId,
          },
        },
      );
    }

    if (
      !this.config
        .allowControlledExecution &&
      !ctx.dryRun
    ) {
      throw new AirtelReconciliationRepairError(
        'Controlled repair execution is disabled by configuration.',
        {
          code:
            'CONTROLLED_REPAIR_DISABLED',

          statusCode:
            503,
        },
      );
    }

    if (
      !ctx.actor.id &&
      !ctx.dryRun
    ) {
      throw new AirtelReconciliationRepairError(
        'Repair execution requires an authenticated actor identity.',
        {
          code:
            'REPAIR_ACTOR_REQUIRED',

          statusCode:
            401,
        },
      );
    }

    const financialRepair =
      plan.steps.some(
        step =>
          step.repairability ===
          REPAIRABILITY.FINANCIAL_CORE,
      );

    if (
      financialRepair &&
      this.config
        .makerCheckerForFinancialRepair &&
      !ctx.dryRun
    ) {
      if (
        !ctx.approval?.approved
      ) {
        throw new AirtelReconciliationRepairError(
          'Financial reconciliation repair requires explicit checker approval.',
          {
            code:
              'REPAIR_CHECKER_APPROVAL_REQUIRED',

            statusCode:
              403,
          },
        );
      }

      if (
        !ctx.approval.approvalId ||
        !ctx.approval.approverId
      ) {
        throw new AirtelReconciliationRepairError(
          'Checker approval must include approvalId and approverId.',
          {
            code:
              'REPAIR_APPROVAL_IDENTITY_INVALID',

            statusCode:
              403,
          },
        );
      }

      if (
        ctx.actor.id ===
        ctx.approval.approverId
      ) {
        throw new AirtelReconciliationRepairError(
          'Maker and checker must be distinct principals for financial-impacting repair.',
          {
            code:
              'REPAIR_MAKER_CHECKER_SEPARATION_REQUIRED',

            statusCode:
              403,
          },
        );
      }
    }
  }

  /**
   * --------------------------------------------------------------------------
   * Repair executor resolution
   * --------------------------------------------------------------------------
   */

  #executor() {
    if (
      !this.repairAdapter
    ) {
      return null;
    }

    for (
      const method of [
        'applyRepairPlan',
        'executeRepairPlan',
        'repair',
        'execute',
      ]
    ) {
      if (
        typeof this
          .repairAdapter?.[
            method
          ] ===
        'function'
      ) {
        return this
          .repairAdapter[
          method
        ].bind(
          this.repairAdapter,
        );
      }
    }

    return null;
  }

  /**
   * --------------------------------------------------------------------------
   * Observability
   * --------------------------------------------------------------------------
   */

  #observe(
    operation,
    result,
  ) {
    if (
      !this.metrics
    ) {
      return;
    }

    const labels = {
      operation,

      status:
        result?.status ||
        'UNKNOWN',

      provider:
        result?.provider ||
        this.config.provider,
    };

    try {
      if (
        typeof this.metrics
          .increment ===
        'function'
      ) {
        this.metrics.increment(
          'titech_airtel_reconciliation_total',
          1,
          labels,
        );
      } else if (
        typeof this.metrics
          .inc ===
        'function'
      ) {
        this.metrics.inc(
          'titech_airtel_reconciliation_total',
          labels,
        );
      } else if (
        typeof this.metrics
          .count ===
        'function'
      ) {
        this.metrics.count(
          'titech_airtel_reconciliation_total',
          1,
          labels,
        );
      }
    } catch {
      // Telemetry must never alter reconciliation behavior.
    }
  }

  #log(
    level,
    payload,
  ) {
    if (
      !this.logger
    ) {
      return;
    }

    try {
      const method =
        typeof this.logger[level] ===
        'function'
          ? this.logger[level]
          : typeof this.logger.info ===
              'function'
            ? this.logger.info
            : null;

      method?.call(
        this.logger,
        {
          component:
            COMPONENT,

          engineVersion:
            ENGINE_VERSION,

          ...payload,
        },
      );
    } catch {
      // Logging must never alter reconciliation behavior.
    }
  }
}

// =============================================================================
// Factory / default instance
// =============================================================================

export function createReconciliationRepairEngine(
  options = {},
) {
  return new AirtelReconciliationRepairEngine(
    options,
  );
}

export const defaultReconciliationRepairEngine =
  createReconciliationRepairEngine();

export default AirtelReconciliationRepairEngine;