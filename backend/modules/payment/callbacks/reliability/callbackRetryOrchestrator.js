/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Retry Orchestrator
 * ============================================================================
 */


class CallbackRetryOrchestrator {


constructor({

retryPolicy,

queue,

logger

}) {


this.retryPolicy =
retryPolicy;


this.queue =
queue;


this.logger =
logger;


}



async execute({

job,

attempt = 0

}) {


try {


return await job();


}


catch(error){


if(
this.retryPolicy.shouldRetry(
attempt
)
){


const delay =
this.retryPolicy.calculateDelay(
attempt
);



this.logger?.warn(
"Callback retry scheduled",
{
attempt,
delay
}
);



await this.queue.add(

"callback-retry",

{

...job,

attempt:
attempt + 1

},

{
delay
}

);



return;

}



throw error;


}



}



}



module.exports =
CallbackRetryOrchestrator;