"use strict";


class RetryComplianceEvidence {


    generate(context){


        return {


            retryId:
                context.retryId,


            tenantId:
                context.tenantId,


            policy:
                context.policyName,


            timestamp:
                new Date(),


            controls:[

                "audit",

                "masking",

                "tenant-isolation",

                "idempotency"

            ]


        };


    }


}



module.exports={

    RetryComplianceEvidence

};