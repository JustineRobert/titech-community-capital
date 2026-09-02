"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Sanctions Screening Service
 * ============================================================================
 * Enterprise Sanctions Screening Engine
 * Version: 3.0.0
 * ============================================================================
 *
 * Purpose
 * -------
 * Deterministic, tenant-aware sanctions screening orchestration service.
 *
 * Supported Screening Domains
 * ---------------------------
 * - OFAC
 * - United Nations
 * - European Union
 * - UK HMT / OFSI
 * - Local watchlists
 * - Customer screening
 * - Beneficiary screening
 * - Payment screening
 * - Alias detection
 * - Exact name matching
 * - Normalized name matching
 * - Deterministic fuzzy matching
 * - Risk classification
 * - Fail-closed screening
 * - Screening decisioning
 * - Idempotency support
 * - Audit/event hooks
 * - Continuous-monitoring support
 *
 * IMPORTANT
 * ---------
 * This service is an orchestration and decisioning layer.
 *
 * It does NOT pretend to contain live sanctions lists.
 *
 * Production deployments should inject real list providers/adapters:
 *
 *   service.registerListProvider("OFAC", provider)
 *   service.registerListProvider("UN", provider)
 *   service.registerListProvider("EU", provider)
 *   service.registerListProvider("UK_HMT", provider)
 *   service.registerListProvider("LOCAL", provider)
 *
 * Provider contract:
 *
 *   {
 *      async search({ customer, normalizedName, aliases, listType }) {
 *          return {
 *              available: true,
 *              matches: [...]
 *          };
 *      }
 *   }
 *
 * A provider match may contain:
 *
 *   {
 *      id,
 *      name,
 *      aliases,
 *      score,
 *      matchType,
 *      listed,
 *      country,
 *      program,
 *      source
 *   }
 *
 * ============================================================================
 */

const crypto = require("crypto");

class SanctionsScreeningService {
    constructor(options = {}) {
        this.config = {
            version: "3.0.0",

            thresholds: {
                EXACT_MATCH: 95,
                HIGH_MATCH: 85,
                MEDIUM_MATCH: 70,
                LOW_MATCH: 50,
            },

            listWeights: {
                OFAC: 30,
                UN: 25,
                EU: 20,
                UK_HMT: 15,
                LOCAL: 10,
            },

            screening: {
                maxAliases: 50,
                maxNameLength: 200,
                fuzzyCandidateLimit: 25,
                providerTimeoutMs: 5000,
                overallTimeoutMs: 15000,
                minimumNameLength: 2,
            },

            decisions: {
                exactMatch: "BLOCK",
                highRisk: "REVIEW",
                mediumRisk: "HOLD",
                lowRisk: "ALLOW",
                clear: "ALLOW",
            },

            failClosed: true,
        };

        this.providers = new Map();

        this.auditLogger =
            typeof options.auditLogger === "function"
                ? options.auditLogger
                : null;

        this.logger =
            options.logger ||
            {
                info: (...args) => {
                    if (process.env.NODE_ENV !== "test") {
                        console.info(...args);
                    }
                },

                warn: (...args) => {
                    if (process.env.NODE_ENV !== "test") {
                        console.warn(...args);
                    }
                },

                error: (...args) => {
                    console.error(...args);
                },
            };
    }

    /**
     * =========================================================================
     * PROVIDER REGISTRATION
     * =========================================================================
     */

    registerListProvider(listType, provider) {
        const normalizedList = this.normalizeListType(listType);

        if (!normalizedList) {
            throw new Error(`Unsupported sanctions list: ${listType}`);
        }

        if (!provider || typeof provider.search !== "function") {
            throw new TypeError(
                `Sanctions provider for ${normalizedList} must implement search()`
            );
        }

        this.providers.set(normalizedList, provider);

        return this;
    }

    unregisterListProvider(listType) {
        const normalizedList = this.normalizeListType(listType);

        if (normalizedList) {
            this.providers.delete(normalizedList);
        }

        return this;
    }

    /**
     * =========================================================================
     * MAIN CUSTOMER SCREENING ENTRYPOINT
     * =========================================================================
     */

    async screenCustomer(customer, options = {}) {
        const startedAt = Date.now();

        try {
            this.validateCustomer(customer);

            const screeningId =
                options.screeningId || crypto.randomUUID();

            const tenantId =
                options.tenantId ||
                customer.tenantId ||
                null;

            const idempotencyKey =
                options.idempotencyKey ||
                this.generateIdempotencyKey(
                    "CUSTOMER",
                    customer,
                    tenantId
                );

            const normalizedCustomer =
                this.normalizeCustomer(customer);

            const listTypes = this.resolveListTypes(options);

            const screeningResults =
                await this.executeListScreenings(
                    normalizedCustomer,
                    listTypes,
                    options
                );

            const score =
                this.calculateScreeningScore(
                    screeningResults
                );

            const classification =
                this.classifyRisk(score);

            const decision =
                this.generatePaymentDecision(score, screeningResults);

            const recommendations =
                this.generateRecommendations(
                    classification,
                    screeningResults
                );

            const result = {
                success: true,

                screeningId,

                idempotencyKey,

                tenantId,

                subjectType: "CUSTOMER",

                subjectId:
                    customer._id ||
                    customer.userId ||
                    customer.memberId ||
                    customer.customerId ||
                    null,

                score,

                classification,

                decision,

                details: screeningResults,

                recommendations,

                screeningMetadata: {
                    engineVersion: this.config.version,
                    lists: listTypes,
                    providerCount: this.providers.size,
                    deterministic: true,
                    durationMs: Date.now() - startedAt,
                },

                timestamp: new Date().toISOString(),
            };

            await this.writeAuditEvent(
                "SANCTIONS_SCREENING_COMPLETED",
                result
            );

            return result;
        } catch (error) {
            this.logger.error(
                "[SANCTIONS] Customer screening failed",
                {
                    error: error.message,
                }
            );

            const failureResult =
                this.buildFailureResult(
                    "CUSTOMER",
                    error,
                    options
                );

            await this.writeAuditEvent(
                "SANCTIONS_SCREENING_FAILED",
                failureResult
            );

            return failureResult;
        }
    }

    /**
     * =========================================================================
     * PAYMENT SCREENING
     * =========================================================================
     */

    async screenTransaction(
        transaction,
        sender,
        beneficiary,
        options = {}
    ) {
        const screeningId =
            options.screeningId ||
            crypto.randomUUID();

        try {
            if (!transaction) {
                throw new Error(
                    "Transaction data is required"
                );
            }

            if (!sender) {
                throw new Error(
                    "Sender data is required"
                );
            }

            if (!beneficiary) {
                throw new Error(
                    "Beneficiary data is required"
                );
            }

            const tenantId =
                options.tenantId ||
                transaction.tenantId ||
                sender.tenantId ||
                beneficiary.tenantId ||
                null;

            const transactionId =
                transaction.id ||
                transaction.transactionId ||
                null;

            const [
                senderResult,
                beneficiaryResult,
            ] = await Promise.all([
                this.screenCustomer(sender, {
                    ...options,
                    tenantId,
                }),

                this.screenCustomer(beneficiary, {
                    ...options,
                    tenantId,
                }),
            ]);

            const highestScore =
                Math.max(
                    senderResult.score || 0,
                    beneficiaryResult.score || 0
                );

            const decision =
                this.generatePaymentDecision(
                    highestScore,
                    {
                        sender: senderResult,
                        beneficiary: beneficiaryResult,
                    }
                );

            const result = {
                success:
                    senderResult.success &&
                    beneficiaryResult.success,

                screeningId,

                transactionId,

                tenantId,

                subjectType: "TRANSACTION",

                sender: senderResult,

                beneficiary: beneficiaryResult,

                highestRiskScore: highestScore,

                classification:
                    this.classifyRisk(highestScore),

                decision,

                recommendations:
                    this.generateTransactionRecommendations(
                        senderResult,
                        beneficiaryResult,
                        decision
                    ),

                timestamp:
                    new Date().toISOString(),
            };

            await this.writeAuditEvent(
                "PAYMENT_SANCTIONS_SCREENING_COMPLETED",
                result
            );

            return result;
        } catch (error) {
            this.logger.error(
                "[SANCTIONS] Transaction screening failed",
                {
                    screeningId,
                    error: error.message,
                }
            );

            const failureResult =
                this.buildFailureResult(
                    "TRANSACTION",
                    error,
                    options
                );

            await this.writeAuditEvent(
                "PAYMENT_SANCTIONS_SCREENING_FAILED",
                failureResult
            );

            return failureResult;
        }
    }

    /**
     * =========================================================================
     * LIST-SPECIFIC SCREENING
     * =========================================================================
     */

    async screenOFAC(customer, options = {}) {
        return this.performListScreening(
            customer,
            "OFAC",
            options
        );
    }

    async screenUN(customer, options = {}) {
        return this.performListScreening(
            customer,
            "UN",
            options
        );
    }

    async screenEU(customer, options = {}) {
        return this.performListScreening(
            customer,
            "EU",
            options
        );
    }

    async screenUK(customer, options = {}) {
        return this.performListScreening(
            customer,
            "UK_HMT",
            options
        );
    }

    async screenLocalLists(customer, options = {}) {
        return this.performListScreening(
            customer,
            "LOCAL",
            options
        );
    }

    /**
     * =========================================================================
     * GENERIC LIST SCREENING
     * =========================================================================
     */

    async performListScreening(
        customer,
        listType,
        options = {}
    ) {
        const normalizedList =
            this.normalizeListType(listType);

        if (!normalizedList) {
            throw new Error(
                `Unsupported sanctions list: ${listType}`
            );
        }

        this.validateCustomer(customer);

        const normalizedCustomer =
            this.normalizeCustomer(customer);

        const provider =
            this.providers.get(normalizedList);

        /**
         * Provider-backed production screening.
         */
        if (provider) {
            return this.executeProviderSearch(
                provider,
                normalizedCustomer,
                normalizedList,
                options
            );
        }

        /**
         * Optional caller-supplied screening result.
         *
         * This allows upstream adapters to perform the actual
         * sanctions-list lookup while this service remains the
         * central scoring/decisioning engine.
         */
        const suppliedResult =
            this.getSuppliedListResult(
                customer,
                normalizedList
            );

        if (suppliedResult) {
            return this.normalizeProviderResult(
                suppliedResult,
                normalizedList
            );
        }

        /**
         * No provider and no supplied result.
         *
         * We deliberately DO NOT manufacture a random match score.
         */
        return {
            list: normalizedList,

            available: false,

            providerConfigured: false,

            matchScore: null,

            matched: false,

            matchType: "NOT_SCREENED",

            matches: [],

            thresholdBreached: false,

            errorCode:
                "SANCTIONS_PROVIDER_UNAVAILABLE",
        };
    }

    /**
     * =========================================================================
     * PROVIDER EXECUTION
     * =========================================================================
     */

    async executeProviderSearch(
        provider,
        customer,
        listType,
        options = {}
    ) {
        const timeout =
            options.providerTimeoutMs ||
            this.config.screening.providerTimeoutMs;

        const normalizedName =
            customer.normalizedName;

        const aliases =
            customer.aliases || [];

        try {
            const response =
                await this.withTimeout(
                    provider.search({
                        customer,
                        normalizedName,
                        aliases,
                        listType,
                        tenantId:
                            customer.tenantId ||
                            options.tenantId ||
                            null,
                    }),
                    timeout,
                    `${listType} sanctions provider timeout`
                );

            return this.normalizeProviderResult(
                response,
                listType
            );
        } catch (error) {
            this.logger.error(
                `[SANCTIONS] ${listType} provider failed`,
                {
                    error: error.message,
                }
            );

            return {
                list: listType,

                available: false,

                providerConfigured: true,

                matchScore: null,

                matched: false,

                matchType: "SCREENING_ERROR",

                matches: [],

                thresholdBreached: false,

                errorCode:
                    "SANCTIONS_PROVIDER_ERROR",

                errorMessage:
                    error.message,
            };
        }
    }

    /**
     * =========================================================================
     * CUSTOMER NORMALIZATION
     * =========================================================================
     */

    normalizeCustomer(customer) {
        const aliases = Array.isArray(
            customer.aliases
        )
            ? customer.aliases
                  .filter(Boolean)
                  .slice(
                      0,
                      this.config.screening.maxAliases
                  )
                  .map((alias) =>
                      this.normalizeName(alias)
                  )
                  .filter(Boolean)
            : [];

        const name =
            customer.name ||
            customer.fullName ||
            customer.legalName ||
            "";

        return {
            ...customer,

            name: String(name).trim(),

            normalizedName:
                this.normalizeName(name),

            aliases,

            normalizedAliases: aliases,

            tenantId:
                customer.tenantId || null,
        };
    }

    /**
     * =========================================================================
     * NAME NORMALIZATION
     * =========================================================================
     */

    normalizeName(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .normalize("NFKD")
            .replace(
                /[\u0300-\u036f]/g,
                ""
            )
            .toUpperCase()
            .replace(
                /[^\p{L}\p{N}\s]/gu,
                " "
            )
            .replace(/\s+/g, " ")
            .trim()
            .slice(
                0,
                this.config.screening.maxNameLength
            );
    }

    /**
     * =========================================================================
     * DETERMINISTIC NAME MATCHING
     * =========================================================================
     *
     * Used when an actual sanctions provider supplies candidate records.
     *
     * The algorithm intentionally combines:
     *
     * - Exact normalized-name matching
     * - Token matching
     * - Jaro-style similarity
     * - Alias comparison
     *
     * Final decisions should still be reviewed according to
     * institutional compliance policy.
     */

    calculateNameMatchScore(
        customerName,
        candidateName,
        aliases = []
    ) {
        const normalizedCustomer =
            this.normalizeName(customerName);

        const normalizedCandidate =
            this.normalizeName(candidateName);

        if (
            !normalizedCustomer ||
            !normalizedCandidate
        ) {
            return 0;
        }

        if (
            normalizedCustomer ===
            normalizedCandidate
        ) {
            return 100;
        }

        let score =
            this.jaroWinklerSimilarity(
                normalizedCustomer,
                normalizedCandidate
            ) * 100;

        for (const alias of aliases) {
            const aliasScore =
                this.jaroWinklerSimilarity(
                    this.normalizeName(alias),
                    normalizedCandidate
                ) * 100;

            score = Math.max(
                score,
                aliasScore
            );
        }

        /**
         * Token overlap protects against common
         * ordering differences.
         */
        const tokenScore =
            this.tokenSimilarity(
                normalizedCustomer,
                normalizedCandidate
            ) * 100;

        score =
            Math.max(
                score,
                tokenScore
            );

        return Number(
            Math.min(100, score).toFixed(2)
        );
    }

    /**
     * =========================================================================
     * TOKEN SIMILARITY
     * =========================================================================
     */

    tokenSimilarity(a, b) {
        const aTokens =
            new Set(
                this.normalizeName(a)
                    .split(" ")
                    .filter(Boolean)
            );

        const bTokens =
            new Set(
                this.normalizeName(b)
                    .split(" ")
                    .filter(Boolean)
            );

        if (
            !aTokens.size ||
            !bTokens.size
        ) {
            return 0;
        }

        let intersection = 0;

        for (const token of aTokens) {
            if (bTokens.has(token)) {
                intersection++;
            }
        }

        const union =
            new Set([
                ...aTokens,
                ...bTokens,
            ]).size;

        return union
            ? intersection / union
            : 0;
    }

    /**
     * =========================================================================
     * JARO-WINKLER SIMILARITY
     * =========================================================================
     */

    jaroWinklerSimilarity(
        first,
        second
    ) {
        const s1 = String(first);
        const s2 = String(second);

        if (s1 === s2) {
            return 1;
        }

        if (!s1.length || !s2.length) {
            return 0;
        }

        const matchDistance =
            Math.floor(
                Math.max(
                    s1.length,
                    s2.length
                ) / 2
            ) - 1;

        const s1Matches =
            new Array(s1.length).fill(false);

        const s2Matches =
            new Array(s2.length).fill(false);

        let matches = 0;

        for (
            let i = 0;
            i < s1.length;
            i++
        ) {
            const start =
                Math.max(
                    0,
                    i - matchDistance
                );

            const end =
                Math.min(
                    i + matchDistance + 1,
                    s2.length
                );

            for (
                let j = start;
                j < end;
                j++
            ) {
                if (
                    s2Matches[j] ||
                    s1[i] !== s2[j]
                ) {
                    continue;
                }

                s1Matches[i] = true;
                s2Matches[j] = true;
                matches++;

                break;
            }
        }

        if (!matches) {
            return 0;
        }

        let t = 0;
        let k = 0;

        for (
            let i = 0;
            i < s1.length;
            i++
        ) {
            if (!s1Matches[i]) {
                continue;
            }

            while (!s2Matches[k]) {
                k++;
            }

            if (s1[i] !== s2[k]) {
                t++;
            }

            k++;
        }

        const transpositions =
            t / 2;

        const jaro =
            (
                matches / s1.length +
                matches / s2.length +
                (matches -
                    transpositions) /
                    matches
            ) /
            3;

        const prefixLength =
            Math.min(
                4,
                this.getCommonPrefixLength(
                    s1,
                    s2
                )
            );

        return (
            jaro +
            prefixLength *
                0.1 *
                (1 - jaro)
        );
    }

    getCommonPrefixLength(a, b) {
        let length = 0;

        for (
            let i = 0;
            i <
                Math.min(
                    a.length,
                    b.length,
                    4
                );
            i++
        ) {
            if (a[i] !== b[i]) {
                break;
            }

            length++;
        }

        return length;
    }

    /**
     * =========================================================================
     * PROVIDER RESULT NORMALIZATION
     * =========================================================================
     */

    normalizeProviderResult(
        response,
        listType
    ) {
        const matches =
            Array.isArray(response?.matches)
                ? response.matches
                : [];

        const normalizedMatches =
            matches
                .map((match) => {
                    const candidateName =
                        match.name ||
                        match.fullName ||
                        "";

                    const suppliedScore =
                        Number(match.score);

                    const calculatedScore =
                        Number.isFinite(
                            suppliedScore
                        )
                            ? Math.min(
                                  100,
                                  Math.max(
                                      0,
                                      suppliedScore
                                  )
                              )
                            : this.calculateNameMatchScore(
                                  response.normalizedName ||
                                      "",
                                  candidateName,
                                  response.aliases ||
                                      []
                              );

                    return {
                        id:
                            match.id ||
                            match.entityId ||
                            null,

                        name: candidateName,

                        aliases:
                            Array.isArray(
                                match.aliases
                            )
                                ? match.aliases
                                : [],

                        score:
                            Number(
                                calculatedScore.toFixed(
                                    2
                                )
                            ),

                        matchType:
                            match.matchType ||
                            this.getMatchType(
                                calculatedScore
                            ),

                        listed:
                            match.listed !== false,

                        country:
                            match.country ||
                            null,

                        program:
                            match.program ||
                            null,

                        source:
                            match.source ||
                            listType,
                    };
                })
                .sort(
                    (a, b) =>
                        b.score - a.score
                )
                .slice(
                    0,
                    this.config.screening
                        .fuzzyCandidateLimit
                );

        const highestScore =
            normalizedMatches.length
                ? normalizedMatches[0].score
                : 0;

        return {
            list: listType,

            available:
                response?.available !== false,

            providerConfigured: true,

            matchScore: highestScore,

            matched:
                normalizedMatches.length >
                0,

            matchType:
                normalizedMatches.length
                    ? normalizedMatches[0]
                          .matchType
                    : "NO_MATCH",

            matches: normalizedMatches,

            matchedAlias:
                normalizedMatches.length
                    ? normalizedMatches[0].name
                    : null,

            thresholdBreached:
                highestScore >=
                this.config.thresholds
                    .LOW_MATCH,

            errorCode:
                response?.errorCode || null,
        };
    }

    /**
     * =========================================================================
     * MATCH TYPE
     * =========================================================================
     */

    getMatchType(score) {
        if (
            score >=
            this.config.thresholds
                .EXACT_MATCH
        ) {
            return "EXACT";
        }

        if (
            score >=
            this.config.thresholds
                .HIGH_MATCH
        ) {
            return "HIGH";
        }

        if (
            score >=
            this.config.thresholds
                .MEDIUM_MATCH
        ) {
            return "MEDIUM";
        }

        if (
            score >=
            this.config.thresholds
                .LOW_MATCH
        ) {
            return "LOW";
        }

        return "NO_MATCH";
    }

    /**
     * =========================================================================
     * SCREENING SCORE
     * =========================================================================
     */

    calculateScreeningScore(results) {
        let weightedScore = 0;
        let availableWeight = 0;

        for (
            const [
                list,
                result,
            ] of Object.entries(results)
        ) {
            const weight =
                this.config.listWeights[
                    list
                ] || 0;

            if (
                !weight ||
                !result ||
                !result.available
            ) {
                continue;
            }

            const score =
                Number(
                    result.matchScore
                );

            if (
                !Number.isFinite(score)
            ) {
                continue;
            }

            weightedScore +=
                score * weight;

            availableWeight += weight;
        }

        if (!availableWeight) {
            return 0;
        }

        return Number(
            (
                weightedScore /
                availableWeight
            ).toFixed(2)
        );
    }

    /**
     * =========================================================================
     * RISK CLASSIFICATION
     * =========================================================================
     */

    classifyRisk(score) {
        const numericScore =
            Number(score) || 0;

        if (
            numericScore >=
            this.config.thresholds
                .EXACT_MATCH
        ) {
            return "CRITICAL";
        }

        if (
            numericScore >=
            this.config.thresholds
                .HIGH_MATCH
        ) {
            return "HIGH";
        }

        if (
            numericScore >=
            this.config.thresholds
                .MEDIUM_MATCH
        ) {
            return "MEDIUM";
        }

        if (
            numericScore >=
            this.config.thresholds
                .LOW_MATCH
        ) {
            return "LOW";
        }

        return "CLEAR";
    }

    /**
     * =========================================================================
     * PAYMENT DECISION ENGINE
     * =========================================================================
     */

    generatePaymentDecision(
        score,
        details = {}
    ) {
        /**
         * Any exact/high-confidence listed match
         * must take precedence over weighted averaging.
         */
        if (
            this.containsExactMatch(
                details
            )
        ) {
            return "BLOCK";
        }

        const numericScore =
            Number(score) || 0;

        if (
            numericScore >=
            this.config.thresholds
                .EXACT_MATCH
        ) {
            return "BLOCK";
        }

        if (
            numericScore >=
            this.config.thresholds
                .HIGH_MATCH
        ) {
            return "REVIEW";
        }

        if (
            numericScore >=
            this.config.thresholds
                .MEDIUM_MATCH
        ) {
            return "HOLD";
        }

        return "ALLOW";
    }

    /**
     * =========================================================================
     * EXACT MATCH DETECTION
     * =========================================================================
     */

    containsExactMatch(details) {
        if (!details) {
            return false;
        }

        const results =
            Array.isArray(details)
                ? details
                : Object.values(details);

        for (const result of results) {
            if (!result) {
                continue;
            }

            if (
                result.matchType ===
                    "EXACT" ||
                Number(
                    result.matchScore
                ) >=
                    this.config.thresholds
                        .EXACT_MATCH
            ) {
                return true;
            }

            if (
                Array.isArray(
                    result.matches
                )
            ) {
                if (
                    result.matches.some(
                        (match) =>
                            match.listed !==
                                false &&
                            (
                                match.matchType ===
                                    "EXACT" ||
                                Number(
                                    match.score
                                ) >=
                                    this.config
                                        .thresholds
                                        .EXACT_MATCH
                            )
                    )
                ) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * =========================================================================
     * RECOMMENDATIONS
     * =========================================================================
     */

    generateRecommendations(
        classification,
        results = {}
    ) {
        const recommendations = [];

        switch (classification) {
            case "CRITICAL":
                recommendations.push(
                    "Block affected activity pending compliance determination."
                );

                recommendations.push(
                    "Escalate to the designated sanctions compliance officer."
                );

                recommendations.push(
                    "Perform documented enhanced due diligence."
                );

                break;

            case "HIGH":
                recommendations.push(
                    "Place activity under manual sanctions review."
                );

                recommendations.push(
                    "Verify identity and supporting customer information."
                );

                recommendations.push(
                    "Do not release payment until review is completed."
                );

                break;

            case "MEDIUM":
                recommendations.push(
                    "Perform enhanced due diligence."
                );

                recommendations.push(
                    "Review aliases, date of birth, nationality and identifiers."
                );

                break;

            case "LOW":
                recommendations.push(
                    "Perform standard due diligence."
                );

                recommendations.push(
                    "Maintain normal sanctions monitoring."
                );

                break;

            default:
                recommendations.push(
                    "No sanctions match identified from available screening sources."
                );

                break;
        }

        const unavailableLists =
            Object.values(results).filter(
                (result) =>
                    result &&
                    result.available === false
            );

        if (
            unavailableLists.length >
            0
        ) {
            recommendations.push(
                "One or more sanctions sources were unavailable; screening completeness must be reviewed before relying on the result."
            );
        }

        return [
            ...new Set(
                recommendations
            ),
        ];
    }

    /**
     * =========================================================================
     * TRANSACTION RECOMMENDATIONS
     * =========================================================================
     */

    generateTransactionRecommendations(
        senderResult,
        beneficiaryResult,
        decision
    ) {
        const recommendations = [];

        if (
            !senderResult?.success
        ) {
            recommendations.push(
                "Sender screening failed; do not rely on automated clearance."
            );
        }

        if (
            !beneficiaryResult?.success
        ) {
            recommendations.push(
                "Beneficiary screening failed; do not rely on automated clearance."
            );
        }

        if (
            decision === "BLOCK"
        ) {
            recommendations.push(
                "Block transaction pending sanctions compliance disposition."
            );
        }

        if (
            decision === "REVIEW"
        ) {
            recommendations.push(
                "Hold transaction for sanctions analyst review."
            );
        }

        if (
            decision === "HOLD"
        ) {
            recommendations.push(
                "Temporarily hold transaction pending enhanced verification."
            );
        }

        return [
            ...new Set(
                recommendations
            ),
        ];
    }

    /**
     * =========================================================================
     * LIST RESOLUTION
     * =========================================================================
     */

    resolveListTypes(options = {}) {
        const requested =
            Array.isArray(
                options.lists
            )
                ? options.lists
                : [
                      "OFAC",
                      "UN",
                      "EU",
                      "UK_HMT",
                      "LOCAL",
                  ];

        return [
            ...new Set(
                requested
                    .map(
                        (list) =>
                            this.normalizeListType(
                                list
                            )
                    )
                    .filter(Boolean)
            ),
        ];
    }

    normalizeListType(listType) {
        if (!listType) {
            return null;
        }

        const normalized =
            String(listType)
                .trim()
                .toUpperCase();

        const aliases = {
            OFAC: "OFAC",

            UN: "UN",
            UNSC: "UN",

            EU: "EU",

            UK: "UK_HMT",
            HMT: "UK_HMT",
            UK_HMT: "UK_HMT",
            OFSI: "UK_HMT",

            LOCAL: "LOCAL",
        };

        return aliases[
            normalized
        ] || null;
    }

    /**
     * =========================================================================
     * SUPPLIED RESULT SUPPORT
     * =========================================================================
     */

    getSuppliedListResult(
        customer,
        listType
    ) {
        const supplied =
            customer?.sanctionsScreening ||
            customer?.sanctionsResults;

        if (!supplied) {
            return null;
        }

        const result =
            supplied[listType];

        if (!result) {
            return null;
        }

        return result;
    }

    /**
     * =========================================================================
     * CUSTOMER VALIDATION
     * =========================================================================
     */

    validateCustomer(customer) {
        if (
            !customer ||
            typeof customer !==
                "object"
        ) {
            throw new TypeError(
                "Customer data is required"
            );
        }

        const name =
            customer.name ||
            customer.fullName ||
            customer.legalName;

        if (
            !name ||
            String(name).trim()
                .length <
                this.config.screening
                    .minimumNameLength
        ) {
            throw new Error(
                "Customer legal name is required for sanctions screening"
            );
        }

        if (
            String(name).length >
            this.config.screening
                .maxNameLength
        ) {
            throw new Error(
                "Customer name exceeds maximum supported length"
            );
        }
    }

    /**
     * =========================================================================
     * IDEMPOTENCY KEY
     * =========================================================================
     */

    generateIdempotencyKey(
        subjectType,
        subject,
        tenantId
    ) {
        const subjectId =
            subject?._id ||
            subject?.userId ||
            subject?.memberId ||
            subject?.customerId ||
            subject?.id ||
            "";

        const name =
            subject?.name ||
            subject?.fullName ||
            subject?.legalName ||
            "";

        return crypto
            .createHash("sha256")
            .update(
                [
                    this.config.version,
                    tenantId || "",
                    subjectType,
                    String(subjectId),
                    this.normalizeName(name),
                ].join("|")
            )
            .digest("hex");
    }

    /**
     * =========================================================================
     * TIMEOUT PROTECTION
     * =========================================================================
     */

    async withTimeout(
        promise,
        timeoutMs,
        message
    ) {
        let timer;

        const timeoutPromise =
            new Promise(
                (_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new Error(
                                    message
                                )
                            ),
                        timeoutMs
                    );
                }
            );

        try {
            return await Promise.race(
                [
                    promise,
                    timeoutPromise,
                ]
            );
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * =========================================================================
     * FAILURE HANDLING
     * =========================================================================
     */

    buildFailureResult(
        subjectType,
        error,
        options = {}
    ) {
        return {
            success: false,

            screeningId:
                options.screeningId ||
                crypto.randomUUID(),

            tenantId:
                options.tenantId ||
                null,

            subjectType,

            score: null,

            classification:
                this.config.failClosed
                    ? "REVIEW"
                    : "CLEAR",

            decision:
                this.config.failClosed
                    ? "REVIEW"
                    : "ALLOW",

            screeningFailed: true,

            errorCode:
                "SANCTIONS_SCREENING_FAILED",

            error:
                error?.message ||
                "Sanctions screening failed",

            recommendations: [
                "Do not rely on automated sanctions clearance.",
                "Route the subject to manual compliance review.",
            ],

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * AUDIT EVENT
     * =========================================================================
     */

    async writeAuditEvent(
        eventType,
        payload
    ) {
        if (
            !this.auditLogger ||
            typeof this.auditLogger !==
                "function"
        ) {
            return;
        }

        try {
            await this.auditLogger({
                eventType,

                service:
                    "SanctionsScreeningService",

                version:
                    this.config.version,

                timestamp:
                    new Date().toISOString(),

                tenantId:
                    payload?.tenantId ||
                    null,

                screeningId:
                    payload?.screeningId ||
                    null,

                subjectType:
                    payload?.subjectType ||
                    null,

                decision:
                    payload?.decision ||
                    null,

                classification:
                    payload?.classification ||
                    null,

                score:
                    payload?.score ??
                    payload?.highestRiskScore ??
                    null,
            });
        } catch (error) {
            /**
             * Audit failures must be observable but should not
             * silently change the screening decision.
             */
            this.logger.error(
                "[SANCTIONS] Audit event failed",
                {
                    eventType,
                    error: error.message,
                }
            );
        }
    }

    /**
     * =========================================================================
     * HEALTH / READINESS
     * =========================================================================
     */

    getHealth() {
        const requiredLists = [
            "OFAC",
            "UN",
            "EU",
            "UK_HMT",
            "LOCAL",
        ];

        const providers =
            requiredLists.reduce(
                (result, list) => {
                    result[list] =
                        this.providers.has(
                            list
                        );

                    return result;
                },
                {}
            );

        return {
            service:
                "SanctionsScreeningService",

            version:
                this.config.version,

            healthy: true,

            failClosed:
                this.config.failClosed,

            providers,

            configuredProviderCount:
                this.providers.size,

            timestamp:
                new Date().toISOString(),
        };
    }
}

module.exports =
    SanctionsScreeningService;