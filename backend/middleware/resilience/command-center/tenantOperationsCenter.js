'use strict';


class TenantOperationsCenter {


    constructor()
    {

        this.operations =
            new Map();

    }




    register(
        tenantId,
        operation
    )
    {

        this.operations.set(

            tenantId,

            operation

        );

    }




    get(
        tenantId
    )
    {

        return this.operations.get(

            tenantId

        );

    }



}



module.exports =
    TenantOperationsCenter;