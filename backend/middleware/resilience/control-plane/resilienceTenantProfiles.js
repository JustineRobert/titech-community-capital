'use strict';


class ResilienceTenantProfiles {


    constructor()
    {

        this.profiles =
            new Map();

    }



    register(
        tenantId,
        profile
    )
    {


        this.profiles.set(

            tenantId,

            Object.freeze(profile)

        );

    }



    resolve(
        tenantId
    )
    {

        return this.profiles.get(

            tenantId

        );

    }



    remove(
        tenantId
    )
    {

        return this.profiles.delete(

            tenantId

        );

    }



}



module.exports =
    ResilienceTenantProfiles;