"use strict";

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Universal Resilience Intelligence Mesh
 *
 * Enterprise Mesh Protocol Layer
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Protocol version management
 * ✓ Capability negotiation
 * ✓ Message envelopes
 * ✓ Handshake lifecycle
 * ✓ Compatibility validation
 * ✓ Secure communication contracts
 * ✓ Federation communication foundation
 *
 * ============================================================================
 */


const crypto = require("crypto");


/**
 * ============================================================================
 * Protocol Constants
 * ============================================================================
 */

const PROTOCOL_VERSION = "1.0.0";


const PROTOCOL_STATE = Object.freeze({

    CREATED: "CREATED",

    NEGOTIATING: "NEGOTIATING",

    ESTABLISHED: "ESTABLISHED",

    DEGRADED: "DEGRADED",

    CLOSED: "CLOSED",

    FAILED: "FAILED"

});


const MESSAGE_TYPE = Object.freeze({

    HANDSHAKE:
        "HANDSHAKE",

    HANDSHAKE_RESPONSE:
        "HANDSHAKE_RESPONSE",

    EVENT:
        "EVENT",

    COMMAND:
        "COMMAND",

    QUERY:
        "QUERY",

    RESPONSE:
        "RESPONSE",

    HEARTBEAT:
        "HEARTBEAT"

});


/**
 * ============================================================================
 * UUID Helper
 * ============================================================================
 */

function createProtocolId(prefix = "protocol") {

    return `${prefix}-${crypto.randomUUID()}`;

}


/**
 * ============================================================================
 * Mesh Protocol
 * ============================================================================
 */

class MeshProtocol {


    constructor(options = {}) {


        this.options = Object.freeze({

            version:
                options.version ||
                PROTOCOL_VERSION,


            capabilities:

                Object.freeze([

                    ...(options.capabilities || [])

                ]),


            logger:

                options.logger ||
                console,


            clock:

                options.clock ||
                (() => new Date())

        });


        this.logger =
            this.options.logger;


        this.clock =
            this.options.clock;


        this.sessions =
            new Map();


        this.statistics = {


            messagesCreated: 0,

            handshakesStarted: 0,

            handshakesCompleted: 0,

            compatibilityFailures: 0,

            errors: 0


        };


    }


    /**
     * ========================================================================
     * Create Message Envelope
     * ========================================================================
     */


    createEnvelope({

        type,

        source,

        destination,

        payload = {},

        metadata = {}

    }) {


        const envelope = Object.freeze({


            id:
                createProtocolId("message"),


            version:
                this.options.version,


            type,


            source,

            destination,


            payload:


                Object.freeze({

                    ...payload

                }),


            metadata:


                Object.freeze({

                    ...metadata

                }),


            timestamp:

                this.clock()


        });


        this.statistics.messagesCreated++;


        return envelope;

    }



    /**
     * ========================================================================
     * Start Handshake
     * ========================================================================
     */


    initiateHandshake(remoteNode) {


        if (!remoteNode?.id) {

            throw new Error(
                "Remote node identity required."
            );

        }


        const session = {


            id:

                createProtocolId(
                    "session"
                ),


            remoteNode:

                remoteNode.id,


            state:

                PROTOCOL_STATE.NEGOTIATING,


            localVersion:

                this.options.version,


            remoteVersion:

                null,


            createdAt:

                this.clock()

        };


        this.sessions.set(

            session.id,

            session

        );


        this.statistics.handshakesStarted++;


        return this.createEnvelope({

            type:

                MESSAGE_TYPE.HANDSHAKE,


            source:

                "mesh",


            destination:

                remoteNode.id,


            payload:


                {


                    version:

                        this.options.version,


                    capabilities:

                        this.options.capabilities


                }

        });


    }



    /**
     * ========================================================================
     * Process Handshake
     * ========================================================================
     */


    processHandshake(message) {


        const remoteCapabilities =

            message.payload?.capabilities || [];


        const remoteVersion =

            message.payload?.version;



        const compatibility =

            this.validateCompatibility({

                version:
                    remoteVersion,


                capabilities:
                    remoteCapabilities

            });



        if (!compatibility.compatible) {


            this.statistics.compatibilityFailures++;


            return Object.freeze({


                accepted: false,


                reason:

                    compatibility.reason


            });


        }



        this.statistics.handshakesCompleted++;



        return Object.freeze({


            accepted: true,


            protocolVersion:

                this.options.version,


            capabilities:

                this.negotiateCapabilities(

                    remoteCapabilities

                )


        });


    }



    /**
     * ========================================================================
     * Capability Negotiation
     * ========================================================================
     */


    negotiateCapabilities(remoteCapabilities = []) {


        return Object.freeze(

            this.options.capabilities

                .filter(

                    capability =>

                        remoteCapabilities.includes(

                            capability

                        )

                )

        );

    }



    /**
     * ========================================================================
     * Compatibility Validation
     * ========================================================================
     */


    validateCompatibility({

        version,

        capabilities = []

    }) {


        if (!version) {


            return Object.freeze({

                compatible: false,

                reason:
                    "Missing protocol version"

            });


        }



        const majorLocal =

            this.options.version
                .split(".")[0];


        const majorRemote =

            version
                .split(".")[0];



        if (majorLocal !== majorRemote) {


            return Object.freeze({

                compatible:false,

                reason:
                    "Protocol major version mismatch"

            });


        }



        return Object.freeze({

            compatible:true,


            capabilities:

                this.negotiateCapabilities(

                    capabilities

                )

        });


    }



    /**
     * ========================================================================
     * Close Session
     * ========================================================================
     */


    closeSession(sessionId) {


        const session =
            this.sessions.get(sessionId);



        if (!session) {

            return false;

        }


        this.sessions.set(

            sessionId,

            Object.freeze({

                ...session,

                state:
                    PROTOCOL_STATE.CLOSED

            })

        );


        return true;

    }



    /**
     * ========================================================================
     * Protocol Diagnostics
     * ========================================================================
     */


    diagnostics() {


        return Object.freeze({

            version:

                this.options.version,


            sessions:

                this.sessions.size,


            capabilities:

                this.options.capabilities,


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

    MeshProtocol,

    PROTOCOL_VERSION,

    PROTOCOL_STATE,

    MESSAGE_TYPE

};