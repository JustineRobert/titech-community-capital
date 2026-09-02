/**
 * ============================================================================
 * Callback Event Publisher
 * ============================================================================
 */


class CallbackEventPublisher {


constructor({

eventBus

}) {

this.eventBus =
eventBus;

}



async publish(callback){


await this.eventBus.publish({

event:
"payment.completed",

payload:
callback

});


}



}



module.exports =
CallbackEventPublisher;