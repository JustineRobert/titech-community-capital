'use strict';


class IncidentRemediationEngine {


    constructor(
        actions
    )
    {

        this.actions =
            actions;

    }



    async remediate(
        incident
    )
    {


        const action =
            this.actions.resolve(

                incident.type

            );



        if(action)
        {

            return action(

                incident

            );

        }



        return {

            status:

                'NO_REMEDIATION'

        };

    }



}



module.exports =
    IncidentRemediationEngine;