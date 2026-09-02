'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Audit Service
 * ============================================================================
 *
 * File:
 *   backend/services/admin/adminAudit.service.js
 *
 * Purpose:
 *   Canonical administrative audit-query, integrity-verification and
 *   compliance-support service for TITech Community Capital.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 * - Uses the real AuditLog Mongoose model.
 * - Does not invent or depend on a repository interface that is not present.
 * - Treats AuditLog as append-only.
 * - Tenant isolation is mandatory for tenant-scoped operations.
 * - New audit writes are delegated to the existing auditLogService where
 *   possible so the system retains one canonical audit-writing path.
 * - Audit records are never updated or deleted by this service.
 * - Sensitive metadata is redacted before returning records to administrators.
 * - Pagination is bounded.
 * - Filtering is explicit and validated.
 * - Hash-chain integrity can be verified per tenant.
 * - Supports operational audit search, summaries, timelines and integrity
 *   checks.
 * - Compatible with CommonJS / Node.js backend conventions.
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * Authorization should still be enforced by the route/controller middleware.
 * This service enforces data scope and safe query construction, but it does
 * not replace RBAC middleware.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All branding and product references use TITech Community Capital.
 *
 * ============================================================================
 */

const crypto = require('node:crypto');
const mongoose = require('mongoose');

const AuditLog = require('../../models/AuditLog');

const auditLogService = require('../../services/auditLogService');
const logger = require('../../utils/logger');

/**
 * ============================================================================
 * SERVICE METADATA
 * ============================================================================
 */

const SERVICE_NAME =
  'AdminAuditService';

const SERVICE_VERSION =
  '2026.1';

const DEFAULT_PAGE_SIZE =
  50;

const MAX_PAGE_SIZE =
  200;

const DEFAULT_LOOKBACK_DAYS =
  30;

const MAX_LOOKBACK_DAYS =
  3660;

/**
 * ============================================================================
 * ALLOWED FILTERS
 * ============================================================================
 */

const ALLOWED_SORT_FIELDS = Object.freeze([
  'createdAt',
  'updatedAt',
  'action',
  'entityType',
]);

const SORT_DIRECTIONS = Object.freeze([
  'asc',
  'desc',
]);

const SAFE_TEXT_FIELDS = Object.freeze([
  'action',
  'entityType',
]);

/**
 * ============================================================================
 * ERROR TYPE
 * ============================================================================
 */

class AdminAuditError extends Error {
  constructor(
    message,
    {
      code = 'ADMIN_AUDIT_ERROR',
      statusCode = 500,
      details = null,
      cause = null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminAuditError';

    this.code =
      code;

    this.statusCode =
      statusCode;

    this.details =
      details;

    this.cause =
      cause;
  }
}

/**
 * ============================================================================
 * NORMALIZATION HELPERS
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

  if (Array.isArray(value)) {
    return value
      .map((item) =>
        normalizeString(item),
      )
      .filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((item) =>
      item.trim(),
    )
    .filter(Boolean);
}

function normalizeBoolean(
  value,
  fallback = null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    normalized === 'true' ||
    normalized === '1'
  ) {
    return true;
  }

  if (
    normalized === 'false' ||
    normalized === '0'
  ) {
    return false;
  }

  return fallback;
}

function normalizePositiveInteger(
  value,
  fallback,
  maximum,
) {
  const numeric =
    Number(value);

  if (
    !Number.isInteger(numeric) ||
    numeric < 1
  ) {
    return fallback;
  }

  return Math.min(
    numeric,
    maximum,
  );
}

function toObjectId(
  value,
  fieldName = 'id',
) {
  const normalized =
    normalizeString(value);

  if (!normalized) {
    throw new AdminAuditError(
      `${fieldName} is required.`,
      {
        code:
          `${String(fieldName).toUpperCase()}_REQUIRED`,
        statusCode: 400,
      },
    );
  }

  if (
    !mongoose.Types.ObjectId.isValid(
      normalized,
    )
  ) {
    throw new AdminAuditError(
      `${fieldName} is not a valid MongoDB ObjectId.`,
      {
        code:
          `INVALID_${String(
            fieldName,
          ).toUpperCase()}`,
        statusCode: 400,
      },
    );
  }

  return new mongoose.Types.ObjectId(
    normalized,
  );
}

function parseDate(
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
      ? new Date(value.getTime())
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new AdminAuditError(
      `Invalid ${fieldName}.`,
      {
        code:
          `INVALID_${String(
            fieldName,
          ).toUpperCase()}`,
        statusCode: 400,
      },
    );
  }

  return date;
}

function cloneSafe(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  try {
    return JSON.parse(
      JSON.stringify(value),
    );
  } catch {
    return null;
  }
}

/**
 * ============================================================================
 * SENSITIVE DATA REDACTION
 * ============================================================================
 */

const SENSITIVE_KEY_FRAGMENTS =
  Object.freeze([
    'password',
    'passwd',
    'token',
    'secret',
    'authorization',
    'cookie',
    'refresh',
    'access',
    'otp',
    'pin',
    'cvv',
    'cardnumber',
    'nationalid',
    'national_id',
    'nin',
    'ssn',
    'apikey',
    'api_key',
    'clientsecret',
    'privatekey',
    'mongouri',
    'databaseurl',
    'connectionstring',
  ]);

function isSensitiveKey(
  key,
) {
  const normalized =
    String(key)
      .replace(/[-_\s]/g, '')
      .toLowerCase();

  return SENSITIVE_KEY_FRAGMENTS.some(
    (fragment) =>
      normalized.includes(
        fragment
          .replace(
            /[-_\s]/g,
            '',
          )
          .toLowerCase(),
      ),
  );
}

function redactValue(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      (item) =>
        redactValue(item),
    );
  }

  if (
    typeof value !==
    'object'
  ) {
    return value;
  }

  const output = {};

  for (
    const [key, entry] of
    Object.entries(value)
  ) {
    if (
      isSensitiveKey(key)
    ) {
      output[key] =
        '[REDACTED]';

      continue;
    }

    output[key] =
      redactValue(entry);
  }

  return output;
}

/**
 * ============================================================================
 * DATE RANGE
 * ============================================================================
 */

function normalizeDateRange(
  {
    from = null,
    to = null,
    days = DEFAULT_LOOKBACK_DAYS,
  } = {},
) {
  const now =
    new Date();

  const requestedDays =
    normalizePositiveInteger(
      days,
      DEFAULT_LOOKBACK_DAYS,
      MAX_LOOKBACK_DAYS,
    );

  const parsedFrom =
    parseDate(
      from,
      'from',
    );

  const parsedTo =
    parseDate(
      to,
      'to',
    );

  const effectiveTo =
    parsedTo ||
    now;

  const effectiveFrom =
    parsedFrom ||
    new Date(
      effectiveTo.getTime() -
      requestedDays *
        24 *
        60 *
        60 *
        1000,
    );

  if (
    effectiveFrom >
    effectiveTo
  ) {
    throw new AdminAuditError(
      '`from` cannot be later than `to`.',
      {
        code:
          'INVALID_AUDIT_DATE_RANGE',
        statusCode: 400,
      },
    );
  }

  return {
    from:
      effectiveFrom,

    to:
      effectiveTo,
  };
}

/**
 * ============================================================================
 * CURSOR PAGINATION
 * ============================================================================
 *
 * Cursor format:
 *
 *   base64url(
 *     JSON.stringify({
 *       createdAt,
 *       id,
 *     })
 *   )
 *
 * The ordering is always deterministic:
 *
 *   createdAt DESC/ASC
 *   _id DESC/ASC
 *
 * This prevents duplicate/missing records when multiple audit entries share
 * the same timestamp.
 * ============================================================================
 */

function encodeCursor(
  {
    createdAt,
    id,
  },
) {
  const payload =
    JSON.stringify({
      createdAt:
        new Date(
          createdAt,
        ).toISOString(),

      id:
        String(id),
    });

  return Buffer
    .from(payload)
    .toString(
      'base64url',
    );
}

function decodeCursor(
  cursor,
) {
  if (!cursor) {
    return null;
  }

  try {
    const parsed =
      JSON.parse(
        Buffer
          .from(
            String(cursor),
            'base64url',
          )
          .toString(
            'utf8',
          ),
      );

    const createdAt =
      parseDate(
        parsed.createdAt,
        'cursor.createdAt',
      );

    const id =
      toObjectId(
        parsed.id,
        'cursor.id',
      );

    return {
      createdAt,
      id,
    };
  } catch (
    error
  ) {
    if (
      error instanceof
      AdminAuditError
    ) {
      throw error;
    }

    throw new AdminAuditError(
      'Invalid audit pagination cursor.',
      {
        code:
          'INVALID_AUDIT_CURSOR',
        statusCode: 400,
        cause:
          error,
      },
    );
  }
}

function buildCursorFilter(
  cursor,
  direction,
) {
  if (!cursor) {
    return null;
  }

  const operator =
    direction === 'asc'
      ? '$gt'
      : '$lt';

  return {
    $or: [
      {
        createdAt: {
          [operator]:
            cursor.createdAt,
        },
      },

      {
        createdAt:
          cursor.createdAt,

        _id: {
          [operator]:
            cursor.id,
        },
      },
    ],
  };
}

/**
 * ============================================================================
 * SAFE PROJECTION
 * ============================================================================
 *
 * Raw metadata is deliberately returned only after recursive redaction.
 * Authentication/security secrets should therefore not escape through the
 * admin audit API even if an upstream caller accidentally logged one.
 * ============================================================================
 */

function serializeAuditLog(
  document,
) {
  if (!document) {
    return null;
  }

  const source =
    typeof document.toObject ===
    'function'
      ? document.toObject()
      : document;

  return {
    id:
      source._id
        ? String(source._id)
        : null,

    action:
      source.action ||
      null,

    userId:
      source.userId
        ? String(
            source.userId,
          )
        : null,

    tenantId:
      source.tenantId
        ? String(
            source.tenantId,
          )
        : null,

    entityType:
      source.entityType ||
      null,

    entityId:
      source.entityId
        ? String(
            source.entityId,
          )
        : null,

    metadata:
      redactValue(
        cloneSafe(
          source.metadata ||
            {},
        ),
      ),

    prevHash:
      source.prevHash ||
      null,

    currentHash:
      source.currentHash ||
      null,

    createdAt:
      source.createdAt ||
      null,

    updatedAt:
      source.updatedAt ||
      null,
  };
}

/**
 * ============================================================================
 * SERVICE
 * ============================================================================
 */

class AdminAuditService {
  constructor(
    {
      AuditLogModel =
        AuditLog,

      auditWriter =
        auditLogService,

      loggerInstance =
        logger,
    } = {},
  ) {
    this.AuditLog =
      AuditLogModel;

    this.auditWriter =
      auditWriter;

    this.logger =
      loggerInstance;

    this.serviceName =
      SERVICE_NAME;

    this.version =
      SERVICE_VERSION;
  }

  /**
   * ==========================================================================
   * VALIDATION
   * ==========================================================================
   */

  normalizeTenantId(
    tenantId,
  ) {
    return String(
      toObjectId(
        tenantId,
        'tenantId',
      ),
    );
  }

  normalizeUserId(
    userId,
  ) {
    if (
      !userId
    ) {
      return null;
    }

    return toObjectId(
      userId,
      'userId',
    );
  }

  normalizeEntityId(
    entityId,
  ) {
    if (
      !entityId
    ) {
      return null;
    }

    return toObjectId(
      entityId,
      'entityId',
    );
  }

  /**
   * ==========================================================================
   * CREATE / APPEND AUDIT EVENT
   * ==========================================================================
   *
   * This method is intentionally append-only.
   *
   * Preferred path:
   *   existing auditLogService.log(...)
   *
   * Fallback:
   *   direct AuditLog.create/save is available for installations where the
   *   writer is not injected.
   *
   * Existing AuditLog model pre-save logic remains responsible for hash-chain
   * calculation.
   * ==========================================================================
   */

  async append(
    {
      action,
      userId,
      tenantId,
      entityType,
      entityId = null,
      metadata = {},
      role = null,
    },
  ) {
    const normalizedAction =
      normalizeString(
        action,
      );

    if (!normalizedAction) {
      throw new AdminAuditError(
        'Audit action is required.',
        {
          code:
            'AUDIT_ACTION_REQUIRED',
          statusCode: 400,
        },
      );
    }

    const normalizedTenantId =
      this.normalizeTenantId(
        tenantId,
      );

    const normalizedUserId =
      this.normalizeUserId(
        userId,
      );

    const normalizedEntityId =
      this.normalizeEntityId(
        entityId,
      );

    const normalizedEntityType =
      normalizeString(
        entityType,
      );

    if (
      !normalizedEntityType
    ) {
      throw new AdminAuditError(
        'Audit entityType is required.',
        {
          code:
            'AUDIT_ENTITY_TYPE_REQUIRED',
          statusCode: 400,
        },
      );
    }

    const safeMetadata =
      redactValue(
        cloneSafe(
          metadata ||
            {},
        ),
      ) || {};

    try {
      /**
       * Preferred canonical writer.
       *
       * The current auditLogService.log accepts a user object and generates
       * the legacy Audit model entry. Because this admin service is canonical
       * on AuditLog, only use it when the injected writer explicitly declares
       * itself compatible with AuditLog.
       */
      if (
        this.auditWriter &&
        typeof
          this.auditWriter
            .logAction ===
          'function'
      ) {
        const entry =
          await this.auditWriter
            .logAction({
              action:
                normalizedAction,

              userId:
                normalizedUserId,

              tenantId:
                new mongoose.Types.ObjectId(
                  normalizedTenantId,
                ),

              entityType:
                normalizedEntityType,

              entityId:
                normalizedEntityId,

              metadata:
                {
                  ...safeMetadata,

                  ...(role
                    ? {
                        role:
                          normalizeString(
                            role,
                          ),
                      }
                    : {}),
                },
            });

        return serializeAuditLog(
          entry,
        );
      }

      /**
       * Canonical AuditLog direct path.
       *
       * The AuditLog schema's pre-save hook computes prevHash/currentHash.
       */
      const entry =
        new this.AuditLog({
          action:
            normalizedAction,

          userId:
            normalizedUserId,

          tenantId:
            new mongoose.Types.ObjectId(
              normalizedTenantId,
            ),

          entityType:
            normalizedEntityType,

          entityId:
            normalizedEntityId,

          metadata:
            safeMetadata,
        });

      const saved =
        await entry.save();

      return serializeAuditLog(
        saved,
      );
    } catch (
      error
    ) {
      this.logError(
        'Failed to append admin audit event.',
        error,
        {
          tenantId:
            normalizedTenantId,

          userId:
            normalizedUserId
              ? String(
                  normalizedUserId,
                )
              : null,

          action:
            normalizedAction,

          entityType:
            normalizedEntityType,
        },
      );

      throw this.wrapError(
        error,
        'AUDIT_APPEND_FAILED',
      );
    }
  }

  /**
   * ==========================================================================
   * SEARCH / LIST
   * ==========================================================================
   */

  async list(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      this.normalizeTenantId(
        tenantId,
      );

    const {
      action,
      actions,
      entityType,
      entityTypes,
      userId,
      entityId,
      from,
      to,
      days =
        DEFAULT_LOOKBACK_DAYS,
      reviewed,
      pageSize =
        options.limit ||
        DEFAULT_PAGE_SIZE,
      sortBy =
        'createdAt',
      sortDirection =
        'desc',
      cursor = null,
    } = options;

    const filter = {
      tenantId:
        new mongoose.Types.ObjectId(
          normalizedTenantId,
        ),
    };

    const normalizedActions =
      normalizeArray(
        actions ||
          action,
      );

    if (
      normalizedActions.length ===
      1
    ) {
      filter.action =
        normalizedActions[0];
    }

    if (
      normalizedActions.length >
      1
    ) {
      filter.action = {
        $in:
          normalizedActions.slice(
            0,
            100,
          ),
      };
    }

    const normalizedEntityTypes =
      normalizeArray(
        entityTypes ||
          entityType,
      );

    if (
      normalizedEntityTypes.length ===
      1
    ) {
      filter.entityType =
        normalizedEntityTypes[0];
    }

    if (
      normalizedEntityTypes.length >
      1
    ) {
      filter.entityType = {
        $in:
          normalizedEntityTypes.slice(
            0,
            100,
          ),
      };
    }

    if (userId) {
      filter.userId =
        this.normalizeUserId(
          userId,
        );
    }

    if (entityId) {
      filter.entityId =
        this.normalizeEntityId(
          entityId,
        );
    }

    const range =
      normalizeDateRange({
        from,
        to,
        days,
      });

    filter.createdAt = {
      $gte:
        range.from,

      $lte:
        range.to,
    };

    const normalizedReviewed =
      normalizeBoolean(
        reviewed,
        null,
      );

    /**
     * `reviewed` is not part of the canonical AuditLog schema.
     * We deliberately do not inject unknown fields into the Mongo query.
     *
     * This prevents silently producing misleading results.
     */
    if (
      normalizedReviewed !==
      null
    ) {
      throw new AdminAuditError(
        'The canonical AuditLog model does not define a reviewed field. Use a compliance or case-management service for review-state filtering.',
        {
          code:
            'UNSUPPORTED_AUDIT_FILTER',
          statusCode: 400,
          details: {
            field:
              'reviewed',
          },
        },
      );
    }

    const safeSortBy =
      ALLOWED_SORT_FIELDS.includes(
        sortBy,
      )
        ? sortBy
        : 'createdAt';

    const safeDirection =
      SORT_DIRECTIONS.includes(
        String(
          sortDirection,
        ).toLowerCase(),
      )
        ? String(
            sortDirection,
          ).toLowerCase()
        : 'desc';

    const safePageSize =
      normalizePositiveInteger(
        pageSize,
        DEFAULT_PAGE_SIZE,
        MAX_PAGE_SIZE,
      );

    const decodedCursor =
      decodeCursor(
        cursor,
      );

    const cursorFilter =
      buildCursorFilter(
        decodedCursor,
        safeDirection,
      );

    const finalFilter =
      cursorFilter
        ? {
            $and: [
              filter,
              cursorFilter,
            ],
          }
        : filter;

    /**
     * Deterministic tie-breaker.
     */
    const sort = {
      [safeSortBy]:
        safeDirection ===
        'asc'
          ? 1
          : -1,

      _id:
        safeDirection ===
        'asc'
          ? 1
          : -1,
    };

    try {
      const documents =
        await this.AuditLog
          .find(
            finalFilter,
          )
          .select(
            [
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
            ].join(' '),
          )
          .sort(sort)
          .limit(
            safePageSize + 1,
          )
          .lean();

      const hasNextPage =
        documents.length >
        safePageSize;

      const pageDocuments =
        hasNextPage
          ? documents.slice(
              0,
              safePageSize,
            )
          : documents;

      const last =
        pageDocuments[
          pageDocuments.length - 1
        ];

      const nextCursor =
        hasNextPage &&
        last
          ? encodeCursor({
              createdAt:
                last.createdAt,

              id:
                last._id,
            })
          : null;

      return {
        items:
          pageDocuments.map(
            serializeAuditLog,
          ),

        pagination: {
          pageSize:
            safePageSize,

          hasNextPage,

          nextCursor,

          sortBy:
            safeSortBy,

          sortDirection:
            safeDirection,
        },

        filter: {
          tenantId:
            normalizedTenantId,

          from:
            range.from,

          to:
            range.to,

          action:
            normalizedActions,

          entityType:
            normalizedEntityTypes,

          userId:
            userId || null,

          entityId:
            entityId || null,
        },
      };
    } catch (
      error
    ) {
      this.logError(
        'Failed to query administrative audit logs.',
        error,
        {
          tenantId:
            normalizedTenantId,
        },
      );

      throw this.wrapError(
        error,
        'AUDIT_LIST_FAILED',
      );
    }
  }

  /**
   * ==========================================================================
   * GET ONE
   * ==========================================================================
   */

  async getById(
    tenantId,
    auditId,
  ) {
    const normalizedTenantId =
      this.normalizeTenantId(
        tenantId,
      );

    const normalizedAuditId =
      toObjectId(
        auditId,
        'auditId',
      );

    try {
      const document =
        await this.AuditLog
          .findOne({
            _id:
              normalizedAuditId,

            tenantId:
              new mongoose.Types.ObjectId(
                normalizedTenantId,
              ),
          })
          .select(
            [
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
            ].join(' '),
          )
          .lean();

      if (!document) {
        throw new AdminAuditError(
          'Audit record not found.',
          {
            code:
              'AUDIT_NOT_FOUND',
            statusCode: 404,
          },
        );
      }

      return serializeAuditLog(
        document,
      );
    } catch (
      error
    ) {
      if (
        error instanceof
        AdminAuditError
      ) {
        throw error;
      }

      this.logError(
        'Failed to load audit record.',
        error,
        {
          tenantId:
            normalizedTenantId,

          auditId:
            String(
              normalizedAuditId,
            ),
        },
      );

      throw this.wrapError(
        error,
        'AUDIT_GET_FAILED',
      );
    }
  }

  /**
   * ==========================================================================
   * SUMMARY / STATISTICS
   * ==========================================================================
   */

  async getSummary(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      this.normalizeTenantId(
        tenantId,
      );

    const range =
      normalizeDateRange(
        options,
      );

    const tenantObjectId =
      new mongoose.Types.ObjectId(
        normalizedTenantId,
      );

    try {
      const [
        overall,
        actions,
        entities,
        users,
        hourly,
      ] = await Promise.all([
        this.AuditLog.aggregate([
          {
            $match: {
              tenantId:
                tenantObjectId,

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
                null,

              total:
                {
                  $sum: 1,
                },

              distinctUsers:
                {
                  $addToSet:
                    '$userId',
                },

              distinctActions:
                {
                  $addToSet:
                    '$action',
                },

              distinctEntityTypes:
                {
                  $addToSet:
                    '$entityType',
                },
            },
          },

          {
            $project: {
              _id: 0,

              total: 1,

              userCount:
                {
                  $size:
                    '$distinctUsers',
                },

              actionCount:
                {
                  $size:
                    '$distinctActions',
                },

              entityTypeCount:
                {
                  $size:
                    '$distinctEntityTypes',
                },
            },
          },
        ]),

        this.AuditLog.aggregate([
          {
            $match: {
              tenantId:
                tenantObjectId,

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
                '$action',

              count:
                {
                  $sum: 1,
                },
            },
          },

          {
            $sort: {
              count: -1,
            },
          },

          {
            $limit: 50,
          },
        ]),

        this.AuditLog.aggregate([
          {
            $match: {
              tenantId:
                tenantObjectId,

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
                '$entityType',

              count:
                {
                  $sum: 1,
                },
            },
          },

          {
            $sort: {
              count: -1,
            },
          },

          {
            $limit: 50,
          },
        ]),

        this.AuditLog.aggregate([
          {
            $match: {
              tenantId:
                tenantObjectId,

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
                '$userId',

              count:
                {
                  $sum: 1,
                },
            },
          },

          {
            $sort: {
              count: -1,
            },
          },

          {
            $limit: 50,
          },
        ]),

        this.AuditLog.aggregate([
          {
            $match: {
              tenantId:
                tenantObjectId,

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
                {
                  $dateToString: {
                    format:
                      '%Y-%m-%dT%H:00:00.000Z',

                    date:
                      '$createdAt',
                  },
                },

              count:
                {
                  $sum: 1,
                },
            },
          },

          {
            $sort: {
              _id: 1,
            },
          },
        ]),
      ]);

      const base =
        overall[0] || {
          total: 0,
          userCount: 0,
          actionCount: 0,
          entityTypeCount: 0,
        };

      return {
        tenantId:
          normalizedTenantId,

        period: {
          from:
            range.from,

          to:
            range.to,
        },

        total:
          Number(
            base.total || 0,
          ),

        distinctUsers:
          Number(
            base.userCount ||
              0,
          ),

        distinctActions:
          Number(
            base.actionCount ||
              0,
          ),

        distinctEntityTypes:
          Number(
            base.entityTypeCount ||
              0,
          ),

        topActions:
          actions.map(
            (row) => ({
              action:
                row._id,

              count:
                Number(
                  row.count ||
                    0,
                ),
            }),
          ),

        topEntityTypes:
          entities.map(
            (row) => ({
              entityType:
                row._id,

              count:
                Number(
                  row.count ||
                    0,
                ),
            }),
          ),

        topUsers:
          users.map(
            (row) => ({
              userId:
                row._id
                  ? String(
                      row._id,
                    )
                  : null,

              count:
                Number(
                  row.count ||
                    0,
                ),
            }),
          ),

        hourly:
          hourly.map(
            (row) => ({
              period:
                row._id,

              count:
                Number(
                  row.count ||
                    0,
                ),
            }),
          ),

        generatedAt:
          new Date(),
      };
    } catch (
      error
    ) {
      this.logError(
        'Failed to build audit summary.',
        error,
        {
          tenantId:
            normalizedTenantId,
        },
      );

      throw this.wrapError(
        error,
        'AUDIT_SUMMARY_FAILED',
      );
    }
  }

  /**
   * ==========================================================================
   * ENTITY TIMELINE
   * ==========================================================================
   *
   * Returns all audit events for one domain entity inside the tenant boundary.
   * ==========================================================================
   */

  async getEntityTimeline(
    tenantId,
    {
      entityType,
      entityId,
      from = null,
      to = null,
      days =
        DEFAULT_LOOKBACK_DAYS,
      limit =
        DEFAULT_PAGE_SIZE,
    } = {},
  ) {
    const normalizedTenantId =
      this.normalizeTenantId(
        tenantId,
      );

    const normalizedEntityType =
      normalizeString(
        entityType,
      );

    if (
      !normalizedEntityType
    ) {
      throw new AdminAuditError(
        'entityType is required.',
        {
          code:
            'ENTITY_TYPE_REQUIRED',
          statusCode: 400,
        },
      );
    }

    const normalizedEntityId =
      this.normalizeEntityId(
        entityId,
      );

    const range =
      normalizeDateRange({
        from,
        to,
        days,
      });

    const safeLimit =
      normalizePositiveInteger(
        limit,
        DEFAULT_PAGE_SIZE,
        MAX_PAGE_SIZE,
      );

    try {
      const documents =
        await this.AuditLog
          .find({
            tenantId:
              new mongoose.Types.ObjectId(
                normalizedTenantId,
              ),

            entityType:
              normalizedEntityType,

            entityId:
              normalizedEntityId,

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
            ].join(' '),
          )
          .sort({
            createdAt:
              1,

            _id:
              1,
          })
          .limit(
            safeLimit,
          )
          .lean();

      return {
        tenantId:
          normalizedTenantId,

        entityType:
          normalizedEntityType,

        entityId:
          String(
            normalizedEntityId,
          ),

        period: {
          from:
            range.from,

          to:
            range.to,
        },

        items:
          documents.map(
            serializeAuditLog,
          ),

        count:
          documents.length,
      };
    } catch (
      error
    ) {
      this.logError(
        'Failed to load entity audit timeline.',
        error,
        {
          tenantId:
            normalizedTenantId,

          entityType:
            normalizedEntityType,

          entityId:
            String(
              normalizedEntityId,
            ),
        },
      );

      throw this.wrapError(
        error,
        'AUDIT_ENTITY_TIMELINE_FAILED',
      );
    }
  }

  /**
   * ==========================================================================
   * USER TIMELINE
   * ==========================================================================
   */

  async getUserTimeline(
    tenantId,
    userId,
    options = {},
  ) {
    const normalizedTenantId =
      this.normalizeTenantId(
        tenantId,
      );

    const normalizedUserId =
      this.normalizeUserId(
        userId,
      );

    const range =
      normalizeDateRange(
        options,
      );

    const safeLimit =
      normalizePositiveInteger(
        options.limit,
        DEFAULT_PAGE_SIZE,
        MAX_PAGE_SIZE,
      );

    try {
      const documents =
        await this.AuditLog
          .find({
            tenantId:
              new mongoose.Types.ObjectId(
                normalizedTenantId,
              ),

            userId:
              normalizedUserId,

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
            ].join(' '),
          )
          .sort({
            createdAt:
              -1,

            _id:
              -1,
          })
          .limit(
            safeLimit,
          )
          .lean();

      return {
        tenantId:
          normalizedTenantId,

        userId:
          String(
            normalizedUserId,
          ),

        period: {
          from:
            range.from,

          to:
            range.to,
        },

        items:
          documents.map(
            serializeAuditLog,
          ),

        count:
          documents.length,
      };
    } catch (
      error
    ) {
      this.logError(
        'Failed to load user audit timeline.',
        error,
        {
          tenantId:
            normalizedTenantId,

          userId:
            String(
              normalizedUserId,
            ),
        },
      );

      throw this.wrapError(
        error,
        'AUDIT_USER_TIMELINE_FAILED',
      );
    }
  }

  /**
   * ==========================================================================
   * HASH CHAIN INTEGRITY VERIFICATION
   * ==========================================================================
   *
   * IMPORTANT:
   * The current AuditLog schema computes:
   *
   *   prevHash
   *   currentHash
   *
   * in its pre-save hook.
   *
   * This verification routine does not mutate any record.
   *
   * It independently reconstructs the hash payload using the same logical
   * fields and validates:
   *
   * 1. previous hash linkage;
   * 2. current hash correctness;
   * 3. tenant boundary;
   * 4. chronological ordering.
   *
   * ==========================================================================
   */

  async verifyIntegrity(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      this.normalizeTenantId(
        tenantId,
      );

    const range =
      normalizeDateRange(
        options,
      );

    const tenantObjectId =
      new mongoose.Types.ObjectId(
        normalizedTenantId,
      );

    try {
      const documents =
        await this.AuditLog
          .find({
            tenantId:
              tenantObjectId,

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
              'action',
              'userId',
              'tenantId',
              'entityType',
              'entityId',
              'metadata',
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
          .lean();

      const failures = [];

      let previousHash =
        null;

      for (
        let index = 0;
        index <
          documents.length;
        index += 1
      ) {
        const entry =
          documents[index];

        const expectedPreviousHash =
          previousHash;

        const actualPreviousHash =
          entry.prevHash ||
          null;

        if (
          actualPreviousHash !==
          expectedPreviousHash
        ) {
          failures.push({
            type:
              'PREVIOUS_HASH_MISMATCH',

            index,

            auditId:
              String(
                entry._id,
              ),

            expected:
              expectedPreviousHash,

            actual:
              actualPreviousHash,
          });
        }

        /**
         * Mirrors the payload currently used by AuditLog.pre('save').
         */
        const payload =
          JSON.stringify({
            action:
              entry.action,

            userId:
              entry.userId,

            tenantId:
              entry.tenantId,

            entityType:
              entry.entityType,

            entityId:
              entry.entityId,

            metadata:
              entry.metadata,

            prevHash:
              entry.prevHash,

            ts:
              entry.createdAt
                ? new Date(
                    entry.createdAt,
                  ).toISOString()
                : null,
          });

        const expectedCurrentHash =
          crypto
            .createHash(
              'sha256',
            )
            .update(payload)
            .digest('hex');

        if (
          expectedCurrentHash !==
          entry.currentHash
        ) {
          failures.push({
            type:
              'CURRENT_HASH_MISMATCH',

            index,

            auditId:
              String(
                entry._id,
              ),

            expected:
              expectedCurrentHash,

            actual:
              entry.currentHash,
          });
        }

        previousHash =
          entry.currentHash ||
          null;
      }

      return {
        tenantId:
          normalizedTenantId,

        valid:
          failures.length ===
          0,

        inspected:
          documents.length,

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
    } catch (
      error
    ) {
      this.logError(
        'Failed to verify audit hash-chain integrity.',
        error,
        {
          tenantId:
            normalizedTenantId,
        },
      );

      throw this.wrapError(
        error,
        'AUDIT_INTEGRITY_CHECK_FAILED',
      );
    }
  }

  /**
   * ==========================================================================
   * GLOBAL AUDIT HEALTH
   * ==========================================================================
   *
   * Suitable for an administrative health endpoint.
   * It verifies only bounded tenant-scoped data.
   * ==========================================================================
   */

  async getAuditHealth(
    tenantId,
  ) {
    const normalizedTenantId =
      this.normalizeTenantId(
        tenantId,
      );

    try {
      const latest =
        await this.AuditLog
          .findOne({
            tenantId:
              new mongoose.Types.ObjectId(
                normalizedTenantId,
              ),
          })
          .select(
            [
              '_id',
              'currentHash',
              'prevHash',
              'createdAt',
            ].join(' '),
          )
          .sort({
            createdAt:
              -1,

            _id:
              -1,
          })
          .lean();

      const count =
        await this.AuditLog.countDocuments({
          tenantId:
            new mongoose.Types.ObjectId(
              normalizedTenantId,
            ),
        });

      let latestChainState =
        'unknown';

      if (latest) {
        if (
          latest.currentHash &&
          typeof latest.currentHash ===
            'string' &&
          latest.currentHash.length ===
            64
        ) {
          latestChainState =
            'present';
        } else {
          latestChainState =
            'invalid';
        }
      }

      return {
        healthy:
          latest
            ? latestChainState ===
              'present'
            : true,

        tenantId:
          normalizedTenantId,

        recordCount:
          count,

        latestAuditAt:
          latest?.createdAt ||
          null,

        latestAuditId:
          latest?._id
            ? String(
                latest._id,
              )
            : null,

        latestChainState,

        appendOnly:
          true,

        generatedAt:
          new Date(),
      };
    } catch (
      error
    ) {
      this.logError(
        'Failed to evaluate audit health.',
        error,
        {
          tenantId:
            normalizedTenantId,
        },
      );

      throw this.wrapError(
        error,
        'AUDIT_HEALTH_FAILED',
      );
    }
  }

  /**
   * ==========================================================================
   * OPERATIONAL / COMPLIANCE EXPORT
   * ==========================================================================
   *
   * Returns sanitized records only.
   *
   * No CSV/XLSX dependency is introduced here. Export formatting belongs in a
   * dedicated report/export service.
   * ==========================================================================
   */

  async getExportDataset(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      this.normalizeTenantId(
        tenantId,
      );

    const range =
      normalizeDateRange(
        options,
      );

    const safeLimit =
      normalizePositiveInteger(
        options.limit,
        MAX_PAGE_SIZE,
        10000,
      );

    const filter = {
      tenantId:
        new mongoose.Types.ObjectId(
          normalizedTenantId,
        ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const actions =
      normalizeArray(
        options.actions ||
          options.action,
      );

    if (
      actions.length
    ) {
      filter.action = {
        $in:
          actions.slice(
            0,
            100,
          ),
      };
    }

    const entityTypes =
      normalizeArray(
        options.entityTypes ||
          options.entityType,
      );

    if (
      entityTypes.length
    ) {
      filter.entityType = {
        $in:
          entityTypes.slice(
            0,
            100,
          ),
      };
    }

    try {
      const documents =
        await this.AuditLog
          .find(filter)
          .select(
            [
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
            ].join(' '),
          )
          .sort({
            createdAt:
              1,

            _id:
              1,
          })
          .limit(
            safeLimit,
          )
          .lean();

      return {
        generatedAt:
          new Date(),

        tenantId:
          normalizedTenantId,

        from:
          range.from,

        to:
          range.to,

        count:
          documents.length,

        truncated:
          documents.length >=
          safeLimit,

        records:
          documents.map(
            serializeAuditLog,
          ),
      };
    } catch (
      error
    ) {
      this.logError(
        'Failed to build audit export dataset.',
        error,
        {
          tenantId:
            normalizedTenantId,
        },
      );

      throw this.wrapError(
        error,
        'AUDIT_EXPORT_DATASET_FAILED',
      );
    }
  }

  /**
   * ==========================================================================
   * IMMUTABILITY GUARD
   * ==========================================================================
   *
   * These explicit methods make destructive operations fail closed instead of
   * allowing a future controller developer to accidentally wire destructive
   * behavior into the admin audit service.
   * ==========================================================================
   */

  async update() {
    throw new AdminAuditError(
      'Audit records are immutable and cannot be updated.',
      {
        code:
          'AUDIT_IMMUTABLE',
        statusCode: 405,
      },
    );
  }

  async delete() {
    throw new AdminAuditError(
      'Audit records are immutable and cannot be deleted.',
      {
        code:
          'AUDIT_IMMUTABLE',
        statusCode: 405,
      },
    );
  }

  async remove() {
    return this.delete();
  }

  /**
   * ==========================================================================
   * INTERNAL ERROR / LOGGING HELPERS
   * ==========================================================================
   */

  wrapError(
    error,
    code,
  ) {
    if (
      error instanceof
      AdminAuditError
    ) {
      return error;
    }

    return new AdminAuditError(
      error?.message ||
        'Administrative audit operation failed.',
      {
        code,

        cause:
          error,
      },
    );
  }

  logError(
    message,
    error,
    context = {},
  ) {
    try {
      if (
        this.logger &&
        typeof
          this.logger.error ===
          'function'
      ) {
        this.logger.error(
          message,
          {
            service:
              this.serviceName,

            version:
              this.version,

            ...context,

            error:
              error?.message,

            errorName:
              error?.name,
          },
        );
      }
    } catch {
      // Logging failures must never replace the original business error.
    }
  }
}

/**
 * ============================================================================
 * SINGLETON
 * ============================================================================
 */

const adminAuditService =
  new AdminAuditService();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  adminAuditService;

module.exports.AdminAuditService =
  AdminAuditService;

module.exports.AdminAuditError =
  AdminAuditError;

module.exports.SERVICE_NAME =
  SERVICE_NAME;

module.exports.SERVICE_VERSION =
  SERVICE_VERSION;