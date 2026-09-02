/**
 * TITech Community Capital LTD
 * Mobile Money Callback Processor
 *
 * Complete callback lifecycle:
 *
 * Provider Callback
 *        |
 * Validation
 *        |
 * Deduplication
 *        |
 * Fraud
 *        |
 * AML
 *        |
 * KYC
 *        |
 * Decision
 *        |
 * Ledger / Settlement
 */


const fraud =
require("../compliance/fraudDetectionPipeline");


const aml =
require("../compliance/amlScreeningPipeline");


const kyc =
require("../compliance/kycVerificationPipeline");


const decision =
require("../compliance/complianceDecisionEngine");



class CallbackProcessor {



async process(callback){


const {

transaction,

customer

}=callback;



const fraudResult =
await fraud.execute({

...transaction,

kycStatus:
customer.kycStatus

});



const amlResult =
await aml.execute(
transaction
);



const kycResult =
await kyc.execute(
customer
);



const compliance =
decision.evaluate({

fraud:
fraudResult,


aml:
amlResult,


kyc:
kycResult

});



return {


transactionId:
transaction.id,


fraud:
fraudResult,


aml:
amlResult,


kyc:
kycResult,


decision:
compliance


};



}



}


module.exports =
new CallbackProcessor();