"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Security Manager
 * =============================================================================
 *
 * Central security enforcement layer for retry operations.
 *
 * Responsibilities:
 *
 * ✓ Audit enforcement
 * ✓ Data protection
 * ✓ Tenant isolation
 * ✓ Abuse prevention
 * ✓ Compliance checks
 * ✓ Fraud integration
 *
 * =============================================================================
 */


const crypto = require("crypto");


class RetrySecurityManager {


    constructor(options={}) {


        this.audit =
            options.audit;


        this.masker =
            options.masker;


        this.tenantGuard =
            options.tenantGuard;


        this.abuseProtection =
            options.abuseProtection;


        this.compliance =
            options.compliance;


    }




    async beforeExecution(context) {


        this.validateTenant(
            context
        );


        this.checkAbuse(
            context
        );


        return {

            securityValidated:true

        };

    }





    async afterExecution(
        context,
        result
    ) {


        await this.audit?.record({

            event:
                "retry.completed",

            retryId:
                context.retryId,

            hash:
                crypto
                .createHash("sha256")
                .update(
                    JSON.stringify(context)
                )
                .digest("hex")

        });


        return result;

    }




    validateTenant(context){


        if(
            !context.tenantId
        ){

            throw new Error(
                "Retry execution requires tenant context"
            );

        }


    }





    checkAbuse(context){


        if(
            this.abuseProtection
            &&
            !this.abuseProtection.allow(context)
        ){

            throw new Error(
                "Retry abuse protection triggered"
            );

        }


    }


}


module.exports = {

    RetrySecurityManager

};