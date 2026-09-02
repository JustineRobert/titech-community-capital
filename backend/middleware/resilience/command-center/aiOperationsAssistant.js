'use strict';


class AIOperationsAssistant {


    constructor(
        aiEngine
    )
    {

        this.ai =
            aiEngine;

    }



    async analyze(
        question,
        context
    )
    {


        return {


            question,


            recommendation:

                await this.ai.analyze(

                    context

                ),


            generatedAt:

                new Date()


        };

    }



}



module.exports =
    AIOperationsAssistant;