/**
 * ============================================================================
 * Callback Audit Service
 * ============================================================================
 */


class CallbackAuditService {


constructor({

auditLogger

}) {


this.auditLogger =
auditLogger;


}



async record(event){


await this.auditLogger.write({

type:
"PAYMENT_CALLBACK",

provider:
event.provider,

transactionId:
event.transactionId,

timestamp:
new Date()

});


}



}



module.exports =
CallbackAuditService;