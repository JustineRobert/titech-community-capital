'use strict';


class DependencySimulator {


    constructor(
        injector
    )
    {

        this.injector =
            injector;

    }



    simulateFailure(
        dependency
    )
    {


        this.injector.inject(

            dependency,

            new Error(

                `${dependency} unavailable`

            )

        );

    }



    restore(
        dependency
    )
    {

        this.injector.clear(

            dependency

        );

    }



}



module.exports =
    DependencySimulator;