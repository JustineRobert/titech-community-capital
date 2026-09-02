/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Worker
 * ============================================================================
 */


const {
Worker
}
=
require("bullmq");



class CallbackWorker {


constructor({

connection,

processor,

logger

}) {


this.worker =
new Worker(

"payment-callbacks",

async job => {


return processor(
job.data
);


},

{
connection
}

);


this.logger =
logger;


this.worker.on(

"failed",

(job,error)=>{


this.logger?.error(

"Callback worker failed",

{
jobId:
job.id,

error:
error.message

}

);


}

);


}



}



module.exports =
CallbackWorker;