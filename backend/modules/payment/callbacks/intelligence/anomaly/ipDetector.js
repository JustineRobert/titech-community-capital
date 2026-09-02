/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback IP Behavior Detector
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Callback Source IP Analysis
 * • Request Velocity Detection
 * • Suspicious Geographic Movement Detection
 * • Provider IP Range Validation Hooks
 * • Repeated Callback Attack Detection
 * • Source Reputation Analysis Hooks
 * • Multi-Tenant Aware
 * • Provider Independent
 * • Structured Logging
 * • Enterprise Metrics
 * • OpenTelemetry Ready
 * • Immutable Detection Results
 *
 * Purpose
 * -------
 * Detect abnormal callback source behavior that may indicate replay attacks,
 * provider infrastructure problems, automation abuse, or malicious traffic.
 *
 * Detection Rules
 * ---------------
 * • Excessive requests from one IP
 * • Suspicious geographic changes
 * • Unexpected provider IP ranges
 * • Repeated callback attacks
 * • High velocity callback traffic
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Security Signal Generator Only
 * • No Blocking Decisions
 * • No Firewall Actions
 * • Extensible
 *
 * ============================================================================
 */


const {

    DETECTOR_NAME,

    ANOMALY_CATEGORY,

    CONFIDENCE_LEVEL

} = require("./anomalyConstants");


const {

    DetectorExecutionError

} = require("./anomalyErrors");


const {

    calculatePercentage

} = require("./anomalyUtils");



class IpDetector {


    constructor({

        callbackRepository,

        ipReputationService,

        geoLocationService,

        metrics,

        logger

    } = {}) {


        this.callbackRepository =
            callbackRepository;


        this.ipReputationService =
            ipReputationService;


        this.geoLocationService =
            geoLocationService;


        this.metrics =
            metrics;


        this.logger =
            logger;

    }



    /**
     * ------------------------------------------------------------------------
     * Execute IP Detection
     * ------------------------------------------------------------------------
     */


    async detect({

        callback,

        context = {}

    }) {


        try {


            const findings =

                await this.#analyzeIpBehavior({

                    callback,

                    context

                });



            const score =

                this.#calculateScore(findings);



            const result = Object.freeze({


                detector:

                    DETECTOR_NAME.IP,


                detected:

                    score > 0,


                score,


                category:

                    ANOMALY_CATEGORY.SOURCE_IP,


                confidence:

                    this.#calculateConfidence(score),



                metadata:

                    findings,



                detectedAt:

                    new Date()


            });



            this.metrics?.increment?.(

                "ipBehaviorDetections"

            );



            this.logger?.debug?.(

                "IP detector completed",

                {


                    ip:

                        callback.ipAddress,


                    detected:

                        result.detected,


                    score


                }

            );



            return result;


        }

        catch(error) {


            throw new DetectorExecutionError(

                "IP detector execution failed.",

                {


                    detector:

                        DETECTOR_NAME.IP,


                    cause:

                        error


                }

            );


        }


    }





    /**
     * ------------------------------------------------------------------------
     * Analyze Source IP Behaviour
     * ------------------------------------------------------------------------
     */


    async #analyzeIpBehavior({

        callback,

        context

    }) {


        const findings = {


            excessiveRequests:

                false,


            suspiciousGeoChange:

                false,


            unexpectedProviderRange:

                false,


            repeatedAttackPattern:

                false,


            highVelocity:

                false,


            ipReputationRisk:

                false,


            requestCount:

                0


        };



        const ip =

            callback.ipAddress;



        if (!ip) {


            return findings;


        }



        findings.requestCount =

            await this.#requestVelocity(ip);



        findings.excessiveRequests =

            findings.requestCount > 100;



        findings.highVelocity =

            findings.requestCount > 200;



        findings.suspiciousGeoChange =

            await this.#detectGeoChange({

                callback

            });



        findings.unexpectedProviderRange =

            await this.#validateProviderIp({

                callback

            });



        findings.repeatedAttackPattern =

            await this.#detectRepeatedAttack({

                callback

            });



        findings.ipReputationRisk =

            await this.#checkIpReputation(ip);



        return findings;


    }





    /**
     * ------------------------------------------------------------------------
     * Request Velocity Detection
     * ------------------------------------------------------------------------
     */


    async #requestVelocity(ip) {


        if (

            !this.callbackRepository

        ) {


            return 0;


        }



        if (

            typeof this.callbackRepository.countByIp !==

            "function"

        ) {


            return 0;


        }



        return this.callbackRepository.countByIp({

            ip,

            windowMinutes: 1

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Geographic Movement Detection
     * ------------------------------------------------------------------------
     */


    async #detectGeoChange({

        callback

    }) {


        if (

            !this.geoLocationService

        ) {


            return false;


        }



        const previousLocation =

            await this.geoLocationService.lastKnownLocation({

                ip:

                    callback.ipAddress

            });



        if (!previousLocation) {


            return false;


        }



        return (

            previousLocation.country !==

            callback.country

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Provider IP Validation
     * ------------------------------------------------------------------------
     */


    async #validateProviderIp({

        callback

    }) {


        if (

            !this.ipReputationService

        ) {


            return false;


        }



        return this.ipReputationService.isUnexpectedProviderRange({

            provider:

                callback.provider,


            ip:

                callback.ipAddress


        });


    }





    /**
     * ------------------------------------------------------------------------
     * Repeated Attack Pattern Detection
     * ------------------------------------------------------------------------
     */


    async #detectRepeatedAttack({

        callback

    }) {


        if (

            !this.callbackRepository

        ) {


            return false;


        }



        if (

            typeof this.callbackRepository.countFailedCallbacksByIp !==

            "function"

        ) {


            return false;


        }



        const failures =

            await this.callbackRepository.countFailedCallbacksByIp({

                ip:

                    callback.ipAddress,


                windowMinutes:

                    10


            });



        return failures > 50;


    }





    /**
     * ------------------------------------------------------------------------
     * IP Reputation Check
     * ------------------------------------------------------------------------
     */


    async #checkIpReputation(ip) {


        if (

            !this.ipReputationService

        ) {


            return false;


        }



        return this.ipReputationService.isRisky(ip);


    }





    /**
     * ------------------------------------------------------------------------
     * Calculate Detection Score
     * ------------------------------------------------------------------------
     */


    #calculateScore(findings) {


        let score = 0;



        if (

            findings.excessiveRequests

        ) {


            score += 20;


        }



        if (

            findings.highVelocity

        ) {


            score += 25;


        }



        if (

            findings.suspiciousGeoChange

        ) {


            score += 15;


        }



        if (

            findings.unexpectedProviderRange

        ) {


            score += 20;


        }



        if (

            findings.repeatedAttackPattern

        ) {


            score += 30;


        }



        if (

            findings.ipReputationRisk

        ) {


            score += 25;


        }



        return Math.min(score, 100);


    }





    /**
     * ------------------------------------------------------------------------
     * Calculate Confidence
     * ------------------------------------------------------------------------
     */


    #calculateConfidence(score) {


        if (

            score >= 75

        ) {


            return CONFIDENCE_LEVEL.VERY_HIGH;


        }



        if (

            score >= 50

        ) {


            return CONFIDENCE_LEVEL.HIGH;


        }



        if (

            score >= 25

        ) {


            return CONFIDENCE_LEVEL.MODERATE;


        }



        return CONFIDENCE_LEVEL.LOW;


    }


}



module.exports = IpDetector;