"use strict";

const {
    EventEmitter
} = require("events");

const crypto =
    require("crypto");


const SNAPSHOT_VERSION = "1.0.0";


const MEMORY_STATE = Object.freeze({

    CREATED:
        "CREATED",

    INITIALIZING:
        "INITIALIZING",

    READY:
        "READY",

    RUNNING:
        "RUNNING",

    DEGRADED:
        "DEGRADED",

    STOPPING:
        "STOPPING",

    STOPPED:
        "STOPPED",

    FAILED:
        "FAILED"

});


const MEMORY_TYPE = Object.freeze({

    EVENT:
        "EVENT",

    INCIDENT:
        "INCIDENT",

    STATE:
        "STATE",

    LEARNING:
        "LEARNING",

    REPLICATION:
        "REPLICATION"

});


const REPLICATION_STATE = Object.freeze({

    PENDING:
        "PENDING",

    SYNCING:
        "SYNCING",

    COMPLETED:
        "COMPLETED",

    FAILED:
        "FAILED"

});

function createId(prefix = "memory") {

    return `${prefix}-${crypto.randomUUID()}`;

}


class DistributedMemory extends EventEmitter {


    constructor(options = {}) {

        super();


        this.options = Object.freeze({

            name:

                options.name ||

                "distributed-resilience-memory",


            logger:

                options.logger ||

                console,


            metrics:

                options.metrics ||

                null,


            tracer:

                options.tracer ||

                null,


            clock:

                options.clock ||

                (() => new Date()),


            ...options

        });


        this.logger =
            this.options.logger;


        this.metrics =
            this.options.metrics;


        this.tracer =
            this.options.tracer;


        this.clock =
            this.options.clock;



        /**
         * Lifecycle
         */

        this.state =
            MEMORY_STATE.CREATED;


        this.started =
            false;


        this.startedAt =
            null;



        /**
         * Enterprise Memory Registries
         */

        this.memory =
            new Map();


        this.events =
            new Map();


        this.incidents =
            new Map();


        this.states =
            new Map();


        this.learning =
            new Map();


        this.replication =
            new Map();


        this.snapshots =
            new Map();



        /**
         * Statistics
         */

        this.statistics = {


            storedRecords:
                0,


            events:
                0,


            incidents:
                0,


            reconstructions:
                0,


            replays:
                0,


            replications:
                0,


            errors:
                0


        };



        /**
         * Diagnostics
         */

        this.diagnostics = {


            lastWrite:
                null,


            lastReplay:
                null,


            lastReplication:
                null,


            lastSnapshot:
                null,


            lastError:
                null


        };


    }


incrementMetric(
    name,
    value = 1,
    labels = {}
) {


    if (
        !this.metrics?.increment
    ) {

        return;

    }


    this.metrics.increment(
        name,
        value,
        labels
    );

}

startSpan(
    name,
    attributes = {}
) {


    if (
        !this.tracer?.startSpan
    ) {

        return null;

    }


    return this.tracer.startSpan(
        name,
        attributes
    );

}

async initialize() {


    if (
        this.state !== MEMORY_STATE.CREATED
    ) {

        return this.state;

    }



    this.state =
        MEMORY_STATE.INITIALIZING;



    try {


        this.state =
            MEMORY_STATE.READY;



        this.emit(
            "memory:initialized"
        );


        return this.state;



    }
    catch(error) {


        this.state =
            MEMORY_STATE.FAILED;


        this.statistics.errors++;


        this.diagnostics.lastError =
            error;


        throw error;

    }

}

async start() {


    if (
        this.started
    ) {

        return this.state;

    }


    if (
        this.state !== MEMORY_STATE.READY
    ) {

        await this.initialize();

    }



    this.started =
        true;


    this.startedAt =
        this.clock();


    this.state =
        MEMORY_STATE.RUNNING;



    this.emit(
        "memory:started",
        {
            startedAt:
                this.startedAt
        }
    );


    return this.state;

}

async stop() {


    if (
        !this.started
    ) {

        return this.state;

    }


    this.state =
        MEMORY_STATE.STOPPING;



    this.started =
        false;


    this.state =
        MEMORY_STATE.STOPPED;



    this.emit(
        "memory:stopped"
    );


    return this.state;

}

    /* =====================================================================
     * Store Memory Record
     * =====================================================================
     *
     * Stores immutable resilience knowledge records.
     *
     * =================================================================== */

    store(record = {}) {


        const span =
            this.startSpan(
                "memory.store"
            );


        try {


            if (!record.type) {

                throw new Error(
                    "Memory type is required."
                );

            }


            const memoryRecord =
                Object.freeze({

                    id:
                        record.id ||
                        createId("memory"),


                    type:
                        record.type,


                    source:
                        record.source ||
                        null,


                    payload:

                        Object.freeze({

                            ...(record.payload || {})

                        }),


                    metadata:

                        Object.freeze({

                            ...(record.metadata || {})

                        }),


                    createdAt:
                        this.clock()

                });



            this.memory.set(

                memoryRecord.id,

                memoryRecord

            );



            this.statistics.storedRecords++;



            this.diagnostics.lastWrite =
                this.clock();



            this.incrementMetric(

                "resilience_memory_records_stored_total"

            );



            this.emit(

                "memory:stored",

                memoryRecord

            );



            return memoryRecord;



        }
        catch(error) {


            this.statistics.errors++;

            this.diagnostics.lastError =
                error;


            throw error;


        }
        finally {

            span?.end?.();

        }

    }

        /* =====================================================================
     * Store Event Memory
     * =================================================================== */

    storeEvent(event = {}) {


        const record =
            this.store({

                type:
                    MEMORY_TYPE.EVENT,


                source:
                    event.source,


                payload:
                    event

            });



        this.events.set(

            record.id,

            record

        );



        this.statistics.events++;



        this.emit(

            "event:stored",

            record

        );



        return record;

    }


    /* =====================================================================
     * Store Incident Memory
     * =================================================================== */

    storeIncident(incident = {}) {


        const record =
            this.store({

                type:
                    MEMORY_TYPE.INCIDENT,


                source:
                    incident.source,


                payload:
                    incident

            });



        this.incidents.set(

            record.id,

            record

        );



        this.statistics.incidents++;



        this.emit(

            "incident:stored",

            record

        );



        return record;

    }


    /* =====================================================================
     * Store State Memory
     * =================================================================== */

    storeState(state = {}) {


        const record =
            this.store({

                type:
                    MEMORY_TYPE.STATE,


                source:
                    state.source,


                payload:
                    state

            });



        this.states.set(

            record.id,

            record

        );



        return record;

    }

    /* =====================================================================
     * Store Learning Feedback
     * =================================================================== */

    storeLearningFeedback(feedback = {}) {


        const record =
            this.store({

                type:
                    MEMORY_TYPE.LEARNING,


                source:
                    feedback.source,


                payload:
                    feedback

            });



        this.learning.set(

            record.id,

            record

        );



        return record;

    }


    /* =====================================================================
     * Retrieve Memory
     * =================================================================== */

    retrieve(memoryId) {


        return this.memory.get(
            memoryId
        ) || null;


    }


    /* =====================================================================
     * Search Memory
     * =================================================================== */

    search(criteria = {}) {


        const results = [];


        for (
            const record
            of this.memory.values()
        ) {


            let matches = true;



            if (
                criteria.type &&
                record.type !== criteria.type
            ) {

                matches = false;

            }



            if (
                criteria.source &&
                record.source !== criteria.source
            ) {

                matches = false;

            }



            if (matches) {

                results.push(
                    record
                );

            }

        }



        return Object.freeze(

            results

        );

    }


    /* =====================================================================
     * Delete Memory
     * =================================================================== */

    delete(memoryId) {


        const existing =
            this.memory.get(
                memoryId
            );


        if (!existing) {

            return false;

        }



        this.memory.delete(

            memoryId

        );



        this.events.delete(

            memoryId

        );



        this.incidents.delete(

            memoryId

        );



        this.states.delete(

            memoryId

        );



        this.learning.delete(

            memoryId

        );



        this.emit(

            "memory:deleted",

            {

                id:
                    memoryId

            }

        );



        return true;

    }



    /* =====================================================================
     * Replay Historical Memory
     * =====================================================================
     *
     * Replays stored resilience events.
     *
     * =================================================================== */

    replay(criteria = {}) {


        const span =
            this.startSpan(
                "memory.replay"
            );


        try {


            const records =
                this.search(criteria);



            const replay =
                Object.freeze({

                    id:
                        createId("replay"),


                    records:

                        Object.freeze(

                            [
                                ...records
                            ]
                            .sort(

                                (a, b) =>

                                    new Date(
                                        a.createdAt
                                    )
                                    -
                                    new Date(
                                        b.createdAt
                                    )

                            )

                        ),


                    count:
                        records.length,


                    executedAt:
                        this.clock()

                });



            this.statistics.replays++;


            this.diagnostics.lastReplay =
                this.clock();



            this.incrementMetric(

                "resilience_memory_replay_total"

            );



            this.emit(

                "memory:replayed",

                replay

            );



            return replay;



        }
        finally {

            span?.end?.();

        }

    }


    /* =====================================================================
     * Generate Memory Timeline
     * =================================================================== */

    timeline(criteria = {}) {


        const records =
            this.search(criteria);



        return Object.freeze(

            records
                .sort(

                    (a, b) =>

                        new Date(
                            a.createdAt
                        )
                        -
                        new Date(
                            b.createdAt
                        )

                )
                .map(

                    record =>

                    Object.freeze({

                        id:
                            record.id,


                        type:
                            record.type,


                        timestamp:
                            record.createdAt

                    })

                )

        );

    }

    /* =====================================================================
     * Generate Memory History
     * =================================================================== */

    generateHistory(criteria = {}) {


        const timeline =
            this.timeline(criteria);



        return Object.freeze({

            generatedAt:

                this.clock(),


            totalRecords:

                timeline.length,


            timeline

        });


    }

    /* =====================================================================
     * Reconstruct State
     * =================================================================== */

    reconstructState(options = {}) {


        const span =
            this.startSpan(
                "memory.reconstruct_state"
            );


        try {


            const states =
                this.search({

                    type:
                        MEMORY_TYPE.STATE

                });



            if (
                states.length === 0
            ) {

                return null;

            }



            const ordered =
                states.sort(

                    (a, b) =>

                        new Date(
                            a.createdAt
                        )
                        -
                        new Date(
                            b.createdAt
                        )

                );



            const latest =
                ordered[
                    ordered.length - 1
                ];



            this.statistics.reconstructions++;



            return Object.freeze({

                reconstructedAt:

                    this.clock(),


                source:

                    latest.source,


                state:

                    Object.freeze({

                        ...(latest.payload || {})

                    })

            });



        }
        finally {

            span?.end?.();

        }

    }

    /* =====================================================================
     * Compare Memory States
     * =================================================================== */

    compareStates(
        stateA,
        stateB
    ) {


        const differences = {};



        const keys =
            new Set([

                ...Object.keys(
                    stateA || {}
                ),

                ...Object.keys(
                    stateB || {}
                )

            ]);



        for (
            const key
            of keys
        ) {


            if (

                JSON.stringify(
                    stateA[key]
                )

                !==

                JSON.stringify(
                    stateB[key]
                )

            ) {


                differences[key] = {

                    before:
                        stateA[key],


                    after:
                        stateB[key]

                };

            }

        }



        return Object.freeze({

            changed:

                Object.keys(
                    differences
                ).length > 0,


            differences

        });

    }


    /* =====================================================================
     * Restore Memory Snapshot
     * =================================================================== */

    restoreSnapshot(snapshotId) {


        const snapshot =
            this.snapshots.get(
                snapshotId
            );



        if (!snapshot) {


            throw new Error(

                `Memory snapshot not found: ${snapshotId}`

            );

        }



        const restored =
            Object.freeze({

                id:

                    createId(
                        "restore"
                    ),


                snapshotId,


                restoredAt:

                    this.clock(),


                state:

                    snapshot

            });



        this.emit(

            "memory:restored",

            restored

        );



        return restored;

    }

    /* =====================================================================
     * Create Memory Replication Task
     * =====================================================================
     *
     * Creates a controlled replication workflow.
     *
     * =================================================================== */

    createReplicationTask(options = {}) {


        const task =
            Object.freeze({

                id:
                    createId(
                        "replication"
                    ),


                source:

                    options.source ||
                    "local",


                target:

                    options.target ||
                    null,


                memoryTypes:

                    Object.freeze(

                        [
                            ...(options.memoryTypes || [])

                        ]

                    ),


                state:

                    REPLICATION_STATE.PENDING,


                createdAt:

                    this.clock()


            });



        this.replication.set(

            task.id,

            task

        );



        this.statistics.replications++;



        this.incrementMetric(

            "resilience_memory_replication_tasks_created_total"

        );



        this.emit(

            "replication:created",

            task

        );



        return task;

    }

    /* =====================================================================
     * Replicate Memory
     * =================================================================== */

    replicate(taskId) {


        const task =
            this.replication.get(
                taskId
            );


        if (!task) {

            throw new Error(
                `Replication task not found: ${taskId}`
            );

        }



        const updated =
            Object.freeze({

                ...task,


                state:

                    REPLICATION_STATE.SYNCING,


                startedAt:

                    this.clock()

            });



        this.replication.set(

            taskId,

            updated

        );



        const result =
            Object.freeze({

                taskId,


                replicatedRecords:

                    this.memory.size,


                state:

                    REPLICATION_STATE.COMPLETED,


                completedAt:

                    this.clock()

            });



        this.replication.set(

            taskId,

            Object.freeze({

                ...updated,


                state:

                    REPLICATION_STATE.COMPLETED


            })

        );



        this.diagnostics.lastReplication =
            this.clock();



        this.emit(

            "replication:completed",

            result

        );



        this.incrementMetric(

            "resilience_memory_replication_completed_total"

        );



        return result;

    }


    /* =====================================================================
     * Synchronize Memory
     * =================================================================== */

    syncMemory(criteria = {}) {


        const records =
            this.search(criteria);



        const synchronization =
            Object.freeze({

                id:

                    createId(
                        "sync"
                    ),


                records:

                    Object.freeze(

                        records

                    ),


                count:

                    records.length,


                synchronizedAt:

                    this.clock()


            });



        this.emit(

            "memory:synchronized",

            synchronization

        );



        return synchronization;

    }

    /* =====================================================================
     * Verify Replication
     * =================================================================== */

    verifyReplication(taskId) {


        const task =
            this.replication.get(
                taskId
            );


        if (!task) {


            throw new Error(

                `Replication task not found: ${taskId}`

            );

        }



        const verification =
            Object.freeze({

                taskId,


                valid:

                    task.state ===
                    REPLICATION_STATE.COMPLETED,


                checkedAt:

                    this.clock()


            });



        this.emit(

            "replication:verified",

            verification

        );



        return verification;

    }

    /* =====================================================================
     * Resolve Memory Conflict
     * =================================================================== */

    resolveConflict(conflict = {}) {


        const resolution =
            Object.freeze({

                id:

                    createId(
                        "conflict-resolution"
                    ),


                conflictId:

                    conflict.id ||
                    null,


                strategy:

                    conflict.strategy ||
                    "LATEST_VERSION",


                resolved:

                    true,


                resolvedAt:

                    this.clock()


            });



        this.emit(

            "memory:conflict_resolved",

            resolution

        );



        return resolution;

    }

    /* =====================================================================
     * Replication Health
     * =================================================================== */

    replicationHealth() {


        const tasks =
            [
                ...this.replication.values()
            ];



        const completed =
            tasks.filter(

                task =>

                    task.state ===
                    REPLICATION_STATE.COMPLETED

            ).length;



        const failed =
            tasks.filter(

                task =>

                    task.state ===
                    REPLICATION_STATE.FAILED

            ).length;



        return Object.freeze({

            total:

                tasks.length,


            completed,


            failed,


            healthy:

                failed === 0,


            timestamp:

                this.clock()

        });


    }

    /* =====================================================================
     * Distributed Memory Health
     * =================================================================== */

    health() {


        const replication =
            this.replicationHealth();



        return Object.freeze({


            component:

                "DistributedMemory",


            state:

                this.state,


            running:

                this.started,


            healthy:

                this.state !== MEMORY_STATE.FAILED,


            records:

                this.memory.size,


            events:

                this.events.size,


            incidents:

                this.incidents.size,


            states:

                this.states.size,


            learningRecords:

                this.learning.size,


            replication,


            timestamp:

                this.clock()


        });


    }

    /* =====================================================================
     * Statistics Export
     * =================================================================== */

    statistics() {


        return Object.freeze({

            ...this.statistics,


            storage:

                Object.freeze({

                    records:

                        this.memory.size,


                    events:

                        this.events.size,


                    incidents:

                        this.incidents.size,


                    states:

                        this.states.size,


                    learning:

                        this.learning.size

                }),



            replication:

                this.replicationHealth(),



            timestamp:

                this.clock()


        });


    }    
    /* =====================================================================
     * Diagnostics Report
     * =================================================================== */

    diagnostics() {


        return Object.freeze({


            component:

                "DistributedMemory",


            state:

                this.state,


            diagnostics:

                Object.freeze({

                    ...this.diagnostics

                }),



            statistics:

                this.statistics(),



            health:

                this.health(),



            registry:

                Object.freeze({


                    memory:

                        this.memory.size,


                    events:

                        this.events.size,


                    incidents:

                        this.incidents.size,


                    states:

                        this.states.size,


                    learning:

                        this.learning.size,


                    replication:

                        this.replication.size,


                    snapshots:

                        this.snapshots.size


                }),



            generatedAt:

                this.clock()


        });


    }

    /* =====================================================================
     * Immutable Memory Snapshot
     * =================================================================== */

    snapshot() {


        const snapshot =
            Object.freeze({


                version:

                    SNAPSHOT_VERSION,



                id:

                    createId(
                        "memory-snapshot"
                    ),



                createdAt:

                    this.clock(),



                state:

                    this.state,



                memory:

                    Object.freeze(

                        [
                            ...this.memory.values()
                        ]

                    ),



                events:

                    Object.freeze(

                        [
                            ...this.events.values()
                        ]

                    ),



                incidents:

                    Object.freeze(

                        [
                            ...this.incidents.values()
                        ]

                    ),



                states:

                    Object.freeze(

                        [
                            ...this.states.values()
                        ]

                    ),



                learning:

                    Object.freeze(

                        [
                            ...this.learning.values()
                        ]

                    ),



                replication:

                    Object.freeze(

                        [
                            ...this.replication.values()
                        ]

                    )

            });



        this.snapshots.set(

            snapshot.id,

            snapshot

        );



        this.diagnostics.lastSnapshot =
            this.clock();



        this.emit(

            "memory:snapshot_created",

            snapshot

        );



        return snapshot;

    }    

    /* =====================================================================
     * Export Memory State
     * =================================================================== */

    exportMemoryState() {


        const snapshot =
            this.snapshot();



        return Object.freeze({


            exportedAt:

                this.clock(),



            version:

                SNAPSHOT_VERSION,



            payload:

                snapshot


        });


    }

    /* =====================================================================
     * Import Memory State
     * =================================================================== */

    importMemoryState(packageData = {}) {


        if (
            !packageData.payload
        ) {

            throw new Error(
                "Invalid memory package."
            );

        }



        const payload =
            packageData.payload;



        for (
            const record
            of payload.memory || []
        ) {

            this.memory.set(

                record.id,

                record

            );

        }



        for (
            const record
            of payload.events || []
        ) {

            this.events.set(

                record.id,

                record

            );

        }



        for (
            const record
            of payload.incidents || []
        ) {

            this.incidents.set(

                record.id,

                record

            );

        }



        for (
            const record
            of payload.states || []
        ) {

            this.states.set(

                record.id,

                record

            );

        }



        for (
            const record
            of payload.learning || []
        ) {

            this.learning.set(

                record.id,

                record

            );

        }



        this.emit(

            "memory:imported",

            {

                records:

                    this.memory.size

            }

        );



        return this.health();

    }

    /* =====================================================================
     * Audit Package
     * =================================================================== */

    auditPackage() {


        return Object.freeze({


            packageId:

                createId(
                    "audit"
                ),



            component:

                "DistributedMemory",



            generatedAt:

                this.clock(),



            health:

                this.health(),



            statistics:

                this.statistics(),



            diagnostics:

                this.diagnostics(),



            snapshot:

                this.snapshot()



        });


    }

