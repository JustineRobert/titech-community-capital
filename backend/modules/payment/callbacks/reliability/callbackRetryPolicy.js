/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Retry Policy
 * ============================================================================
 */


class CallbackRetryPolicy {


constructor(options = {}) {


this.maxRetries =
options.maxRetries || 5;


this.initialDelay =
options.initialDelay || 1000;


this.maxDelay =
options.maxDelay || 60000;


}



calculateDelay(attempt){


const delay =
this.initialDelay *
Math.pow(2, attempt);


return Math.min(
delay,
this.maxDelay
);


}



shouldRetry(attempt){


return attempt < this.maxRetries;


}



}



module.exports =
CallbackRetryPolicy;