/**
 * TITech Community Capital LTD
 * Settlement Processing Engine
 */


const idempotency =
require("./idempotencyManager");


const DistributedTransactionManager =
require(
"./distributedTransactionManager"
);


const ledger =
require(
"./ledgerPostingService"
);


const stateMachine =
require(
"./settlementStateMachine"
);



const audit =
require(
"./settlementAudit"
);



class SettlementProcessor {



async process(callback){



const key =
idempotency.generateKey(
callback
);



const reserved =
await idempotency.reserve(
key,
callback
);



if(!reserved){


return idempotency.check(key);


}



let settlement =
{

transactionId:
callback.transaction.id,


status:
"RECEIVED"


};



try{


settlement =
stateMachine.transition(
settlement,
"VALIDATING"
);



const tx =
new DistributedTransactionManager();



tx.register({

execute:

()=>ledger.post(callback.transaction),


rollback:

()=>ledger.rollback()

});



settlement =
stateMachine.transition(
settlement,
"PROCESSING"
);



const result =
await tx.commit();



settlement =
stateMachine.transition(
settlement,
"POSTED"
);



settlement =
stateMachine.transition(
settlement,
"SETTLED"
);



await idempotency.complete(

key,

settlement

);



audit.record({

transactionId:

callback.transaction.id,


status:
"SETTLED"

});



return {

settlement,

result

};


}

catch(error){


settlement.status =
"FAILED";


await idempotency.fail(
key,
error
);


audit.record({

transactionId:
callback.transaction.id,

status:
"FAILED",

error:
error.message

});


throw error;


}



}



}



module.exports =
new SettlementProcessor();