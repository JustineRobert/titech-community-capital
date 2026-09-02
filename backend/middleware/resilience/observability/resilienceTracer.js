'use strict';


class ResilienceTracer {


    constructor(
        tracer
    )
    {

        this.tracer =
            tracer;

    }



    start(
        operation,
        attributes={}
    )
    {


        if(!this.tracer)
        {

            return {

                end(){}

            };

        }



        return this.tracer.startSpan(

            operation,

            {

                attributes:

                    {

                        component:

                            'resilience',

                        ...attributes

                    }

            }

        );

    }



}



module.exports =
    ResilienceTracer;