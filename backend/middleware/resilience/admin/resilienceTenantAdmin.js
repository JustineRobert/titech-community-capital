'use strict';


class ResilienceTenantAdmin {


    constructor(
        profiles
    )
    {

        this.profiles =
            profiles;

    }



    create(
        tenantId,
        profile
    )
    {

        return this.profiles.register(

            tenantId,

            profile

        );

    }



    get(
        tenantId
    )
    {

        return this.profiles.resolve(

            tenantId

        );

    }



    remove(
        tenantId
    )
    {

        return this.profiles.remove(

            tenantId

        );

    }


}



module.exports =
    ResilienceTenantAdmin;