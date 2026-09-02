'use strict';


class ResilienceConfigValidator {


    validate(
        config
    )
    {


        if(
            typeof config.enabled !== 'boolean'
        )
        {

            throw new Error(

                'Invalid resilience enabled flag'

            );

        }



        if(
            config.circuitBreaker
            &&
            config.circuitBreaker.failureThreshold < 1
        )
        {

            throw new Error(

                'Invalid circuit threshold'

            );

        }



        return true;

    }



}



module.exports =
    ResilienceConfigValidator;