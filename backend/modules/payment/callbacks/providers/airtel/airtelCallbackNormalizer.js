/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Callback Normalizer
 * ============================================================================
 */


class AirtelCallbackNormalizer {


async normalize(payload){


return {


provider:
"airtel_money",


transactionId:
payload.transaction.id,


amount:
Number(
payload.transaction.amount
),


currency:
payload.transaction.currency
||
"UGX",


status:
payload.transaction.status,


receivedAt:
new Date()


};


}



}


module.exports = AirtelCallbackNormalizer;