'use strict';

const crypto = require('crypto');


class SnapshotEngineError extends Error {

    constructor(code, message, metadata = {}) {

        super(message);

        this.name =
            'SnapshotEngineError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();
    }
}



class SnapshotEngine {


    constructor({

        balanceEngine,

        snapshotRepository,

        snapshotValidator,

        dailySnapshot,

        weeklySnapshot,

        monthlySnapshot,

        yearEndSnapshot,

        regulatorySnapshot,

        auditService,

        eventBus,

        logger,

        metrics

    } = {}) {


        this.balanceEngine =
            balanceEngine;


        this.snapshotRepository =
            snapshotRepository;


        this.snapshotValidator =
            snapshotValidator;


        this.dailySnapshot =
            dailySnapshot;


        this.weeklySnapshot =
            weeklySnapshot;


        this.monthlySnapshot =
            monthlySnapshot;


        this.yearEndSnapshot =
            yearEndSnapshot;


        this.regulatorySnapshot =
            regulatorySnapshot;


        this.auditService =
            auditService;


        this.eventBus =
            eventBus;


        this.logger =
            logger;


        this.metrics =
            metrics;

    }





    /**
     * --------------------------------------------------
     * CREATE SNAPSHOT
     *
     * Entry point for all snapshots
     * --------------------------------------------------
     */
    async create({

        type,

        tenantId,

        period,

        metadata = {}

    }) {


        const snapshotId =
            crypto.randomUUID();



        try {


            const generator =
                this.resolveGenerator(type);



            const snapshot =
                await generator.generate({

                    tenantId,

                    period,

                    snapshotId,

                    metadata

                });



            await this.validate(snapshot);



            const saved =
                await this.snapshotRepository
                    .save(snapshot);



            await this.auditService
                ?.record({

                    action:
                        'SNAPSHOT_CREATED',

                    entity:
                        saved

                });



            await this.eventBus
                ?.publish({

                    type:
                        'SnapshotCreated',

                    payload:
                        saved

                });



            this.metrics
                ?.increment?.(
                    'finance.snapshot.created'
                );



            return saved;



        } catch(error) {


            this.metrics
                ?.increment?.(
                    'finance.snapshot.failed'
                );


            throw new SnapshotEngineError(

                'SNAPSHOT_CREATION_FAILED',

                error.message,

                {
                    snapshotId
                }

            );

        }

    }







    resolveGenerator(type) {


        const generators = {


            DAILY:
                this.dailySnapshot,


            WEEKLY:
                this.weeklySnapshot,


            MONTHLY:
                this.monthlySnapshot,


            YEAR_END:
                this.yearEndSnapshot,


            REGULATORY:
                this.regulatorySnapshot

        };



        const generator =
            generators[type];



        if(!generator){


            throw new SnapshotEngineError(

                'INVALID_SNAPSHOT_TYPE',

                `Unsupported snapshot type ${type}`

            );

        }



        return generator;

    }







    async validate(snapshot){


        return this.snapshotValidator
            .validate(snapshot);

    }







    async restore(snapshotId){


        const snapshot =
            await this.snapshotRepository
                .findById(snapshotId);



        if(!snapshot){


            throw new SnapshotEngineError(

                'SNAPSHOT_NOT_FOUND',

                'Snapshot does not exist'

            );

        }



        return snapshot;

    }







    async rebuild({

        tenantId,

        type,

        period

    }){


        return this.create({

            tenantId,

            type,

            period,

            metadata:{

                rebuild:true

            }

        });

    }




    async archive(snapshotId){


        return this.snapshotRepository
            .archive(snapshotId);

    }


}



module.exports = {

    SnapshotEngine,

    SnapshotEngineError

};