'use strict';


class GlobalResilienceView {


    constructor()
    {

        this.tenants =
            new Map();

    }




    registerTenant(
        tenantId,
        resilienceState
    )
    {

        this.tenants.set(

            tenantId,

            resilienceState

        );

    }



    snapshot()
    {

        return {


            tenants:

                Array.from(

                    this.tenants.entries()

                )
                .map(

                    ([id,state])=>({

                        tenantId:id,

                        state

                    })

                ),


            count:

                this.tenants.size


        };

    }



}



module.exports =
    GlobalResilienceView;