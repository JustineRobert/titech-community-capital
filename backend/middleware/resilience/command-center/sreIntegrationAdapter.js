'use strict';


class SREIntegrationAdapter {


    constructor()
    {

        this.handlers=[];

    }



    register(
        handler
    )
    {

        this.handlers.push(handler);

    }




    publish(
        event
    )
    {

        for(
            const handler of this.handlers
        )
        {

            handler(event);

        }

    }



}



module.exports =
    SREIntegrationAdapter;