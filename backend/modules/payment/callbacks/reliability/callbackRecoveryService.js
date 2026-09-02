/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Recovery Service
 * ============================================================================
 */


class CallbackRecoveryService {


constructor({

deadLetterRepository,

queue

}) {


this.repository =
deadLetterRepository;


this.queue =
queue;


}



async replay(id){


const failed =
await this.repository.findById(
id
);



if(!failed){

throw new Error(
"Failed callback not found"
);

}



return this.queue.add(

"callback-recovery",

failed.callback

);



}



}



module.exports =
CallbackRecoveryService;