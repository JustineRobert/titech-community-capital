'use strict';


class FailureInjector {


    constructor()
    {

        this.failures =
            new Map();

    }



    inject(
        dependency,
        error
    )
    {

        this.failures.set(

            dependency,

            error

        );

    }



    clear(
        dependency
    )
    {

        this.failures.delete(

            dependency

        );

    }



    shouldFail(
        dependency
    )
    {

        return this.failures.has(

            dependency

        );

    }



    getError(
        dependency
    )
    {

        return this.failures.get(

            dependency

        );

    }



}



module.exports =
    FailureInjector;