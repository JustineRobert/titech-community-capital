'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Adjustment Period Domain Service
 * ============================================================================
 *
 * Purpose:
 *   Represents a controlled financial adjustment period used when a normal
 *   accounting period is closed/locked and an authorized correction workflow
 *   must be performed.
 *
 * IMPORTANT:
 *   This service does not directly mutate ledger balances.
 *   Adjustment-period creation is a control-plane operation. Financial
 *   corrections must still be posted through the immutable Ledger Engine /
 *   Journal Posting pipeline.
 *
 * Supported lifecycle:
 *
 *   OPEN
 *     |
 *     +--> APPROVED
 *     |
 *     +--> REJECTED
 *     |
 *     +--> EXPIRED
 *     |
 *     +--> CLOSED
 *     |
 *     +--> CANCELLED
 *
 * ============================================================================
 */

const crypto = require('crypto');

const STATUS = Object.freeze({
    OPEN: 'OPEN',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    EXPIRED: 'EXPIRED',
    CLOSED: 'CLOSED',
    CANCELLED: 'CANCELLED'
});

const TYPE = 'ADJUSTMENT';

const DEFAULTS = Object.freeze({
    type: TYPE,
    status: STATUS.OPEN
});

class AdjustmentPeriod {

    constructor(options = {}) {

        this.repository =
            options.repository ||
            options.model ||
            null;

        this.logger =
            options.logger ||
            console;

        this.clock =
            options.clock ||
            (() => new Date());

        this.idGenerator =
            options.idGenerator ||
            (() => crypto.randomUUID());

        this.config = {
            ...DEFAULTS,
            ...(options.config || {})
        };
    }

    /**
     * =========================================================================
     * Create Adjustment Period
     * =========================================================================
     *
     * Does not automatically approve the period.
     *
     * Required:
     *   tenantId
     *   reason
     *   approvalId
     *
     * Optional:
     *   requestedBy
     *   effectiveFrom
     *   effectiveUntil
     *   reference
     *   metadata
     *
     * =========================================================================
     */

    async create({
        tenantId,
        reason,
        approvalId,
        requestedBy = null,
        effectiveFrom = null,
        effectiveUntil = null,
        reference = null,
        metadata = {}
    } = {}) {

        this.validateCreateInput({
            tenantId,
            reason,
            approvalId
        });

        const now =
            this.clock();

        const adjustmentPeriod = {
            id:
                this.idGenerator(),

            tenantId:
                String(tenantId),

            type:
                TYPE,

            reason:
                this.normalizeText(reason),

            approvalId:
                String(approvalId),

            requestedBy:
                requestedBy
                    ? String(requestedBy)
                    : null,

            reference:
                reference
                    ? this.normalizeText(reference)
                    : null,

            effectiveFrom:
                this.normalizeDate(
                    effectiveFrom,
                    'effectiveFrom'
                ),

            effectiveUntil:
                this.normalizeDate(
                    effectiveUntil,
                    'effectiveUntil'
                ),

            status:
                STATUS.OPEN,

            metadata:
                this.sanitizeMetadata(
                    metadata
                ),

            createdAt:
                new Date(now),

            updatedAt:
                new Date(now),

            approvedAt:
                null,

            approvedBy:
                null,

            rejectedAt:
                null,

            rejectedBy:
                null,

            closedAt:
                null,

            closedBy:
                null,

            cancelledAt:
                null,

            cancelledBy:
                null
        };

        this.validateEffectiveWindow(
            adjustmentPeriod.effectiveFrom,
            adjustmentPeriod.effectiveUntil
        );

        /*
         * Prefer the existing persistence boundary when supplied.
         *
         * This keeps the service compatible with a Mongoose repository,
         * Mongo model adapter, or other existing Finance Core persistence
         * implementation.
         */
        if (
            this.repository &&
            typeof this.repository.create ===
                'function'
        ) {

            return this.repository.create(
                adjustmentPeriod
            );
        }

        /*
         * Safe fallback for current prototype integrations.
         *
         * This preserves the original behavior while producing a complete,
         * deterministic domain object.
         */
        return adjustmentPeriod;
    }

    /**
     * =========================================================================
     * Approve
     * =========================================================================
     */

    async approve({
        adjustmentPeriod,
        approvalId,
        approvedBy
    } = {}) {

        this.assertPeriod(
            adjustmentPeriod
        );

        if (
            !approvedBy
        ) {
            throw this.createValidationError(
                'approvedBy is required'
            );
        }

        if (
            adjustmentPeriod.status !==
            STATUS.OPEN
        ) {
            throw this.createStateError(
                `Adjustment period cannot be approved from status ${adjustmentPeriod.status}`
            );
        }

        if (
            approvalId &&
            String(approvalId) !==
                String(
                    adjustmentPeriod.approvalId
                )
        ) {
            throw this.createValidationError(
                'Approval ID does not match adjustment period approval'
            );
        }

        const now =
            this.clock();

        const updated = {
            ...adjustmentPeriod,

            status:
                STATUS.APPROVED,

            approvedAt:
                new Date(now),

            approvedBy:
                String(approvedBy),

            updatedAt:
                new Date(now)
        };

        return this.persistUpdate(
            updated
        );
    }

    /**
     * =========================================================================
     * Reject
     * =========================================================================
     */

    async reject({
        adjustmentPeriod,
        rejectedBy,
        rejectionReason
    } = {}) {

        this.assertPeriod(
            adjustmentPeriod
        );

        if (
            !rejectedBy
        ) {
            throw this.createValidationError(
                'rejectedBy is required'
            );
        }

        if (
            !rejectionReason
        ) {
            throw this.createValidationError(
                'rejectionReason is required'
            );
        }

        if (
            adjustmentPeriod.status !==
            STATUS.OPEN
        ) {
            throw this.createStateError(
                `Adjustment period cannot be rejected from status ${adjustmentPeriod.status}`
            );
        }

        const now =
            this.clock();

        const updated = {
            ...adjustmentPeriod,

            status:
                STATUS.REJECTED,

            rejectionReason:
                this.normalizeText(
                    rejectionReason
                ),

            rejectedAt:
                new Date(now),

            rejectedBy:
                String(rejectedBy),

            updatedAt:
                new Date(now)
        };

        return this.persistUpdate(
            updated
        );
    }

    /**
     * =========================================================================
     * Close
     * =========================================================================
     *
     * Closing is only permitted after approval.
     */

    async close({
        adjustmentPeriod,
        closedBy
    } = {}) {

        this.assertPeriod(
            adjustmentPeriod
        );

        if (
            !closedBy
        ) {
            throw this.createValidationError(
                'closedBy is required'
            );
        }

        if (
            adjustmentPeriod.status !==
            STATUS.APPROVED
        ) {
            throw this.createStateError(
                `Adjustment period cannot be closed from status ${adjustmentPeriod.status}`
            );
        }

        const now =
            this.clock();

        const updated = {
            ...adjustmentPeriod,

            status:
                STATUS.CLOSED,

            closedAt:
                new Date(now),

            closedBy:
                String(closedBy),

            updatedAt:
                new Date(now)
        };

        return this.persistUpdate(
            updated
        );
    }

    /**
     * =========================================================================
     * Cancel
     * =========================================================================
     */

    async cancel({
        adjustmentPeriod,
        cancelledBy,
        cancellationReason
    } = {}) {

        this.assertPeriod(
            adjustmentPeriod
        );

        if (
            !cancelledBy
        ) {
            throw this.createValidationError(
                'cancelledBy is required'
            );
        }

        if (
            !cancellationReason
        ) {
            throw this.createValidationError(
                'cancellationReason is required'
            );
        }

        if (
            [
                STATUS.CLOSED,
                STATUS.CANCELLED
            ].includes(
                adjustmentPeriod.status
            )
        ) {
            throw this.createStateError(
                `Adjustment period cannot be cancelled from status ${adjustmentPeriod.status}`
            );
        }

        const now =
            this.clock();

        const updated = {
            ...adjustmentPeriod,

            status:
                STATUS.CANCELLED,

            cancellationReason:
                this.normalizeText(
                    cancellationReason
                ),

            cancelledAt:
                new Date(now),

            cancelledBy:
                String(cancelledBy),

            updatedAt:
                new Date(now)
        };

        return this.persistUpdate(
            updated
        );
    }

    /**
     * =========================================================================
     * Expire
     * =========================================================================
     */

    async expire({
        adjustmentPeriod,
        expiredBy = null
    } = {}) {

        this.assertPeriod(
            adjustmentPeriod
        );

        if (
            [
                STATUS.CLOSED,
                STATUS.CANCELLED,
                STATUS.REJECTED,
                STATUS.EXPIRED
            ].includes(
                adjustmentPeriod.status
            )
        ) {
            throw this.createStateError(
                `Adjustment period cannot expire from status ${adjustmentPeriod.status}`
            );
        }

        const now =
            this.clock();

        const updated = {
            ...adjustmentPeriod,

            status:
                STATUS.EXPIRED,

            expiredAt:
                new Date(now),

            expiredBy:
                expiredBy
                    ? String(expiredBy)
                    : null,

            updatedAt:
                new Date(now)
        };

        return this.persistUpdate(
            updated
        );
    }

    /**
     * =========================================================================
     * State Inspection
     * =========================================================================
     */

    isOpen(period) {
        return (
            period?.status ===
            STATUS.OPEN
        );
    }

    isApproved(period) {
        return (
            period?.status ===
            STATUS.APPROVED
        );
    }

    isClosed(period) {
        return (
            period?.status ===
            STATUS.CLOSED
        );
    }

    isTerminal(period) {
        return [
            STATUS.CLOSED,
            STATUS.CANCELLED,
            STATUS.REJECTED,
            STATUS.EXPIRED
        ].includes(
            period?.status
        );
    }

    canPostAdjustment(
        period
    ) {
        return (
            period?.status ===
            STATUS.APPROVED
        );
    }

    /**
     * =========================================================================
     * Persistence
     * =========================================================================
     */

    async persistUpdate(
        adjustmentPeriod
    ) {

        if (
            this.repository &&
            typeof this.repository.update ===
                'function'
        ) {
            return this.repository.update(
                adjustmentPeriod.id,
                adjustmentPeriod
            );
        }

        return adjustmentPeriod;
    }

    /**
     * =========================================================================
     * Input Validation
     * =========================================================================
     */

    validateCreateInput({
        tenantId,
        reason,
        approvalId
    }) {

        if (
            tenantId === undefined ||
            tenantId === null ||
            String(tenantId).trim() === ''
        ) {
            throw this.createValidationError(
                'tenantId is required'
            );
        }

        if (
            reason === undefined ||
            reason === null ||
            String(reason).trim() === ''
        ) {
            throw this.createValidationError(
                'reason is required'
            );
        }

        if (
            approvalId === undefined ||
            approvalId === null ||
            String(approvalId).trim() === ''
        ) {
            throw this.createValidationError(
                'approvalId is required'
            );
        }
    }

    validateEffectiveWindow(
        effectiveFrom,
        effectiveUntil
    ) {

        if (
            effectiveFrom &&
            effectiveUntil &&
            effectiveUntil <
                effectiveFrom
        ) {
            throw this.createValidationError(
                'effectiveUntil cannot be before effectiveFrom'
            );
        }
    }

    assertPeriod(
        adjustmentPeriod
    ) {

        if (
            !adjustmentPeriod ||
            typeof adjustmentPeriod !==
                'object'
        ) {
            throw this.createValidationError(
                'adjustmentPeriod is required'
            );
        }

        if (
            !adjustmentPeriod.id
        ) {
            throw this.createValidationError(
                'adjustmentPeriod.id is required'
            );
        }

        if (
            !adjustmentPeriod.tenantId
        ) {
            throw this.createValidationError(
                'adjustmentPeriod.tenantId is required'
            );
        }
    }

    /**
     * =========================================================================
     * Sanitization
     * =========================================================================
     */

    normalizeText(
        value
    ) {

        return String(
            value
        )
            .trim()
            .slice(
                0,
                2000
            );
    }

    normalizeDate(
        value,
        fieldName
    ) {

        if (
            value === null ||
            value === undefined
        ) {
            return null;
        }

        const date =
            value instanceof Date
                ? new Date(
                    value.getTime()
                )
                : new Date(
                    value
                );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            throw this.createValidationError(
                `${fieldName} must be a valid date`
            );
        }

        return date;
    }

    sanitizeMetadata(
        metadata
    ) {

        if (
            !metadata ||
            typeof metadata !==
                'object'
        ) {
            return {};
        }

        const result = {};

        for (
            const [
                key,
                value
            ] of Object.entries(
                metadata
            )
        ) {

            if (
                result &&
                Object.keys(
                    result
                ).length >= 50
            ) {
                break;
            }

            if (
                this.isSensitiveKey(
                    key
                )
            ) {
                continue;
            }

            result[
                String(key).slice(
                    0,
                    128
                )
            ] =
                this.sanitizeMetadataValue(
                    value
                );
        }

        return result;
    }

    sanitizeMetadataValue(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        if (
            typeof value ===
            'string'
        ) {
            return value.slice(
                0,
                1000
            );
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
            value instanceof Date
        ) {
            return value.toISOString();
        }

        if (
            Array.isArray(value)
        ) {
            return value
                .slice(0, 20)
                .map(
                    item =>
                        this.sanitizeMetadataValue(
                            item
                        )
                );
        }

        try {

            return JSON.parse(
                JSON.stringify(
                    value
                )
            );

        } catch (_error) {

            return '[unserializable]';
        }
    }

    isSensitiveKey(
        key
    ) {

        const normalized =
            String(
                key || ''
            );

        return [
            /password/i,
            /token/i,
            /secret/i,
            /authorization/i,
            /private.?key/i,
            /pin/i,
            /otp/i,
            /cvv/i,
            /card.?number/i,
            /account.?number/i,
            /wallet.?number/i,
            /national.?id/i,
            /identity.?number/i
        ].some(
            pattern =>
                pattern.test(
                    normalized
                )
        );
    }

    /**
     * =========================================================================
     * Errors
     * =========================================================================
     */

    createValidationError(
        message
    ) {

        const error =
            new Error(
                message
            );

        error.code =
            'ADJUSTMENT_PERIOD_VALIDATION_ERROR';

        error.statusCode =
            400;

        return error;
    }

    createStateError(
        message
    ) {

        const error =
            new Error(
                message
            );

        error.code =
            'ADJUSTMENT_PERIOD_INVALID_STATE';

        error.statusCode =
            409;

        return error;
    }

    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */

    diagnostics() {

        return {
            module:
                'AdjustmentPeriod',

            type:
                TYPE,

            statuses:
                Object.values(
                    STATUS
                ),

            persistenceEnabled:
                Boolean(
                    this.repository
                ),

            timestamp:
                new Date()
                    .toISOString()
        };
    }

    /**
     * =========================================================================
     * Factory
     * =========================================================================
     */

    static create(
        options = {}
    ) {

        return new AdjustmentPeriod(
            options
        );
    }
}

AdjustmentPeriod.STATUS =
    STATUS;

AdjustmentPeriod.TYPE =
    TYPE;

module.exports =
    AdjustmentPeriod;