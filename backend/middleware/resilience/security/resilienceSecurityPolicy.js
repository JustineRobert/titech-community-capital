'use strict';


class ResilienceSecurityPolicy {


    constructor()
    {

        this.rules =
            new Map();

    }



    register(
        name,
        rule
    )
    {

        this.rules.set(

            name,

            rule

        );

    }




    evaluate(
        operation
    )
    {


        for(
            const rule of this.rules.values()
        )
        {

            if(
                rule(operation) === false
            )
            {

                throw new Error(

                    'Resilience security policy violation'

                );

            }

        }



        return true;

    }



}



module.exports =
    ResilienceSecurityPolicy;