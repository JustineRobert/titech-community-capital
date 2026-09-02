'use strict';


class SelfHealingWorkflowEngine {


    constructor()
    {

        this.workflows =
            new Map();

    }




    register(
        name,
        steps
    )
    {

        this.workflows.set(

            name,

            steps

        );

    }





    async execute(
        name,
        context
    )
    {


        const steps =
            this.workflows.get(

                name

            );



        const results=[];



        for(
            const step of steps || []
        )
        {

            results.push(

                await step(context)

            );

        }



        return results;

    }



}



module.exports =
    SelfHealingWorkflowEngine;