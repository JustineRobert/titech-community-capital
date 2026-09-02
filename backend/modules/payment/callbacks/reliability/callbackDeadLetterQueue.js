/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Dead Letter Queue
 * ============================================================================
 */


class CallbackDeadLetterQueue {


constructor({

queue

}) {


this.queue =
queue;


}



async store(callback,error){


return this.queue.add(

"dead-letter",

{

callback,

error:
error.message,

failedAt:
new Date()

}

);


}



}



module.exports =
CallbackDeadLetterQueue;