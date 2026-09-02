"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Universal Resilience Fabric
 * Fabric Registry Engine
 *
 * Responsibilities:
 *
 * - Fabric module registration
 * - Capability discovery
 * - Dependency resolution
 * - Topology awareness
 * - Registry snapshots
 *
 * ============================================================================
 */


const REGISTRY_STATE = Object.freeze({

    CREATED:
        "CREATED",

    ACTIVE:
        "ACTIVE",

    STOPPED:
        "STOPPED"

});


const MODULE_STATE = Object.freeze({

    REGISTERED:
        "REGISTERED",

    AVAILABLE:
        "AVAILABLE",

    DEGRADED:
        "DEGRADED",

    OFFLINE:
        "OFFLINE"

});


const SNAPSHOT_VERSION =
    "1.0.0";



function createId(prefix) {

    return (

        `${prefix}_${crypto.randomUUID()}`

    );

}



class FabricRegistry {


    constructor(options = {}) {


        this.state =
            REGISTRY_STATE.CREATED;


        this.clock =
            options.clock ||

            (() => new Date());


        this.logger =
            options.logger ||

            console;



        this.modules =
            new Map();



        this.capabilities =
            new Map();



        this.dependencies =
            new Map();



        this.topology =
            new Map();



        this.snapshots =
            new Map();



        this.metrics =
            {

                modulesRegistered:
                    0,

                capabilitiesRegistered:
                    0,

                dependencyResolutions:
                    0

            };


    }



    /* =========================================================================
     * Lifecycle
     * ========================================================================= */


    initialize() {


        this.state =
            REGISTRY_STATE.ACTIVE;


        return this;

    }



    stop() {


        this.state =
            REGISTRY_STATE.STOPPED;


        return this;

    }



    /* =========================================================================
     * Module Registration
     * ========================================================================= */


    registerModule(options = {}) {


        if (!options.name) {

            throw new Error(
                "Module name required"
            );

        }



        const module =
            Object.freeze({

                id:
                    createId(
                        "module"
                    ),


                name:
                    options.name,


                version:
                    options.version ||
                    "1.0.0",


                type:
                    options.type ||
                    "FABRIC_COMPONENT",


                state:
                    MODULE_STATE.REGISTERED,


                metadata:

                    Object.freeze(
                        options.metadata || {}
                    ),


                registeredAt:
                    this.clock()

            });



        this.modules.set(

            module.name,

            module

        );



        this.metrics.modulesRegistered++;



        return module;

    }



    unregisterModule(name) {


        const removed =
            this.modules.delete(
                name
            );


        return Object.freeze({

            removed,

            name,

            timestamp:
                this.clock()

        });

    }



    /* =========================================================================
     * Capability Registry
     * ========================================================================= */


    registerCapability(options = {}) {


        const capability =
            Object.freeze({

                id:
                    createId(
                        "capability"
                    ),


                name:
                    options.name,


                module:
                    options.module,


                version:
                    options.version ||
                    "1.0.0",


                metadata:

                    Object.freeze(
                        options.metadata || {}
                    ),


                createdAt:
                    this.clock()

            });



        this.capabilities.set(

            capability.name,

            capability

        );



        this.metrics.capabilitiesRegistered++;



        return capability;

    }



    discoverCapability(name) {


        return (

            this.capabilities.get(name) ||

            null

        );

    }



    listCapabilities() {


        return Object.freeze(

            [

                ...this.capabilities.values()

            ]

        );

    }



    /* =========================================================================
     * Dependency Resolution
     * ========================================================================= */


    registerDependency(
        module,
        dependency
    ) {


        this.dependencies.set(

            module,

            dependency

        );


        return Object.freeze({

            module,

            dependency,

            registeredAt:
                this.clock()

        });

    }



    resolveDependencies(module) {


        const dependency =

            this.dependencies.get(
                module
            );


        this.metrics
            .dependencyResolutions++;


        return dependency || [];

    }



    /* =========================================================================
     * Topology Awareness
     * ========================================================================= */


    updateTopology(
        module,
        metadata = {}
    ) {


        const topology =
            Object.freeze({

                module,

                metadata:

                    Object.freeze(
                        metadata
                    ),


                updatedAt:
                    this.clock()

            });



        this.topology.set(

            module,

            topology

        );


        return topology;

    }



    topologySnapshot() {


        return Object.freeze(

            [

                ...this.topology.values()

            ]

        );

    }



    /* =========================================================================
     * Snapshot
     * ========================================================================= */


    snapshot() {


        const snapshot =
            Object.freeze({

                id:
                    createId(
                        "registry_snapshot"
                    ),


                version:
                    SNAPSHOT_VERSION,


                modules:

                    Object.freeze(

                        [

                            ...this.modules.values()

                        ]

                    ),


                capabilities:

                    this.listCapabilities(),


                topology:

                    this.topologySnapshot(),


                createdAt:
                    this.clock()

            });



        this.snapshots.set(

            snapshot.id,

            snapshot

        );


        return snapshot;

    }



}


module.exports =
    FabricRegistry;