/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Distributed Tracing
 * ============================================================================
 */


class CallbackTracer {


constructor({

tracer

}) {


this.tracer =
tracer;


}



async trace(

name,

handler

){


return this.tracer.startActiveSpan(

name,

async span=>{


try {

return await handler();

}

finally {

span.end();

}


}

);


}



}



module.exports =
CallbackTracer;