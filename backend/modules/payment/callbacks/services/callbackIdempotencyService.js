/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Idempotency Service
 * ============================================================================
 */


class CallbackIdempotencyService {


constructor({

redis,

ttl = 86400

}) {


this.redis = redis;

this.ttl = ttl;


}



async check(reference){


const key =
`callback:${reference}`;



const exists =
await this.redis.exists(key);



if(exists){

throw new Error(
"Duplicate callback detected"
);

}


await this.redis.set(

key,

"processed",

{
EX:this.ttl
}

);


return true;


}



}



module.exports =
CallbackIdempotencyService;