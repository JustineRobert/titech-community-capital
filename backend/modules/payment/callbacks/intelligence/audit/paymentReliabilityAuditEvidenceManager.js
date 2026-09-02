/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Audit Evidence Manager
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Immutable Audit Evidence Storage
 * • Evidence Lifecycle Management
 * • Cryptographic Evidence Hashing
 * • Audit Package Generation
 * • Compliance Evidence Verification
 * • Regulator Audit Support
 * • Chain-of-Custody Tracking
 * • Evidence Retention Enforcement
 * • Forensic Investigation Support
 * • Evidence Integrity Validation
 * • Financial Control Traceability
 *
 *
 * Purpose
 * -------
 * Maintain a trusted evidence repository for all payment reliability actions,
 * decisions, compliance events, and operational changes.
 *
 *
 * Evidence Lifecycle
 * ------------------
 *
 *
 * Reliability Event
 *
 *        |
 *        ▼
 *
 * Evidence Capture
 *
 *        |
 *        ▼
 *
 * Cryptographic Hashing
 *
 *        |
 *        ▼
 *
 * Immutable Storage
 *
 *        |
 *        ▼
 *
 * Verification / Audit
 *
 *
 *
 * Evidence Types
 * --------------
 *
 * CALLBACK_EVENT
 * ANOMALY_DETECTION
 * AUTONOMOUS_DECISION
 * SELF_HEALING_ACTION
 * FAILOVER_ACTION
 * GOVERNANCE_DECISION
 * COMPLIANCE_RESULT
 * REGULATORY_REPORT
 *
 *
 * Security Principles
 * -------------------
 *
 * • Evidence Integrity
 * • Non-Repudiation
 * • Chain Of Custody
 * • Audit Transparency
 *
 * ============================================================================
 */


const crypto = require("crypto");



const {
    randomUUID
} = require("crypto");



class PaymentReliabilityAuditEvidenceManager {


    constructor({

        storageService,

        auditLogger,

        retentionManager,

        eventBus,

        complianceManager,

        logger

    } = {}) {


        this.storageService =
            storageService;


        this.auditLogger =
            auditLogger;


        this.retentionManager =
            retentionManager;


        this.eventBus =
            eventBus;


        this.complianceManager =
            complianceManager;


        this.logger =
            logger;



        this.evidence =
            new Map();



        this.chain =
            [];

    }





    /**
     * ------------------------------------------------------------------------
     * Store Audit Evidence
     * ------------------------------------------------------------------------
     */


    async storeEvidence({

        type,

        payload,

        source,

        metadata = {}

    }) {


        const evidenceId =
            randomUUID();



        const timestamp =
            new Date();



        const previousHash =
            this.#getLatestHash();



        const hash =
            this.#generateHash({

                evidenceId,

                type,

                payload,

                previousHash,

                timestamp

            });



        const evidence = {


            id:

                evidenceId,


            type,


            source,


            payload,


            metadata,


            timestamp,


            hash,


            previousHash,


            status:

                "IMMUTABLE"


        };



        this.evidence.set(

            evidenceId,

            evidence

        );



        this.chain.push(

            {

                id:

                    evidenceId,

                hash,

                previousHash

            }

        );



        await this.#persist(

            evidence

        );



        await this.#publishEvent(

            evidence

        );



        return Object.freeze(

            evidence

        );

    }





    /**
     * ------------------------------------------------------------------------
     * Cryptographic Hash Generation
     * ------------------------------------------------------------------------
     */


    #generateHash(data) {


        return crypto

            .createHash("sha256")

            .update(

                JSON.stringify(data)

            )

            .digest("hex");

    }





    /**
     * ------------------------------------------------------------------------
     * Latest Chain Hash
     * ------------------------------------------------------------------------
     */


    #getLatestHash() {


        if (

            this.chain.length === 0

        ) {


            return null;

        }



        return this.chain.at(-1).hash;

    }





    /**
     * ------------------------------------------------------------------------
     * Verify Evidence Integrity
     * ------------------------------------------------------------------------
     */


    verifyEvidence(id) {


        const evidence =

            this.evidence.get(id);



        if (!evidence) {


            return {


                valid:

                    false,


                reason:

                    "Evidence not found"

            };

        }



        const recalculated =

            this.#generateHash({

                evidenceId:

                    evidence.id,


                type:

                    evidence.type,


                payload:

                    evidence.payload,


                previousHash:

                    evidence.previousHash,


                timestamp:

                    evidence.timestamp

            });



        return {


            valid:

                recalculated === evidence.hash,


            evidenceId:

                id


        };


    }





    /**
     * ------------------------------------------------------------------------
     * Retrieve Evidence
     * ------------------------------------------------------------------------
     */


    getEvidence(id) {


        return this.evidence.get(id) || null;

    }





    /**
     * ------------------------------------------------------------------------
     * Generate Audit Package
     * ------------------------------------------------------------------------
     */


    generateAuditPackage({

        from,

        to,

        type

    } = {}) {


        const records =

            [...this.evidence.values()]

            .filter(

                item => {


                    if (type && item.type !== type) {

                        return false;

                    }


                    if (from && item.timestamp < from) {

                        return false;

                    }


                    if (to && item.timestamp > to) {

                        return false;

                    }


                    return true;

                }

            );



        return Object.freeze({

            generatedAt:

                new Date(),


            evidenceCount:

                records.length,


            records,


            chain:

                this.chain

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Chain Of Custody Record
     * ------------------------------------------------------------------------
     */


    trackCustody({

        evidenceId,

        actor,

        action,

        reason

    }) {


        const evidence =

            this.evidence.get(

                evidenceId

            );



        if (!evidence) {


            throw new Error(

                "Evidence not found"

            );

        }



        if (!evidence.custody) {


            evidence.custody = [];

        }



        evidence.custody.push({

            actor,

            action,

            reason,

            timestamp:

                new Date()

        });



        return evidence.custody.at(-1);

    }





    /**
     * ------------------------------------------------------------------------
     * Retention Enforcement
     * ------------------------------------------------------------------------
     */


    async enforceRetention() {


        if (

            this.retentionManager

        ) {


            return await this.retentionManager.apply(

                this.evidence

            );

        }



        return {


            status:

                "RETENTION_MANAGER_UNAVAILABLE"

        };

    }





    /**
     * ------------------------------------------------------------------------
     * Forensic Search
     * ------------------------------------------------------------------------
     */


    investigate(filters = {}) {


        return [

            ...this.evidence.values()

        ]

        .filter(

            evidence => {


                if (

                    filters.type

                    &&

                    evidence.type !== filters.type

                ) {


                    return false;

                }



                if (

                    filters.source

                    &&

                    evidence.source !== filters.source

                ) {


                    return false;

                }



                return true;

            }

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Evidence Dashboard
     * ------------------------------------------------------------------------
     */


    dashboard() {


        return Object.freeze({

            totalEvidence:

                this.evidence.size,


            chainLength:

                this.chain.length,


            immutableRecords:

                [...this.evidence.values()]

                .filter(

                    item =>

                        item.status ===

                        "IMMUTABLE"

                )

                .length

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Persistence
     * ------------------------------------------------------------------------
     */


    async #persist(evidence) {


        if (

            this.storageService

            &&

            typeof this.storageService.save ===

            "function"

        ) {


            await this.storageService.save(

                evidence

            );

        }


    }





    /**
     * ------------------------------------------------------------------------
     * Event Publishing
     * ------------------------------------------------------------------------
     */


    async #publishEvent(evidence) {


        if (

            this.eventBus

            &&

            typeof this.eventBus.publish ===

            "function"

        ) {


            await this.eventBus.publish({

                type:

                    "AUDIT_EVIDENCE_CREATED",


                payload:

                    evidence

            });

        }


    }





    /**
     * ------------------------------------------------------------------------
     * Audit Logging
     * ------------------------------------------------------------------------
     */


    async audit(event) {


        if (

            this.auditLogger

        ) {


            await this.auditLogger.log(

                {

                    category:

                        "AUDIT_EVIDENCE_MANAGER",


                    event

                }

            );

        }


    }


}



module.exports =
    PaymentReliabilityAuditEvidenceManager;