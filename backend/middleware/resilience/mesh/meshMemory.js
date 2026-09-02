"use strict";

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Universal Resilience Intelligence Mesh
 *
 * Enterprise Mesh Memory Layer
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Distributed resilience memory
 * ✓ Event history storage
 * ✓ Knowledge retention
 * ✓ State reconstruction
 * ✓ Incident memory
 * ✓ Learning feedback storage
 * ✓ Historical topology intelligence
 *
 * ============================================================================
 */


const crypto = require("crypto");


/**
 * ============================================================================
 * Memory Constants
 * ============================================================================
 */


const MEMORY_TYPE = Object.freeze({

    EVENT:
        "EVENT",

    STATE:
        "STATE",

    INCIDENT:
        "INCIDENT",

    TOPOLOGY:
        "TOPOLOGY",

    KNOWLEDGE:
        "KNOWLEDGE",

    FEEDBACK:
        "FEEDBACK"

});


const MEMORY_STATE = Object.freeze({

    ACTIVE:
        "ACTIVE",

    ARCHIVED:
        "ARCHIVED",

    EXPIRED:
        "EXPIRED"

});



function createMemoryId(prefix="memory") {

    return `${prefix}-${crypto.randomUUID()}`;

}



/**
 * ============================================================================
 * Enterprise Mesh Memory
 * ============================================================================
 */


class MeshMemory {


    constructor(options = {}) {


        this.options = Object.freeze({

            maxHistory:

                options.maxHistory || 10000,


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
         * Memory Stores
         */


        this.events =
            new Map();



        this.states =
            new Map();



        this.incidents =
            new Map();



        this.topologyHistory =
            new Map();



        this.knowledge =
            new Map();



        this.feedback =
            new Map();



        this.statistics = {


            memoriesCreated:0,

            eventsStored:0,

            incidentsStored:0,

            reconstructions:0,

            knowledgeEntries:0


        };


    }





    /**
     * ========================================================================
     * Store Memory
     * ========================================================================
     */


    store(

        type,

        payload,

        metadata = {}

    ) {


        const record = Object.freeze({


            id:

                createMemoryId(),


            type,


            payload:

                Object.freeze({

                    ...payload

                }),


            metadata:

                Object.freeze({

                    ...metadata

                }),


            state:

                MEMORY_STATE.ACTIVE,


            createdAt:

                this.clock()


        });



        switch(type){


            case MEMORY_TYPE.EVENT:

                this.events.set(

                    record.id,

                    record

                );

                this.statistics.eventsStored++;

                break;



            case MEMORY_TYPE.STATE:

                this.states.set(

                    record.id,

                    record

                );

                break;



            case MEMORY_TYPE.INCIDENT:

                this.incidents.set(

                    record.id,

                    record

                );

                this.statistics.incidentsStored++;

                break;



            case MEMORY_TYPE.TOPOLOGY:

                this.topologyHistory.set(

                    record.id,

                    record

                );

                break;



            case MEMORY_TYPE.KNOWLEDGE:

                this.knowledge.set(

                    record.id,

                    record

                );

                this.statistics.knowledgeEntries++;

                break;



            case MEMORY_TYPE.FEEDBACK:

                this.feedback.set(

                    record.id,

                    record

                );

                break;


            default:

                throw new Error(
                    "Unknown memory type."
                );


        }



        this.statistics.memoriesCreated++;



        return record;


    }





    /**
     * ========================================================================
     * Store Event History
     * ========================================================================
     */


    rememberEvent(event){


        return this.store(

            MEMORY_TYPE.EVENT,

            event

        );


    }





    /**
     * ========================================================================
     * Store Incident Memory
     * ========================================================================
     */


    rememberIncident(incident){


        return this.store(

            MEMORY_TYPE.INCIDENT,

            incident

        );


    }





    /**
     * ========================================================================
     * Save Mesh State
     * ========================================================================
     */


    saveState(state){


        return this.store(

            MEMORY_TYPE.STATE,

            state

        );


    }





    /**
     * ========================================================================
     * Historical Topology
     * ========================================================================
     */


    rememberTopology(topology){


        return this.store(

            MEMORY_TYPE.TOPOLOGY,

            topology

        );


    }





    /**
     * ========================================================================
     * Knowledge Retention
     * ========================================================================
     */


    retainKnowledge(

        knowledge

    ){


        return this.store(

            MEMORY_TYPE.KNOWLEDGE,

            knowledge

        );


    }





    /**
     * ========================================================================
     * Learning Feedback
     * ========================================================================
     */


    recordFeedback(feedback){


        return this.store(

            MEMORY_TYPE.FEEDBACK,

            feedback

        );


    }





    /**
     * ========================================================================
     * Query Memory
     * ========================================================================
     */


    query(type, filter={}) {


        let source;



        switch(type){


            case MEMORY_TYPE.EVENT:

                source=this.events;

                break;


            case MEMORY_TYPE.STATE:

                source=this.states;

                break;


            case MEMORY_TYPE.INCIDENT:

                source=this.incidents;

                break;


            case MEMORY_TYPE.TOPOLOGY:

                source=this.topologyHistory;

                break;


            case MEMORY_TYPE.KNOWLEDGE:

                source=this.knowledge;

                break;


            case MEMORY_TYPE.FEEDBACK:

                source=this.feedback;

                break;


            default:

                return [];

        }



        return Object.freeze(

            [...source.values()]
                .filter(item => {


                    if (!filter.from) {

                        return true;

                    }


                    return (

                        item.createdAt >=

                        filter.from

                    );


                })

        );


    }





    /**
     * ========================================================================
     * State Reconstruction
     * ========================================================================
     */


    reconstructState(timestamp){


        this.statistics.reconstructions++;



        const states =

            [...this.states.values()]

                .filter(state =>

                    state.createdAt <= timestamp

                )

                .sort(

                    (a,b)=>

                        b.createdAt -
                        a.createdAt

                );



        return states[0] || null;


    }





    /**
     * ========================================================================
     * Memory Snapshot
     * ========================================================================
     */


    snapshot(){


        return Object.freeze({


            events:

                this.events.size,


            states:

                this.states.size,


            incidents:

                this.incidents.size,


            topology:

                this.topologyHistory.size,


            knowledge:

                this.knowledge.size,


            feedback:

                this.feedback.size,


            statistics:

                Object.freeze({

                    ...this.statistics

                }),


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

            memory:

                this.snapshot(),


            timestamp:

                this.clock()

        });


    }


}



module.exports = {


    MeshMemory,

    MEMORY_TYPE,

    MEMORY_STATE

};