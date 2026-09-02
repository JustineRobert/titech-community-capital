/**
 * ============================================================================
 * TITech Community Capital LTD
 * Prometheus Callback Metrics
 * ============================================================================
 */


const client =
require("prom-client");



const callbackCounter =
new client.Counter({

name:
"payment_callback_total",

help:
"Total payment callbacks received",

labelNames:[
"provider",
"status"
]

});



module.exports = {

callbackCounter

};