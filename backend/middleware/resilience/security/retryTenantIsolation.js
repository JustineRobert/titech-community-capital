"use strict";


class RetryTenantIsolation {


    validate(context){


        if(
            !context.tenantId
        ){

            throw new Error(
                "Tenant isolation violation"
            );

        }



        return true;


    }


}



module.exports={

    RetryTenantIsolation

};