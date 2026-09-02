/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Metrics
 * ============================================================================
 */


class CallbackMetrics {


constructor(){

this.metrics = {

received:0,

processed:0,

failed:0,

retried:0,

duplicates:0

};


}



increment(metric){

if(this.metrics[metric] !== undefined){

this.metrics[metric]++;

}

}



snapshot(){

return {

...this.metrics

};

}



}



module.exports =
CallbackMetrics;