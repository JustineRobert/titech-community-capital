"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Case Management Service
 * ============================================================================
 *
 * File:
 * backend/modules/risk/services/CaseManagementService.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Central compliance, AML/CFT, fraud and risk case-management engine.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 * - Case creation
 * - Case assignment
 * - Case lifecycle management
 * - Risk alert linkage
 * - Investigator assignment
 * - Notes management
 * - Evidence management
 * - SLA monitoring
 * - SLA breach detection
 * - Escalation
 * - Resolution management
 * - Case reopening
 * - Case retrieval
 * - Case statistics
 * - Audit/event integration
 * - Tenant isolation
 * - Structured logging
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This service does NOT directly modify financial ledger balances.
 *
 * Financial controls must remain enforced by the transaction/payment/
 * ledger orchestration layer.
 *
 * ============================================================================
 */

const crypto = require("crypto");

const Case = require("../../models/Case");
const RiskAlert = require("../../models/RiskAlert");

/**
 * ============================================================================
 * DEFAULT CONFIGURATION
 * ============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({
    version: "1.0.0",

    slaHours: 48,

    escalationSlaHours: 24,

    maxNoteLength: 10000,

    maxEvidenceDescriptionLength: 10000,

    statuses: Object.freeze([
        "OPEN",
        "UNDER_REVIEW",
        "ESCALATED",
        "CLOSED",
    ]),

    priorities: Object.freeze([
        "P1",
        "P2",
        "P3",
        "P4",
    ]),

    defaultPriority: "P3",

    alertStatuses: Object.freeze({
        IN_CASE: "IN_CASE",
        CLOSED: "CLOSED",
        OPEN: "OPEN",
    }),

    /**
     * Explicit lifecycle transitions.
     *
     * CLOSED is intentionally terminal unless reopenCase() is explicitly
     * invoked.
     */
    transitions: Object.freeze({
        OPEN: Object.freeze([
            "OPEN",
            "UNDER_REVIEW",
            "ESCALATED",
            "CLOSED",
        ]),

        UNDER_REVIEW: Object.freeze([
            "UNDER_REVIEW",
            "ESCALATED",
            "CLOSED",
        ]),

        ESCALATED: Object.freeze([
            "ESCALATED",
            "UNDER_REVIEW",
            "CLOSED",
        ]),

        CLOSED: Object.freeze([]),
    }),
});

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

function generateId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function isNonEmptyString(value) {
    return (
        typeof value === "string" &&
        value.trim().length > 0
    );
}

function normalizeString(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    return String(value).trim();
}

function normalizeStatus(status) {
    if (!isNonEmptyString(status)) {
        return null;
    }

    return status.trim().toUpperCase();
}

function normalizePriority(priority) {
    if (!isNonEmptyString(priority)) {
        return null;
    }

    return priority.trim().toUpperCase();
}

/**
 * ============================================================================
 * CASE MANAGEMENT SERVICE
 * ============================================================================
 */

class CaseManagementService {
    constructor(options = {}) {
        this.config = this.buildConfig(
            options.config || {}
        );

        this.dependencies = {
            auditService:
                options.auditService || null,

            logger:
                options.logger || console,

            clock:
                typeof options.clock === "function"
                    ? options.clock
                    : () => new Date(),
        };

        this.serviceName =
            "CaseManagementService";

        this.serviceVersion =
            this.config.version;
    }

    /**
     * ========================================================================
     * CONFIGURATION
     * ========================================================================
     */

    buildConfig(customConfig = {}) {
        const config = {
            ...DEFAULT_CONFIG,

            ...customConfig,

            statuses: customConfig.statuses ||
                DEFAULT_CONFIG.statuses,

            priorities: customConfig.priorities ||
                DEFAULT_CONFIG.priorities,

            transitions: {
                ...DEFAULT_CONFIG.transitions,
                ...(customConfig.transitions || {}),
            },

            alertStatuses: {
                ...DEFAULT_CONFIG.alertStatuses,
                ...(customConfig.alertStatuses || {}),
            },
        };

        this.validateConfiguration(config);

        return Object.freeze(config);
    }

    validateConfiguration(config) {
        if (
            !Number.isFinite(
                Number(config.slaHours)
            ) ||
            Number(config.slaHours) <= 0
        ) {
            throw new Error(
                "Case SLA hours must be a positive number."
            );
        }

        if (
            !Number.isFinite(
                Number(config.escalationSlaHours)
            ) ||
            Number(config.escalationSlaHours) <= 0
        ) {
            throw new Error(
                "Escalation SLA hours must be a positive number."
            );
        }

        if (
            !Array.isArray(config.statuses) ||
            config.statuses.length === 0
        ) {
            throw new Error(
                "Case statuses must be configured."
            );
        }

        if (
            !Array.isArray(config.priorities) ||
            config.priorities.length === 0
        ) {
            throw new Error(
                "Case priorities must be configured."
            );
        }

        if (
            !config.priorities.includes(
                config.defaultPriority
            )
        ) {
            throw new Error(
                "Default case priority must be valid."
            );
        }
    }

    /**
     * ========================================================================
     * TIME
     * ========================================================================
     */

    now() {
        return this.dependencies.clock();
    }

    /**
     * ========================================================================
     * CREATE CASE
     * ========================================================================
     *
     * Backward compatible with:
     *
     * createCase({
     *   alertId,
     *   userId,
     *   tenantId,
     *   assignedTo
     * })
     *
     * Additional supported properties:
     * - priority
     * - createdBy
     * - metadata
     */
    async createCase({
        alertId,
        userId,
        tenantId,
        assignedTo = null,
        priority = null,
        createdBy = "SYSTEM",
        metadata = {},
    } = {}) {
        this.validateRequiredIdentifiers({
            alertId,
            userId,
            tenantId,
        });

        const now = this.now();

        /**
         * Verify that the originating risk alert exists and belongs to
         * the same tenant when tenantId is available on the alert.
         */
        const alert = await RiskAlert.findOne({
            alertId,
        });

        if (!alert) {
            throw this.createError(
                "RISK_ALERT_NOT_FOUND",
                "Risk alert not found."
            );
        }

        if (
            alert.tenantId &&
            String(alert.tenantId) !==
                String(tenantId)
        ) {
            throw this.createError(
                "TENANT_ACCESS_DENIED",
                "Risk alert does not belong to the requested tenant."
            );
        }

        /**
         * Prevent duplicate case creation for the same alert.
         *
         * This is especially important when AML/fraud engines retry case
         * creation after a timeout.
         */
        const existingCase =
            await Case.findOne({
                alertId,
                tenantId,
            });

        if (existingCase) {
            return existingCase;
        }

        const caseId =
            generateId("CASE");

        const normalizedPriority =
            this.validatePriority(
                priority ||
                    this.mapAlertPriority(
                        alert
                    ) ||
                    this.config.defaultPriority
            );

        const slaDeadline =
            this.calculateSlaDeadline(
                now,
                this.config.slaHours
            );

        const newCase = await Case.create({
            caseId,

            alertId,

            userId,

            tenantId,

            assignedTo:
                assignedTo || null,

            priority:
                normalizedPriority,

            status:
                "OPEN",

            notes: [],

            evidence: [],

            createdAt:
                now,

            updatedAt:
                now,

            slaDeadline,

            slaStatus:
                "ACTIVE",

            createdBy,

            metadata,
        });

        /**
         * Link the case to the originating risk alert.
         */
        await RiskAlert.updateOne(
            {
                alertId,

                ...(tenantId
                    ? { tenantId }
                    : {}),
            },
            {
                $set: {
                    caseId,

                    status:
                        this.config.alertStatuses
                            .IN_CASE,

                    updatedAt:
                        now,
                },
            }
        );

        await this.audit(
            "CASE_CREATED",
            {
                caseId,
                alertId,
                userId,
                tenantId,
                priority:
                    normalizedPriority,
                assignedTo,
                createdBy,
            }
        );

        return newCase;
    }

    /**
     * ========================================================================
     * VALIDATE REQUIRED IDENTIFIERS
     * ========================================================================
     */

    validateRequiredIdentifiers({
        alertId,
        userId,
        tenantId,
    }) {
        if (!isNonEmptyString(alertId)) {
            throw this.createError(
                "INVALID_ALERT_ID",
                "alertId is required."
            );
        }

        if (!isNonEmptyString(userId)) {
            throw this.createError(
                "INVALID_USER_ID",
                "userId is required."
            );
        }

        if (!isNonEmptyString(tenantId)) {
            throw this.createError(
                "INVALID_TENANT_ID",
                "tenantId is required."
            );
        }
    }

    /**
     * ========================================================================
     * UPDATE CASE STATUS
     * ========================================================================
     */

    async updateCaseStatus(
        caseId,
        status,
        options = {}
    ) {
        this.validateCaseId(caseId);

        const normalizedStatus =
            normalizeStatus(status);

        if (
            !this.config.statuses.includes(
                normalizedStatus
            )
        ) {
            throw this.createError(
                "INVALID_CASE_STATUS",
                `Invalid case status: ${status}`
            );
        }

        const existingCase =
            await this.getCaseForTenant(
                caseId,
                options.tenantId
            );

        if (!existingCase) {
            throw this.createError(
                "CASE_NOT_FOUND",
                "Case not found."
            );
        }

        const currentStatus =
            normalizeStatus(
                existingCase.status
            );

        if (
            currentStatus ===
            normalizedStatus
        ) {
            return existingCase;
        }

        if (
            !this.isValidTransition(
                currentStatus,
                normalizedStatus
            )
        ) {
            throw this.createError(
                "INVALID_CASE_TRANSITION",
                `Cannot transition case from ${currentStatus} to ${normalizedStatus}.`
            );
        }

        const now = this.now();

        const update = {
            status:
                normalizedStatus,

            updatedAt:
                now,
        };

        if (
            normalizedStatus ===
            "ESCALATED"
        ) {
            update.escalatedAt = now;

            update.slaDeadline =
                this.calculateSlaDeadline(
                    now,
                    this.config
                        .escalationSlaHours
                );

            update.slaStatus =
                "ESCALATED";
        }

        if (
            normalizedStatus ===
            "UNDER_REVIEW"
        ) {
            update.reviewStartedAt =
                existingCase.reviewStartedAt ||
                now;
        }

        if (
            normalizedStatus ===
            "CLOSED"
        ) {
            update.closedAt =
                now;

            update.slaStatus =
                this.calculateSlaStatus(
                    existingCase
                );
        }

        const updatedCase =
            await Case.findOneAndUpdate(
                {
                    caseId,

                    ...(options.tenantId
                        ? {
                              tenantId:
                                  options.tenantId,
                          }
                        : {}),
                },
                {
                    $set: update,
                },
                {
                    new: true,
                }
            );

        if (!updatedCase) {
            throw this.createError(
                "CASE_UPDATE_FAILED",
                "Case could not be updated."
            );
        }

        await this.audit(
            "CASE_STATUS_CHANGED",
            {
                caseId,
                tenantId:
                    updatedCase.tenantId,
                previousStatus:
                    currentStatus,
                newStatus:
                    normalizedStatus,
                actorId:
                    options.actorId || null,
            }
        );

        if (
            normalizedStatus ===
            "CLOSED"
        ) {
            await this.closeLinkedAlert(
                updatedCase
            );
        }

        return updatedCase;
    }

    /**
     * ========================================================================
     * VALIDATE STATUS TRANSITION
     * ========================================================================
     */

    isValidTransition(
        currentStatus,
        nextStatus
    ) {
        const allowed =
            this.config.transitions[
                currentStatus
            ] || [];

        return allowed.includes(
            nextStatus
        );
    }

    /**
     * ========================================================================
     * ASSIGN CASE
     * ========================================================================
     */

    async assignCase(
        caseId,
        investigatorId,
        options = {}
    ) {
        this.validateCaseId(caseId);

        if (
            !isNonEmptyString(
                investigatorId
            )
        ) {
            throw this.createError(
                "INVALID_INVESTIGATOR_ID",
                "investigatorId is required."
            );
        }

        const existingCase =
            await this.getCaseForTenant(
                caseId,
                options.tenantId
            );

        if (!existingCase) {
            throw this.createError(
                "CASE_NOT_FOUND",
                "Case not found."
            );
        }

        if (
            existingCase.status ===
            "CLOSED"
        ) {
            throw this.createError(
                "CASE_CLOSED",
                "Closed cases cannot be assigned."
            );
        }

        const now = this.now();

        const updatedCase =
            await Case.findOneAndUpdate(
                {
                    caseId,

                    ...(options.tenantId
                        ? {
                              tenantId:
                                  options.tenantId,
                          }
                        : {}),
                },
                {
                    $set: {
                        assignedTo:
                            investigatorId,

                        updatedAt:
                            now,

                        assignedAt:
                            now,

                        assignedBy:
                            options.actorId ||
                            null,
                    },
                },
                {
                    new: true,
                }
            );

        if (!updatedCase) {
            throw this.createError(
                "CASE_ASSIGNMENT_FAILED",
                "Case assignment failed."
            );
        }

        await this.audit(
            "CASE_ASSIGNED",
            {
                caseId,
                tenantId:
                    updatedCase.tenantId,
                investigatorId,
                actorId:
                    options.actorId || null,
            }
        );

        return updatedCase;
    }

    /**
     * ========================================================================
     * UNASSIGN CASE
     * ========================================================================
     */

    async unassignCase(
        caseId,
        options = {}
    ) {
        this.validateCaseId(caseId);

        const existingCase =
            await this.getCaseForTenant(
                caseId,
                options.tenantId
            );

        if (!existingCase) {
            throw this.createError(
                "CASE_NOT_FOUND",
                "Case not found."
            );
        }

        if (
            existingCase.status ===
            "CLOSED"
        ) {
            throw this.createError(
                "CASE_CLOSED",
                "Closed cases cannot be unassigned."
            );
        }

        const now = this.now();

        return Case.findOneAndUpdate(
            {
                caseId,

                ...(options.tenantId
                    ? {
                          tenantId:
                              options.tenantId,
                      }
                    : {}),
            },
            {
                $set: {
                    assignedTo: null,
                    updatedAt: now,
                },
                $unset: {
                    assignedAt: 1,
                    assignedBy: 1,
                },
            },
            {
                new: true,
            }
        );
    }

    /**
     * ========================================================================
     * ADD NOTE
     * ========================================================================
     */

    async addNote(
        caseId,
        authorId,
        content,
        options = {}
    ) {
        this.validateCaseId(caseId);

        if (
            !isNonEmptyString(
                authorId
            )
        ) {
            throw this.createError(
                "INVALID_AUTHOR_ID",
                "authorId is required."
            );
        }

        if (
            !isNonEmptyString(
                content
            )
        ) {
            throw this.createError(
                "INVALID_NOTE",
                "Note content is required."
            );
        }

        if (
            content.length >
            this.config.maxNoteLength
        ) {
            throw this.createError(
                "NOTE_TOO_LONG",
                `Note exceeds maximum length of ${this.config.maxNoteLength} characters.`
            );
        }

        const existingCase =
            await this.getCaseForTenant(
                caseId,
                options.tenantId
            );

        if (!existingCase) {
            throw this.createError(
                "CASE_NOT_FOUND",
                "Case not found."
            );
        }

        if (
            existingCase.status ===
            "CLOSED"
        ) {
            throw this.createError(
                "CASE_CLOSED",
                "Notes cannot be added to a closed case."
            );
        }

        const note = {
            noteId:
                generateId("NOTE"),

            authorId,

            content:
                content.trim(),

            createdAt:
                this.now(),
        };

        const updatedCase =
            await Case.findOneAndUpdate(
                {
                    caseId,

                    ...(options.tenantId
                        ? {
                              tenantId:
                                  options.tenantId,
                          }
                        : {}),
                },
                {
                    $push: {
                        notes: note,
                    },

                    $set: {
                        updatedAt:
                            this.now(),
                    },
                },
                {
                    new: true,
                }
            );

        await this.audit(
            "CASE_NOTE_ADDED",
            {
                caseId,
                tenantId:
                    updatedCase?.tenantId,
                noteId:
                    note.noteId,
                authorId,
            }
        );

        return updatedCase;
    }

    /**
     * ========================================================================
     * ADD EVIDENCE
     * ========================================================================
     */

    async addEvidence(
        caseId,
        evidenceItem,
        options = {}
    ) {
        this.validateCaseId(caseId);

        if (
            !evidenceItem ||
            typeof evidenceItem !==
                "object"
        ) {
            throw this.createError(
                "INVALID_EVIDENCE",
                "Evidence item is required."
            );
        }

        const existingCase =
            await this.getCaseForTenant(
                caseId,
                options.tenantId
            );

        if (!existingCase) {
            throw this.createError(
                "CASE_NOT_FOUND",
                "Case not found."
            );
        }

        if (
            existingCase.status ===
            "CLOSED"
        ) {
            throw this.createError(
                "CASE_CLOSED",
                "Evidence cannot be added to a closed case."
            );
        }

        const description =
            normalizeString(
                evidenceItem.description
            );

        if (
            description &&
            description.length >
                this.config
                    .maxEvidenceDescriptionLength
        ) {
            throw this.createError(
                "EVIDENCE_DESCRIPTION_TOO_LONG",
                "Evidence description exceeds the configured maximum length."
            );
        }

        const evidence = {
            evidenceId:
                generateId("EVIDENCE"),

            ...evidenceItem,

            description,

            createdAt:
                this.now(),

            addedBy:
                options.actorId ||
                evidenceItem.addedBy ||
                null,
        };

        const updatedCase =
            await Case.findOneAndUpdate(
                {
                    caseId,

                    ...(options.tenantId
                        ? {
                              tenantId:
                                  options.tenantId,
                          }
                        : {}),
                },
                {
                    $push: {
                        evidence,
                    },

                    $set: {
                        updatedAt:
                            this.now(),
                    },
                },
                {
                    new: true,
                }
            );

        await this.audit(
            "CASE_EVIDENCE_ADDED",
            {
                caseId,
                tenantId:
                    updatedCase?.tenantId,
                evidenceId:
                    evidence.evidenceId,
                actorId:
                    options.actorId || null,
            }
        );

        return updatedCase;
    }

    /**
     * ========================================================================
     * CALCULATE SLA DEADLINE
     * ========================================================================
     */

    calculateSlaDeadline(
        startDate = this.now(),
        hours = this.config.slaHours
    ) {
        const deadline =
            new Date(startDate);

        deadline.setTime(
            deadline.getTime() +
                Number(hours) *
                    60 *
                    60 *
                    1000
        );

        return deadline;
    }

    /**
     * ========================================================================
     * SLA STATUS
     * ========================================================================
     */

    calculateSlaStatus(caseRecord) {
        if (!caseRecord) {
            return "UNKNOWN";
        }

        if (
            caseRecord.status ===
            "CLOSED"
        ) {
            return "RESOLVED";
        }

        if (
            !caseRecord.slaDeadline
        ) {
            return "NO_DEADLINE";
        }

        const now =
            this.now();

        if (
            new Date(
                caseRecord.slaDeadline
            ).getTime() <
            now.getTime()
        ) {
            return "BREACHED";
        }

        const remainingMs =
            new Date(
                caseRecord.slaDeadline
            ).getTime() -
            now.getTime();

        const remainingHours =
            remainingMs /
            (60 * 60 * 1000);

        if (
            remainingHours <= 4
        ) {
            return "AT_RISK";
        }

        return "ACTIVE";
    }

    /**
     * ========================================================================
     * CHECK SLA
     * ========================================================================
     */

    async checkSLA(
        caseId,
        options = {}
    ) {
        this.validateCaseId(caseId);

        const caseRecord =
            await this.getCaseForTenant(
                caseId,
                options.tenantId
            );

        if (!caseRecord) {
            throw this.createError(
                "CASE_NOT_FOUND",
                "Case not found."
            );
        }

        const slaStatus =
            this.calculateSlaStatus(
                caseRecord
            );

        const now =
            this.now();

        const updatedCase =
            await Case.findOneAndUpdate(
                {
                    caseId,

                    ...(options.tenantId
                        ? {
                              tenantId:
                                  options.tenantId,
                          }
                        : {}),
                },
                {
                    $set: {
                        slaStatus,

                        updatedAt:
                            now,

                        ...(slaStatus ===
                        "BREACHED"
                            ? {
                                  slaBreachedAt:
                                      caseRecord.slaBreachedAt ||
                                      now,
                              }
                            : {}),
                    },
                },
                {
                    new: true,
                }
            );

        if (
            slaStatus ===
            "BREACHED"
        ) {
            await this.audit(
                "CASE_SLA_BREACHED",
                {
                    caseId,
                    tenantId:
                        caseRecord.tenantId,
                    slaDeadline:
                        caseRecord.slaDeadline,
                }
            );
        }

        return {
            caseId,
            status:
                updatedCase?.status,
            slaStatus,
            slaDeadline:
                updatedCase?.slaDeadline ||
                null,
            checkedAt:
                now.toISOString(),
        };
    }

    /**
     * ========================================================================
     * CLOSE CASE
     * ========================================================================
     */

    async closeCase(
        caseId,
        resolutionNotes,
        options = {}
    ) {
        this.validateCaseId(caseId);

        if (
            !isNonEmptyString(
                resolutionNotes
            )
        ) {
            throw this.createError(
                "RESOLUTION_REQUIRED",
                "Resolution notes are required when closing a case."
            );
        }

        if (
            resolutionNotes.length >
            this.config.maxNoteLength
        ) {
            throw this.createError(
                "RESOLUTION_TOO_LONG",
                "Resolution notes exceed the configured maximum length."
            );
        }

        const existingCase =
            await this.getCaseForTenant(
                caseId,
                options.tenantId
            );

        if (!existingCase) {
            throw this.createError(
                "CASE_NOT_FOUND",
                "Case not found."
            );
        }

        if (
            existingCase.status ===
            "CLOSED"
        ) {
            return existingCase;
        }

        if (
            !this.isValidTransition(
                existingCase.status,
                "CLOSED"
            )
        ) {
            throw this.createError(
                "INVALID_CASE_CLOSURE",
                `Case cannot be closed from status ${existingCase.status}.`
            );
        }

        const now =
            this.now();

        const finalSlaStatus =
            this.calculateSlaStatus(
                existingCase
            );

        const updatedCase =
            await Case.findOneAndUpdate(
                {
                    caseId,

                    ...(options.tenantId
                        ? {
                              tenantId:
                                  options.tenantId,
                          }
                        : {}),
                },
                {
                    $set: {
                        status:
                            "CLOSED",

                        resolutionNotes:
                            resolutionNotes.trim(),

                        resolvedBy:
                            options.actorId ||
                            null,

                        closedAt:
                            now,

                        updatedAt:
                            now,

                        slaStatus:
                            finalSlaStatus ===
                            "BREACHED"
                                ? "RESOLVED_LATE"
                                : "RESOLVED",
                    },
                },
                {
                    new: true,
                }
            );

        if (!updatedCase) {
            throw this.createError(
                "CASE_CLOSE_FAILED",
                "Case could not be closed."
            );
        }

        await this.closeLinkedAlert(
            updatedCase
        );

        await this.audit(
            "CASE_CLOSED",
            {
                caseId,
                tenantId:
                    updatedCase.tenantId,
                alertId:
                    updatedCase.alertId,
                resolvedBy:
                    options.actorId ||
                    null,
                slaStatus:
                    updatedCase.slaStatus,
            }
        );

        return updatedCase;
    }

    /**
     * ========================================================================
     * ESCALATE CASE
     * ========================================================================
     */

    async escalateCase(
        caseId,
        reason,
        options = {}
    ) {
        if (
            !isNonEmptyString(reason)
        ) {
            throw this.createError(
                "ESCALATION_REASON_REQUIRED",
                "Escalation reason is required."
            );
        }

        const updatedCase =
            await this.updateCaseStatus(
                caseId,
                "ESCALATED",
                options
            );

        if (!updatedCase) {
            return null;
        }

        const now =
            this.now();

        const escalatedCase =
            await Case.findOneAndUpdate(
                {
                    caseId,

                    ...(options.tenantId
                        ? {
                              tenantId:
                                  options.tenantId,
                          }
                        : {}),
                },
                {
                    $set: {
                        escalationReason:
                            reason.trim(),

                        escalatedBy:
                            options.actorId ||
                            null,

                        escalatedAt:
                            now,

                        updatedAt:
                            now,
                    },
                },
                {
                    new: true,
                }
            );

        await this.audit(
            "CASE_ESCALATED",
            {
                caseId,
                tenantId:
                    escalatedCase?.tenantId,
                reason:
                    reason.trim(),
                actorId:
                    options.actorId || null,
            }
        );

        return escalatedCase;
    }

    /**
     * ========================================================================
     * REOPEN CASE
     * ========================================================================
     *
     * Explicit reopening is allowed only through this method.
     * This prevents accidental CLOSED -> OPEN transitions.
     * ========================================================================
     */

    async reopenCase(
        caseId,
        reason,
        options = {}
    ) {
        this.validateCaseId(caseId);

        if (
            !isNonEmptyString(reason)
        ) {
            throw this.createError(
                "REOPEN_REASON_REQUIRED",
                "A reason is required to reopen a case."
            );
        }

        const existingCase =
            await this.getCaseForTenant(
                caseId,
                options.tenantId
            );

        if (!existingCase) {
            throw this.createError(
                "CASE_NOT_FOUND",
                "Case not found."
            );
        }

        if (
            existingCase.status !==
            "CLOSED"
        ) {
            throw this.createError(
                "CASE_NOT_CLOSED",
                "Only closed cases can be reopened."
            );
        }

        const now =
            this.now();

        const updatedCase =
            await Case.findOneAndUpdate(
                {
                    caseId,

                    ...(options.tenantId
                        ? {
                              tenantId:
                                  options.tenantId,
                          }
                        : {}),
                },
                {
                    $set: {
                        status:
                            "UNDER_REVIEW",

                        reopenReason:
                            reason.trim(),

                        reopenedBy:
                            options.actorId ||
                            null,

                        reopenedAt:
                            now,

                        updatedAt:
                            now,

                        slaDeadline:
                            this.calculateSlaDeadline(
                                now,
                                this.config.slaHours
                            ),

                        slaStatus:
                            "ACTIVE",
                    },
                },
                {
                    new: true,
                }
            );

        await this.audit(
            "CASE_REOPENED",
            {
                caseId,
                tenantId:
                    updatedCase?.tenantId,
                reason:
                    reason.trim(),
                actorId:
                    options.actorId || null,
            }
        );

        return updatedCase;
    }

    /**
     * ========================================================================
     * GET CASE
     * ========================================================================
     */

    async getCase(
        caseId,
        options = {}
    ) {
        this.validateCaseId(caseId);

        return this.getCaseForTenant(
            caseId,
            options.tenantId
        );
    }

    /**
     * ========================================================================
     * INTERNAL TENANT-AWARE CASE LOOKUP
     * ========================================================================
     */

    async getCaseForTenant(
        caseId,
        tenantId = null
    ) {
        const query = {
            caseId,
        };

        if (tenantId) {
            query.tenantId =
                tenantId;
        }

        return Case.findOne(
            query
        );
    }

    /**
     * ========================================================================
     * FIND CASE BY ALERT
     * ========================================================================
     */

    async getCaseByAlert(
        alertId,
        tenantId = null
    ) {
        if (
            !isNonEmptyString(
                alertId
            )
        ) {
            throw this.createError(
                "INVALID_ALERT_ID",
                "alertId is required."
            );
        }

        const query = {
            alertId,
        };

        if (tenantId) {
            query.tenantId =
                tenantId;
        }

        return Case.findOne(
            query
        );
    }

    /**
     * ========================================================================
     * LIST CASES
     * ========================================================================
     *
     * Intended for service/controller usage.
     *
     * Supported filters:
     * - tenantId
     * - status
     * - assignedTo
     * - priority
     * - alertId
     * - userId
     * ========================================================================
     */

    async listCases(
        filters = {},
        options = {}
    ) {
        const query = {};

        if (
            filters.tenantId ||
            options.tenantId
        ) {
            query.tenantId =
                filters.tenantId ||
                options.tenantId;
        }

        if (filters.status) {
            query.status =
                normalizeStatus(
                    filters.status
                );
        }

        if (filters.assignedTo) {
            query.assignedTo =
                filters.assignedTo;
        }

        if (filters.priority) {
            query.priority =
                normalizePriority(
                    filters.priority
                );
        }

        if (filters.alertId) {
            query.alertId =
                filters.alertId;
        }

        if (filters.userId) {
            query.userId =
                filters.userId;
        }

        const limit = Math.min(
            Math.max(
                Number(
                    options.limit || 50
                ),
                1
            ),
            500
        );

        const skip = Math.max(
            Number(
                options.skip || 0
            ),
            0
        );

        return Case.find(
            query
        )
            .sort({
                createdAt: -1,
            })
            .skip(skip)
            .limit(limit);
    }

    /**
     * ========================================================================
     * CASE STATISTICS
     * ========================================================================
     */

    async getCaseStatistics(
        tenantId
    ) {
        if (
            !isNonEmptyString(
                tenantId
            )
        ) {
            throw this.createError(
                "INVALID_TENANT_ID",
                "tenantId is required."
            );
        }

        const [
            total,
            open,
            underReview,
            escalated,
            closed,
        ] = await Promise.all([
            Case.countDocuments({
                tenantId,
            }),

            Case.countDocuments({
                tenantId,
                status: "OPEN",
            }),

            Case.countDocuments({
                tenantId,
                status:
                    "UNDER_REVIEW",
            }),

            Case.countDocuments({
                tenantId,
                status:
                    "ESCALATED",
            }),

            Case.countDocuments({
                tenantId,
                status: "CLOSED",
            }),
        ]);

        const active =
            open +
            underReview +
            escalated;

        return {
            tenantId,

            total,

            active,

            open,

            underReview,

            escalated,

            closed,

            generatedAt:
                this.now().toISOString(),
        };
    }

    /**
     * ========================================================================
     * SLA BREACH SCAN
     * ========================================================================
     *
     * Useful for scheduled jobs.
     *
     * Example:
     * CaseManagementService.scanSlaBreaches("tenant-id")
     * ========================================================================
     */

    async scanSlaBreaches(
        tenantId,
        options = {}
    ) {
        if (
            !isNonEmptyString(
                tenantId
            )
        ) {
            throw this.createError(
                "INVALID_TENANT_ID",
                "tenantId is required."
            );
        }

        const now =
            this.now();

        const cases =
            await Case.find({
                tenantId,

                status: {
                    $ne: "CLOSED",
                },

                slaDeadline: {
                    $lt: now,
                },

                slaStatus: {
                    $nin: [
                        "BREACHED",
                        "RESOLVED",
                        "RESOLVED_LATE",
                    ],
                },
            });

        if (!cases.length) {
            return {
                processed: 0,
                breached: 0,
                cases: [],
            };
        }

        const results = [];

        for (
            const caseRecord of cases
        ) {
            const updatedCase =
                await Case.findOneAndUpdate(
                    {
                        caseId:
                            caseRecord.caseId,

                        tenantId,

                        status: {
                            $ne: "CLOSED",
                        },
                    },
                    {
                        $set: {
                            slaStatus:
                                "BREACHED",

                            slaBreachedAt:
                                caseRecord.slaBreachedAt ||
                                now,

                            updatedAt:
                                now,
                        },
                    },
                    {
                        new: true,
                    }
                );

            if (updatedCase) {
                results.push(
                    updatedCase
                );

                await this.audit(
                    "CASE_SLA_BREACHED",
                    {
                        caseId:
                            updatedCase.caseId,

                        tenantId,

                        alertId:
                            updatedCase.alertId,

                        slaDeadline:
                            updatedCase.slaDeadline,

                        actorId:
                            options.actorId ||
                            "SLA_MONITOR",
                    }
                );
            }
        }

        return {
            processed:
                cases.length,

            breached:
                results.length,

            cases:
                results,
        };
    }

    /**
     * ========================================================================
     * LINKED ALERT CLOSURE
     * ========================================================================
     */

    async closeLinkedAlert(
        caseRecord
    ) {
        if (
            !caseRecord ||
            !caseRecord.alertId
        ) {
            return null;
        }

        const query = {
            alertId:
                caseRecord.alertId,
        };

        if (
            caseRecord.tenantId
        ) {
            query.tenantId =
                caseRecord.tenantId;
        }

        return RiskAlert.updateOne(
            query,
            {
                $set: {
                    status:
                        this.config
                            .alertStatuses
                            .CLOSED,

                    updatedAt:
                        this.now(),
                },
            }
        );
    }

    /**
     * ========================================================================
     * MAP ALERT PRIORITY
     * ========================================================================
     */

    mapAlertPriority(
        alert
    ) {
        if (!alert) {
            return this.config
                .defaultPriority;
        }

        const riskScore =
            Number(
                alert.riskScore ||
                alert.amlScore ||
                0
            );

        if (
            riskScore >= 90
        ) {
            return "P1";
        }

        if (
            riskScore >= 80
        ) {
            return "P2";
        }

        if (
            riskScore >= 60
        ) {
            return "P3";
        }

        return "P4";
    }

    /**
     * ========================================================================
     * PRIORITY VALIDATION
     * ========================================================================
     */

    validatePriority(
        priority
    ) {
        const normalized =
            normalizePriority(
                priority
            );

        if (
            !this.config.priorities.includes(
                normalized
            )
        ) {
            throw this.createError(
                "INVALID_CASE_PRIORITY",
                `Invalid case priority: ${priority}`
            );
        }

        return normalized;
    }

    /**
     * ========================================================================
     * CASE ID VALIDATION
     * ========================================================================
     */

    validateCaseId(
        caseId
    ) {
        if (
            !isNonEmptyString(
                caseId
            )
        ) {
            throw this.createError(
                "INVALID_CASE_ID",
                "caseId is required."
            );
        }
    }

    /**
     * ========================================================================
     * STRUCTURED ERROR
     * ========================================================================
     */

    createError(
        code,
        message
    ) {
        const error =
            new Error(message);

        error.code =
            code;

        error.service =
            this.serviceName;

        error.serviceVersion =
            this.serviceVersion;

        return error;
    }

    /**
     * ========================================================================
     * AUDIT
     * ========================================================================
     */

    async audit(
        event,
        metadata = {}
    ) {
        const auditService =
            this.dependencies
                .auditService;

        if (
            auditService &&
            typeof auditService.log ===
                "function"
        ) {
            try {
                await auditService.log({
                    event,

                    service:
                        this.serviceName,

                    serviceVersion:
                        this.serviceVersion,

                    timestamp:
                        this.now()
                            .toISOString(),

                    ...metadata,
                });
            } catch (error) {
                this.logError(
                    "Case audit logging failed",
                    error,
                    {
                        event,
                        metadata,
                    }
                );
            }
        }

        return true;
    }

    /**
     * ========================================================================
     * LOGGING
     * ========================================================================
     */

    logError(
        message,
        error,
        metadata = {}
    ) {
        const logger =
            this.dependencies
                .logger;

        if (
            logger &&
            typeof logger.error ===
                "function"
        ) {
            logger.error(
                message,
                {
                    error:
                        error?.message,

                    stack:
                        error?.stack,

                    service:
                        this.serviceName,

                    serviceVersion:
                        this.serviceVersion,

                    ...metadata,
                }
            );
        }
    }
}

/**
 * ============================================================================
 * SINGLETON EXPORT
 * ============================================================================
 *
 * Preserves existing architecture:
 *
 * const CaseManagementService =
 *     require("./CaseManagementService");
 *
 * await CaseManagementService.createCase(...);
 *
 * ============================================================================
 */

const caseManagementService =
    new CaseManagementService();

/**
 * ============================================================================
 * CLASS + CONFIG EXPORTS
 * ============================================================================
 *
 * Useful for:
 *
 * - Jest tests
 * - Dependency injection
 * - Multi-tenant configuration
 * - Service composition
 * ============================================================================
 */

module.exports =
    caseManagementService;

module.exports.CaseManagementService =
    CaseManagementService;

module.exports.DEFAULT_CASE_CONFIG =
    DEFAULT_CONFIG;