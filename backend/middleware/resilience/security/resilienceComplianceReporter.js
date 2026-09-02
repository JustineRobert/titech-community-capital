'use strict';


class ResilienceComplianceReporter {


    generate(
        data
    )
    {


        return {


            reportType:

                'RESILIENCE_COMPLIANCE',


            generatedAt:

                new Date(),


            controls:

            {

                audit:

                    !!data.audit,


                accessControl:

                    !!data.accessControl,


                tenantIsolation:

                    !!data.tenantIsolation,


                financialProtection:

                    !!data.financialProtection

            }

        };

    }



}



module.exports =
    ResilienceComplianceReporter;