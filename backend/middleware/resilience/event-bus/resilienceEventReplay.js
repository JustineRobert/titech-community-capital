'use strict';


class ResilienceEventReplay {


    constructor(
        store,
        bus
    )
    {

        this.store =
            store;


        this.bus =
            bus;

    }





    async replay(
        filter={}
    )
    {


        const events =
            await this.store.find(

                filter

            );



        for(
            const event of events || []
        )
        {

            this.bus.publish(

                event

            );

        }



        return events;

    }



}



module.exports =
    ResilienceEventReplay;