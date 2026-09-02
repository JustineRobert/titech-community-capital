/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Processing Engine
 * ============================================================================
 */


class CallbackProcessingEngine {


constructor({

    validator,

    normalizer,

    dispatcher,

    ledgerService,

    reconciliationService,

    eventService,

    idempotencyService

}) {


this.validator = validator;

this.normalizer = normalizer;

this.dispatcher = dispatcher;

this.ledgerService = ledgerService;

this.reconciliationService =
    reconciliationService;

this.eventService =
    eventService;

this.idempotencyService =
    idempotencyService;


}




async process({

provider,

payload,

signature,

context={}

}) {



await this.validator.validate({

provider,

payload,

signature

});




const callback =
await this.normalizer.normalize(
provider,
payload
);




await this.idempotencyService.check(
callback.transactionId
);




await this.dispatcher.dispatch({

provider,

payload,

context

});




await this.ledgerService.post(
callback
);




await this.reconciliationService.reconcile(
callback
);




await this.eventService.publish(
callback
);




return {

success:true,

transactionId:
callback.transactionId

};


}



}


module.exports = CallbackProcessingEngine;