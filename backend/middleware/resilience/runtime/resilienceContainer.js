'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * Enterprise Resilience Dependency Container
 *
 * Responsibilities:
 *
 * ✓ Singleton storage
 * ✓ Dependency registration
 * ✓ Dependency resolution
 * ✓ Runtime isolation
 * ✓ Lifecycle ownership
 *
 * =============================================================================
 */


class ResilienceContainer {


    constructor()
    {

        this.dependencies =
            new Map();


        this.instances =
            new Map();


        this.lifecycle =
        {

            initialized:false,

            shutdown:false

        };

    }



    register(
        name,
        dependency
    )
    {

        if(
            this.dependencies.has(name)
        )
        {

            throw new Error(

                `Resilience dependency already registered: ${name}`

            );
        }



        this.dependencies.set(

            name,

            dependency

        );


        return dependency;

    }



    singleton(
        name,
        factory
    )
    {


        if(
            this.instances.has(name)
        )
        {

            return this.instances.get(name);

        }



        const instance =
            factory();



        this.instances.set(

            name,

            instance

        );



        return instance;

    }



    resolve(
        name
    )
    {


        if(
            this.instances.has(name)
        )
        {

            return this.instances.get(name);

        }



        if(
            this.dependencies.has(name)
        )
        {

            return this.dependencies.get(name);

        }



        throw new Error(

            `Resilience dependency not found: ${name}`

        );
    }



    has(
        name
    )
    {

        return (

            this.instances.has(name)

            ||

            this.dependencies.has(name)

        );
    }



    snapshot()
    {

        return {

            dependencies:

                [

                    ...this.dependencies.keys()

                ],


            instances:

                [

                    ...this.instances.keys()

                ],


            lifecycle:

                this.lifecycle

        };

    }



    shutdown()
    {

        this.instances.clear();

        this.dependencies.clear();


        this.lifecycle.shutdown =
            true;

    }

}



module.exports =
    ResilienceContainer;