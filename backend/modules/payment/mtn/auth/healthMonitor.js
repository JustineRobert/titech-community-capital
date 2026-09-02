'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Authentication Health Monitor
 * =============================================================================
 *
 * Purpose
 * -------
 * Continuous health intelligence layer for MTN authentication services.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ Authentication dependency monitoring
 * ✓ Token manager health checks
 * ✓ Credential manager health checks
 * ✓ OAuth provider availability checks
 * ✓ Authentication SLA tracking
 * ✓ Failure rate monitoring
 * ✓ Health state aggregation
 * ✓ Readiness/liveness reporting
 * ✓ Metrics instrumentation
 * ✓ Audit and logging hooks
 *
 *
 * Does NOT:
 *
 * ✗ Authenticate users
 * ✗ Generate tokens
 * ✗ Refresh tokens
 * ✗ Modify credentials
 * ✗ Perform payment operations
 *
 *
 * Architecture:
 *
 *
 * Kubernetes Probe
 *
 *        |
 *        ▼
 *
 * HealthMonitor
 *
 *        |
 *        +----------------+
 *        |                |
 *        ▼                ▼
 *
 * Auth Service      Credential Manager
 *
 *        |
 *        ▼
 *
 * MTN OAuth Provider
 *
 * =============================================================================
 */



class HealthMonitor {





    constructor({

        authService,

        credentialManager,

        tokenManager,

        oauthClient,

        metrics,

        logger,

        auditService,

        tracer,

        thresholds = {}

    } = {}) {



        this.authService = authService;



        this.credentialManager = credentialManager;



        this.tokenManager = tokenManager;



        this.oauthClient = oauthClient;



        this.metrics = metrics;



        this.logger = logger;



        this.auditService = auditService;



        this.tracer = tracer;







        this.thresholds = {



            maxFailureRate:

                thresholds.maxFailureRate ||

                0.20,



            maxLatencyMs:

                thresholds.maxLatencyMs ||

                3000



        };







        this.startedAt = new Date();







        this.state = {



            status:

                'UNKNOWN',



            lastCheck:

                null,



            lastHealthy:

                null,



            lastFailure:

                null,



            failures:

                0,



            checks:

                0



        };



    }









    /**
     * =========================================================================
     * Full Health Check
     * =========================================================================
     */


    async check({

        tenantId = null

    } = {}) {



        const span =

            this.tracer?.startSpan?.(

                'mtn.auth.health_check'

            );







        const started =

            Date.now();







        try {



            const results = {};







            results.credentials =

                await this.checkCredentials({

                    tenantId

                });







            results.tokenManager =

                await this.checkTokenManager();







            results.oauthProvider =

                await this.checkOAuthProvider();







            const latency =

                Date.now() - started;







            const healthy =

                Object.values(results)

                    .every(

                        result =>

                            result.status === 'UP'

                    );







            this.state.checks++;







            this.state.lastCheck =

                new Date();







            if (healthy) {



                this.state.status =

                    'UP';



                this.state.lastHealthy =

                    new Date();



                this.metrics?.counter?.(

                    'payment_mtn_auth_health_success_total'

                );



            }



            else {



                this.state.status =

                    'DEGRADED';



                this.state.failures++;



                this.state.lastFailure =

                    new Date();



                this.metrics?.counter?.(

                    'payment_mtn_auth_health_failure_total'

                );



            }

            this.metrics?.histogram?.(

                'payment_mtn_auth_health_latency_ms',

                latency

            );

            return {



                status:

                    this.state.status,



                latencyMs:

                    latency,



                provider:

                    'MTN',



                module:

                    'AUTH',



                checks:

                    results,



                timestamp:

                    new Date()



            };



        }



        catch(error) {



            this.state.status =

                'DOWN';



            this.state.failures++;



            this.state.lastFailure =

                new Date();







            this.logger?.error?.({

                message:

                    'MTN authentication health check failed',



                error

            });







            throw error;



        }



        finally {



            span?.end?.();



        }



    }

    /**
     * =========================================================================
     * Credential Dependency Check
     * =========================================================================
     */


    async checkCredentials({

        tenantId

    }) {



        try {



            if (!this.credentialManager) {



                return {



                    status:

                        'UNKNOWN',



                    message:

                        'Credential manager unavailable'



                };



            }







            return this.credentialManager.health({

                tenantId

            });



        }



        catch(error) {



            return {



                status:

                    'DOWN',



                error:

                    error.message



            };



        }



    }

    /**
     * =========================================================================
     * Token Manager Check
     * =========================================================================
     */


    async checkTokenManager() {



        try {



            if (!this.tokenManager) {



                return {



                    status:

                        'UNKNOWN',



                    message:

                        'Token manager unavailable'



                };



            }







            return {



                status:

                    'UP',



                cacheSize:

                    this.tokenManager.size?.() || 0



            };



        }



        catch(error) {



            return {



                status:

                    'DOWN',



                error:

                    error.message



            };



        }



    }

    /**
     * =========================================================================
     * OAuth Provider Availability Check
     * =========================================================================
     */


    async checkOAuthProvider() {



        try {



            if (!this.oauthClient?.health) {



                return {



                    status:

                        'UNKNOWN',



                    message:

                        'OAuth health endpoint unavailable'



                };



            }







            return this.oauthClient.health();



        }



        catch(error) {



            return {



                status:

                    'DOWN',



                error:

                    error.message



            };



        }



    }

    /**
     * =========================================================================
     * Kubernetes Liveness Probe
     * =========================================================================
     */


    async liveness() {



        return {



            status:

                'UP',



            service:

                'mtn-auth-health-monitor',



            uptimeMs:

                Date.now() -

                this.startedAt.getTime()



        };



    }

    /**
     * =========================================================================
     * Kubernetes Readiness Probe
     * =========================================================================
     */


    async readiness() {



        const healthy =

            this.state.status === 'UP';


        return {



            ready:

                healthy,



            status:

                this.state.status,



            lastHealthy:

                this.state.lastHealthy



        };



    }

    /**
     * =========================================================================
     * Publish Audit Event
     * =========================================================================
     */


    async audit({

        status,

        details = {}

    }) {



        return this.auditService?.record?.({

            action:

                'MTN_AUTH_HEALTH_CHECK',



            status,



            details



        });



    }

    /**
     * =========================================================================
     * Snapshot
     * =========================================================================
     */


    snapshot() {



        return {



            status:

                this.state.status,



            checks:

                this.state.checks,



            failures:

                this.state.failures,



            lastCheck:

                this.state.lastCheck,



            lastHealthy:

                this.state.lastHealthy,



            lastFailure:

                this.state.lastFailure



        };



    }

}

module.exports = HealthMonitor;