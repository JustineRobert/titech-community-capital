/**
 * TITech Community Capital LTD
 * Atomic Financial Posting
 */


const ledgerService =
require(
"../../finance/services/ledgerService"
);



class LedgerPostingService {



async post(payment){



const journal = {

reference:

payment.transactionId,


description:

"Mobile Money Settlement",


entries:

[

{

account:
payment.customerAccount,

debit:
payment.amount

},

{

account:
payment.mobileMoneyAccount,

credit:
payment.amount

}

]


};



return ledgerService
.createJournal(
journal
);



}



async rollback(){

// ledger reversal hook

}



}



module.exports =
new LedgerPostingService();