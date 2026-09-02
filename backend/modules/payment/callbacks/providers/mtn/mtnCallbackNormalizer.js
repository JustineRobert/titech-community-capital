/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Callback Normalizer
 * ============================================================================
 */


class MtnCallbackNormalizer {


async normalize(payload){


return {

provider:
"mtn_momo",


transactionId:
payload.financialTransactionId
||
payload.externalId,


amount:
Number(payload.amount),


currency:
payload.currency
||
"UGX",


status:
payload.status
||
"SUCCESS",


receivedAt:
new Date()

};


}



}


module.exports = MtnCallbackNormalizer;