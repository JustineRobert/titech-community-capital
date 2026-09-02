'use strict';


class ResilienceLearningEngine {


    constructor()
    {

        this.history=[];

    }



    learn(
        decision,
        result
    )
    {

        this.history.push({

            decision,

            result,

            timestamp:

                new Date()

        });

    }



    knowledge()
    {

        return [

            ...this.history

        ];

    }



}



module.exports =
    ResilienceLearningEngine;