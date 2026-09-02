'use strict';


class ResilienceFeatureFlags {


    constructor()
    {

        this.flags =
            new Map();

    }



    register(
        name,
        enabled=false
    )
    {

        this.flags.set(

            name,

            enabled

        );

    }



    enable(
        name
    )
    {

        this.flags.set(

            name,

            true

        );

    }



    disable(
        name
    )
    {

        this.flags.set(

            name,

            false

        );

    }



    isEnabled(
        name
    )
    {

        return (

            this.flags.get(name)

            ||

            false

        );

    }



    snapshot()
    {

        return Object.fromEntries(

            this.flags

        );

    }

}



module.exports =
    ResilienceFeatureFlags;