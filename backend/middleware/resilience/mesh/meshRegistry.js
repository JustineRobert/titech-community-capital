"use strict";

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Universal Resilience Intelligence Mesh
 *
 * Enterprise Mesh Registry & Federation Layer
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Global mesh registry
 * ✓ Cross-mesh discovery
 * ✓ Federation membership
 * ✓ Sovereign mesh domains
 * ✓ Trust federation
 * ✓ Capability exchange
 * ✓ Multi-mesh topology awareness
 *
 * ============================================================================
 */


const crypto = require("crypto");



/**
 * ============================================================================
 * Federation Constants
 * ============================================================================
 */


const MESH_STATE = Object.freeze({

    REGISTERED:
        "REGISTERED",

    ACTIVE:
        "ACTIVE",

    DEGRADED:
        "DEGRADED",

    ISOLATED:
        "ISOLATED",

    REVOKED:
        "REVOKED"

});



const FEDERATION_STATE = Object.freeze({

    CREATED:
        "CREATED",

    ACTIVE:
        "ACTIVE",

    SUSPENDED:
        "SUSPENDED",

    CLOSED:
        "CLOSED"

});



const TRUST_STATE = Object.freeze({

    UNKNOWN:
        "UNKNOWN",

    VERIFIED:
        "VERIFIED",

    TRUSTED:
        "TRUSTED",

    BLOCKED:
        "BLOCKED"

});



function createId(prefix="mesh") {

    return `${prefix}-${crypto.randomUUID()}`;

}





/**
 * ============================================================================
 * Enterprise Mesh Registry
 * ============================================================================
 */


class MeshRegistry {


    constructor(options={}) {


        this.options = Object.freeze({

            organization:

                options.organization ||

                "Global Resilience Federation",


            logger:

                options.logger || console,


            clock:

                options.clock ||

                (()=>new Date())

        });



        this.logger =
            this.options.logger;


        this.clock =
            this.options.clock;



        /**
         * Registered Mesh Domains
         */


        this.meshes =
            new Map();



        /**
         * Federation Registry
         */


        this.federations =
            new Map();



        /**
         * Capability Registry
         */


        this.capabilities =
            new Map();



        /**
         * Trust Federation
         */


        this.trust =
            new Map();



        /**
         * Federation Topology
         */


        this.topology =
            new Map();



        /**
         * Discovery Cache
         */


        this.discovery =
            new Map();



        this.statistics = {


            meshesRegistered:0,

            federationsCreated:0,

            discoveries:0,

            trustRelations:0,

            capabilityExchanges:0


        };


    }





    /**
     * ========================================================================
     * Register Mesh Domain
     * ========================================================================
     */


    registerMesh(mesh={}) {


        if (!mesh.id) {

            throw new Error(
                "Mesh id required."
            );

        }



        const record = Object.freeze({


            id:

                mesh.id,


            name:

                mesh.name || mesh.id,


            domain:

                mesh.domain ||

                "default",


            organization:

                mesh.organization || null,


            state:

                MESH_STATE.REGISTERED,


            capabilities:

                Object.freeze([

                    ...(mesh.capabilities || [])

                ]),


            createdAt:

                this.clock()


        });



        this.meshes.set(

            record.id,

            record

        );



        this.statistics.meshesRegistered++;



        return record;

    }





    /**
     * ========================================================================
     * Update Mesh State
     * ========================================================================
     */


    updateMeshState(

        meshId,

        state

    ){


        const mesh =
            this.meshes.get(meshId);



        if (!mesh) {

            throw new Error(
                "Unknown mesh."
            );

        }



        const updated = Object.freeze({

            ...mesh,

            state

        });



        this.meshes.set(

            meshId,

            updated

        );



        return updated;


    }





    /**
     * ========================================================================
     * Create Federation
     * ========================================================================
     */


    createFederation(config={}) {


        const federation = Object.freeze({


            id:

                createId(
                    "federation"
                ),


            name:

                config.name ||

                "global-federation",


            members:

                Object.freeze([

                    ...(config.members || [])

                ]),


            state:

                FEDERATION_STATE.CREATED,


            createdAt:

                this.clock()


        });



        this.federations.set(

            federation.id,

            federation

        );



        this.statistics.federationsCreated++;



        return federation;


    }





    /**
     * ========================================================================
     * Join Federation
     * ========================================================================
     */


    joinFederation(

        federationId,

        meshId

    ){


        const federation =

            this.federations.get(

                federationId

            );



        const mesh =

            this.meshes.get(

                meshId

            );



        if (!federation || !mesh) {

            throw new Error(
                "Invalid federation membership."
            );

        }



        const updated = Object.freeze({


            ...federation,


            members:

                Object.freeze([

                    ...new Set([

                        ...federation.members,

                        meshId

                    ])

                ]),


            state:

                FEDERATION_STATE.ACTIVE

        });



        this.federations.set(

            federationId,

            updated

        );



        return updated;


    }





    /**
     * ========================================================================
     * Cross Mesh Discovery
     * ========================================================================
     */


    discoverMesh(query={}) {


        const result =

            [...this.meshes.values()]

            .filter(mesh => {


                if (!query.domain) {

                    return true;

                }


                return (

                    mesh.domain ===

                    query.domain

                );


            });



        this.statistics.discoveries++;



        return Object.freeze(result);


    }





    /**
     * ========================================================================
     * Capability Exchange
     * ========================================================================
     */


    exchangeCapabilities(

        meshId,

        capabilities=[]

    ){


        this.capabilities.set(

            meshId,

            Object.freeze([

                ...capabilities

            ])

        );



        this.statistics.capabilityExchanges++;



        return {

            meshId,

            capabilities

        };


    }





    /**
     * ========================================================================
     * Trust Federation
     * ========================================================================
     */


    establishTrust({

        source,

        target,

        level=TRUST_STATE.TRUSTED

    }) {


        const relation = Object.freeze({


            id:

                createId(
                    "trust"
                ),


            source,


            target,


            level,


            createdAt:

                this.clock()


        });



        this.trust.set(

            relation.id,

            relation

        );



        this.statistics.trustRelations++;



        return relation;


    }





    /**
     * ========================================================================
     * Topology Awareness
     * ========================================================================
     */


    updateTopology(snapshot){


        this.topology.set(

            snapshot.id ||

            createId(
                "topology"
            ),


            Object.freeze({

                ...snapshot,

                updatedAt:

                    this.clock()

            })

        );


        return true;


    }





    /**
     * ========================================================================
     * Registry Snapshot
     * ========================================================================
     */


    snapshot(){


        return Object.freeze({


            meshes:

                this.meshes.size,


            federations:

                this.federations.size,


            trustRelations:

                this.trust.size,


            capabilities:

                this.capabilities.size,


            topology:

                this.topology.size,


            timestamp:

                this.clock()


        });


    }





    /**
     * ========================================================================
     * Diagnostics
     * ========================================================================
     */


    diagnostics(){


        return Object.freeze({


            registry:

                this.snapshot(),


            statistics:

                Object.freeze({

                    ...this.statistics

                }),


            timestamp:

                this.clock()


        });


    }


}



module.exports = {


    MeshRegistry,


    MESH_STATE,


    FEDERATION_STATE,


    TRUST_STATE


};