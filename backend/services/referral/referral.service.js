'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Referral Service
 * ============================================================================
 *
 * File:
 *   backend/services/referral/referral.service.js
 *
 * Responsibility
 * ----------------------------------------------------------------------------
 * Application/domain service for referral operations.
 *
 * This service owns:
 *
 *   - Tenant isolation
 *   - Actor ownership
 *   - Input normalization
 *   - Referral eligibility
 *   - Duplicate protection
 *   - Idempotency coordination
 *   - Referral lifecycle state
 *   - Audit/event metadata
 *   - Pagination semantics
 *
 * This service MUST NOT:
 *
 *   ✗ read req.body directly
 *   ✗ trust userId from clients
 *   ✗ trust tenantId from clients
 *   ✗ access MongoDB models directly
 *   ✗ calculate arbitrary financial balances
 *   ✗ mutate wallets directly
 *   ✗ mutate ledgers directly
 *   ✗ expose persistence exceptions
 *
 * Financial rewards MUST be delegated to the financial application boundary.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   Controller
 *       ↓
 *   Referral Service
 *       ↓
 *   Referral Repository
 *       ↓
 *   MongoDB
 *
 *                AND, when eligible:
 *
 *   Referral Service
 *       ↓
 *   Referral Reward Policy
 *       ↓
 *   Financial Operation Service
 *       ↓
 *   Financial Transaction Boundary
 *       ↓
 *   Ledger + Balance
 *
 * ============================================================================
 */

const crypto = require('node:crypto');

const {
    ApiError,
} = require('../../errors');

/**
 * ============================================================================
 * Lazy Dependency Resolution
 * ============================================================================
 *
 * The repository remains the persistence boundary.
 *
 * The resolver intentionally happens lazily so this service can be imported
 * by unit tests that inject mocks without requiring the entire persistence
 * subsystem to be initialized.
 * ============================================================================
 */

let repositoryInstance = null;

function resolveReferralRepository() {
    if (repositoryInstance) {
        return repositoryInstance;
    }

    let loaded;

    try {
        loaded = require(
            '../../repositories/referral/referral.repository',
        );
    } catch (error) {
        const dependencyError = new Error(
            'TITech referral repository is not available.',
        );

        dependencyError.code =
            'REFERRAL_REPOSITORY_UNAVAILABLE';

        dependencyError.cause = error;

        throw dependencyError;
    }

    repositoryInstance =
        loaded?.default ??
        loaded?.referralRepository ??
        loaded;

    return repositoryInstance;
}

/**
 * ============================================================================
 * Optional Audit Resolver
 * ============================================================================
 *
 * Audit integration is intentionally optional at this boundary.
 *
 * If TITech's centralized audit service is unavailable, referral creation
 * should not silently invent an audit implementation.
 *
 * Production deployments should wire the canonical audit service.
 * ============================================================================
 */

let auditServiceResolved = false;
let auditService = null;

function resolveAuditService() {
    if (auditServiceResolved) {
        return auditService;
    }

    auditServiceResolved = true;

    const candidates = [
        '../../services/audit/audit.service',
        '../../services/auditService',
        '../../services/audit',
    ];

    for (const candidate of candidates) {
        try {
            const loaded = require(candidate);

            const resolved =
                loaded?.default ??
                loaded?.auditService ??
                loaded;

            if (
                resolved &&
                (
                    typeof resolved.record ===
                        'function' ||
                    typeof resolved.recordEvent ===
                        'function' ||
                    typeof resolved.log ===
                        'function'
                )
            ) {
                auditService = resolved;
                break;
            }
        } catch {
            /**
             * Optional dependency.
             */
        }
    }

    return auditService;
}

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const SERVICE_NAME =
    'TITech Referral Service';

const SERVICE_VERSION =
    '2026.2';

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    50;

const MAX_LIMIT =
    200;

const MAX_EMAIL_LENGTH =
    320;

const MAX_NAME_LENGTH =
    255;

const MAX_PHONE_LENGTH =
    32;

const MAX_NOTE_LENGTH =
    1000;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

const ALLOWED_STATUSES = new Set([
    'PENDING',
    'QUALIFIED',
    'REWARDED',
    'REJECTED',
    'EXPIRED',
    'CANCELLED',
]);

/**
 * ============================================================================
 * Error Codes
 * ============================================================================
 */

const ERROR_CODES = Object.freeze({
    INVALID_COMMAND:
        'REFERRAL_INVALID_COMMAND',

    TENANT_REQUIRED:
        'REFERRAL_TENANT_REQUIRED',

    ACTOR_REQUIRED:
        'REFERRAL_ACTOR_REQUIRED',

    EMAIL_REQUIRED:
        'REFERRAL_EMAIL_REQUIRED',

    INVALID_EMAIL:
        'REFERRAL_INVALID_EMAIL',

    DUPLICATE:
        'REFERRAL_ALREADY_EXISTS',

    IDEMPOTENCY_REQUIRED:
        'REFERRAL_IDEMPOTENCY_KEY_REQUIRED',

    IDEMPOTENCY_CONFLICT:
        'REFERRAL_IDEMPOTENCY_CONFLICT',

    IDEMPOTENCY_UNAVAILABLE:
        'REFERRAL_IDEMPOTENCY_UNAVAILABLE',

    REPOSITORY_UNAVAILABLE:
        'REFERRAL_REPOSITORY_UNAVAILABLE',

    INVALID_PAGINATION:
        'REFERRAL_INVALID_PAGINATION',

    INTERNAL:
        'REFERRAL_SERVICE_ERROR',
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function normalizeString(
    value,
    fallback = null,
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    const normalized =
        String(value).trim();

    return normalized || fallback;
}

function normalizeEmail(value) {
    const email =
        normalizeString(value)?.toLowerCase();

    if (!email) {
        return null;
    }

    return email;
}

function normalizePage(value) {
    const page =
        Number.parseInt(value, 10);

    return Number.isInteger(page) &&
        page >= 1
        ? page
        : DEFAULT_PAGE;
}

function normalizeLimit(value) {
    const limit =
        Number.parseInt(value, 10);

    if (
        !Number.isInteger(limit) ||
        limit < 1
    ) {
        return DEFAULT_LIMIT;
    }

    return Math.min(
        limit,
        MAX_LIMIT,
    );
}

function validateRequiredContext({
    tenantId,
    actorId,
}) {
    if (!tenantId) {
        throw new ApiError(
            'A trusted tenant context is required for referral operations.',
            403,
            ERROR_CODES.TENANT_REQUIRED,
        );
    }

    if (!actorId) {
        throw new ApiError(
            'An authenticated actor context is required.',
            401,
            ERROR_CODES.ACTOR_REQUIRED,
        );
    }
}

function validateEmail(email) {
    if (!email) {
        throw new ApiError(
            'Referral email address is required.',
            400,
            ERROR_CODES.EMAIL_REQUIRED,
        );
    }

    if (
        email.length >
        MAX_EMAIL_LENGTH
    ) {
        throw new ApiError(
            'Referral email address is too long.',
            400,
            ERROR_CODES.INVALID_EMAIL,
        );
    }

    /**
     * express-validator already performs the primary validation.
     *
     * The service performs a second defensive check because this is the
     * domain boundary and should never assume that every caller came through
     * HTTP validation.
     */

    if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            email,
        )
    ) {
        throw new ApiError(
            'A valid referral email address is required.',
            400,
            ERROR_CODES.INVALID_EMAIL,
        );
    }
}

function normalizeIdempotencyKey(
    value,
) {
    const key =
        normalizeString(value);

    if (!key) {
        return null;
    }

    if (
        key.length >
        MAX_IDEMPOTENCY_KEY_LENGTH
    ) {
        throw new ApiError(
            'The idempotency key is too long.',
            400,
            ERROR_CODES.IDEMPOTENCY_CONFLICT,
        );
    }

    return key;
}

function createCommandFingerprint(
    command,
) {
    const canonical = JSON.stringify({
        tenantId:
            command.tenantId,

        actorId:
            command.actorId,

        email:
            normalizeEmail(
                command.email,
            ),

        name:
            normalizeString(
                command.name,
            ),

        phone:
            normalizeString(
                command.phone,
            ),

        note:
            normalizeString(
                command.note,
            ),
    });

    return crypto
        .createHash('sha256')
        .update(canonical)
        .digest('hex');
}

function assertStringLength(
    value,
    max,
    field,
) {
    if (
        value !== null &&
        value !== undefined &&
        String(value).length > max
    ) {
        throw new ApiError(
            `${field} cannot exceed ${max} characters.`,
            400,
            'REFERRAL_INVALID_INPUT',
        );
    }
}

/**
 * ============================================================================
 * Repository Contract
 * ============================================================================
 */

function assertRepositoryContract(
    repository,
) {
    const required = [
        'findByIdempotencyKey',
        'findActiveByTenantAndEmail',
        'create',
        'findByTenantAndActor',
    ];

    const missing =
        required.filter(
            (method) =>
                typeof repository?.[method] !==
                'function',
        );

    if (missing.length > 0) {
        const error = new Error(
            `Referral repository contract is incomplete. Missing: ${missing.join(', ')}`,
        );

        error.code =
            ERROR_CODES.REPOSITORY_UNAVAILABLE;

        throw error;
    }
}

/**
 * ============================================================================
 * Audit
 * ============================================================================
 */

async function writeAuditEvent({
    event,
    tenantId,
    actorId,
    referralId,
    requestId,
    correlationId,
    metadata = {},
}) {
    const service =
        resolveAuditService();

    if (!service) {
        return;
    }

    const payload = {
        event,
        service: SERVICE_NAME,
        serviceVersion: SERVICE_VERSION,
        tenantId,
        actorId,
        referralId,
        requestId,
        correlationId,
        metadata,
        timestamp: new Date(),
    };

    if (
        typeof service.record ===
        'function'
    ) {
        await service.record(
            payload,
        );

        return;
    }

    if (
        typeof service.recordEvent ===
        'function'
    ) {
        await service.recordEvent(
            payload,
        );

        return;
    }

    if (
        typeof service.log ===
        'function'
    ) {
        await service.log(
            payload,
        );
    }
}

/**
 * ============================================================================
 * Repository Error Translation
 * ============================================================================
 */

function translateRepositoryError(
    error,
) {
    if (!error) {
        return new ApiError(
            'The referral request could not be completed.',
            500,
            ERROR_CODES.INTERNAL,
        );
    }

    /**
     * Mongo duplicate-key protection.
     *
     * The repository should expose a domain-specific duplicate error where
     * possible. This fallback makes the service resilient when Mongo errors
     * reach the boundary unexpectedly.
     */

    if (
        error.code === 11000
    ) {
        return new ApiError(
            'A matching referral already exists.',
            409,
            ERROR_CODES.DUPLICATE,
        );
    }

    if (
        error.code ===
        ERROR_CODES.DUPLICATE
    ) {
        return error;
    }

    if (
        error.code ===
        ERROR_CODES.IDEMPOTENCY_CONFLICT
    ) {
        return error;
    }

    if (
        error.statusCode &&
        error.statusCode >= 400 &&
        error.statusCode < 500
    ) {
        return error;
    }

    const translated =
        new ApiError(
            'The referral request could not be completed.',
            500,
            ERROR_CODES.INTERNAL,
        );

    translated.cause =
        error;

    return translated;
}

/**
 * ============================================================================
 * Create Referral
 * ============================================================================
 *
 * Input:
 *
 * {
 *   tenantId,
 *   actorId,
 *   email,
 *   name,
 *   phone,
 *   note,
 *   idempotencyKey,
 *   requestId,
 *   correlationId
 * }
 *
 * Output:
 *
 * {
 *   created,
 *   referral,
 *   idempotent,
 *   ...
 * }
 *
 * ============================================================================
 */

async function createReferral(
    command,
) {
    if (
        !command ||
        typeof command !== 'object'
    ) {
        throw new ApiError(
            'Referral command is invalid.',
            400,
            ERROR_CODES.INVALID_COMMAND,
        );
    }

    const tenantId =
        normalizeString(
            command.tenantId,
        );

    const actorId =
        normalizeString(
            command.actorId,
        );

    validateRequiredContext({
        tenantId,
        actorId,
    });

    const email =
        normalizeEmail(
            command.email,
        );

    validateEmail(email);

    const name =
        normalizeString(
            command.name,
        );

    const phone =
        normalizeString(
            command.phone,
        );

    const note =
        normalizeString(
            command.note,
        );

    assertStringLength(
        name,
        MAX_NAME_LENGTH,
        'Name',
    );

    assertStringLength(
        phone,
        MAX_PHONE_LENGTH,
        'Phone number',
    );

    assertStringLength(
        note,
        MAX_NOTE_LENGTH,
        'Referral note',
    );

    const idempotencyKey =
        normalizeIdempotencyKey(
            command.idempotencyKey,
        );

    /**
     * Idempotency is mandatory for referral creation.
     *
     * Referral creation is a state-changing operation and can ultimately
     * cause financial consequences.
     */

    if (!idempotencyKey) {
        throw new ApiError(
            'An Idempotency-Key is required when creating a referral.',
            400,
            ERROR_CODES.IDEMPOTENCY_REQUIRED,
        );
    }

    const repository =
        resolveReferralRepository();

    assertRepositoryContract(
        repository,
    );

    const fingerprint =
        createCommandFingerprint({
            tenantId,
            actorId,
            email,
            name,
            phone,
            note,
        });

    /**
     * ------------------------------------------------------------------------
     * STEP 1 — Idempotency lookup
     * ------------------------------------------------------------------------
     *
     * Idempotency records must always be tenant-scoped.
     */

    let existingByIdempotency;

    try {
        existingByIdempotency =
            await repository.findByIdempotencyKey({
                tenantId,
                actorId,
                idempotencyKey,
            });
    } catch (error) {
        throw translateRepositoryError(
            error,
        );
    }

    if (existingByIdempotency) {
        if (
            existingByIdempotency.commandFingerprint &&
            existingByIdempotency.commandFingerprint !==
                fingerprint
        ) {
            throw new ApiError(
                'The supplied idempotency key was previously used with different referral data.',
                409,
                ERROR_CODES.IDEMPOTENCY_CONFLICT,
            );
        }

        return {
            created: false,
            idempotent: true,
            referral:
                existingByIdempotency.referral ??
                existingByIdempotency,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * STEP 2 — Duplicate referral protection
     * ------------------------------------------------------------------------
     *
     * Never search globally by email alone.
     *
     * Referral uniqueness belongs to the tenant boundary.
     */

    let existingReferral;

    try {
        existingReferral =
            await repository.findActiveByTenantAndEmail({
                tenantId,
                email,
            });
    } catch (error) {
        throw translateRepositoryError(
            error,
        );
    }

    if (existingReferral) {
        /**
         * Deliberately do NOT reveal another user's identity.
         */

        throw new ApiError(
            'A referral for this email already exists in this tenant.',
            409,
            ERROR_CODES.DUPLICATE,
        );
    }

    /**
     * ------------------------------------------------------------------------
     * STEP 3 — Build domain command
     * ------------------------------------------------------------------------
     */

    const referralCommand = {
        tenantId,
        actorId,

        referrerId:
            actorId,

        referredEmail:
            email,

        email,

        name,
        phone,
        note,

        status:
            'PENDING',

        idempotencyKey,

        commandFingerprint:
            fingerprint,

        requestId:
            normalizeString(
                command.requestId,
            ),

        correlationId:
            normalizeString(
                command.correlationId,
            ),

        createdBy:
            actorId,

        metadata: {
            source:
                'referral-api',

            service:
                SERVICE_NAME,

            serviceVersion:
                SERVICE_VERSION,
        },
    };

    /**
     * ------------------------------------------------------------------------
     * STEP 4 — Persist
     * ------------------------------------------------------------------------
     *
     * The repository must enforce the relevant database-level uniqueness
     * constraints as the final concurrency boundary.
     */

    let createdReferral;

    try {
        createdReferral =
            await repository.create(
                referralCommand,
            );
    } catch (error) {
        /**
         * Concurrent requests may both pass the duplicate lookup.
         *
         * The repository/database uniqueness constraint must reject one of
         * them. Translate that race safely into a domain response.
         */

        throw translateRepositoryError(
            error,
        );
    }

    /**
     * ------------------------------------------------------------------------
     * STEP 5 — Audit
     * ------------------------------------------------------------------------
     */

    try {
        await writeAuditEvent({
            event:
                'referral.created',

            tenantId,
            actorId,

            referralId:
                createdReferral?._id ??
                createdReferral?.id ??
                null,

            requestId:
                command.requestId,

            correlationId:
                command.correlationId,

            metadata: {
                email,
                idempotencyKey,
            },
        });
    } catch (auditError) {
        /**
         * Audit failures must not silently mutate the referral response.
         *
         * The centralized observability/error subsystem should receive the
         * audit failure. The referral remains persisted.
         */

        if (
            typeof process !==
            'undefined' &&
            process.emitWarning
        ) {
            process.emitWarning(
                `Referral audit event failed: ${auditError?.message ?? 'unknown error'}`,
                {
                    code:
                        'TITECH_REFERRAL_AUDIT_FAILURE',
                },
            );
        }
    }

    /**
     * IMPORTANT:
     *
     * No reward is calculated here.
     *
     * If the referral subsequently qualifies for a financial reward, a domain
     * workflow must invoke the canonical financial operation boundary.
     */

    return {
        created: true,
        idempotent: false,
        referral: createdReferral,
    };
}

/**
 * ============================================================================
 * Get User Referrals
 * ============================================================================
 */

async function getUserReferrals(
    command,
) {
    if (
        !command ||
        typeof command !== 'object'
    ) {
        throw new ApiError(
            'Referral query is invalid.',
            400,
            ERROR_CODES.INVALID_COMMAND,
        );
    }

    const tenantId =
        normalizeString(
            command.tenantId,
        );

    const actorId =
        normalizeString(
            command.actorId,
        );

    validateRequiredContext({
        tenantId,
        actorId,
    });

    const page =
        normalizePage(
            command.page,
        );

    const limit =
        normalizeLimit(
            command.limit,
        );

    if (
        page < 1 ||
        limit < 1 ||
        limit > MAX_LIMIT
    ) {
        throw new ApiError(
            'Referral pagination parameters are invalid.',
            400,
            ERROR_CODES.INVALID_PAGINATION,
        );
    }

    const repository =
        resolveReferralRepository();

    assertRepositoryContract(
        repository,
    );

    let result;

    try {
        result =
            await repository.findByTenantAndActor({
                tenantId,
                actorId,
                page,
                limit,
                requestId:
                    normalizeString(
                        command.requestId,
                    ),
                correlationId:
                    normalizeString(
                        command.correlationId,
                    ),
            });
    } catch (error) {
        throw translateRepositoryError(
            error,
        );
    }

    /**
     * Normalize repository output so controllers do not need to understand
     * Mongo-specific pagination structures.
     */

    const items =
        Array.isArray(result)
            ? result
            : Array.isArray(result?.items)
                ? result.items
                : [];

    const total =
        Number.isInteger(
            result?.total,
        )
            ? result.total
            : items.length;

    const totalPages =
        limit > 0
            ? Math.ceil(
                total / limit,
            )
            : 0;

    return {
        items,

        pagination: {
            page,
            limit,
            total,
            totalPages,

            hasNextPage:
                page <
                totalPages,

            hasPreviousPage:
                page > 1,
        },
    };
}

/**
 * ============================================================================
 * Referral Eligibility
 * ============================================================================
 *
 * This function deliberately does not award money.
 *
 * It returns domain eligibility information that a higher-level workflow may
 * use before calling the financial application service.
 * ============================================================================
 */

function evaluateRewardEligibility(
    referral,
) {
    if (!referral) {
        return {
            eligible: false,
            reason:
                'REFERRAL_NOT_FOUND',
        };
    }

    const status =
        normalizeString(
            referral.status,
        )?.toUpperCase();

    if (
        !status ||
        !ALLOWED_STATUSES.has(
            status,
        )
    ) {
        return {
            eligible: false,
            reason:
                'REFERRAL_INVALID_STATUS',
        };
    }

    /**
     * Only a future domain policy should decide whether a referral becomes
     * financially rewardable.
     *
     * PENDING referrals are never directly rewardable.
     */

    if (
        status !==
        'QUALIFIED'
    ) {
        return {
            eligible: false,
            reason:
                `REFERRAL_STATUS_${status}`,
        };
    }

    return {
        eligible: true,
        reason:
            'REFERRAL_QUALIFIED',
    };
}

/**
 * ============================================================================
 * Public Service
 * ============================================================================
 */

const referralService = Object.freeze({
    createReferral,

    getUserReferrals,

    evaluateRewardEligibility,

    serviceName:
        SERVICE_NAME,

    serviceVersion:
        SERVICE_VERSION,

    errorCodes:
        ERROR_CODES,
});

module.exports =
    referralService;