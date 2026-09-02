'use strict';


class ResilienceAgentRegistry {


    constructor()
    {

        this.agents =
            new Map();

    }



    register(
        name,
        agent
    )
    {

        this.agents.set(

            name,

            agent

        );

    }



    resolve(
        name
    )
    {

        return this.agents.get(

            name

        );

    }



    list()
    {

        return Array.from(

            this.agents.keys()

        );

    }



}



module.exports =
    ResilienceAgentRegistry;