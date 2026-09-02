/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Reconciliation Scheduler
 * ============================================================================
 */


class CallbackReconciliationScheduler {


constructor({

reconciliationService,

cron

}) {


this.service =
reconciliationService;


this.cron =
cron;


}



start(){


this.cron.schedule(

"0 */6 * * *",

async()=>{


await this.service.reconcilePendingCallbacks();


}

);


}



}



module.exports =
CallbackReconciliationScheduler;