"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Integration Adapters
 * =============================================================================
 *
 * Technology-aware retry adapters.
 *
 * Supported:
 *
 * ✓ MongoDB
 * ✓ Mongoose
 * ✓ Redis
 * ✓ Axios
 * ✓ Fetch
 * ✓ MTN MoMo
 * ✓ Airtel Money
 * ✓ Kafka
 * ✓ RabbitMQ
 * ✓ BullMQ
 * ✓ File Storage
 * ✓ External Services
 *
 * Responsibilities:
 *
 * - Error normalization
 * - Retry classification
 * - Policy selection
 * - Operation wrapping
 * - Metadata enrichment
 *
 * =============================================================================
 */


const {
    retryClient
} = require("./retryClient");



/* =============================================================================
 * Base Adapter
 * =============================================================================
 */


class RetryAdapter {


    constructor(options={}) {


        this.name =
            options.name
            ||
            "generic";


        this.client =
            options.client
            ||
            retryClient;


    }



    execute(
        operation,
        options={}
    ) {


        return this.client.execute(

            operation,

            {

                service:
                    this.name,


                ...options

            }

        );


    }


}





/* =============================================================================
 * MongoDB Adapter
 * =============================================================================
 */


class MongoDBRetryAdapter
extends RetryAdapter {


    constructor(options={}) {


        super({

            ...options,

            name:"mongodb"

        });


    }



    execute(
        operation,
        options={}
    ) {


        return this.client.database(

            operation,

            {

                component:
                    "mongodb",

                ...options

            }

        );


    }


}





/* =============================================================================
 * Mongoose Adapter
 * =============================================================================
 */


class MongooseRetryAdapter
extends MongoDBRetryAdapter {


    constructor(options={}) {


        super(options);


        this.name =
            "mongoose";


    }


}





/* =============================================================================
 * Redis Adapter
 * =============================================================================
 */


class RedisRetryAdapter
extends RetryAdapter {


    constructor(options={}) {


        super({

            ...options,

            name:"redis"

        });


    }



    execute(
        operation,
        options={}
    ) {


        return this.client.execute(

            operation,

            {

                policy:

                    {

                        name:
                            "redisPolicy"

                    },


                service:
                    "redis",


                ...options

            }

        );


    }


}





/* =============================================================================
 * Axios Adapter
 * =============================================================================
 */


class AxiosRetryAdapter
extends RetryAdapter {


    constructor(options={}) {


        super({

            ...options,

            name:"axios"

        });


    }



    request(
        operation,
        options={}
    ) {


        return this.client.apiCall(

            operation,

            {

                component:
                    "axios",


                ...options

            }

        );


    }


}





/* =============================================================================
 * Fetch Adapter
 * =============================================================================
 */


class FetchRetryAdapter
extends AxiosRetryAdapter {


    constructor(options={}) {


        super(options);


        this.name =
            "fetch";


    }


}





/* =============================================================================
 * MTN MoMo Adapter
 * =============================================================================
 */


class MTNMoMoRetryAdapter
extends RetryAdapter {


    constructor(options={}) {


        super({

            ...options,

            name:"mtn-momo"

        });


    }



    payment(
        operation,
        options={}
    ) {


        return this.client.payment(

            operation,

            {


                provider:
                    "MTN_MOMO",


                component:
                    "payment-gateway",


                ...options


            }

        );


    }


}





/* =============================================================================
 * Airtel Money Adapter
 * =============================================================================
 */


class AirtelMoneyRetryAdapter
extends RetryAdapter {


    constructor(options={}) {


        super({

            ...options,

            name:"airtel-money"

        });


    }



    payment(
        operation,
        options={}
    ) {


        return this.client.payment(

            operation,

            {


                provider:
                    "AIRTEL_MONEY",


                component:
                    "payment-gateway",


                ...options


            }

        );


    }


}





/* =============================================================================
 * Kafka Adapter
 * =============================================================================
 */


class KafkaRetryAdapter
extends RetryAdapter {


    constructor(options={}) {


        super({

            ...options,

            name:"kafka"

        });


    }



    publish(
        operation,
        options={}
    ) {


        return this.client.job(

            operation,

            {

                component:
                    "kafka",


                ...options

            }

        );


    }


}





/* =============================================================================
 * RabbitMQ Adapter
 * =============================================================================
 */


class RabbitMQRetryAdapter
extends KafkaRetryAdapter {


    constructor(options={}) {


        super(options);


        this.name =
            "rabbitmq";


    }


}





/* =============================================================================
 * BullMQ Adapter
 * =============================================================================
 */


class BullMQRetryAdapter
extends RetryAdapter {


    constructor(options={}) {


        super({

            ...options,

            name:"bullmq"

        });


    }



    executeJob(
        operation,
        options={}
    ) {


        return this.client.job(

            operation,

            {

                component:
                    "bullmq",


                ...options

            }

        );


    }


}





/* =============================================================================
 * File Storage Adapter
 * =============================================================================
 */


class FileStorageRetryAdapter
extends RetryAdapter {


    constructor(options={}) {


        super({

            ...options,

            name:"filesystem"

        });


    }



    execute(
        operation,
        options={}
    ) {


        return this.client.execute(

            operation,

            {

                policy:

                    {

                        name:
                            "storagePolicy"

                    },


                ...options

            }

        );


    }


}





/* =============================================================================
 * External Service Adapter
 * =============================================================================
 */


class ExternalServiceRetryAdapter
extends RetryAdapter {


    constructor(options={}) {


        super({

            ...options,

            name:"external-service"

        });


    }



    call(
        operation,
        options={}
    ) {


        return this.client.apiCall(

            operation,

            options

        );


    }


}





/* =============================================================================
 * Adapter Registry
 * =============================================================================
 */


class RetryAdapterRegistry {


    constructor(){


        this.adapters =
            new Map();


    }



    register(
        name,
        adapter
    ){


        this.adapters.set(

            name,

            adapter

        );


        return this;


    }



    get(
        name
    ){


        return this.adapters.get(
            name
        );


    }



    list()
    {


        return [

            ...this.adapters.keys()

        ];


    }


}





const retryAdapterRegistry =
    new RetryAdapterRegistry();



retryAdapterRegistry

    .register(
        "mongodb",
        new MongoDBRetryAdapter()
    )

    .register(
        "mongoose",
        new MongooseRetryAdapter()
    )

    .register(
        "redis",
        new RedisRetryAdapter()
    )

    .register(
        "axios",
        new AxiosRetryAdapter()
    )

    .register(
        "fetch",
        new FetchRetryAdapter()
    )

    .register(
        "mtn-momo",
        new MTNMoMoRetryAdapter()
    )

    .register(
        "airtel-money",
        new AirtelMoneyRetryAdapter()
    )

    .register(
        "kafka",
        new KafkaRetryAdapter()
    )

    .register(
        "rabbitmq",
        new RabbitMQRetryAdapter()
    )

    .register(
        "bullmq",
        new BullMQRetryAdapter()
    )

    .register(
        "filesystem",
        new FileStorageRetryAdapter()
    )

    .register(
        "external-service",
        new ExternalServiceRetryAdapter()
    );





module.exports = {


    RetryAdapter,

    MongoDBRetryAdapter,

    MongooseRetryAdapter,

    RedisRetryAdapter,

    AxiosRetryAdapter,

    FetchRetryAdapter,

    MTNMoMoRetryAdapter,

    AirtelMoneyRetryAdapter,

    KafkaRetryAdapter,

    RabbitMQRetryAdapter,

    BullMQRetryAdapter,

    FileStorageRetryAdapter,

    ExternalServiceRetryAdapter,

    RetryAdapterRegistry,

    retryAdapterRegistry

};