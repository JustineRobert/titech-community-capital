'use strict';


class ResiliencePolicyManager {


    constructor(policyEngine)
    {

        this.policyEngine =
            policyEngine;

    }



    updatePolicy(
        name,
        policy
    )
    {


        return this.policyEngine
            .registerPolicy(

                name,

                policy

            );

    }



    removePolicy(
        name
    )
    {

        return this.policyEngine
            .policies
            .delete(

                name

            );

    }



    list()
    {

        return [

            ...this.policyEngine
                .policies
                .keys()

        ];

    }



}



module.exports =
    ResiliencePolicyManager;