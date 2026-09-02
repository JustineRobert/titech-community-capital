'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * MTN MoMo Enterprise Authentication Service
 * ----------------------------------------------------------
 * Purpose
 * -------
 * Centralized OAuth lifecycle management for the MTN MoMo API.
 *
 * Responsibilities
 * ----------------
 * • API User management
 * • API Key authentication
 * • OAuth access token acquisition
 * • Token caching
 * • Automatic token refresh
 * • Token expiration tracking
 * • Credential rotation
 * • Tenant-aware credential resolution
 * • Provider health monitoring
 * • Structured logging
 * • OpenTelemetry instrumentation
 * • Prometheus metrics
 * • Audit integration
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Collections
 * • Disbursements
 * • Callback handling
 * • Settlement
 * • Ledger posting
 * • Business validation
 *
 * Public API
 * ----------
 * initialize()
 * authenticate()
 * refreshToken()
 * getAccessToken()
 * invalidate()
 * health()
 * rotateCredentials()
 *
 * ==========================================================
 */
