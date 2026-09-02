'use strict';


const ResilienceSecurityPolicy =
require('./resilienceSecurityPolicy');


const ResilienceAuditProtection =
require('./resilienceAuditProtection');


const ResilienceFinancialGuard =
require('./resilienceFinancialGuard');


const ResilienceTenantIsolation =
require('./resilienceTenantIsolation');



function bootstrapResilienceSecurity()
{


    return {


        policy:

            new ResilienceSecurityPolicy(),


        audit:

            new ResilienceAuditProtection(),


        financial:

            new ResilienceFinancialGuard(),


        tenant:

            new ResilienceTenantIsolation()

    };

}



module.exports =
{

    bootstrapResilienceSecurity

};