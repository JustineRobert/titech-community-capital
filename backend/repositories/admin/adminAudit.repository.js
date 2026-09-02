'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Audit Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/admin/adminAudit.repository.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical persistence/data-access layer for TITech Community Capital's
 * administrative audit infrastructure.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Tenant-scoped AuditLog queries
 * - Audit event lookup
 * - Administrative audit search
 * - Deterministic cursor pagination
 * - User/entity/action filtering
 * - Audit activity statistics
 * - Time-series audit activity
 * - Entity timelines
 * - User timelines
 * - Hash-chain continuity verification
 * - Chain-boundary inspection
 * - Safe audit projections
 *
 * Append-only security boundary
 * ----------------------------------------------------------------------------
 * Audit records are immutable.
 *
 * This repository MUST NOT expose:
 *
 *   updateAudit()
 *   deleteAudit()
 *   replaceAudit()
 *
 * as mutating persistence operations.
 *
 * Audit writes belong to the canonical audit-writing service/model lifecycle.
 *
 * Tenant isolation
 * ----------------------------------------------------------------------------
 * Every tenant-scoped query MUST include tenantId.
 *
 * If the injected AuditLog model does not expose tenantId, tenant-scoped
 * operations fail closed rather than running an unsafe global query.
 *
 * ============================================================================
 */

const crypto = require('node:crypto');

const mongoose = require('mongoose');

const AuditLog = require('../../models/AuditLog');

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const REPOSITORY_NAME =
  'AdminAuditRepository';

const REPOSITORY_VERSION =
  '2026.1';

const DEFAULT_PAGE_SIZE =
  50;

const MAX_PAGE_SIZE =
  200;

const MAX_AGGREGATION_BUCKETS =
  100;

const DEFAULT_LOOKBACK_DAYS =
  30;

const MAX_LOOKBACK_DAYS =
  3660;

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class AdminAuditRepositoryError extends Error {
  constructor(
    message,
    {
      code =
        'ADMIN_AUDIT_REPOSITORY_ERROR',

      cause =
        null,

      details =
        null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminAuditRepositoryError';

    this.code =
      code;

    this.cause =
      cause;

    this.details =
      details;
  }
}

/**
 * ============================================================================
 * NORMALIZATION
 * ============================================================================
 */

function normalizeString(
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

  return normalized ||
    fallback;
}

function normalizeArray(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }

  const values =
    Array.isArray(value)
      ? value
      : String(value).split(',');

  return [
    ...new Set(
      values
        .map((item) =>
          normalizeString(item),
        )
        .filter(Boolean),
    ),
  ];
}

function normalizeLimit(
  value,
  fallback =
    DEFAULT_PAGE_SIZE,
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    MAX_PAGE_SIZE,
  );
}

function normalizeDate(
  value,
  fieldName,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const date =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new AdminAuditRepositoryError(
      `Invalid ${fieldName}.`,
      {
        code:
          `INVALID_${String(
            fieldName,
          ).toUpperCase()}`,
      },
    );
  }

  return date;
}

function toObjectId(
  value,
  fieldName = 'id',
) {
  const normalized =
    normalizeString(value);

  if (!normalized) {
    throw new AdminAuditRepositoryError(
      `${fieldName} is required.`,
      {
        code:
          `${String(
            fieldName,
          ).toUpperCase()}_REQUIRED`,
      },
    );
  }

  if (
    !mongoose.Types.ObjectId.isValid(
      normalized,
    )
  ) {
    throw new AdminAuditRepositoryError(
      `${fieldName} must be a valid MongoDB ObjectId.`,
      {
        code:
          `INVALID_${String(
            fieldName,
          ).toUpperCase()}`,
      },
    );
  }

  return new mongoose.Types.ObjectId(
    normalized,
  );
}

function safeNumber(
  value,
) {
  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : 0;
}

function round(
  value,
  decimals = 2,
) {
  const factor =
    10 ** decimals;

  return (
    Math.round(
      safeNumber(value) *
        factor,
    ) / factor
  );
}

function first(
  rows,
) {
  return Array.isArray(rows) &&
    rows.length
    ? rows[0]
    : null;
}

/**
 * ============================================================================
 * SAFE AUDIT PROJECTION
 * ============================================================================
 *
 * Metadata may contain operational information. The repository does not
 * automatically return arbitrary future model fields.
 *
 * Secret redaction is additionally applied to metadata at read time.
 * ============================================================================
 */

const SAFE_AUDIT_FIELDS =
  Object.freeze([
    '_id',

    'action',

    'userId',

    'tenantId',

    'entityType',

    'entityId',

    'metadata',

    'prevHash',

    'currentHash',

    'createdAt',

    'updatedAt',
  ]);

const SENSITIVE_METADATA_KEY_PATTERNS =
  Object.freeze([
    /password/i,
    /passwd/i,
    /secret/i,
    /token/i,
    /authorization/i,
    /cookie/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
    /refresh/i,
    /access[_-]?token/i,
    /otp/i,
    /pin/i,
    /cvv/i,
    /card.?number/i,
    /connection.?string/i,
    /database.?url/i,
    /mongo.?uri/i,
    /redis.?url/i,
    /client.?secret/i,
  ]);

/**
 * ============================================================================
 * REPOSITORY
 * ============================================================================
 */

class AdminAuditRepository {
  constructor({
    AuditLogModel =
      AuditLog,
  } = {}) {
    this.AuditLog =
      AuditLogModel;
  }

  /**
   * ==========================================================================
   * SCHEMA CAPABILITIES
   * ==========================================================================
   */

  hasPath(
    path,
  ) {
    return Boolean(
      this.AuditLog?.schema?.path(
        path,
      ),
    );
  }

  supportsTenantIsolation() {
    return this.hasPath(
      'tenantId',
    );
  }

  assertTenantIsolationAvailable() {
    if (
      !this.supportsTenantIsolation()
    ) {
      throw new AdminAuditRepositoryError(
        'Tenant-scoped AuditLog operations are unavailable because the AuditLog model does not expose tenantId. TITech will not perform an unsafe global audit query.',
        {
          code:
            'AUDIT_TENANT_SCOPE_UNAVAILABLE',

          details: {
            model:
              'AuditLog',

            requiredField:
              'tenantId',
          },
        },
      );
    }
  }

  /**
   * ==========================================================================
   * TENANT FILTER
   * ==========================================================================
   */

  buildTenantFilter(
    tenantId,
  ) {
    this.assertTenantIsolationAvailable();

    return {
      tenantId:
        toObjectId(
          tenantId,
          'tenantId',
        ),
    };
  }

  /**
   * ==========================================================================
   * SAFE PROJECTION
   * ==========================================================================
   */

  getSafeProjection() {
    const projection =
      {};

    for (
      const field of
      SAFE_AUDIT_FIELDS
    ) {
      if (
        this.hasPath(
          field,
        )
      ) {
        projection[field] =
          1;
      }
    }

    return projection;
  }

  /**
   * ==========================================================================
   * SEARCH FILTER
   * ==========================================================================
   */

  buildFilter(
    tenantId,
    options = {},
  ) {
    const filter = {
      ...this.buildTenantFilter(
        tenantId,
      ),
    };

    const actions =
      normalizeArray(
        options.actions ||
          options.action,
      );

    if (
      actions.length ===
      1
    ) {
      filter.action =
        actions[0];
    } else if (
      actions.length > 1
    ) {
      filter.action = {
        $in:
          actions.slice(
            0,
            MAX_AGGREGATION_BUCKETS,
          ),
      };
    }

    const entityTypes =
      normalizeArray(
        options.entityTypes ||
          options.entityType,
      );

    if (
      entityTypes.length ===
      1
    ) {
      filter.entityType =
        entityTypes[0];
    } else if (
      entityTypes.length > 1
    ) {
      filter.entityType = {
        $in:
          entityTypes.slice(
            0,
            MAX_AGGREGATION_BUCKETS,
          ),
      };
    }

    if (
      options.userId
    ) {
      filter.userId =
        toObjectId(
          options.userId,
          'userId',
        );
    }

    if (
      options.entityId
    ) {
      filter.entityId =
        toObjectId(
          options.entityId,
          'entityId',
        );
    }

    if (
      options.from ||
      options.to
    ) {
      const from =
        normalizeDate(
          options.from,
          'from',
        );

      const to =
        normalizeDate(
          options.to,
          'to',
        );

      filter.createdAt =
        {};

      if (from) {
        filter.createdAt.$gte =
          from;
      }

      if (to) {
        filter.createdAt.$lte =
          to;
      }

      this.assertDateRange(
        filter.createdAt,
      );
    }

    if (
      options.minCreatedAt ||
      options.maxCreatedAt
    ) {
      const from =
        normalizeDate(
          options.minCreatedAt,
          'minCreatedAt',
        );

      const to =
        normalizeDate(
          options.maxCreatedAt,
          'maxCreatedAt',
        );

      filter.createdAt =
        {};

      if (from) {
        filter.createdAt.$gte =
          from;
      }

      if (to) {
        filter.createdAt.$lte =
          to;
      }

      this.assertDateRange(
        filter.createdAt,
      );
    }

    return filter;
  }

  assertDateRange(
    range,
  ) {
    if (
      !range?.$gte ||
      !range?.$lte
    ) {
      return;
    }

    if (
      range.$gte >
      range.$lte
    ) {
      throw new AdminAuditRepositoryError(
        '`from` cannot be later than `to`.',
        {
          code:
            'INVALID_DATE_RANGE',
        },
      );
    }
  }

  /**
   * ==========================================================================
   * FIND BY ID
   * ==========================================================================
   */

  async findById(
    tenantId,
    auditId,
  ) {
    const document =
      await this.AuditLog
        .findOne({
          ...this.buildTenantFilter(
            tenantId,
          ),

          _id:
            toObjectId(
              auditId,
              'auditId',
            ),
        })
        .select(
          this.getSafeProjection(),
        )
        .lean();

    return this.serializeAudit(
      document,
    );
  }

  /**
   * ==========================================================================
   * EXISTS
   * ==========================================================================
   */

  async exists(
    tenantId,
    auditId,
  ) {
    const result =
      await this.AuditLog.exists({
        ...this.buildTenantFilter(
          tenantId,
        ),

        _id:
          toObjectId(
            auditId,
            'auditId',
          ),
      });

    return Boolean(
      result,
    );
  }

  /**
   * ==========================================================================
   * COUNT
   * ==========================================================================
   */

  async count(
    tenantId,
    options = {},
  ) {
    return this.AuditLog.countDocuments(
      this.buildFilter(
        tenantId,
        options,
      ),
    );
  }

  /**
   * ==========================================================================
   * PAGINATED AUDIT SEARCH
   * ==========================================================================
   *
   * Ordering:
   *
   *   createdAt DESC
   *   _id DESC
   *
   * Cursor:
   *
   *   {
   *     createdAt,
   *     id
   *   }
   *
   * Keyset pagination prevents offset performance degradation as the audit
   * collection grows.
   * ==========================================================================
   */

  async findPage(
    tenantId,
    options = {},
  ) {
    const limit =
      normalizeLimit(
        options.limit,
      );

    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    if (
      options.cursor
    ) {
      const cursor =
        this.decodeCursor(
          options.cursor,
        );

      filter.$or = [
        {
          createdAt: {
            $lt:
              cursor.createdAt,
          },
        },

        {
          createdAt:
            cursor.createdAt,

          _id: {
            $lt:
              cursor.id,
          },
        },
      ];
    }

    const documents =
      await this.AuditLog
        .find(
          filter,
        )
        .select(
          this.getSafeProjection(),
        )
        .sort({
          createdAt:
            -1,

          _id:
            -1,
        })
        .limit(
          limit + 1,
        )
        .lean();

    const hasNextPage =
      documents.length >
      limit;

    const items =
      hasNextPage
        ? documents.slice(
            0,
            limit,
          )
        : documents;

    const last =
      items[
        items.length - 1
      ];

    return {
      items:
        items.map(
          (item) =>
            this.serializeAudit(
              item,
            ),
        ),

      pagination: {
        limit,

        hasNextPage,

        nextCursor:
          hasNextPage &&
          last
            ? this.encodeCursor(
                last,
              )
            : null,
      },
    };
  }

  /**
   * ==========================================================================
   * SIMPLE LIST
   * ==========================================================================
   */

  async findMany(
    tenantId,
    options = {},
  ) {
    const documents =
      await this.AuditLog
        .find(
          this.buildFilter(
            tenantId,
            options,
          ),
        )
        .select(
          this.getSafeProjection(),
        )
        .sort({
          createdAt:
            -1,

          _id:
            -1,
        })
        .limit(
          normalizeLimit(
            options.limit,
          ),
        )
        .lean();

    return documents.map(
      (document) =>
        this.serializeAudit(
          document,
        ),
    );
  }

  /**
   * ==========================================================================
   * USER TIMELINE
   * ==========================================================================
   */

  async findByUser(
    tenantId,
    userId,
    options = {},
  ) {
    return this.findMany(
      tenantId,
      {
        ...options,

        userId,
      },
    );
  }

  /**
   * ==========================================================================
   * ENTITY TIMELINE
   * ==========================================================================
   */

  async findByEntity(
    tenantId,
    {
      entityType,
      entityId,
      limit =
        DEFAULT_PAGE_SIZE,
      from = null,
      to = null,
    } = {},
  ) {
    const normalizedEntityType =
      normalizeString(
        entityType,
      );

    if (
      !normalizedEntityType
    ) {
      throw new AdminAuditRepositoryError(
        'entityType is required.',
        {
          code:
            'ENTITY_TYPE_REQUIRED',
        },
      );
    }

    return this.findMany(
      tenantId,
      {
        entityType:
          normalizedEntityType,

        entityId,

        limit,

        from,

        to,
      },
    );
  }

  /**
   * ==========================================================================
   * ACTION TIMELINE
   * ==========================================================================
   */

  async findByAction(
    tenantId,
    action,
    options = {},
  ) {
    const normalizedAction =
      normalizeString(
        action,
      );

    if (
      !normalizedAction
    ) {
      throw new AdminAuditRepositoryError(
        'action is required.',
        {
          code:
            'ACTION_REQUIRED',
        },
      );
    }

    return this.findMany(
      tenantId,
      {
        ...options,

        action:
          normalizedAction,
      },
    );
  }

  /**
   * ==========================================================================
   * ENTITY TYPE TIMELINE
   * ==========================================================================
   */

  async findByEntityType(
    tenantId,
    entityType,
    options = {},
  ) {
    const normalizedEntityType =
      normalizeString(
        entityType,
      );

    if (
      !normalizedEntityType
    ) {
      throw new AdminAuditRepositoryError(
        'entityType is required.',
        {
          code:
            'ENTITY_TYPE_REQUIRED',
        },
      );
    }

    return this.findMany(
      tenantId,
      {
        ...options,

        entityType:
          normalizedEntityType,
      },
    );
  }

  /**
   * ==========================================================================
   * LATEST EVENT
   * ==========================================================================
   */

  async findLatest(
    tenantId,
  ) {
    const document =
      await this.AuditLog
        .findOne(
          this.buildTenantFilter(
            tenantId,
          ),
        )
        .select(
          this.getSafeProjection(),
        )
        .sort({
          createdAt:
            -1,

          _id:
            -1,
        })
        .lean();

    return this.serializeAudit(
      document,
    );
  }

  /**
   * ==========================================================================
   * EARLIEST EVENT
   * ==========================================================================
   */

  async findEarliest(
    tenantId,
  ) {
    const document =
      await this.AuditLog
        .findOne(
          this.buildTenantFilter(
            tenantId,
          ),
        )
        .select(
          this.getSafeProjection(),
        )
        .sort({
          createdAt:
            1,

          _id:
            1,
        })
        .lean();

    return this.serializeAudit(
      document,
    );
  }

  /**
   * ==========================================================================
   * AUDIT STATISTICS
   * ==========================================================================
   */

  async getStatistics(
    tenantId,
    {
      from = null,
      to = null,
      days =
        DEFAULT_LOOKBACK_DAYS,
    } = {},
  ) {
    const range =
      this.buildDateRange({
        from,
        to,
        days,
      });

    const filter = {
      ...this.buildTenantFilter(
        tenantId,
      ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const [
      overall,
      byAction,
      byEntityType,
      byUser,
    ] =
      await Promise.all([
        this.AuditLog.aggregate([
          {
            $match:
              filter,
          },

          {
            $group: {
              _id:
                null,

              total:
                {
                  $sum:
                    1,
                },

              users:
                {
                  $addToSet:
                    '$userId',
                },

              actions:
                {
                  $addToSet:
                    '$action',
                },

              entityTypes:
                {
                  $addToSet:
                    '$entityType',
                },
            },
          },

          {
            $project: {
              _id:
                0,

              total:
                1,

              userCount:
                {
                  $size:
                    '$users',
                },

              actionCount:
                {
                  $size:
                    '$actions',
                },

              entityTypeCount:
                {
                  $size:
                    '$entityTypes',
                },
            },
          },
        ]),

        this.groupByField(
          filter,
          '$action',
        ),

        this.groupByField(
          filter,
          '$entityType',
        ),

        this.AuditLog.aggregate([
          {
            $match:
              filter,
          },

          {
            $group: {
              _id:
                '$userId',

              count:
                {
                  $sum:
                    1,
                },
            },
          },

          {
            $sort: {
              count:
                -1,
            },
          },

          {
            $limit:
              MAX_AGGREGATION_BUCKETS,
          },
        ]),
      ]);

    const result =
      first(overall) || {};

    return {
      period: {
        from:
          range.from,

        to:
          range.to,
      },

      total:
        safeNumber(
          result.total,
        ),

      distinctUsers:
        safeNumber(
          result.userCount,
        ),

      distinctActions:
        safeNumber(
          result.actionCount,
        ),

      distinctEntityTypes:
        safeNumber(
          result.entityTypeCount,
        ),

      byAction:
        byAction.map(
          (row) => ({
            action:
              row._id,

            count:
              safeNumber(
                row.count,
              ),
          }),
        ),

      byEntityType:
        byEntityType.map(
          (row) => ({
            entityType:
              row._id,

            count:
              safeNumber(
                row.count,
              ),
          }),
        ),

      byUser:
        byUser.map(
          (row) => ({
            userId:
              row._id
                ? String(
                    row._id,
                  )
                : null,

            count:
              safeNumber(
                row.count,
              ),
          }),
        ),
    };
  }

  async groupByField(
    filter,
    field,
  ) {
    return this.AuditLog.aggregate([
      {
        $match:
          filter,
      },

      {
        $group: {
          _id:
            field,

          count:
            {
              $sum:
                1,
            },
        },
      },

      {
        $sort: {
          count:
            -1,
        },
      },

      {
        $limit:
          MAX_AGGREGATION_BUCKETS,
      },
    ]);
  }

  /**
   * ==========================================================================
   * TIME SERIES
   * ==========================================================================
   */

  async getActivityTrend(
    tenantId,
    {
      from = null,
      to = null,
      days =
        DEFAULT_LOOKBACK_DAYS,
      granularity =
        'day',
    } = {},
  ) {
    const range =
      this.buildDateRange({
        from,
        to,
        days,
      });

    const dateExpression =
      this.dateBucketExpression(
        '$createdAt',
        granularity,
      );

    return this.AuditLog.aggregate([
      {
        $match: {
          ...this.buildTenantFilter(
            tenantId,
          ),

          createdAt: {
            $gte:
              range.from,

            $lte:
              range.to,
          },
        },
      },

      {
        $group: {
          _id:
            dateExpression,

          count:
            {
              $sum:
                1,
            },
        },
      },

      {
        $sort: {
          _id:
            1,
        },
      },
    ]);
  }

  /**
   * ==========================================================================
   * ACTION TREND
   * ==========================================================================
   */

  async getActionTrend(
    tenantId,
    action,
    options = {},
  ) {
    const normalizedAction =
      normalizeString(
        action,
      );

    if (
      !normalizedAction
    ) {
      throw new AdminAuditRepositoryError(
        'action is required.',
        {
          code:
            'ACTION_REQUIRED',
        },
      );
    }

    const range =
      this.buildDateRange(
        options,
      );

    return this.AuditLog.aggregate([
      {
        $match: {
          ...this.buildTenantFilter(
            tenantId,
          ),

          action:
            normalizedAction,

          createdAt: {
            $gte:
              range.from,

            $lte:
              range.to,
          },
        },
      },

      {
        $group: {
          _id:
            this.dateBucketExpression(
              '$createdAt',
              options.granularity ||
                'day',
            ),

          count:
            {
              $sum:
                1,
            },
        },
      },

      {
        $sort: {
          _id:
            1,
        },
      },
    ]);
  }

  /**
   * ==========================================================================
   * HASH CHAIN BOUNDARIES
   * ==========================================================================
   */

  async getChainBoundary(
    tenantId,
  ) {
    const [
      firstDocument,
      lastDocument,
    ] =
      await Promise.all([
        this.AuditLog
          .findOne(
            this.buildTenantFilter(
              tenantId,
            ),
          )
          .select(
            [
              '_id',
              'prevHash',
              'currentHash',
              'createdAt',
            ].join(' '),
          )
          .sort({
            createdAt:
              1,

            _id:
              1,
          })
          .lean(),

        this.AuditLog
          .findOne(
            this.buildTenantFilter(
              tenantId,
            ),
          )
          .select(
            [
              '_id',
              'prevHash',
              'currentHash',
              'createdAt',
            ].join(' '),
          )
          .sort({
            createdAt:
              -1,

            _id:
              -1,
          })
          .lean(),
      ]);

    return {
      first:
        firstDocument
          ? {
              id:
                String(
                  firstDocument._id,
                ),

              prevHash:
                firstDocument.prevHash ||
                null,

              currentHash:
                firstDocument.currentHash ||
                null,

              createdAt:
                firstDocument.createdAt,
            }
          : null,

      last:
        lastDocument
          ? {
              id:
                String(
                  lastDocument._id,
                ),

              prevHash:
                lastDocument.prevHash ||
                null,

              currentHash:
                lastDocument.currentHash ||
                null,

              createdAt:
                lastDocument.createdAt,
            }
          : null,
    };
  }

  /**
   * ==========================================================================
   * HASH CHAIN CONTINUITY VERIFICATION
   * ==========================================================================
   *
   * This repository validates what can be established from persisted chain
   * fields without reconstructing a hash formula that belongs to the model's
   * write lifecycle.
   *
   * Verification checks:
   *
   *   1. ordered records
   *   2. first-record boundary
   *   3. prevHash -> previous currentHash linkage
   *   4. presence/shape of currentHash
   *
   * The repository does NOT invent a hash payload formula.
   *
   * A complete cryptographic hash recomputation should live beside the exact
   * canonical AuditLog hashing implementation so the model and verifier can
   * never silently diverge.
   * ==========================================================================
   */

  async verifyChain(
    tenantId,
    {
      from = null,
      to = null,
      days =
        DEFAULT_LOOKBACK_DAYS,
      limit = 50000,
    } = {},
  ) {
    const range =
      this.buildDateRange({
        from,
        to,
        days,
      });

    const boundedLimit =
      Math.min(
        Math.max(
          Number(limit) ||
            1,
          1,
        ),
        50000,
      );

    const documents =
      await this.AuditLog
        .find({
          ...this.buildTenantFilter(
            tenantId,
          ),

          createdAt: {
            $gte:
              range.from,

            $lte:
              range.to,
          },
        })
        .select(
          [
            '_id',
            'prevHash',
            'currentHash',
            'createdAt',
          ].join(' '),
        )
        .sort({
          createdAt:
            1,

          _id:
            1,
        })
        .limit(
          boundedLimit,
        )
        .lean();

    const failures = [];

    let previousCurrentHash =
      null;

    documents.forEach(
      (document, index) => {
        const currentHash =
          normalizeString(
            document.currentHash,
          );

        const previousHash =
          normalizeString(
            document.prevHash,
          );

        if (
          index ===
          0
        ) {
          /**
           * First record of an independent verification range may legitimately
           * point to a record before the range. Therefore we do not require
           * prevHash to be null unless we explicitly verify from the chain
           * beginning.
           */
        } else if (
          previousHash !==
          previousCurrentHash
        ) {
          failures.push({
            type:
              'CHAIN_LINK_MISMATCH',

            index,

            auditId:
              String(
                document._id,
              ),

            expectedPreviousHash:
              previousCurrentHash,

            actualPreviousHash:
              previousHash,

            createdAt:
              document.createdAt,
          });
        }

        if (
          !currentHash
        ) {
          failures.push({
            type:
              'MISSING_CURRENT_HASH',

            index,

            auditId:
              String(
                document._id,
              ),

            createdAt:
              document.createdAt,
          });
        } else if (
          !/^[a-f0-9]{64}$/i.test(
            currentHash,
          )
        ) {
          failures.push({
            type:
              'INVALID_CURRENT_HASH_FORMAT',

            index,

            auditId:
              String(
                document._id,
              ),

            currentHash,

            createdAt:
              document.createdAt,
          });
        }

        if (
          previousHash &&
          !/^[a-f0-9]{64}$/i.test(
            previousHash,
          )
        ) {
          failures.push({
            type:
              'INVALID_PREVIOUS_HASH_FORMAT',

            index,

            auditId:
              String(
                document._id,
              ),

            previousHash,

            createdAt:
              document.createdAt,
          });
        }

        previousCurrentHash =
          currentHash;
      },
    );

    return {
      tenantId:
        String(
          tenantId,
        ),

      valid:
        failures.length ===
        0,

      entriesChecked:
        documents.length,

      truncated:
        documents.length >=
        boundedLimit,

      failures,

      period: {
        from:
          range.from,

        to:
          range.to,
      },

      verifiedAt:
        new Date(),
    };
  }

  /**
   * ==========================================================================
   * HASH LOOKUP
   * ==========================================================================
   */

  async findByCurrentHash(
    tenantId,
    currentHash,
  ) {
    const normalizedHash =
      normalizeString(
        currentHash,
      );

    if (
      !normalizedHash
    ) {
      throw new AdminAuditRepositoryError(
        'currentHash is required.',
        {
          code:
            'CURRENT_HASH_REQUIRED',
        },
      );
    }

    const document =
      await this.AuditLog
        .findOne({
          ...this.buildTenantFilter(
            tenantId,
          ),

          currentHash:
            normalizedHash,
        })
        .select(
          this.getSafeProjection(),
        )
        .lean();

    return this.serializeAudit(
      document,
    );
  }

  /**
   * ==========================================================================
   * PREVIOUS HASH LOOKUP
   * ==========================================================================
   */

  async findByPreviousHash(
    tenantId,
    previousHash,
    options = {},
  ) {
    const normalizedHash =
      normalizeString(
        previousHash,
      );

    if (
      !normalizedHash
    ) {
      throw new AdminAuditRepositoryError(
        'previousHash is required.',
        {
          code:
            'PREVIOUS_HASH_REQUIRED',
        },
      );
    }

    const documents =
      await this.AuditLog
        .find({
          ...this.buildTenantFilter(
            tenantId,
          ),

          prevHash:
            normalizedHash,
        })
        .select(
          this.getSafeProjection(),
        )
        .sort({
          createdAt:
            1,

          _id:
            1,
        })
        .limit(
          normalizeLimit(
            options.limit,
          ),
        )
        .lean();

    return documents.map(
      (document) =>
        this.serializeAudit(
          document,
        ),
    );
  }

  /**
   * ==========================================================================
   * SERIALIZATION / REDACTION
   * ==========================================================================
   */

  serializeAudit(
    document,
  ) {
    if (!document) {
      return null;
    }

    return {
      id:
        document._id
          ? String(
              document._id,
            )
          : null,

      action:
        document.action ||
        null,

      userId:
        document.userId
          ? String(
              document.userId,
            )
          : null,

      tenantId:
        document.tenantId
          ? String(
              document.tenantId,
            )
          : null,

      entityType:
        document.entityType ||
        null,

      entityId:
        document.entityId
          ? String(
              document.entityId,
            )
          : null,

      metadata:
        this.redactMetadata(
          document.metadata ||
            {},
        ),

      prevHash:
        document.prevHash ||
        null,

      currentHash:
        document.currentHash ||
        null,

      createdAt:
        document.createdAt ||
        null,

      updatedAt:
        document.updatedAt ||
        null,
    };
  }

  redactMetadata(
    value,
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return value;
    }

    if (
      Array.isArray(
        value,
      )
    ) {
      return value.map(
        (item) =>
          this.redactMetadata(
            item,
          ),
      );
    }

    if (
      typeof value !==
      'object'
    ) {
      return value;
    }

    const result =
      {};

    for (
      const [
        key,
        item,
      ] of Object.entries(
        value,
      )
    ) {
      if (
        SENSITIVE_METADATA_KEY_PATTERNS.some(
          (pattern) =>
            pattern.test(
              key,
            ),
        )
      ) {
        result[key] =
          '[REDACTED]';

        continue;
      }

      result[key] =
        this.redactMetadata(
          item,
        );
    }

    return result;
  }

  /**
   * ==========================================================================
   * CURSOR
   * ==========================================================================
   */

  encodeCursor(
    document,
  ) {
    const payload =
      JSON.stringify({
        createdAt:
          document.createdAt
            ? new Date(
                document.createdAt,
              ).toISOString()
            : null,

        id:
          document._id
            ? String(
                document._id,
              )
            : null,
      });

    return Buffer
      .from(
        payload,
      )
      .toString(
        'base64url',
      );
  }

  decodeCursor(
    cursor,
  ) {
    if (!cursor) {
      throw new AdminAuditRepositoryError(
        'Pagination cursor is required.',
        {
          code:
            'CURSOR_REQUIRED',
        },
      );
    }

    try {
      const payload =
        JSON.parse(
          Buffer
            .from(
              String(
                cursor,
              ),
              'base64url',
            )
            .toString(
              'utf8',
            ),
        );

      const createdAt =
        normalizeDate(
          payload.createdAt,
          'cursor.createdAt',
        );

      const id =
        toObjectId(
          payload.id,
          'cursor.id',
        );

      if (
        !createdAt
      ) {
        throw new Error(
          'Cursor createdAt is missing.',
        );
      }

      return {
        createdAt,

        id,
      };
    } catch (error) {
      if (
        error instanceof
        AdminAuditRepositoryError
      ) {
        throw error;
      }

      throw new AdminAuditRepositoryError(
        'Invalid audit pagination cursor.',
        {
          code:
            'INVALID_CURSOR',

          cause:
            error,
        },
      );
    }
  }

  /**
   * ==========================================================================
   * DATE RANGE
   * ==========================================================================
   */

  buildDateRange(
    {
      from = null,
      to = null,
      days =
        DEFAULT_LOOKBACK_DAYS,
    } = {},
  ) {
    const resolvedTo =
      normalizeDate(
        to,
        'to',
      ) ||
      new Date();

    const requestedDays =
      Number(days);

    const safeDays =
      Number.isInteger(
        requestedDays,
      ) &&
      requestedDays > 0
        ? Math.min(
            requestedDays,
            MAX_LOOKBACK_DAYS,
          )
        : DEFAULT_LOOKBACK_DAYS;

    const resolvedFrom =
      normalizeDate(
        from,
        'from',
      ) ||
      new Date(
        resolvedTo.getTime() -
          safeDays *
            24 *
            60 *
            60 *
            1000,
      );

    if (
      resolvedFrom >
      resolvedTo
    ) {
      throw new AdminAuditRepositoryError(
        '`from` cannot be later than `to`.',
        {
          code:
            'INVALID_DATE_RANGE',
        },
      );
    }

    return {
      from:
        resolvedFrom,

      to:
        resolvedTo,
    };
  }

  /**
   * ==========================================================================
   * DATE BUCKET
   * ==========================================================================
   */

  dateBucketExpression(
    field,
    granularity,
  ) {
    switch (
      granularity
    ) {
      case 'hour':
        return {
          $dateToString: {
            format:
              '%Y-%m-%dT%H:00:00.000Z',

            date:
              field,
          },
        };

      case 'week':
        return {
          $dateToString: {
            format:
              '%G-W%V',

            date:
              field,
          },
        };

      case 'month':
        return {
          $dateToString: {
            format:
              '%Y-%m',

            date:
              field,
          },
        };

      case 'day':
      default:
        return {
          $dateToString: {
            format:
              '%Y-%m-%d',

            date:
              field,
          },
        };
    }
  }

  /**
   * ==========================================================================
   * APPEND-ONLY GUARDS
   * ==========================================================================
   */

  async update() {
    throw new AdminAuditRepositoryError(
      'Audit records are immutable and cannot be updated.',
      {
        code:
          'AUDIT_IMMUTABLE',

        details: {
          repository:
            REPOSITORY_NAME,

          policy:
            'append_only',
        },
      },
    );
  }

  async delete() {
    throw new AdminAuditRepositoryError(
      'Audit records are immutable and cannot be deleted.',
      {
        code:
          'AUDIT_IMMUTABLE',

        details: {
          repository:
            REPOSITORY_NAME,

          policy:
            'append_only',
        },
      },
    );
  }

  async remove() {
    return this.delete();
  }

  /**
   * ==========================================================================
   * CAPABILITIES
   * ==========================================================================
   */

  getCapabilities() {
    return {
      repository:
        REPOSITORY_NAME,

      version:
        REPOSITORY_VERSION,

      tenantIsolation:
        {
          supported:
            this.supportsTenantIsolation(),

          failClosed:
            true,
        },

      appendOnly:
        true,

      hashChain:
        {
          prevHash:
            this.hasPath(
              'prevHash',
            ),

          currentHash:
            this.hasPath(
              'currentHash',
            ),

          continuityVerification:
            this.hasPath(
              'prevHash',
            ) &&
            this.hasPath(
              'currentHash',
            ),
        },

      fields: {
        action:
          this.hasPath(
            'action',
          ),

        userId:
          this.hasPath(
            'userId',
          ),

        tenantId:
          this.hasPath(
            'tenantId',
          ),

        entityType:
          this.hasPath(
            'entityType',
          ),

        entityId:
          this.hasPath(
            'entityId',
          ),

        metadata:
          this.hasPath(
            'metadata',
          ),

        createdAt:
          this.hasPath(
            'createdAt',
          ),
      },

      timestamp:
        new Date(),
    };
  }

  /**
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   */

  async health() {
    const databaseConnected =
      Boolean(
        this.AuditLog &&
          this.AuditLog.db &&
          this.AuditLog.db.readyState ===
            1,
      );

    const tenantIsolation =
      this.supportsTenantIsolation();

    const hashChainAvailable =
      this.hasPath(
        'prevHash',
      ) &&
      this.hasPath(
        'currentHash',
      );

    return {
      repository:
        REPOSITORY_NAME,

      version:
        REPOSITORY_VERSION,

      healthy:
        databaseConnected &&
        tenantIsolation &&
        hashChainAvailable,

      databaseConnected,

      tenantIsolation,

      appendOnly:
        true,

      hashChainAvailable,

      tenantSafety:
        tenantIsolation
          ? 'available'
          : 'blocked',

      timestamp:
        new Date(),
    };
  }
}

/**
 * ============================================================================
 * SINGLETON
 * ============================================================================
 */

const adminAuditRepository =
  new AdminAuditRepository();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  adminAuditRepository;

module.exports.AdminAuditRepository =
  AdminAuditRepository;

module.exports.AdminAuditRepositoryError =
  AdminAuditRepositoryError;

module.exports.REPOSITORY_NAME =
  REPOSITORY_NAME;

module.exports.REPOSITORY_VERSION =
  REPOSITORY_VERSION;