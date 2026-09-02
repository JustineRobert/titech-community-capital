'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Authentication Module
 * ============================================================================
 *
 * Purpose
 * -------
 * Public entry point for the Airtel Money authentication subsystem.
 *
 * Responsibilities
 * ----------------
 * • Authentication initialization
 * • OAuth token lifecycle
 * • Credential management
 * • Token caching
 * • Token refresh orchestration
 * • Health monitoring
 * • Observability
 * • Dependency composition
 *
 * Public API
 * ----------
 * initialize()
 * authenticate()
 * getAccessToken()
 * refreshToken()
 * invalidate()
 * rotateCredentials()
 * health()
 *
 * Architecture
 * ------------
 *
 * auth.js
 *    │
 *    ├── auth/
 *    │     ├── authService.js
 *    │     ├── credentialManager.js
 *    │     ├── oauthClient.js
 *    │     ├── tokenManager.js
 *    │     ├── refreshManager.js
 *    │     ├── observability.js
 *    │     └── healthMonitor.js
 *    │
 *    └── shared/
 *          ├── configuration.js
 *          ├── errors.js
 *          └── requestBuilder.js
 *
 * ============================================================================
 */

const {
    MTNConfiguration
} = require('../shared/configuration');

const AuthService =
    require('./auth/authService');

const CredentialManager =
    require('./auth/credentialManager');

const OAuthClient =
    require('./auth/oauthClient');

const TokenManager =
    require('./auth/tokenManager');

const RefreshManager =
    require('./refreshManager');

const Observability =
    require('./auth/observability');

const HealthMonitor =
    require('./auth/healthMonitor');

class AirtelAuthentication {

    constructor({

        configuration,

        credentialManager,

        tokenManager,

        oauthClient,

        refreshManager,

        observability,

        healthMonitor,

        auditService,

        logger,

        metrics,

        tracer

    } = {}) {

        this.configuration =
            configuration ||
            new MTNConfiguration();

        this.credentialManager =
            credentialManager ||
            new CredentialManager({
                configuration: this.configuration,
                logger,
                metrics,
                auditService
            });

        this.tokenManager =
            tokenManager ||
            new TokenManager({
                logger,
                metrics
            });

        this.refreshManager =
            refreshManager ||
            new RefreshManager({
                logger,
                metrics,
                tracer
            });

        this.observability =
            observability ||
            new Observability({
                logger,
                metrics,
                tracer
            });

        this.oauthClient =
            oauthClient ||
            new OAuthClient({
                configuration: this.configuration,
                logger,
                metrics,
                tracer
            });

        this.healthMonitor =
            healthMonitor ||
            new HealthMonitor({
                logger,
                metrics
            });

        this.authService =
            new AuthService({

                configuration:
                    this.configuration,

                credentialManager:
                    this.credentialManager,

                tokenManager:
                    this.tokenManager,

                oauthClient:
                    this.oauthClient,

                refreshManager:
                    this.refreshManager,

                observability:
                    this.observability,

                auditService,

                logger,

                metrics,

                tracer

            });
    }

    async initialize() {

        return this.authService.initialize();

    }

    async authenticate(options = {}) {

        return this.authService.authenticate(options);

    }

    async getAccessToken(options = {}) {

        return this.authService.getAccessToken(options);

    }

    async refreshToken(options = {}) {

        return this.authService.refreshToken(options);

    }

    async invalidate(options = {}) {

        return this.authService.invalidate(options);

    }

    async rotateCredentials(options = {}) {

        return this.authService.rotateCredentials(options);

    }

    async health() {

        return {

            provider: 'AIRTEL',

            authentication:
                await this.authService.health(),

            credentials:
                await this.credentialManager.health(),

            tokenCache:
                this.tokenManager.health(),

            refreshManager:
                this.refreshManager.health(),

            observability:
                this.observability.health?.(),

            monitor:
                await this.healthMonitor.health?.()

        };

    }

}

module.exports = AirtelAuthentication;