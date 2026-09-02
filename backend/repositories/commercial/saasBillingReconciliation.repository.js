'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * SaaS Billing Reconciliation Repository
 * ============================================================================
 *
 * File:
 * backend/repositories/commercial/saasBillingReconciliation.repository.js
 *
 * Stage:
 * Commercial Consolidation — Stage 01d
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Persistence boundary for SaaS billing shadow reconciliations.
 *
 * Architectural responsibility:
 *
 *   Stage 01d Services
 *          │
 *          ▼
 *   SaaS Billing Reconciliation Repository
 *          │
 *          ▼
 *   SaasBillingReconciliation Model
 *          │
 *          ▼
 *       MongoDB
 *
 * Repository guarantees:
 * ----------------------------------------------------------------------------
 * ✓ Tenant isolation
 * ✓ Deterministic reconciliation-key isolation
 * ✓ Idempotent reconciliation persistence
 * ✓ Duplicate-key recovery
 * ✓ Terminal-state protection
 * ✓ Safe status transitions
 * ✓ Divergence queries
 * ✓ Observation-window queries
 * ✓ Aggregate parity primitives
 * ✓ Pagination support
 * ✓ Optional MongoDB session support
 * ✓ Lean read operations
 * ✓ Controlled field updates
 * ✓ No authorization decisions
 * ✓ No billing calculations
 * ✓ No cut-over decisions
 * ✓ No transaction ownership
 * ✓ No authoritative billing mutations
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This repository is observational.
 *
 * It NEVER:
 *
 * - posts invoices
 * - posts ledger entries
 * - captures payments
 * - changes subscription state
 * - changes tenant billing state
 * - switches billing engines
 * - authorizes commercial billing
 *
 * Stage 01d remains shadow-only.
 *
 * The legacy billing engine remains authoritative.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const SaasBillingReconciliation = require(
  '../../models/saasBillingReconciliation.model',
);

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const DEFAULT_SORT = Object.freeze({
  createdAt: -1,
  _id: -1,
});

const TERMINAL_STATUSES = Object.freeze([
  'matched',
  'matched_within_tolerance',
  'diverged',
  'inconclusive',
  'failed',
  'skipped',
]);

const DIVERGENCE_STATUSES = Object.freeze([
  'diverged',
  'inconclusive',
  'failed',
]);

const MATCH_STATUSES = Object.freeze([
  'matched',
  'matched_within_tolerance',
]);

const SAFE_UPDATE_FIELDS = Object.freeze([
  'status',
  'classification',
  'severity',

  'legacyResultHash',
  'shadowResultHash',
  'normalizedLegacyResultHash',
  'normalizedShadowResultHash',

  'legacyTotal',
  'shadowTotal',
  'absoluteDelta',
  'percentageDelta',
  'basisPointDelta',

  'components',
  'lineItems',

  'tolerance',
  'withinTolerance',
  'exactMatch',

  'differences',
  'differenceCount',
  'materialDifferenceCount',

  'failure',
  'cutover',

  'metadata',
]);

/**
 * ============================================================================
 * ERROR TYPES
 * ============================================================================
 */

class SaasBillingReconciliationRepositoryError extends Error {
  constructor(
    message,
    code = 'SAAS_BILLING_RECONCILIATION_REPOSITORY_ERROR',
    details = undefined,
  ) {
    super(message);

    this.name = 'SaasBillingReconciliationRepositoryError';
    this.code = code;
    this.details = details;

    Error.captureStackTrace?.(
      this,
      SaasBillingReconciliationRepositoryError,
    );
  }
}

class ReconciliationNotFoundError extends SaasBillingReconciliationRepositoryError {
  constructor(tenantId, reconciliationKey) {
    super(
      'SaaS billing reconciliation was not found.',
      'RECONCILIATION_NOT_FOUND',
      {
        tenantId,
        reconciliationKey,
      },
    );

    this.name = 'ReconciliationNotFoundError';
  }
}

class ReconciliationTerminalStateError extends SaasBillingReconciliationRepositoryError {
  constructor(currentStatus, attemptedStatus) {
    super(
      `Terminal reconciliation state cannot be changed from "${currentStatus}" to "${attemptedStatus}".`,
      'RECONCILIATION_TERMINAL_STATE',
      {
        currentStatus,
        attemptedStatus,
      },
    );

    this.name = 'ReconciliationTerminalStateError';
  }
}

class ReconciliationTenantIsolationError extends SaasBillingReconciliationRepositoryError {
  constructor() {
    super(
      'Tenant identity is required for SaaS billing reconciliation access.',
      'TENANT_ID_REQUIRED',
    );

    this.name = 'ReconciliationTenantIsolationError';
  }
}

/**
 * ============================================================================
 * VALIDATION HELPERS
 * ============================================================================
 */

function assertTenantId(tenantId) {
  if (
    tenantId === undefined ||
    tenantId === null ||
    tenantId === ''
  ) {
    throw new ReconciliationTenantIsolationError();
  }

  return tenantId;
}

function normalizeTenantId(tenantId) {
  assertTenantId(tenantId);

  if (mongoose.Types.ObjectId.isValid(tenantId)) {
    return new mongoose.Types.ObjectId(tenantId);
  }

  return tenantId;
}

function assertNonEmptyString(value, fieldName) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new SaasBillingReconciliationRepositoryError(
      `${fieldName} is required.`,
      `INVALID_${String(fieldName).toUpperCase()}`,
    );
  }

  return value.trim();
}

function normalizePagination(options = {}) {
  const page = Number.isInteger(options.page)
    ? options.page
    : DEFAULT_PAGE;

  const requestedLimit = Number.isInteger(options.limit)
    ? options.limit
    : DEFAULT_LIMIT;

  return {
    page: Math.max(1, page),
    limit: Math.min(
      MAX_LIMIT,
      Math.max(1, requestedLimit),
    ),
  };
}

function normalizeDate(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }

  const date = value instanceof Date
    ? value
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new SaasBillingReconciliationRepositoryError(
      `${fieldName} must be a valid date.`,
      `INVALID_${String(fieldName).toUpperCase()}`,
    );
  }

  return date;
}

function isDuplicateKeyError(error) {
  return (
    error?.code === 11000 ||
    error?.name === 'MongoServerError' &&
    error?.message?.includes('E11000')
  );
}

function toPlainObject(document) {
  if (!document) {
    return null;
  }

  if (typeof document.toObject === 'function') {
    return document.toObject();
  }

  return document;
}

function sanitizeUpdate(update = {}) {
  const sanitized = {};

  for (const field of SAFE_UPDATE_FIELDS) {
    if (
      Object.prototype.hasOwnProperty.call(
        update,
        field,
      )
    ) {
      sanitized[field] = update[field];
    }
  }

  return sanitized;
}

function normalizeSort(sort) {
  if (!sort || typeof sort !== 'object') {
    return DEFAULT_SORT;
  }

  const allowedFields = new Set([
    'createdAt',
    'updatedAt',
    'severity',
    'status',
    'classification',
    'operation',
    'percentageDelta',
    'basisPointDelta',
  ]);

  const result = {};

  for (const [field, direction] of Object.entries(sort)) {
    if (!allowedFields.has(field)) {
      continue;
    }

    result[field] =
      Number(direction) === 1 ? 1 : -1;
  }

  return Object.keys(result).length
    ? result
    : DEFAULT_SORT;
}

/**
 * ============================================================================
 * REPOSITORY
 * ============================================================================
 */

class SaasBillingReconciliationRepository {
  /**
   * --------------------------------------------------------------------------
   * Constructor
   * --------------------------------------------------------------------------
   */

  constructor(model = SaasBillingReconciliation, options = {}) {
    if (!model) {
      throw new SaasBillingReconciliationRepositoryError(
        'SaasBillingReconciliation model is required.',
        'MODEL_REQUIRED',
      );
    }

    this.model = model;

    this.logger = options.logger || null;

    this.terminalStatuses = new Set(
      options.terminalStatuses || TERMINAL_STATUSES,
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Logging
   * --------------------------------------------------------------------------
   */

  log(level, message, metadata = {}) {
    try {
      if (
        this.logger &&
        typeof this.logger[level] === 'function'
      ) {
        this.logger[level](
          message,
          metadata,
        );
      }
    } catch {
      // Logging must never break reconciliation persistence.
    }
  }

  /**
   * ==========================================================================
   * CREATE
   * ==========================================================================
   */

  async create(
    tenantId,
    document,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    if (
      !document ||
      typeof document !== 'object'
    ) {
      throw new SaasBillingReconciliationRepositoryError(
        'Reconciliation document is required.',
        'DOCUMENT_REQUIRED',
      );
    }

    if (
      document.tenantId !== undefined &&
      String(document.tenantId) !==
        String(normalizedTenantId)
    ) {
      throw new SaasBillingReconciliationRepositoryError(
        'Document tenantId does not match repository tenantId.',
        'TENANT_MISMATCH',
      );
    }

    const payload = {
      ...document,
      tenantId: normalizedTenantId,

      shadowMode:
        document.shadowMode !== false,

      authoritativeWritePerformed:
        document.authoritativeWritePerformed === true
          ? true
          : false,
    };

    /**
     * Stage 01d safety:
     *
     * A reconciliation record may NEVER represent an authoritative write.
     */
    if (
      payload.shadowMode !== true ||
      payload.authoritativeWritePerformed === true
    ) {
      throw new SaasBillingReconciliationRepositoryError(
        'Stage 01d reconciliation must remain shadow-only.',
        'SHADOW_SAFETY_VIOLATION',
      );
    }

    try {
      const result =
        await this.model.create(
          [payload],
          {
            session:
              options.session || undefined,
          },
        );

      return toPlainObject(result[0]);
    } catch (error) {
      this.log(
        'error',
        'Failed to create SaaS billing reconciliation.',
        {
          tenantId: String(normalizedTenantId),
          reconciliationKey:
            payload.reconciliationKey,
          error: error.message,
        },
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * FIND BY ID
   * ==========================================================================
   */

  async findById(
    tenantId,
    id,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }

    return this.model
      .findOne({
        _id: id,
        tenantId: normalizedTenantId,
      })
      .session(options.session || null)
      .lean();
  }

  /**
   * ==========================================================================
   * FIND BY RECONCILIATION KEY
   * ==========================================================================
   */

  async findByReconciliationKey(
    tenantId,
    reconciliationKey,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const key = assertNonEmptyString(
      reconciliationKey,
      'reconciliationKey',
    );

    return this.model
      .findOne({
        tenantId: normalizedTenantId,
        reconciliationKey: key,
      })
      .session(options.session || null)
      .lean();
  }

  /**
   * ==========================================================================
   * FIND BY EXECUTION ID
   * ==========================================================================
   */

  async findByExecutionId(
    tenantId,
    executionId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    if (
      !mongoose.Types.ObjectId.isValid(
        executionId,
      )
    ) {
      return null;
    }

    return this.model
      .findOne({
        tenantId: normalizedTenantId,
        executionId,
      })
      .session(options.session || null)
      .lean();
  }

  /**
   * ==========================================================================
   * IDEMPOTENT CREATE / UPSERT
   * ==========================================================================
   *
   * Preferred Stage 01d persistence operation.
   *
   * The deterministic key is:
   *
   *   tenantId + reconciliationKey
   *
   * The unique compound index on the model provides the final race-safety
   * guarantee.
   */

  async createIfAbsent({
    tenantId,
    reconciliationKey,
    document,
    session = null,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const key = assertNonEmptyString(
      reconciliationKey ||
        document?.reconciliationKey,
      'reconciliationKey',
    );

    if (
      !document ||
      typeof document !== 'object'
    ) {
      throw new SaasBillingReconciliationRepositoryError(
        'Reconciliation document is required.',
        'DOCUMENT_REQUIRED',
      );
    }

    const payload = {
      ...document,
      tenantId: normalizedTenantId,
      reconciliationKey: key,
      shadowMode: true,
      authoritativeWritePerformed: false,
    };

    const filter = {
      tenantId: normalizedTenantId,
      reconciliationKey: key,
    };

    /**
     * First read.
     *
     * This is an optimization only.
     * The unique database index remains the concurrency guarantee.
     */

    const existing =
      await this.model
        .findOne(filter)
        .session(session || null)
        .lean();

    if (existing) {
      return {
        created: false,
        existing: true,
        document: existing,
      };
    }

    try {
      const created =
        await this.model.create(
          [payload],
          {
            session:
              session || undefined,
          },
        );

      return {
        created: true,
        existing: false,
        document: toPlainObject(created[0]),
      };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      /**
       * Another worker won the race.
       *
       * Return the authoritative persisted reconciliation observation rather
       * than creating a second logical observation.
       */

      const racedExisting =
        await this.model
          .findOne(filter)
          .session(session || null)
          .lean();

      if (racedExisting) {
        return {
          created: false,
          existing: true,
          raced: true,
          document: racedExisting,
        };
      }

      throw error;
    }
  }

  /**
   * ==========================================================================
   * UPSERT INITIAL RECONCILIATION
   * ==========================================================================
   *
   * Unlike a generic Mongo upsert, this method only allows creation when the
   * reconciliation does not exist.
   *
   * Existing terminal state is never silently replaced.
   */

  async upsertInitial({
    tenantId,
    reconciliationKey,
    document,
    session = null,
  } = {}) {
    return this.createIfAbsent({
      tenantId,
      reconciliationKey,
      document,
      session,
    });
  }

  /**
   * ==========================================================================
   * FIND MANY
   * ==========================================================================
   */

  async find(
    tenantId,
    filters = {},
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const safeFilters = {
      ...filters,
    };

    /**
     * Never allow callers to override tenant isolation.
     */
    delete safeFilters.tenantId;

    return this.model
      .find({
        ...safeFilters,
        tenantId: normalizedTenantId,
      })
      .sort(normalizeSort(options.sort))
      .skip(
        Math.max(
          0,
          Number(options.skip) || 0,
        ),
      )
      .limit(
        Math.min(
          MAX_LIMIT,
          Math.max(
            0,
            Number(options.limit) || 0,
          ),
        ),
      )
      .session(options.session || null)
      .lean();
  }

  /**
   * ==========================================================================
   * SEARCH / PAGINATION
   * ==========================================================================
   */

  async search(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const {
      page,
      limit,
    } = normalizePagination(options);

    const query = {
      tenantId: normalizedTenantId,
    };

    if (options.status) {
      query.status = Array.isArray(options.status)
        ? {
            $in: options.status,
          }
        : options.status;
    }

    if (options.classification) {
      query.classification =
        Array.isArray(options.classification)
          ? {
              $in: options.classification,
            }
          : options.classification;
    }

    if (options.severity) {
      query.severity =
        Array.isArray(options.severity)
          ? {
              $in: options.severity,
            }
          : options.severity;
    }

    if (options.operation) {
      query.operation =
        Array.isArray(options.operation)
          ? {
              $in: options.operation,
            }
          : options.operation;
    }

    if (options.planCode) {
      query['context.planCode'] =
        options.planCode;
    }

    if (options.currency) {
      query['context.currency'] =
        String(options.currency).toUpperCase();
    }

    if (options.startDate || options.endDate) {
      const startDate =
        normalizeDate(
          options.startDate,
          'startDate',
        );

      const endDate =
        normalizeDate(
          options.endDate,
          'endDate',
        );

      query.createdAt = {};

      if (startDate) {
        query.createdAt.$gte = startDate;
      }

      if (endDate) {
        query.createdAt.$lte = endDate;
      }
    }

    if (options.withinTolerance !== undefined) {
      query.withinTolerance =
        Boolean(options.withinTolerance);
    }

    if (options.exactMatch !== undefined) {
      query.exactMatch =
        Boolean(options.exactMatch);
    }

    if (
      options.cutoverStatus
    ) {
      query['cutover.status'] =
        Array.isArray(options.cutoverStatus)
          ? {
              $in: options.cutoverStatus,
            }
          : options.cutoverStatus;
    }

    const skip =
      (page - 1) * limit;

    const [
      documents,
      total,
    ] = await Promise.all([
      this.model
        .find(query)
        .sort(
          normalizeSort(options.sort),
        )
        .skip(skip)
        .limit(limit)
        .session(
          options.session || null,
        )
        .lean(),

      this.model.countDocuments(query),
    ]);

    return {
      documents,
      pagination: {
        page,
        limit,
        total,
        pages:
          total === 0
            ? 0
            : Math.ceil(
                total / limit,
              ),
      },
    };
  }

  /**
   * ==========================================================================
   * COUNT
   * ==========================================================================
   */

  async count(
    tenantId,
    filters = {},
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const safeFilters = {
      ...filters,
    };

    delete safeFilters.tenantId;

    return this.model.countDocuments({
      ...safeFilters,
      tenantId: normalizedTenantId,
    });
  }

  /**
   * ==========================================================================
   * UPDATE NON-TERMINAL RECONCILIATION
   * ==========================================================================
   *
   * This is the primary safe mutation primitive.
   *
   * Terminal records cannot be silently overwritten.
   */

  async updateNonTerminal(
    tenantId,
    reconciliationKey,
    update,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const key = assertNonEmptyString(
      reconciliationKey,
      'reconciliationKey',
    );

    const safeUpdate =
      sanitizeUpdate(update);

    /**
     * Never permit these fields to be changed.
     */

    delete safeUpdate.tenantId;
    delete safeUpdate.reconciliationKey;
    delete safeUpdate.shadowMode;
    delete safeUpdate.authoritativeWritePerformed;
    delete safeUpdate.executionId;

    if (
      safeUpdate.status &&
      this.terminalStatuses.has(
        safeUpdate.status,
      )
    ) {
      /**
       * A transition INTO a terminal state is permitted.
       * A transition FROM a terminal state is prevented by the query below.
       */
    }

    const result =
      await this.model.findOneAndUpdate(
        {
          tenantId: normalizedTenantId,
          reconciliationKey: key,

          /**
           * Terminal-state protection.
           *
           * A record already in a terminal state cannot be modified.
           */
          status: {
            $nin:
              Array.from(
                this.terminalStatuses,
              ),
          },

          shadowMode: true,

          authoritativeWritePerformed: false,
        },
        {
          $set: safeUpdate,
        },
        {
          new: true,
          runValidators: true,
          session:
            options.session || undefined,
        },
      ).lean();

    if (result) {
      return result;
    }

    const existing =
      await this.findByReconciliationKey(
        normalizedTenantId,
        key,
        options,
      );

    if (!existing) {
      throw new ReconciliationNotFoundError(
        String(normalizedTenantId),
        key,
      );
    }

    if (
      this.terminalStatuses.has(
        existing.status,
      )
    ) {
      throw new ReconciliationTerminalStateError(
        existing.status,
        safeUpdate.status ||
          'update',
      );
    }

    throw new SaasBillingReconciliationRepositoryError(
      'Reconciliation update did not modify the expected record.',
      'RECONCILIATION_UPDATE_FAILED',
      {
        tenantId:
          String(normalizedTenantId),
        reconciliationKey: key,
      },
    );
  }

  /**
   * ==========================================================================
   * SAFE STATUS TRANSITION
   * ==========================================================================
   */

  async transitionStatus({
    tenantId,
    reconciliationKey,
    fromStatuses,
    toStatus,
    classification,
    severity,
    session = null,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const key = assertNonEmptyString(
      reconciliationKey,
      'reconciliationKey',
    );

    const allowedFromStatuses =
      Array.isArray(fromStatuses) &&
      fromStatuses.length
        ? fromStatuses
        : ['pending'];

    const update = {
      status: toStatus,
    };

    if (classification !== undefined) {
      update.classification =
        classification;
    }

    if (severity !== undefined) {
      update.severity =
        severity;
    }

    const result =
      await this.model.findOneAndUpdate(
        {
          tenantId: normalizedTenantId,
          reconciliationKey: key,

          status: {
            $in: allowedFromStatuses,
          },

          shadowMode: true,

          authoritativeWritePerformed: false,
        },
        {
          $set: update,
        },
        {
          new: true,
          runValidators: true,
          session:
            session || undefined,
        },
      ).lean();

    if (result) {
      return result;
    }

    const existing =
      await this.findByReconciliationKey(
        normalizedTenantId,
        key,
        {
          session,
        },
      );

    if (!existing) {
      throw new ReconciliationNotFoundError(
        String(normalizedTenantId),
        key,
      );
    }

    if (
      this.terminalStatuses.has(
        existing.status,
      )
    ) {
      throw new ReconciliationTerminalStateError(
        existing.status,
        toStatus,
      );
    }

    throw new SaasBillingReconciliationRepositoryError(
      'Invalid reconciliation status transition.',
      'INVALID_RECONCILIATION_TRANSITION',
      {
        currentStatus:
          existing.status,
        allowedFromStatuses,
        toStatus,
      },
    );
  }

  /**
   * ==========================================================================
   * ATTACH EXECUTION
   * ==========================================================================
   */

  async attachExecution({
    tenantId,
    reconciliationKey,
    executionId,
    session = null,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const key = assertNonEmptyString(
      reconciliationKey,
      'reconciliationKey',
    );

    if (
      !mongoose.Types.ObjectId.isValid(
        executionId,
      )
    ) {
      throw new SaasBillingReconciliationRepositoryError(
        'executionId must be a valid ObjectId.',
        'INVALID_EXECUTION_ID',
      );
    }

    const result =
      await this.model.findOneAndUpdate(
        {
          tenantId: normalizedTenantId,
          reconciliationKey: key,

          shadowMode: true,

          authoritativeWritePerformed: false,
        },
        {
          $set: {
            executionId,
          },
        },
        {
          new: true,
          runValidators: true,
          session:
            session || undefined,
        },
      ).lean();

    if (!result) {
      throw new ReconciliationNotFoundError(
        String(normalizedTenantId),
        key,
      );
    }

    return result;
  }

  /**
   * ==========================================================================
   * DIVERGENCE QUERY
   * ==========================================================================
   */

  async findDivergences(
    tenantId,
    options = {},
  ) {
    return this.search(
      tenantId,
      {
        ...options,
        status:
          options.status ||
          DIVERGENCE_STATUSES,
      },
    );
  }

  /**
   * ==========================================================================
   * MATCH QUERY
   * ==========================================================================
   */

  async findMatches(
    tenantId,
    options = {},
  ) {
    return this.search(
      tenantId,
      {
        ...options,
        status:
          options.status ||
          MATCH_STATUSES,
      },
    );
  }

  /**
   * ==========================================================================
   * HIGH-SEVERITY DIVERGENCES
   * ==========================================================================
   */

  async findHighSeverityDivergences(
    tenantId,
    options = {},
  ) {
    return this.search(
      tenantId,
      {
        ...options,
        status: DIVERGENCE_STATUSES,
        severity:
          options.severity || [
            'high',
            'critical',
          ],
      },
    );
  }

  /**
   * ==========================================================================
   * OBSERVATION WINDOW
   * ==========================================================================
   *
   * Returns reconciliations created inside a specific time window.
   *
   * This primitive is intentionally raw enough for the telemetry service to
   * calculate policy-specific metrics without embedding telemetry policy in
   * the repository.
   */

  async findObservationWindow({
    tenantId,
    startDate,
    endDate,
    operation,
    planCode,
    currency,
    session = null,
    limit = MAX_LIMIT,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const start =
      normalizeDate(
        startDate,
        'startDate',
      );

    const end =
      normalizeDate(
        endDate,
        'endDate',
      );

    if (!start || !end) {
      throw new SaasBillingReconciliationRepositoryError(
        'Both startDate and endDate are required for an observation window.',
        'OBSERVATION_WINDOW_REQUIRED',
      );
    }

    if (end <= start) {
      throw new SaasBillingReconciliationRepositoryError(
        'Observation window endDate must be after startDate.',
        'INVALID_OBSERVATION_WINDOW',
      );
    }

    const query = {
      tenantId: normalizedTenantId,

      createdAt: {
        $gte: start,
        $lt: end,
      },
    };

    if (operation) {
      query.operation = operation;
    }

    if (planCode) {
      query['context.planCode'] =
        planCode;
    }

    if (currency) {
      query['context.currency'] =
        String(currency).toUpperCase();
    }

    return this.model
      .find(query)
      .sort(DEFAULT_SORT)
      .limit(
        Math.min(
          MAX_LIMIT,
          Math.max(
            1,
            Number(limit) || MAX_LIMIT,
          ),
        ),
      )
      .session(session || null)
      .lean();
  }

  /**
   * ==========================================================================
   * AGGREGATE OBSERVATION METRICS
   * ==========================================================================
   *
   * Provides telemetry-friendly counts.
   *
   * No cut-over policy is decided here.
   */

  async aggregateObservationMetrics({
    tenantId,
    startDate,
    endDate,
    operation,
    planCode,
    currency,
    session = null,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const start =
      normalizeDate(
        startDate,
        'startDate',
      );

    const end =
      normalizeDate(
        endDate,
        'endDate',
      );

    if (!start || !end) {
      throw new SaasBillingReconciliationRepositoryError(
        'Both startDate and endDate are required.',
        'OBSERVATION_WINDOW_REQUIRED',
      );
    }

    if (end <= start) {
      throw new SaasBillingReconciliationRepositoryError(
        'Observation window endDate must be after startDate.',
        'INVALID_OBSERVATION_WINDOW',
      );
    }

    const match = {
      tenantId: normalizedTenantId,

      createdAt: {
        $gte: start,
        $lt: end,
      },
    };

    if (operation) {
      match.operation = operation;
    }

    if (planCode) {
      match['context.planCode'] =
        planCode;
    }

    if (currency) {
      match['context.currency'] =
        String(currency).toUpperCase();
    }

    const pipeline = [
      {
        $match: match,
      },

      {
        $facet: {
          totals: [
            {
              $count: 'count',
            },
          ],

          byStatus: [
            {
              $group: {
                _id: '$status',
                count: {
                  $sum: 1,
                },
              },
            },
          ],

          byClassification: [
            {
              $group: {
                _id: '$classification',
                count: {
                  $sum: 1,
                },
              },
            },
          ],

          bySeverity: [
            {
              $group: {
                _id: '$severity',
                count: {
                  $sum: 1,
                },
              },
            },
          ],

          byOperation: [
            {
              $group: {
                _id: '$operation',
                count: {
                  $sum: 1,
                },
              },
            },
          ],

          tolerance: [
            {
              $group: {
                _id: null,
                exactMatches: {
                  $sum: {
                    $cond: [
                      '$exactMatch',
                      1,
                      0,
                    ],
                  },
                },

                withinTolerance: {
                  $sum: {
                    $cond: [
                      '$withinTolerance',
                      1,
                      0,
                    ],
                  },
                },

                outsideTolerance: {
                  $sum: {
                    $cond: [
                      '$withinTolerance',
                      0,
                      1,
                    ],
                  },
                },
              },
            },
          ],

          monetaryExposure: [
            {
              $match: {
                absoluteDelta: {
                  $ne: null,
                },
              },
            },

            {
              $group: {
                _id:
                  '$absoluteDelta.currency',

                totalAbsoluteDelta: {
                  $sum:
                    '$absoluteDelta.amount',
                },
              },
            },
          ],
        },
      },
    ];

    const [result] =
      await this.model.aggregate(
        pipeline,
      ).session(
        session || null,
      );

    return (
      result || {
        totals: [],
        byStatus: [],
        byClassification: [],
        bySeverity: [],
        byOperation: [],
        tolerance: [],
        monetaryExposure: [],
      }
    );
  }

  /**
   * ==========================================================================
   * AGGREGATE DIVERGENCES BY DIMENSION
   * ==========================================================================
   *
   * Useful for discovering whether divergence is concentrated by:
   *
   * - operation
   * - plan
   * - currency
   * - classification
   * - severity
   */

  async aggregateDivergencesByDimension({
    tenantId,
    startDate,
    endDate,
    dimension = 'operation',
    session = null,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const start =
      normalizeDate(
        startDate,
        'startDate',
      );

    const end =
      normalizeDate(
        endDate,
        'endDate',
      );

    if (!start || !end) {
      throw new SaasBillingReconciliationRepositoryError(
        'Both startDate and endDate are required.',
        'OBSERVATION_WINDOW_REQUIRED',
      );
    }

    const allowedDimensions = {
      operation: '$operation',
      planCode: '$context.planCode',
      currency: '$context.currency',
      classification: '$classification',
      severity: '$severity',
    };

    if (
      !Object.prototype.hasOwnProperty.call(
        allowedDimensions,
        dimension,
      )
    ) {
      throw new SaasBillingReconciliationRepositoryError(
        `Unsupported aggregation dimension: ${dimension}.`,
        'UNSUPPORTED_AGGREGATION_DIMENSION',
        {
          dimension,
        },
      );
    }

    return this.model
      .aggregate([
        {
          $match: {
            tenantId:
              normalizedTenantId,

            createdAt: {
              $gte: start,
              $lt: end,
            },

            status: {
              $in:
                DIVERGENCE_STATUSES,
            },
          },
        },

        {
          $group: {
            _id:
              allowedDimensions[
                dimension
              ],

            count: {
              $sum: 1,
            },

            highSeverityCount: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      '$severity',
                      [
                        'high',
                        'critical',
                      ],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            materialDifferenceCount: {
              $sum:
                '$materialDifferenceCount',
            },

            absoluteDeltaTotal: {
              $sum:
                '$absoluteDelta.amount',
            },
          },
        },

        {
          $sort: {
            count: -1,
          },
        },
      ])
      .session(
        session || null,
      );
  }

  /**
   * ==========================================================================
   * LATEST RECONCILIATION
   * ==========================================================================
   */

  async findLatest(
    tenantId,
    filters = {},
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const safeFilters = {
      ...filters,
    };

    delete safeFilters.tenantId;

    return this.model
      .findOne({
        ...safeFilters,
        tenantId: normalizedTenantId,
      })
      .sort(DEFAULT_SORT)
      .session(options.session || null)
      .lean();
  }

  /**
   * ==========================================================================
   * DELETE
   * ==========================================================================
   *
   * Financial/commercial reconciliation records should not be physically
   * deleted by normal application code.
   *
   * This repository intentionally does not expose delete/remove methods.
   *
   * Retention is handled through expiresAt / TTL policy on the model.
   * ==========================================================================
   */

  /**
   * ==========================================================================
   * PUBLIC CONSTANTS
   * ==========================================================================
   */

  static get TERMINAL_STATUSES() {
    return TERMINAL_STATUSES;
  }

  static get DIVERGENCE_STATUSES() {
    return DIVERGENCE_STATUSES;
  }

  static get MATCH_STATUSES() {
    return MATCH_STATUSES;
  }

  static get MAX_LIMIT() {
    return MAX_LIMIT;
  }
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  SaasBillingReconciliationRepository;

module.exports.SaasBillingReconciliationRepository =
  SaasBillingReconciliationRepository;

module.exports.SaasBillingReconciliationRepositoryError =
  SaasBillingReconciliationRepositoryError;

module.exports.ReconciliationNotFoundError =
  ReconciliationNotFoundError;

module.exports.ReconciliationTerminalStateError =
  ReconciliationTerminalStateError;

module.exports.ReconciliationTenantIsolationError =
  ReconciliationTenantIsolationError;

module.exports.TERMINAL_STATUSES =
  TERMINAL_STATUSES;

module.exports.DIVERGENCE_STATUSES =
  DIVERGENCE_STATUSES;

module.exports.MATCH_STATUSES =
  MATCH_STATUSES;