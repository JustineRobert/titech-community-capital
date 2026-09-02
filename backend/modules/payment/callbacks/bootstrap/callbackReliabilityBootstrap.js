/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Reliability Bootstrap
 * ============================================================================
 */


function bootstrapCallbackReliability({

retryOrchestrator,

worker,

scheduler

}) {


worker.start?.();


scheduler.start();


return {

retryOrchestrator,

worker,

scheduler

};


}



module.exports =
bootstrapCallbackReliability;