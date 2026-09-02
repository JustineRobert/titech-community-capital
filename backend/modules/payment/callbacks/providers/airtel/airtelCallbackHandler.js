/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Money Callback Handler
 * ============================================================================
 */


class AirtelCallbackHandler {


constructor({

normalizer,

validator,

logger

}) {


this.normalizer =
normalizer;


this.validator =
validator;


this.logger =
logger;


}



async handle({

payload,

context={}

}) {


await this.validator.validate({

provider:
"airtel_money",

payload,

signature:
context.signature

});



const normalized =
await this.normalizer.normalize(
payload
);



this.logger?.info(
"Airtel callback processed",
{
transactionId:
normalized.transactionId
}
);



return normalized;


}



}



module.exports = AirtelCallbackHandler;