'use strict';


class IncidentWorkflowManager {


    constructor()
    {

        this.workflows =
            {};

    }



    register(
        severity,
        workflow
    )
    {

        this.workflows[severity] =
            workflow;

    }



    execute(
        incident
    )
    {


        const workflow =
            this.workflows[
                incident.severity
            ];



        if(workflow)
        {

            return workflow(
                incident
            );

        }



        return null;

    }



}



module.exports =
    IncidentWorkflowManager;