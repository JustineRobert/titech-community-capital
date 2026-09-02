'use strict';


class ResiliencePolicyAdmin {


    constructor(
        policyManager
    )
    {

        this.policyManager =
            policyManager;

    }



    create(
        name,
        policy
    )
    {

        return this.policyManager
            .updatePolicy(

                name,

                policy

            );

    }



    delete(
        name
    )
    {

        return this.policyManager
            .removePolicy(

                name

            );

    }



    list()
    {

        return this.policyManager
            .list();

    }


}



module.exports =
    ResiliencePolicyAdmin;