'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Referral Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/referral/referral.repository.js
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Tenant-scoped referral persistence
 * - Tenant-scoped duplicate detection
 * - Tenant + actor queries
 * - Database-level concurrency handling
 *
 * This repository MUST NOT:
 * - authorize actors
 * - calculate rewards
 * - trust request objects
 * - read req.body
 * - perform wallet/ledger mutations
 *
 * ============================================================================
 */

const Referral = require('../../models/Referral');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ACTIVE_REFERRAL_STATUSES = Object.freeze([
    'PENDING',
    'QUALIFIED',
    'REWARDED',
]);

function normalizeString(value, fallback = null) {
    if (value === undefined || value === null) {
        return fallback;
    }

    const normalized = String(value).trim();

    return normalized || fallback;
}

function normalizePage(value) {
    const page = Number.parseInt(value, 10);

    return Number.isInteger(page) && page > 0
        ? page
        : DEFAULT_PAGE;
}

function normalizeLimit(value) {
    const limit = Number.parseInt(value, 10);

    if (!Number.isInteger(limit) || limit <= 0) {
        return DEFAULT_LIMIT;
    }

    return Math.min(limit, MAX_LIMIT);
}

function normalizeTenantId(tenantId) {
    const value = normalizeString(tenantId);

    if (!value) {
        throw new Error('Referral repository tenantId is required.');
    }

    return value;
}

function normalizeActorId(actorId) {
    const value = normalizeString(actorId);

    if (!value) {
        throw new Error('Referral repository actorId is required.');
    }

    return value;
}

function normalizeEmail(email) {
    const value =
        normalizeString(email)?.toLowerCase();

    if (!value) {
        throw new Error(
            'Referral repository email is required.',
        );
    }

    return value;
}

function leanQuery(query) {
    return query && typeof query.lean === 'function'
        ? query.lean()
        : query;
}

/**
 * ============================================================================
 * Find by tenant + idempotency key
 * ============================================================================
 */

async function findByIdempotencyKey({
    tenantId,
    actorId,
    idempotencyKey,
    session = null,
}) {
    const normalizedTenantId =
        normalizeTenantId(tenantId);

    const normalizedActorId =
        normalizeActorId(actorId);

    const normalizedKey =
        normalizeString(idempotencyKey);

    if (!normalizedKey) {
        return null;
    }

    const filter = {
        tenantId: normalizedTenantId,
        idempotencyKey: normalizedKey,
        $or: [
            {
                referrer: normalizedActorId,
            },
            {
                referrerId: normalizedActorId,
            },
            {
                createdBy: normalizedActorId,
            },
        ],
    };

    let query = Referral.findOne(filter);

    if (session && typeof query.session === 'function') {
        query = query.session(session);
    }

    return leanQuery(query);
}

/**
 * ============================================================================
 * Find active referral by tenant + email
 * ============================================================================
 *
 * This query intentionally NEVER performs a global email lookup.
 * ============================================================================
 */

async function findActiveByTenantAndEmail({
    tenantId,
    email,
    session = null,
}) {
    const normalizedTenantId =
        normalizeTenantId(tenantId);

    const normalizedEmail =
        normalizeEmail(email);

    const filter = {
        tenantId: normalizedTenantId,

        $or: [
            {
                referredEmail:
                    normalizedEmail,
            },
            {
                email:
                    normalizedEmail,
            },
        ],

        status: {
            $in: ACTIVE_REFERRAL_STATUSES,
        },
    };

    let query = Referral.findOne(filter);

    if (session && typeof query.session === 'function') {
        query = query.session(session);
    }

    return leanQuery(query);
}

/**
 * ============================================================================
 * Create referral
 * ============================================================================
 */

async function create(
    command,
    {
        session = null,
    } = {},
) {
    const tenantId =
        normalizeTenantId(command.tenantId);

    const actorId =
        normalizeActorId(command.actorId);

    const email =
        normalizeEmail(
            command.email ??
                command.referredEmail,
        );

    const document = {
        tenantId,

        /**
         * Preserve compatibility with existing Referral schemas while the
         * canonical field remains actor-owned.
         */
        referrer: actorId,
        referrerId: actorId,

        referredEmail: email,
        email,

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

        status:
            normalizeString(
                command.status,
                'PENDING',
            )?.toUpperCase(),

        idempotencyKey:
            normalizeString(
                command.idempotencyKey,
            ),

        idempotencyFingerprint:
            normalizeString(
                command.commandFingerprint,
            ),

        createdBy: actorId,
        updatedBy: actorId,

        requestId:
            normalizeString(
                command.requestId,
            ),

        correlationId:
            normalizeString(
                command.correlationId,
            ),

        metadata:
            command.metadata &&
            typeof command.metadata === 'object' &&
            !Array.isArray(command.metadata)
                ? command.metadata
                : {},
    };

    /**
     * Do not allow a caller to inject persistence fields.
     */
    delete document._id;
    delete document.createdAt;
    delete document.updatedAt;

    const referral =
        new Referral(document);

    if (
        session &&
        typeof referral.save === 'function'
    ) {
        return referral.save({
            session,
        });
    }

    return referral.save();
}

/**
 * ============================================================================
 * Tenant + actor listing
 * ============================================================================
 */

async function findByTenantAndActor({
    tenantId,
    actorId,
    page = DEFAULT_PAGE,
    limit = DEFAULT_LIMIT,
    session = null,
}) {
    const normalizedTenantId =
        normalizeTenantId(tenantId);

    const normalizedActorId =
        normalizeActorId(actorId);

    const normalizedPage =
        normalizePage(page);

    const normalizedLimit =
        normalizeLimit(limit);

    const skip =
        (normalizedPage - 1) *
        normalizedLimit;

    const filter = {
        tenantId: normalizedTenantId,

        $or: [
            {
                referrer: normalizedActorId,
            },
            {
                referrerId: normalizedActorId,
            },
        ],
    };

    let dataQuery =
        Referral.find(filter)
            .sort({
                createdAt: -1,
                _id: -1,
            })
            .skip(skip)
            .limit(normalizedLimit);

    let countQuery =
        Referral.countDocuments(filter);

    if (
        session &&
        typeof dataQuery.session === 'function'
    ) {
        dataQuery =
            dataQuery.session(session);
    }

    if (
        session &&
        typeof countQuery.session === 'function'
    ) {
        countQuery =
            countQuery.session(session);
    }

    const [items, total] =
        await Promise.all([
            leanQuery(dataQuery),
            countQuery,
        ]);

    return {
        items: Array.isArray(items)
            ? items
            : [],
        total:
            Number.isInteger(total)
                ? total
                : 0,
        page: normalizedPage,
        limit: normalizedLimit,
    };
}

/**
 * ============================================================================
 * Update referral state
 * ============================================================================
 */

async function updateStatus({
    tenantId,
    referralId,
    status,
    expectedStatus = null,
    actorId = null,
    session = null,
}) {
    const normalizedTenantId =
        normalizeTenantId(tenantId);

    const normalizedStatus =
        normalizeString(
            status,
        )?.toUpperCase();

    if (!normalizedStatus) {
        throw new Error(
            'Referral status is required.',
        );
    }

    const filter = {
        _id: referralId,
        tenantId: normalizedTenantId,
    };

    if (expectedStatus) {
        filter.status =
            normalizeString(
                expectedStatus,
            )?.toUpperCase();
    }

    const update = {
        $set: {
            status: normalizedStatus,

            ...(actorId
                ? {
                    updatedBy:
                        normalizeActorId(
                            actorId,
                        ),
                }
                : {}),
        },

        $inc: {
            lifecycleVersion: 1,
        },
    };

    let query =
        Referral.findOneAndUpdate(
            filter,
            update,
            {
                new: true,
                runValidators: true,
            },
        );

    if (
        session &&
        typeof query.session === 'function'
    ) {
        query =
            query.session(session);
    }

    return leanQuery(query);
}

/**
 * ============================================================================
 * Repository contract
 * ============================================================================
 */

module.exports = Object.freeze({
    findByIdempotencyKey,
    findActiveByTenantAndEmail,
    findByTenantAndActor,
    create,
    updateStatus,
});