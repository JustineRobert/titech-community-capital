'use strict';


class ResilienceRegulatoryControls {


    constructor()
    {

        this.controls =
        {

            immutableAudit:true,

            segregationOfDuties:true,

            transactionProtection:true,

            dataIsolation:true

        };

    }



    validate()
    {

        return {

            compliant:

                Object.values(
                    this.controls
                )
                .every(Boolean),


            controls:

                this.controls

        };

    }



}



module.exports =
    ResilienceRegulatoryControls;