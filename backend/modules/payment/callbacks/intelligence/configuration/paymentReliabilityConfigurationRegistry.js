/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Configuration Registry
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Central Runtime Configuration Storage
 * • Feature Flag Management
 * • Provider Capability Registry
 * • Tenant Reliability Profiles
 * • Policy Version Management
 * • Configuration Hot Reload
 * • Configuration Validation
 * • Configuration Rollback
 * • Runtime Configuration APIs
 * • Configuration Audit Trail
 * • Multi-Tenant Support
 * • Enterprise Governance Ready
 *
 *
 * Purpose
 * -------
 * Provide centralized runtime configuration management for the payment
 * reliability intelligence platform.
 *
 *
 * Configuration Domains
 * ---------------------
 *
 * FEATURES
 * PROVIDERS
 * TENANTS
 * POLICIES
 * ALERTS
 * ESCALATION
 * FAILOVER
 *
 *
 * Processing Flow
 * ---------------
 *
 * Configuration Update
 *
 *        |
 *        ▼
 *
 * Configuration Registry
 *
 *        |
 *        ▼
 *
 * Validation Engine
 *
 *        |
 *        ▼
 *
 * Runtime Components Reload
 *
 *
 *
 * Design Principles
 * -----------------
 * • Dynamic Configuration
 * • No Service Restart Required
 * • Version Controlled
 * • Auditable Changes
 * • Safe Runtime Updates
 *
 * ============================================================================
 */


const {

    randomUUID

} = require("crypto");



class PaymentReliabilityConfigurationRegistry {


    constructor({

        repository,

        auditLogger,

        logger,

        validator

    } = {}) {


        this.repository =
            repository;


        this.auditLogger =
            auditLogger;


        this.logger =
            logger;


        this.validator =
            validator;



        this.configuration = new Map();



        this.versions = new Map();



        this.featureFlags = new Map();



        this.providerCapabilities = new Map();



        this.tenantProfiles = new Map();



    }





    /**
     * ------------------------------------------------------------------------
     * Register Configuration
     * ------------------------------------------------------------------------
     */


    async register({

        domain,

        key,

        value,

        scope = "GLOBAL"

    }) {


        this.#validate({

            domain,

            value

        });



        const config = {


            id:

                randomUUID(),


            domain,


            key,


            scope,


            value,


            version:

                1,


            active:

                true,


            createdAt:

                new Date()


        };



        this.configuration.set(

            `${domain}:${key}`,

            config

        );



        this.versions.set(

            config.id,

            [

                config

            ]

        );



        await this.#persist(

            config

        );



        return config;

    }





    /**
     * ------------------------------------------------------------------------
     * Retrieve Configuration
     * ------------------------------------------------------------------------
     */


    get({

        domain,

        key

    }) {


        return (

            this.configuration.get(

                `${domain}:${key}`

            )

            ||

            null

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Update Configuration
     * ------------------------------------------------------------------------
     */


    async update({

        domain,

        key,

        value

    }) {


        const current =

            this.get({

                domain,

                key

            });



        if (!current) {


            throw new Error(

                "Configuration does not exist"

            );

        }



        this.#validate({

            domain,

            value

        });



        const updated = {


            ...current,


            value,


            version:

                current.version + 1,


            updatedAt:

                new Date()

        };



        this.configuration.set(

            `${domain}:${key}`,

            updated

        );



        this.versions

            .get(current.id)

            .push(

                updated

            );



        await this.#audit({

            action:

                "CONFIGURATION_UPDATED",


            configuration:

                updated

        });



        return updated;

    }





    /**
     * ------------------------------------------------------------------------
     * Feature Flag Management
     * ------------------------------------------------------------------------
     */


    setFeatureFlag({

        name,

        enabled,

        metadata = {}

    }) {


        const flag = {


            name,


            enabled,


            metadata,


            updatedAt:

                new Date()

        };



        this.featureFlags.set(

            name,

            flag

        );



        return flag;

    }





    isFeatureEnabled(name) {


        return Boolean(

            this.featureFlags.get(name)

                ?.enabled

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Provider Capability Registry
     * ------------------------------------------------------------------------
     */


    registerProviderCapability({

        provider,

        capabilities

    }) {


        const record = {


            provider,


            capabilities,


            updatedAt:

                new Date()

        };



        this.providerCapabilities.set(

            provider,

            record

        );



        return record;

    }





    getProviderCapabilities(provider) {


        return (

            this.providerCapabilities.get(

                provider

            )

            ||

            null

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Tenant Reliability Profiles
     * ------------------------------------------------------------------------
     */


    registerTenantProfile({

        tenantId,

        profile

    }) {


        const record = {


            tenantId,


            profile,


            updatedAt:

                new Date()

        };



        this.tenantProfiles.set(

            tenantId,

            record

        );



        return record;

    }





    getTenantProfile(tenantId) {


        return (

            this.tenantProfiles.get(

                tenantId

            )

            ||

            null

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Hot Reload Configuration
     * ------------------------------------------------------------------------
     */


    async reload({

        domain,

        key,

        value

    }) {


        return this.update({

            domain,

            key,

            value

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Rollback Configuration
     * ------------------------------------------------------------------------
     */


    rollback({

        configurationId,

        version

    }) {


        const history =

            this.versions.get(

                configurationId

            );



        if (!history) {


            throw new Error(

                "Configuration history unavailable"

            );

        }



        const target =

            history.find(

                item =>

                    item.version === version

            );



        if (!target) {


            throw new Error(

                "Configuration version not found"

            );

        }



        this.configuration.set(

            `${target.domain}:${target.key}`,

            target

        );



        return target;

    }





    /**
     * ------------------------------------------------------------------------
     * Validation
     * ------------------------------------------------------------------------
     */


    #validate({

        domain,

        value

    }) {


        if (

            !domain

        ) {


            throw new Error(

                "Configuration domain required"

            );

        }



        if (

            this.validator

        ) {


            this.validator.validate({

                domain,

                value

            });


        }


    }





    /**
     * ------------------------------------------------------------------------
     * Snapshot
     * ------------------------------------------------------------------------
     */


    snapshot() {


        return Object.freeze({

            configurations:

                this.configuration.size,


            featureFlags:

                this.featureFlags.size,


            providers:

                this.providerCapabilities.size,


            tenants:

                this.tenantProfiles.size

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Persistence
     * ------------------------------------------------------------------------
     */


    async #persist(config) {


        if (

            !this.repository

        ) {


            return;

        }



        await this.repository.save(

            config

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Audit
     * ------------------------------------------------------------------------
     */


    async #audit(event) {


        if (

            !this.auditLogger

        ) {


            return;

        }



        await this.auditLogger.log(

            event

        );


    }


}



module.exports =
    PaymentReliabilityConfigurationRegistry;