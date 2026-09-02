"use strict";

/**
 * =============================================================================
 * TITech Community Capital Ltd
 * Universal Resilience Intelligence Fabric
 * Sovereign Interoperability Engine
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Provides the orchestration foundation for sovereign interoperability across
 * federated resilience domains.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Sovereign interoperability lifecycle
 * • Domain registry foundation
 * • Identity registry foundation
 * • Trust relationship foundation
 * • Capability negotiation foundation
 * • Secure session foundation
 * • Policy registry
 * • Metrics & tracing integration
 * • Immutable snapshot foundation
 * • Event-driven interoperability
 *
 * NOTE
 * -----------------------------------------------------------------------------
 * This foundation intentionally DOES NOT implement:
 *
 * • Identity verification
 * • Certificate validation
 * • Cryptographic key management
 * • Trust negotiation
 * • Session establishment
 * • Capability negotiation
 * • Network transport
 *
 * Those responsibilities are implemented in later phases.
 * =============================================================================
 */

const { EventEmitter } = require("events");
const crypto = require("crypto");

/* =============================================================================
 * Snapshot Version
 * ========================================================================== */

const SNAPSHOT_VERSION = "1.0.0";

/* =============================================================================
 * Lifecycle States
 * ========================================================================== */

const INTEROPERABILITY_STATE = Object.freeze({

    CREATED: "CREATED",

    INITIALIZING: "INITIALIZING",

    READY: "READY",

    RUNNING: "RUNNING",

    DEGRADED: "DEGRADED",

    STOPPING: "STOPPING",

    STOPPED: "STOPPED",

    FAILED: "FAILED"

});

/* =============================================================================
 * Trust States
 * ========================================================================== */

const TRUST_STATE = Object.freeze({

    UNKNOWN: "UNKNOWN",

    PENDING: "PENDING",

    VERIFIED: "VERIFIED",

    TRUSTED: "TRUSTED",

    DEGRADED: "DEGRADED",

    REVOKED: "REVOKED",

    EXPIRED: "EXPIRED"

});

/* =============================================================================
 * Secure Session States
 * ========================================================================== */

const SESSION_STATE = Object.freeze({

    CREATED: "CREATED",

    NEGOTIATING: "NEGOTIATING",

    ESTABLISHED: "ESTABLISHED",

    ACTIVE: "ACTIVE",

    ROTATING_KEYS: "ROTATING_KEYS",

    CLOSED: "CLOSED",

    FAILED: "FAILED"

});

/* =============================================================================
 * Capability Negotiation States
 * ========================================================================== */

const NEGOTIATION_STATE = Object.freeze({

    CREATED: "CREATED",

    DISCOVERING: "DISCOVERING",

    NEGOTIATING: "NEGOTIATING",

    AGREED: "AGREED",

    REJECTED: "REJECTED",

    CANCELLED: "CANCELLED",

    FAILED: "FAILED"

});

/* =============================================================================
 * UUID Helper
 * ========================================================================== */

function createId(prefix = "interop") {

    return `${prefix}-${crypto.randomUUID()}`;

}

/* =============================================================================
 * Sovereign Interoperability
 * ========================================================================== */

class SovereignInteroperability extends EventEmitter {

    constructor(options = {}) {

        super();

        this.options = Object.freeze({

            componentName:
                options.componentName ||
                "sovereign-interoperability",

            logger:
                options.logger ||
                console,

            metrics:
                options.metrics ||
                null,

            tracer:
                options.tracer ||
                null,

            clock:
                options.clock ||
                (() => new Date()),

            trustRefreshInterval:
                options.trustRefreshInterval ||
                300000,

            sessionTimeout:
                options.sessionTimeout ||
                3600000,

            negotiationTimeout:
                options.negotiationTimeout ||
                60000,

            ...options

        });

        this.logger = this.options.logger;
        this.metrics = this.options.metrics;
        this.tracer = this.options.tracer;
        this.clock = this.options.clock;

        /* ---------------------------------------------------------------------
         * Lifecycle
         * ------------------------------------------------------------------ */

        this.state = INTEROPERABILITY_STATE.CREATED;

        this.started = false;

        this.initializedAt = null;

        this.startedAt = null;

        /* ---------------------------------------------------------------------
         * Enterprise Registries
         * ------------------------------------------------------------------ */

        this.domains = new Map();

        this.identities = new Map();

        this.trustRelationships = new Map();

        this.sessions = new Map();

        this.capabilities = new Map();

        this.negotiations = new Map();

        this.policies = new Map();

        this.interoperability = new Map();

        this.health = new Map();

        this.snapshots = new Map();

        /* ---------------------------------------------------------------------
         * Metrics Registry
         * ------------------------------------------------------------------ */

        this.metricsRegistry = {

            registeredDomains: 0,

            registeredIdentities: 0,

            trustRelationships: 0,

            activeSessions: 0,

            negotiatedCapabilities: 0,

            completedNegotiations: 0,

            failedNegotiations: 0,

            interoperabilityOperations: 0

        };

        /* ---------------------------------------------------------------------
         * Diagnostics
         * ------------------------------------------------------------------ */

        this.diagnostics = {

            lastInitialization: null,

            lastTrustEvaluation: null,

            lastSession: null,

            lastNegotiation: null,

            lastSnapshot: null,

            lastError: null

        };

    }

    /* =========================================================================
     * Metrics Wrapper
     * ========================================================================= */

    incrementMetric(name, value = 1, labels = {}) {

        if (
            this.metrics &&
            typeof this.metrics.increment === "function"
        ) {

            this.metrics.increment(
                name,
                value,
                labels
            );

        }

    }

    recordGauge(name, value, labels = {}) {

        if (
            this.metrics &&
            typeof this.metrics.gauge === "function"
        ) {

            this.metrics.gauge(
                name,
                value,
                labels
            );

        }

    }

    recordHistogram(name, value, labels = {}) {

        if (
            this.metrics &&
            typeof this.metrics.histogram === "function"
        ) {

            this.metrics.histogram(
                name,
                value,
                labels
            );

        }

    }

    /* =========================================================================
     * Tracing Wrapper
     * ========================================================================= */

    startSpan(name, attributes = {}) {

        if (
            this.tracer &&
            typeof this.tracer.startSpan === "function"
        ) {

            return this.tracer.startSpan(
                name,
                attributes
            );

        }

        return null;

    }

    /* =========================================================================
     * Initialize
     * ========================================================================= */

    async initialize() {

        if (
            this.state !==
            INTEROPERABILITY_STATE.CREATED
        ) {

            return this.state;

        }

        this.state =
            INTEROPERABILITY_STATE.INITIALIZING;

        try {

            this.initializedAt =
                this.clock();

            this.diagnostics.lastInitialization =
                this.initializedAt;

            this.state =
                INTEROPERABILITY_STATE.READY;

            this.logger.info?.({

                component:
                    "SovereignInteroperability",

                event:
                    "initialized"

            });

            this.emit(
                "interoperability:initialized"
            );

            return this.state;

        } catch (error) {

            this.state =
                INTEROPERABILITY_STATE.FAILED;

            this.diagnostics.lastError =
                error;

            throw error;

        }

    }

    /* =========================================================================
     * Start
     * ========================================================================= */

    async start() {

        if (this.started) {

            return this.state;

        }

        if (
            this.state !==
            INTEROPERABILITY_STATE.READY
        ) {

            await this.initialize();

        }

        this.started = true;

        this.startedAt =
            this.clock();

        this.state =
            INTEROPERABILITY_STATE.RUNNING;

        this.logger.info?.({

            component:
                "SovereignInteroperability",

            event:
                "started"

        });

        this.emit(
            "interoperability:started"
        );

        return this.state;

    }

    /* =========================================================================
     * Stop
     * ========================================================================= */

    async stop() {

        if (!this.started) {

            return this.state;

        }

        this.state =
            INTEROPERABILITY_STATE.STOPPING;

        this.started = false;

        this.state =
            INTEROPERABILITY_STATE.STOPPED;

        this.logger.info?.({

            component:
                "SovereignInteroperability",

            event:
                "stopped"

        });

        this.emit(
            "interoperability:stopped"
        );

        return this.state;

    }

        /* =========================================================================
     * Register Sovereign Domain
     * =========================================================================
     *
     * Registers an external sovereign resilience domain.
     *
     * Tracks:
     * - sovereign identifier
     * - governance metadata
     * - federation membership
     * - trust bootstrap information
     *
     * ========================================================================= */

    registerDomain(options = {}) {

        if (!options.identifier) {

            throw new Error(
                "Domain sovereign identifier is required."
            );

        }

        if (
            this.domains.has(
                options.identifier
            )
        ) {

            throw new Error(
                `Domain already exists: ${options.identifier}`
            );

        }


        const domain = Object.freeze({

            id:
                createId("domain"),

            identifier:
                options.identifier,

            name:
                options.name ||
                options.identifier,

            sovereignty:

                options.sovereignty ||
                "INDEPENDENT",

            governance:

                Object.freeze(
                    options.governance || {}
                ),

            federationMembership:

                Object.freeze({

                    enabled:
                        options.federationMembership
                            ?.enabled !== false,

                    federationId:
                        options.federationMembership
                            ?.federationId ||
                        null

                }),


            trustBootstrap:

                Object.freeze({

                    state:
                        TRUST_STATE.UNKNOWN,

                    bootstrapRequired:
                        true,

                    evidence:
                        []

                }),


            metadata:

                Object.freeze(
                    options.metadata || {}
                ),


            registeredAt:
                this.clock(),

            state:
                "REGISTERED"

        });


        this.domains.set(
            domain.identifier,
            domain
        );


        this.health.set(
            domain.identifier,
            Object.freeze({

                domain:
                    domain.identifier,

                available:
                    true,

                status:
                    "UNKNOWN",

                checkedAt:
                    this.clock()

            })
        );


        this.metricsRegistry.registeredDomains++;


        this.incrementMetric(
            "sovereign_domains_registered_total"
        );


        this.emit(
            "domain:registered",
            domain
        );


        this.logger.info?.({

            component:
                "SovereignInteroperability",

            event:
                "domain_registered",

            domain:
                domain.identifier

        });


        return domain;

    }


    /* =========================================================================
     * Remove Sovereign Domain
     * =========================================================================
     *
     * Removes a sovereign domain registration.
     *
     * Performs registry cleanup only.
     *
     * ========================================================================= */

    removeDomain(
        identifier,
        reason = "Removed"
    ) {


        const domain =
            this.domains.get(identifier);


        if (!domain) {

            throw new Error(
                `Domain not found: ${identifier}`
            );

        }


        this.domains.delete(
            identifier
        );


        this.health.delete(
            identifier
        );


        /*
         * Remove future interoperability
         * relationships referencing this domain.
         */

        for (
            const [
                relationshipId,
                relationship
            ] of this.trustRelationships
        ) {

            if (

                relationship.source === identifier ||

                relationship.target === identifier

            ) {

                this.trustRelationships.delete(
                    relationshipId
                );

            }

        }


        const result = Object.freeze({

            removed:
                true,

            identifier,

            reason,

            removedAt:
                this.clock()

        });


        this.incrementMetric(
            "sovereign_domains_removed_total"
        );


        this.emit(
            "domain:removed",
            result
        );


        this.logger.info?.({

            component:
                "SovereignInteroperability",

            event:
                "domain_removed",

            domain:
                identifier

        });


        return result;

    }


    /* =========================================================================
     * Discover Domain
     * =========================================================================
     *
     * Finds a sovereign domain by identifier.
     *
     * Discovery is local registry based.
     * Federation discovery is handled later.
     *
     * ========================================================================= */

    discoverDomain(identifier) {


        const domain =
            this.domains.get(identifier);


        if (!domain) {

            return Object.freeze({

                discovered:
                    false,

                identifier,

                discoveredAt:
                    this.clock()

            });

        }


        return Object.freeze({

            discovered:
                true,

            domain,

            discoveredAt:
                this.clock()

        });

    }


    /* =========================================================================
     * List Domains
     * ========================================================================= */

    listDomains(filters = {}) {


        let domains =
            [
                ...this.domains.values()
            ];


        if (
            filters.federationId
        ) {

            domains =
                domains.filter(

                    domain =>

                        domain.federationMembership
                            .federationId ===
                        filters.federationId

                );

        }


        if (
            filters.sovereignty
        ) {

            domains =
                domains.filter(

                    domain =>

                        domain.sovereignty ===
                        filters.sovereignty

                );

        }


        return Object.freeze({

            total:
                domains.length,

            domains:
                Object.freeze(
                    domains
                ),

            generatedAt:
                this.clock()

        });

    }

        /* =========================================================================
     * Register Identity
     * =========================================================================
     *
     * Registers a sovereign identity abstraction.
     *
     * Does not validate certificates or cryptographic proofs.
     * Those responsibilities belong to external identity providers.
     *
     * ========================================================================= */

    registerIdentity(options = {}) {

        if (!options.domain) {

            throw new Error(
                "Identity domain is required."
            );

        }


        const domain =
            this.domains.get(
                options.domain
            );


        if (!domain) {

            throw new Error(
                `Domain not registered: ${options.domain}`
            );

        }


        if (!options.identifier) {

            throw new Error(
                "Identity identifier is required."
            );

        }


        if (
            this.identities.has(
                options.identifier
            )
        ) {

            throw new Error(
                `Identity already exists: ${options.identifier}`
            );

        }


        const identity = Object.freeze({

            id:
                createId("identity"),

            identifier:
                options.identifier,

            domain:
                options.domain,

            type:
                options.type ||
                "SOVEREIGN_ENTITY",


            attributes:

                Object.freeze(
                    options.attributes || {}
                ),


            status:
                "REGISTERED",


            trustState:
                TRUST_STATE.UNKNOWN,


            evidence:

                Object.freeze([]),


            createdAt:
                this.clock()

        });


        this.identities.set(

            identity.identifier,

            identity

        );


        this.metricsRegistry.registeredIdentities++;


        this.incrementMetric(
            "sovereign_identities_registered_total"
        );


        this.emit(
            "identity:registered",
            identity
        );


        return identity;

    }


    /* =========================================================================
     * Verify Identity
     * =========================================================================
     *
     * Performs identity state evaluation.
     *
     * Actual verification providers can be injected later.
     *
     * ========================================================================= */

    verifyIdentity(
        identifier,
        evidence = {}
    ) {


        const identity =
            this.identities.get(identifier);


        if (!identity) {

            throw new Error(
                `Identity not found: ${identifier}`
            );

        }


        const verifiedEvidence =
            Object.freeze({

                source:
                    evidence.source ||
                    "internal",

                type:
                    evidence.type ||
                    "ASSERTION",

                timestamp:
                    this.clock(),

                metadata:
                    Object.freeze(
                        evidence.metadata || {}
                    )

            });


        const updatedIdentity =
            Object.freeze({

                ...identity,

                status:
                    "VERIFIED",

                trustState:
                    TRUST_STATE.VERIFIED,

                evidence:
                    Object.freeze([

                        ...identity.evidence,

                        verifiedEvidence

                    ])

            });


        this.identities.set(

            identifier,

            updatedIdentity

        );


        this.diagnostics.lastTrustEvaluation =
            this.clock();


        this.emit(
            "identity:verified",
            updatedIdentity
        );


        return updatedIdentity;

    }


    /* =========================================================================
     * Establish Trust
     * =========================================================================
     *
     * Creates a trust relationship between sovereign identities/domains.
     *
     * ========================================================================= */

    establishTrust(options = {}) {


        if (!options.source) {

            throw new Error(
                "Source identity required."
            );

        }


        if (!options.target) {

            throw new Error(
                "Target identity required."
            );

        }


        const source =
            this.identities.get(
                options.source
            );


        const target =
            this.identities.get(
                options.target
            );


        if (!source || !target) {

            throw new Error(
                "Both identities must exist."
            );

        }


        const relationship =
            Object.freeze({

                id:
                    createId("trust"),

                source:
                    options.source,

                target:
                    options.target,


                state:
                    TRUST_STATE.TRUSTED,


                score:
                    options.score ||
                    50,


                evidence:

                    Object.freeze(
                        options.evidence || []
                    ),


                establishedAt:
                    this.clock()

            });


        this.trustRelationships.set(

            relationship.id,

            relationship

        );


        this.metricsRegistry.trustRelationships++;


        this.incrementMetric(
            "trust_relationships_created_total"
        );


        this.emit(
            "trust:established",
            relationship
        );


        return relationship;

    }


    /* =========================================================================
     * Revoke Trust
     * ========================================================================= */

    revokeTrust(
        relationshipId,
        reason = "Revoked"
    ) {


        const relationship =
            this.trustRelationships.get(
                relationshipId
            );


        if (!relationship) {

            throw new Error(
                `Trust relationship not found: ${relationshipId}`
            );

        }


        const revoked =
            Object.freeze({

                ...relationship,

                state:
                    TRUST_STATE.REVOKED,


                revokedReason:
                    reason,


                revokedAt:
                    this.clock()

            });


        this.trustRelationships.set(

            relationshipId,

            revoked

        );


        this.emit(
            "trust:revoked",
            revoked
        );


        return revoked;

    }


    /* =========================================================================
     * Trust Score
     * =========================================================================
     *
     * Calculates current trust posture.
     * ========================================================================= */

    trustScore(identifier) {


        const relationships =

            [

                ...this.trustRelationships.values()

            ].filter(

                relationship =>

                    relationship.source === identifier ||

                    relationship.target === identifier

            );


        if (
            relationships.length === 0
        ) {

            return Object.freeze({

                identifier,

                score:
                    0,

                state:
                    TRUST_STATE.UNKNOWN,

                relationships:
                    0,

                calculatedAt:
                    this.clock()

            });

        }


        const score =

            relationships.reduce(

                (total, relationship) =>

                    total +
                    relationship.score,

                0

            )
            /
            relationships.length;


        return Object.freeze({

            identifier,

            score,

            state:

                score >= 80

                    ? TRUST_STATE.TRUSTED

                    : score >= 40

                        ? TRUST_STATE.VERIFIED

                        : TRUST_STATE.DEGRADED,


            relationships:
                relationships.length,


            calculatedAt:
                this.clock()

        });

    }

        /* =========================================================================
     * Advertise Capability
     * =========================================================================
     *
     * Allows a sovereign domain to publish supported capabilities.
     *
     * ========================================================================= */

    advertiseCapability(options = {}) {

        if (!options.domain) {

            throw new Error(
                "Capability domain is required."
            );

        }


        const domain =
            this.domains.get(
                options.domain
            );


        if (!domain) {

            throw new Error(
                `Domain not registered: ${options.domain}`
            );

        }


        if (!options.name) {

            throw new Error(
                "Capability name is required."
            );

        }


        const capability = Object.freeze({

            id:
                createId("capability"),


            domain:
                options.domain,


            name:
                options.name,


            version:
                options.version ||
                "1.0.0",


            description:
                options.description ||
                null,


            category:
                options.category ||
                "GENERAL",


            status:
                "AVAILABLE",


            metadata:

                Object.freeze(
                    options.metadata || {}
                ),


            advertisedAt:
                this.clock()

        });


        this.capabilities.set(

            capability.id,

            capability

        );


        this.metricsRegistry.negotiatedCapabilities++;


        this.incrementMetric(
            "capabilities_advertised_total"
        );


        this.emit(
            "capability:advertised",
            capability
        );


        return capability;

    }


    /* =========================================================================
     * Request Capability
     * =========================================================================
     *
     * Creates a capability request between sovereign domains.
     *
     * ========================================================================= */

    requestCapability(options = {}) {


        if (!options.requester) {

            throw new Error(
                "Requester domain required."
            );

        }


        if (!options.provider) {

            throw new Error(
                "Provider domain required."
            );

        }


        if (!options.capability) {

            throw new Error(
                "Capability name required."
            );

        }


        const negotiation =
            Object.freeze({

                id:
                    createId("negotiation"),


                requester:
                    options.requester,


                provider:
                    options.provider,


                capability:
                    options.capability,


                state:
                    NEGOTIATION_STATE.CREATED,


                requestedAt:
                    this.clock(),


                metadata:

                    Object.freeze(
                        options.metadata || {}
                    )

            });


        this.negotiations.set(

            negotiation.id,

            negotiation

        );


        this.emit(
            "capability:requested",
            negotiation
        );


        return negotiation;

    }


    /* =========================================================================
     * Negotiate Capability
     * =========================================================================
     *
     * Evaluates capability compatibility.
     *
     * ========================================================================= */

    negotiateCapability(
        negotiationId,
        options = {}
    ) {


        const negotiation =
            this.negotiations.get(
                negotiationId
            );


        if (!negotiation) {

            throw new Error(
                `Negotiation not found: ${negotiationId}`
            );

        }


        const span =
            this.startSpan(
                "capability.negotiation",
                {
                    negotiationId
                }
            );


        try {


            const compatible =
                options.compatible !== false;


            const result =
                Object.freeze({

                    ...negotiation,


                    state:

                        compatible

                            ? NEGOTIATION_STATE.AGREED

                            : NEGOTIATION_STATE.REJECTED,


                    agreedVersion:
                        options.version ||
                        "1.0.0",


                    negotiatedAt:
                        this.clock(),


                    terms:

                        Object.freeze(
                            options.terms || {}
                        )

                });


            this.negotiations.set(

                negotiationId,

                result

            );


            if (compatible) {

                this.metricsRegistry
                    .completedNegotiations++;

            }
            else {

                this.metricsRegistry
                    .failedNegotiations++;

            }


            this.incrementMetric(

                compatible

                    ? "capability_negotiations_success_total"

                    : "capability_negotiations_failed_total"

            );


            this.emit(

                compatible

                    ? "capability:agreed"

                    : "capability:rejected",

                result

            );


            return result;


        }
        finally {

            span?.end?.();

        }

    }


    /* =========================================================================
     * Agreement Status
     * =========================================================================
     *
     * Returns current capability negotiation state.
     *
     * ========================================================================= */

    agreementStatus(
        negotiationId
    ) {


        const negotiation =
            this.negotiations.get(
                negotiationId
            );


        if (!negotiation) {

            throw new Error(
                `Negotiation not found: ${negotiationId}`
            );

        }


        return Object.freeze({

            id:
                negotiation.id,


            capability:
                negotiation.capability,


            requester:
                negotiation.requester,


            provider:
                negotiation.provider,


            state:
                negotiation.state,


            active:

                negotiation.state ===
                NEGOTIATION_STATE.AGREED,


            checkedAt:
                this.clock()

        });

    }

        /* =========================================================================
     * Create Session
     * =========================================================================
     *
     * Creates a secure interoperability session abstraction.
     *
     * Does not create cryptographic material.
     *
     * ========================================================================= */

    createSession(options = {}) {

        if (!options.sourceIdentity) {

            throw new Error(
                "Source identity required."
            );

        }


        if (!options.targetIdentity) {

            throw new Error(
                "Target identity required."
            );

        }


        const source =
            this.identities.get(
                options.sourceIdentity
            );


        const target =
            this.identities.get(
                options.targetIdentity
            );


        if (!source || !target) {

            throw new Error(
                "Both identities must exist."
            );

        }


        const session =
            Object.freeze({

                id:
                    createId("session"),


                sourceIdentity:
                    options.sourceIdentity,


                targetIdentity:
                    options.targetIdentity,


                capability:

                    options.capability ||
                    null,


                state:
                    SESSION_STATE.CREATED,


                trustRequired:

                    options.trustRequired !== false,


                createdAt:
                    this.clock(),


                expiresAt:

                    options.expiresAt ||
                    new Date(

                        Date.now() +
                        this.options.sessionTimeout

                    ),


                metadata:

                    Object.freeze(
                        options.metadata || {}
                    )

            });


        this.sessions.set(

            session.id,

            session

        );


        this.metricsRegistry.activeSessions++;


        this.incrementMetric(
            "secure_sessions_created_total"
        );


        this.diagnostics.lastSession =
            this.clock();


        this.emit(
            "session:created",
            session
        );


        return session;

    }


    /* =========================================================================
     * Validate Session
     * =========================================================================
     *
     * Validates session lifecycle state.
     *
     * ========================================================================= */

    validateSession(
        sessionId
    ) {


        const session =
            this.sessions.get(
                sessionId
            );


        if (!session) {

            throw new Error(
                `Session not found: ${sessionId}`
            );

        }


        const expired =
            new Date(session.expiresAt)
            <
            this.clock();


        const validated =
            Object.freeze({

                ...session,


                state:

                    expired

                        ? SESSION_STATE.FAILED

                        : SESSION_STATE.ACTIVE,


                validatedAt:
                    this.clock()

            });


        this.sessions.set(

            sessionId,

            validated

        );


        if (expired) {

            this.incrementMetric(
                "secure_sessions_expired_total"
            );

        }


        this.emit(
            "session:validated",
            validated
        );


        return Object.freeze({

            valid:
                !expired,


            session:
                validated,


            checkedAt:
                this.clock()

        });

    }


    /* =========================================================================
     * Close Session
     * =========================================================================
     */

    closeSession(
        sessionId,
        reason = "Closed"
    ) {


        const session =
            this.sessions.get(
                sessionId
            );


        if (!session) {

            throw new Error(
                `Session not found: ${sessionId}`
            );

        }


        const closed =
            Object.freeze({

                ...session,


                state:
                    SESSION_STATE.CLOSED,


                closeReason:
                    reason,


                closedAt:
                    this.clock()

            });


        this.sessions.set(

            sessionId,

            closed

        );


        this.metricsRegistry.activeSessions =
            Math.max(

                0,

                this.metricsRegistry.activeSessions - 1

            );


        this.incrementMetric(
            "secure_sessions_closed_total"
        );


        this.emit(
            "session:closed",
            closed
        );


        return closed;

    }


    /* =========================================================================
     * Rotate Keys
     * =========================================================================
     *
     * Coordinates key rotation lifecycle.
     *
     * Actual key generation delegated externally.
     *
     * ========================================================================= */

    rotateKeys(
        sessionId,
        metadata = {}
    ) {


        const session =
            this.sessions.get(
                sessionId
            );


        if (!session) {

            throw new Error(
                `Session not found: ${sessionId}`
            );

        }


        const rotating =
            Object.freeze({

                ...session,


                state:
                    SESSION_STATE.ROTATING_KEYS,


                rotationRequestedAt:
                    this.clock()

            });


        this.sessions.set(

            sessionId,

            rotating

        );


        const rotated =
            Object.freeze({

                ...rotating,


                state:
                    SESSION_STATE.ACTIVE,


                keyVersion:

                    (
                        session.keyVersion ||
                        0
                    ) + 1,


                rotationMetadata:

                    Object.freeze(
                        metadata
                    ),


                rotatedAt:
                    this.clock()

            });


        this.sessions.set(

            sessionId,

            rotated

        );


        this.incrementMetric(
            "secure_session_key_rotations_total"
        );


        this.emit(
            "session:key_rotated",
            rotated
        );


        return rotated;

    }


        /* =========================================================================
     * Health
     * =========================================================================
     *
     * Returns runtime interoperability health.
     * ========================================================================= */

    health() {

        const activeSessions =

            [
                ...this.sessions.values()
            ]
            .filter(

                session =>

                    session.state ===
                    SESSION_STATE.ACTIVE

            )
            .length;


        const trustedRelationships =

            [
                ...this.trustRelationships.values()
            ]
            .filter(

                relationship =>

                    relationship.state ===
                    TRUST_STATE.TRUSTED

            )
            .length;


        const healthReport =
            Object.freeze({

                component:
                    "SovereignInteroperability",


                state:
                    this.state,


                running:
                    this.started,


                healthy:

                    this.state ===
                    INTEROPERABILITY_STATE.RUNNING,


                domains:
                    this.domains.size,


                identities:
                    this.identities.size,


                trustedRelationships,


                activeSessions,


                capabilities:
                    this.capabilities.size,


                negotiations:
                    this.negotiations.size,


                timestamp:
                    this.clock()

            });


        this.emit(
            "health:checked",
            healthReport
        );


        return healthReport;

    }



    /* =========================================================================
     * Statistics
     * ========================================================================= */

    statistics() {

        return Object.freeze({

            lifecycle:

                Object.freeze({

                    state:
                        this.state,


                    started:
                        this.started,


                    initializedAt:
                        this.initializedAt,


                    startedAt:
                        this.startedAt

                }),


            registries:

                Object.freeze({

                    domains:
                        this.domains.size,


                    identities:
                        this.identities.size,


                    trustRelationships:
                        this.trustRelationships.size,


                    sessions:
                        this.sessions.size,


                    capabilities:
                        this.capabilities.size,


                    negotiations:
                        this.negotiations.size,


                    policies:
                        this.policies.size,


                    interoperability:
                        this.interoperability.size,


                    snapshots:
                        this.snapshots.size

                }),


            metrics:

                Object.freeze({

                    ...this.metricsRegistry

                }),


            generatedAt:
                this.clock()

        });

    }



    /* =========================================================================
     * Diagnostics
     * ========================================================================= */

    diagnostics() {

        return Object.freeze({

            component:

                "SovereignInteroperability",


            health:

                this.health(),


            statistics:

                this.statistics(),


            lifecycle:

                Object.freeze({

                    state:
                        this.state,


                    started:
                        this.started

                }),


            diagnostics:

                Object.freeze({

                    ...this.diagnostics

                }),


            generatedAt:
                this.clock()

        });

    }



    /* =========================================================================
     * Immutable Snapshot
     * ========================================================================= */

    snapshot() {

        const snapshot =
            Object.freeze({

                id:
                    createId(
                        "interop-snapshot"
                    ),


                version:
                    SNAPSHOT_VERSION,


                createdAt:
                    this.clock(),


                lifecycle:

                    Object.freeze({

                        state:
                            this.state,


                        started:
                            this.started

                    }),



                domains:

                    Object.freeze(

                        [
                            ...this.domains.values()
                        ]

                    ),



                identities:

                    Object.freeze(

                        [
                            ...this.identities.values()
                        ]

                    ),



                trustRelationships:

                    Object.freeze(

                        [
                            ...this.trustRelationships.values()
                        ]

                    ),



                sessions:

                    Object.freeze(

                        [
                            ...this.sessions.values()
                        ]

                    ),



                capabilities:

                    Object.freeze(

                        [
                            ...this.capabilities.values()
                        ]

                    ),



                negotiations:

                    Object.freeze(

                        [
                            ...this.negotiations.values()
                        ]

                    )

            });



        this.snapshots.set(

            snapshot.id,

            snapshot

        );


        this.diagnostics.lastSnapshot =
            this.clock();


        this.emit(
            "snapshot:created",
            snapshot
        );


        return snapshot;

    }



    /* =========================================================================
     * Export State
     * ========================================================================= */

    exportState() {

        return Object.freeze({

            component:

                "SovereignInteroperability",


            version:

                SNAPSHOT_VERSION,


            exportedAt:

                this.clock(),


            state:

                this.snapshot()

        });

    }



    /* =========================================================================
     * Audit Package
     * ========================================================================= */

    auditPackage() {

        return Object.freeze({

            packageId:

                createId(
                    "interop-audit"
                ),


            component:

                "SovereignInteroperability",


            generatedAt:

                this.clock(),


            health:

                this.health(),


            statistics:

                this.statistics(),


            diagnostics:

                this.diagnostics(),


            snapshot:

                this.snapshot()

        });

    }

    
}


module.exports = {

    SovereignInteroperability,

    SNAPSHOT_VERSION,

    INTEROPERABILITY_STATE,

    TRUST_STATE,

    SESSION_STATE,

    NEGOTIATION_STATE,

    createId

};