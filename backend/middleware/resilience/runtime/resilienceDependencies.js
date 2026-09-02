'use strict';


/**
 * =============================================================================
 * Enterprise Resilience Dependency Registration
 * =============================================================================
 */


function registerDependencies(
    container,
    dependencies={}
)
{


    Object.entries(

        dependencies

    )

    .forEach(

        ([name,value])=>{


            container.register(

                name,

                value

            );


        }

    );



    return container;

}



module.exports =
{

    registerDependencies

};