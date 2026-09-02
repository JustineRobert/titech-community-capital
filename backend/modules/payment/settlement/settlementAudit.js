/**
 * TITech Community Capital LTD
 * Settlement Audit Trail
 */


class SettlementAudit {


constructor(){

this.logs=[];

}



record(event){


this.logs.push({

...event,

timestamp:
new Date()

});


}



find(transactionId){


return this.logs.filter(

x =>
x.transactionId === transactionId

);


}



}


module.exports =
new SettlementAudit();