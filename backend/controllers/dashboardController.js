/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/controllers/dashboardController.js
 *
 * Purpose:
 *   Enterprise dashboard HTTP controller.
 *
 * Responsibilities:
 *   - Expose tenant-scoped dashboard read APIs
 *   - Delegate analytics/business calculations to DashboardService
 *   - Enforce presence of resolved tenant context
 *   - Normalize pagination/query parameters
 *   - Produce canonical TITech API responses
 *   - Preserve request/trace correlation metadata
 *   - Forward unexpected errors to the global error handler
 *
 * Dashboard capabilities:
 *   - Executive metrics
 *   - Dashboard charts
 *   - Fraud monitoring
 *   - Compliance monitoring
 *   - Revenue intelligence
 *   - Portfolio analytics
 *   - Savings analytics
 *   - Loan analytics
 *   - Risk analytics
 *   - Executive summary
 *   - Board / CEO snapshot
 *
 * ARCHITECTURAL BOUNDARY
 * ----------------------
 * This controller MUST NOT:
 *   - perform MongoDB queries for analytics
 *   - mutate balances
 *   - mutate ledger entries
 *   - approve/reject loans
 *   - perform financial calculations
 *   - make payment-provider calls
 *   - implement authorization policy
 *   - bypass tenant-isolation middleware
 *
 * DashboardService owns dashboard aggregation/business logic.
 *
 * Authentication / authorization / tenant resolution should normally happen
 * before this controller in route middleware.
 *
 * This controller keeps a lightweight defense-in-depth tenant-context check.
 *
 * =============================================================================
 */

import DashboardService from '../modules/dashboard/services/dashboardService.js';
import { createRequire } from 'node:module';

import {
  successResponse,
  errorResponse,
  buildPagination,
} from '../utils/response.js';

const require = createRequire(import.meta.url);

const asyncHandler =
  require('../utils/asyncHandler.js');

import logger from '../utils/logger.js';

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const DEFAULT_CHART_PERIOD = '12m';
const DEFAULT_REVENUE_PERIOD = 'monthly';

const ALLOWED_CHART_PERIODS = new Set([
  '7d',
  '30d',
  '90d',
  '6m',
  '12m',
  '24m',
]);

const ALLOWED_REVENUE_PERIODS = new Set([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
]);

/**
 * =============================================================================
 * Internal helpers
 * =============================================================================
 */

/**
 * Resolve the canonical tenant identifier from the request context.
 *
 * Your platform currently contains code using both:
 *
 *   req.tenant_id
 *   req.tenantId
 *
 * Keep compatibility at the controller boundary, while the preferred
 * application convention should eventually become req.tenantId.
 */
const getTenantId = (req) =>
  req.tenantId ??
  req.tenant_id ??
  req.context?.tenantId ??
  req.tenant?.id ??
  req.tenant?._id ??
  null;

/**
 * Resolve request/trace identifier.
 */
const getTraceId = (req) =>
  req.traceId ??
  req.requestId ??
  req.id ??
  req.headers?.['x-trace-id'] ??
  req.headers?.['x-request-id'] ??
  null;

/**
 * Convert a query parameter to a bounded positive integer.
 */
const parsePositiveInteger = (
  value,
  fallback,
  {
    min = 1,
    max = Number.MAX_SAFE_INTEGER,
  } = {},
) => {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const stringValue = String(value).trim();

  /**
   * Do not silently accept values such as:
   *   "10abc"
   *   "1.5"
   *   "0x10"
   *
   * Require an actual decimal integer.
   */
  if (!/^\d+$/.test(stringValue)) {
    return fallback;
  }

  const parsed = Number(stringValue);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < min ||
    parsed > max
  ) {
    return fallback;
  }

  return parsed;
};

/**
 * Build bounded pagination options.
 */
const getPagination = (req) => {
  const page = parsePositiveInteger(
    req.query?.page,
    DEFAULT_PAGE,
    {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    },
  );

  const limit = parsePositiveInteger(
    req.query?.limit,
    DEFAULT_LIMIT,
    {
      min: 1,
      max: MAX_LIMIT,
    },
  );

  return {
    page,
    limit,
  };
};

/**
 * Normalize a request date filter.
 */
const getDateRange = (req) => ({
  startDate:
    typeof req.query?.startDate === 'string'
      ? req.query.startDate.trim()
      : undefined,

  endDate:
    typeof req.query?.endDate === 'string'
      ? req.query.endDate.trim()
      : undefined,
});

/**
 * Validate and normalize chart period.
 *
 * Invalid values are rejected rather than silently producing an unexpected
 * analytics window.
 */
const getChartPeriod = (req) => {
  const requested =
    typeof req.query?.period === 'string'
      ? req.query.period.trim()
      : DEFAULT_CHART_PERIOD;

  if (!ALLOWED_CHART_PERIODS.has(requested)) {
    const error = new Error(
      `Unsupported chart period. Allowed values: ${[
        ...ALLOWED_CHART_PERIODS,
      ].join(', ')}`,
    );

    error.statusCode = 400;
    error.errorCode = 'INVALID_CHART_PERIOD';
    error.expose = true;

    throw error;
  }

  return requested;
};

/**
 * Validate and normalize revenue period.
 */
const getRevenuePeriod = (req) => {
  const requested =
    typeof req.query?.period === 'string'
      ? req.query.period.trim().toLowerCase()
      : DEFAULT_REVENUE_PERIOD;

  if (!ALLOWED_REVENUE_PERIODS.has(requested)) {
    const error = new Error(
      `Unsupported revenue period. Allowed values: ${[
        ...ALLOWED_REVENUE_PERIODS,
      ].join(', ')}`,
    );

    error.statusCode = 400;
    error.errorCode = 'INVALID_REVENUE_PERIOD';
    error.expose = true;

    throw error;
  }

  return requested;
};

/**
 * Throw a canonical tenant-context error.
 */
const requireTenant = (req) => {
  const tenantId = getTenantId(req);

  if (!tenantId) {
    const error = new Error(
      'Tenant context is required.',
    );

    error.statusCode = 400;
    error.errorCode = 'TENANT_CONTEXT_REQUIRED';
    error.expose = true;

    throw error;
  }

  return tenantId;
};

/**
 * Build controller metadata.
 */
const buildMeta = (req, startedAt) => ({
  requestId:
    req.requestId ??
    req.id ??
    req.headers?.['x-request-id'] ??
    null,

  traceId: getTraceId(req),

  tenantId:
    getTenantId(req) ??
    null,

  executionTimeMs: Math.max(
    0,
    Date.now() - startedAt,
  ),
});

/**
 * Log an unexpected dashboard-controller failure.
 *
 * The error is still forwarded to the canonical global error handler.
 */
const logControllerError = (
  error,
  req,
  operation,
) => {
  logger.error(
    {
      err: error,
      operation,
      traceId: getTraceId(req),
      tenantId: getTenantId(req),
      path: req.originalUrl,
      method: req.method,
    },
    '[DashboardController] Request failed',
  );
};

/**
 * Send a tenant-context error without throwing.
 */
const sendTenantError = (
  res,
  req,
) =>
  errorResponse(
    res,
    {
      statusCode: 400,
      errorCode: 'TENANT_CONTEXT_REQUIRED',
      message: 'Tenant context is required.',
      expose: true,
    },
    req,
  );

/**
 * =============================================================================
 * Controller
 * =============================================================================
 */

class DashboardController {
  /**
   * ===========================================================================
   * Dashboard health
   * ===========================================================================
   *
   * GET /api/v1/dashboard/health
   *
   * This endpoint intentionally does not require tenant context.
   *
   * It reports process/application health information only.
   */
  static health = asyncHandler(
    async (req, res) => {
      const startedAt = Date.now();

      return successResponse(
        res,
        {
          service: 'dashboard-service',
          status: 'healthy',
          uptime: process.uptime(),
          nodeVersion: process.version,
          environment:
            process.env.NODE_ENV ??
            'development',

          /**
           * Useful for infrastructure diagnostics.
           * This does not expose secrets.
           */
          memoryUsage: process.memoryUsage(),
        },
        'Dashboard service operational',
        req,
        200,
      );
    },
  );

  /**
   * ===========================================================================
   * Executive metrics
   * ===========================================================================
   *
   * GET /api/v1/dashboard/metrics
   */
  static getMetrics = asyncHandler(
    async (req, res) => {
      const startedAt = Date.now();

      const tenantId = getTenantId(req);

      if (!tenantId) {
        return sendTenantError(
          res,
          req,
        );
      }

      try {
        const metrics =
          await DashboardService.getMetrics(
            tenantId,
          );

        return successResponse(
          res,
          metrics,
          'Metrics retrieved successfully.',
          req,
          200,
        );
      } catch (error) {
        logControllerError(
          error,
          req,
          'getMetrics',
        );

        throw error;
      }
    },
  );

  /**
   * ===========================================================================
   * Dashboard charts
   * ===========================================================================
   *
   * GET /api/v1/dashboard/charts
   *
   * Query:
   *   ?period=7d|30d|90d|6m|12m|24m
   */
  static getCharts = asyncHandler(
    async (req, res) => {
      const tenantId = getTenantId(req);

      if (!tenantId) {
        return sendTenantError(
          res,
          req,
        );
      }

      try {
        const period =
          getChartPeriod(req);

        const charts =
          await DashboardService.getCharts(
            tenantId,
            period,
          );

        return successResponse(
          res,
          charts,
          'Chart data retrieved successfully.',
          req,
          200,
        );
      } catch (error) {
        logControllerError(
          error,
          req,
          'getCharts',
        );

        throw error;
      }
    },
  );

  /**
   * ===========================================================================
   * Fraud alerts
   * ===========================================================================
   *
   * GET /api/v1/dashboard/fraud-alerts
   */
  static getFraudAlerts = asyncHandler(
    async (req, res) => {
      const tenantId = getTenantId(req);

      if (!tenantId) {
        return sendTenantError(
          res,
          req,
        );
      }

      try {
        const pagination =
          getPagination(req);

        const data =
          await DashboardService.getFraudAlerts(
            tenantId,
            pagination,
          );

        /**
         * The service may already return pagination metadata.
         * Do not overwrite it.
         *
         * If it returns an array, provide canonical pagination metadata.
         */
        const normalizedData =
          Array.isArray(data)
            ? {
                items: data,
                pagination: buildPagination({
                  page: pagination.page,
                  limit: pagination.limit,
                  total: data.length,
                }),
              }
            : data;

        return successResponse(
          res,
          normalizedData,
          'Fraud alerts retrieved successfully.',
          req,
          200,
        );
      } catch (error) {
        logControllerError(
          error,
          req,
          'getFraudAlerts',
        );

        throw error;
      }
    },
  );

  /**
   * ===========================================================================
   * Compliance alerts
   * ===========================================================================
   *
   * GET /api/v1/dashboard/compliance-alerts
   */
  static getComplianceAlerts =
    asyncHandler(
      async (req, res) => {
        const tenantId =
          getTenantId(req);

        if (!tenantId) {
          return sendTenantError(
            res,
            req,
          );
        }

        try {
          const pagination =
            getPagination(req);

          const data =
            await DashboardService.getComplianceAlerts(
              tenantId,
              pagination,
            );

          const normalizedData =
            Array.isArray(data)
              ? {
                  items: data,
                  pagination:
                    buildPagination({
                      page: pagination.page,
                      limit: pagination.limit,
                      total: data.length,
                    }),
                }
              : data;

          return successResponse(
            res,
            normalizedData,
            'Compliance alerts retrieved successfully.',
            req,
            200,
          );
        } catch (error) {
          logControllerError(
            error,
            req,
            'getComplianceAlerts',
          );

          throw error;
        }
      },
    );

  /**
   * ===========================================================================
   * Revenue trend
   * ===========================================================================
   *
   * GET /api/v1/dashboard/revenue-trend
   *
   * Query:
   *   ?startDate=...
   *   ?endDate=...
   *   ?period=monthly
   *
   * Date syntax validation should normally be performed by route validators.
   */
  static getRevenueTrend =
    asyncHandler(
      async (req, res) => {
        const tenantId =
          getTenantId(req);

        if (!tenantId) {
          return sendTenantError(
            res,
            req,
          );
        }

        try {
          const {
            startDate,
            endDate,
          } = getDateRange(req);

          const period =
            getRevenuePeriod(req);

          const data =
            await DashboardService.getRevenueTrend(
              tenantId,
              {
                startDate,
                endDate,
                period,
              },
            );

          return successResponse(
            res,
            data,
            'Revenue trend retrieved successfully.',
            req,
            200,
          );
        } catch (error) {
          logControllerError(
            error,
            req,
            'getRevenueTrend',
          );

          throw error;
        }
      },
    );

  /**
   * ===========================================================================
   * Portfolio overview
   * ===========================================================================
   *
   * GET /api/v1/dashboard/portfolio-overview
   */
  static getPortfolioOverview =
    asyncHandler(
      async (req, res) => {
        const tenantId =
          getTenantId(req);

        if (!tenantId) {
          return sendTenantError(
            res,
            req,
          );
        }

        try {
          const data =
            await DashboardService.getPortfolioOverview(
              tenantId,
            );

          return successResponse(
            res,
            data,
            'Portfolio overview retrieved successfully.',
            req,
            200,
          );
        } catch (error) {
          logControllerError(
            error,
            req,
            'getPortfolioOverview',
          );

          throw error;
        }
      },
    );

  /**
   * ===========================================================================
   * Savings analytics
   * ===========================================================================
   *
   * GET /api/v1/dashboard/savings-analytics
   */
  static getSavingsAnalytics =
    asyncHandler(
      async (req, res) => {
        const tenantId =
          getTenantId(req);

        if (!tenantId) {
          return sendTenantError(
            res,
            req,
          );
        }

        try {
          const data =
            await DashboardService.getSavingsAnalytics(
              tenantId,
            );

          return successResponse(
            res,
            data,
            'Savings analytics retrieved successfully.',
            req,
            200,
          );
        } catch (error) {
          logControllerError(
            error,
            req,
            'getSavingsAnalytics',
          );

          throw error;
        }
      },
    );

  /**
   * ===========================================================================
   * Loan analytics
   * ===========================================================================
   *
   * GET /api/v1/dashboard/loan-analytics
   */
  static getLoanAnalytics =
    asyncHandler(
      async (req, res) => {
        const tenantId =
          getTenantId(req);

        if (!tenantId) {
          return sendTenantError(
            res,
            req,
          );
        }

        try {
          const data =
            await DashboardService.getLoanAnalytics(
              tenantId,
            );

          return successResponse(
            res,
            data,
            'Loan analytics retrieved successfully.',
            req,
            200,
          );
        } catch (error) {
          logControllerError(
            error,
            req,
            'getLoanAnalytics',
          );

          throw error;
        }
      },
    );

  /**
   * ===========================================================================
   * Risk analytics
   * ===========================================================================
   *
   * GET /api/v1/dashboard/risk-analytics
   */
  static getRiskAnalytics =
    asyncHandler(
      async (req, res) => {
        const tenantId =
          getTenantId(req);

        if (!tenantId) {
          return sendTenantError(
            res,
            req,
          );
        }

        try {
          const data =
            await DashboardService.getRiskAnalytics(
              tenantId,
            );

          return successResponse(
            res,
            data,
            'Risk analytics retrieved successfully.',
            req,
            200,
          );
        } catch (error) {
          logControllerError(
            error,
            req,
            'getRiskAnalytics',
          );

          throw error;
        }
      },
    );

  /**
   * ===========================================================================
   * Executive summary
   * ===========================================================================
   *
   * GET /api/v1/dashboard/executive-summary
   */
  static getExecutiveSummary =
    asyncHandler(
      async (req, res) => {
        const tenantId =
          getTenantId(req);

        if (!tenantId) {
          return sendTenantError(
            res,
            req,
          );
        }

        try {
          const data =
            await DashboardService.getExecutiveSummary(
              tenantId,
            );

          return successResponse(
            res,
            data,
            'Executive summary retrieved successfully.',
            req,
            200,
          );
        } catch (error) {
          logControllerError(
            error,
            req,
            'getExecutiveSummary',
          );

          throw error;
        }
      },
    );

  /**
   * ===========================================================================
   * Board / CEO snapshot
   * ===========================================================================
   *
   * GET /api/v1/dashboard/snapshot
   */
  static getSnapshot = asyncHandler(
    async (req, res) => {
      const tenantId = getTenantId(req);

      if (!tenantId) {
        return sendTenantError(
          res,
          req,
        );
      }

      try {
        const data =
          await DashboardService.getSnapshot(
            tenantId,
          );

        return successResponse(
          res,
          data,
          'Dashboard snapshot retrieved successfully.',
          req,
          200,
        );
      } catch (error) {
        logControllerError(
          error,
          req,
          'getSnapshot',
        );

        throw error;
      }
    },
  );

  /**
   * ===========================================================================
   * Backwards-compatible utility methods
   * ===========================================================================
   *
   * Existing code may still call:
   *
   *   DashboardController.success(...)
   *   DashboardController.buildMeta(...)
   *   DashboardController.validateTenant(...)
   *
   * Retain these while the repository is migrated.
   */

  static success(
    res,
    data = null,
    message = 'Success',
    statusCode = 200,
    meta = {},
    req = null,
  ) {
    /**
     * Prefer the canonical response utility.
     *
     * Legacy callers can continue supplying meta data. New callers should
     * normally use the controller methods above.
     */
    const responseData = {
      ...(
        meta &&
        typeof meta === 'object' &&
        Object.keys(meta).length
          ? {}
          : {}
      ),
      ...(
        data === undefined
          ? null
          : {}
      ),
    };

    void responseData;

    return successResponse(
      res,
      data,
      message,
      req,
      statusCode,
    );
  }

  static buildMeta(
    req,
    startedAt = Date.now(),
  ) {
    return buildMeta(
      req,
      startedAt,
    );
  }

  static validateTenant(req) {
    return requireTenant(req);
  }
}

/**
 * =============================================================================
 * Named exports
 * =============================================================================
 */

export {
  getTenantId,
  getTraceId,
  getPagination,
  buildMeta,
  requireTenant,
};

export default DashboardController;