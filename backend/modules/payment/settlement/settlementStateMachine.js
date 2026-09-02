/**
 * TITech Community Capital LTD
 * Settlement Lifecycle Controller
 */


const STATES =
Object.freeze({

RECEIVED:
"RECEIVED",

VALIDATING:
"VALIDATING",

PROCESSING:
"PROCESSING",

POSTED:
"POSTED",

SETTLED:
"SETTLED",

FAILED:
"FAILED",

REVERSED:
"REVERSED"

});



const transitions =
{

RECEIVED:
[
"VALIDATING"
],

VALIDATING:
[
"PROCESSING",
"FAILED"
],


PROCESSING:
[
"POSTED",
"FAILED"
],


POSTED:
[
"SETTLED",
"FAILED"
],


FAILED:
[
"REVERSED"
]

};



class SettlementStateMachine {



canTransition(
from,
to
){

return transitions[from]
?.includes(to);

}



transition(
settlement,
next
){


if(
!this.canTransition(
settlement.status,
next
)
){

throw new Error(

`Invalid settlement transition ${settlement.status} -> ${next}`

);

}



return {

...settlement,

status:next,

updatedAt:
new Date()

};


}


}



module.exports =
new SettlementStateMachine();


module.exports.STATES =
STATES;