/**
 * ============================================================================
 * Callback Queue - BullMQ
 * ============================================================================
 */


const {
Queue
}
=
require("bullmq");



class CallbackQueue {


constructor({

connection

}) {


this.queue =
new Queue(
"payment-callbacks",
{
connection
}
);


}



async add(

name,

data,

options={}

){


return this.queue.add(

name,

data,

options

);


}



}



module.exports =
CallbackQueue;