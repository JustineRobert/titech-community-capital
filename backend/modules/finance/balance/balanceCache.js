'use strict';


class BalanceCache {


    constructor({

        redis,

        ttl = 300

    }={}){


        this.redis =
            redis;


        this.ttl =
            ttl;

    }





    async get(key){


        if(!this.redis)
            return null;


        const value =
            await this.redis.get(key);


        return value
            ? JSON.parse(value)
            : null;

    }





    async set(key,value){


        if(!this.redis)
            return;


        await this.redis.set(

            key,

            JSON.stringify(value),

            {
                EX:this.ttl
            }

        );

    }





    async invalidate(key){


        await this.redis
            ?.del(key);

    }


}


module.exports =
    BalanceCache;