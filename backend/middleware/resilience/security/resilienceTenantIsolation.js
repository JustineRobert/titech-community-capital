'use strict';


class ResilienceTenantIsolation {


    validate(
        context,
        resource
    )
    {


        if(
            context.tenantId !==
            resource.tenantId
        )
        {

            throw new Error(

                'Tenant isolation violation'

            );

        }



        return true;

    }



}



module.exports =
    ResilienceTenantIsolation;