'use strict';


class ResilienceStrategyAdmin {


    constructor(
        controller
    )
    {

        this.controller =
            controller;

    }



    disable(
        strategy
    )
    {

        this.controller.disable(
            strategy
        );


        return {

            disabled:true,

            strategy

        };

    }



    enable(
        strategy
    )
    {

        this.controller.enable(
            strategy
        );


        return {

            enabled:true,

            strategy

        };

    }



    status()
    {

        return this.controller.snapshot();

    }


}



module.exports =
    ResilienceStrategyAdmin;