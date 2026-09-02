/**
 * ============================================================================
 * Callback Bootstrap
 * ============================================================================
 */


function registerCallbacks({

registry,

mtnHandler,

airtelHandler

}) {


registry.register(

"mtn_momo",

mtnHandler

);



registry.register(

"airtel_money",

airtelHandler

);



}



module.exports =
registerCallbacks;