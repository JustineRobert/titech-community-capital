/**
 * TITech Community Capital LTD
 * Idempotency Manager
 *
 * Prevents duplicate processing
 * of payment callbacks.
 */


const crypto = require("crypto");


class IdempotencyManager {


constructor(){

this.store = new Map();

}



generateKey(payload){


return crypto
.createHash("sha256")
.update(
JSON.stringify(payload)
)
.digest("hex");


}



async check(key){


return this.store.get(key) || null;


}



async reserve(key,data){


if(this.store.has(key)){

return false;

}


this.store.set(
key,
{

status:"PROCESSING",

createdAt:
new Date(),

data

}
);


return true;

}




async complete(
key,
result
){


this.store.set(

key,

{

status:"COMPLETED",

completedAt:
new Date(),

result

}

);


}



async fail(
key,
error
){


this.store.set(

key,

{

status:"FAILED",

failedAt:
new Date(),

error:
error.message

}

);


}



}


module.exports =
new IdempotencyManager();