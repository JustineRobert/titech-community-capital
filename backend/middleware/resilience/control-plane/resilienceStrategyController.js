'use strict';


class ResilienceStrategyController {


    constructor(registry)
    {

        this.registry =
            registry;

        this.disabled =
            new Set();

    }



    disable(
        strategy
    )
    {

        this.disabled.add(strategy);

    }



    enable(
        strategy
    )
    {

        this.disabled.delete(strategy);

    }



    available(
        strategy
    )
    {

        return !

            this.disabled.has(

                strategy

            );

    }



    snapshot()
    {

        return {

            disabled:

                [

                    ...this.disabled

                ]

        };

    }



}



module.exports =
    ResilienceStrategyController;