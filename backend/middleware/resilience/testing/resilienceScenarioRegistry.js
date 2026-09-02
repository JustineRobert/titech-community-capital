'use strict';


class ResilienceScenarioRegistry {


    constructor()
    {

        this.scenarios =
            new Map();

    }



    register(
        name,
        handler
    )
    {

        this.scenarios.set(

            name,

            handler

        );

    }



    resolve(
        name
    )
    {

        return this.scenarios.get(

            name

        );

    }



    list()
    {

        return [

            ...this.scenarios.keys()

        ];

    }



}



module.exports =
    ResilienceScenarioRegistry;