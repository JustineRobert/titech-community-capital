'use strict';


class LedgerBalance {


    constructor({

        ledgerRepository

    }={}){


        this.ledgerRepository =
            ledgerRepository;

    }





    async calculate({

        tenantId,

        accountId

    }){


        const entries =
            await this.ledgerRepository
                .findAccountEntries({

                    tenantId,

                    accountId

                });



        return entries.reduce(

            (total, entry)=>{


                return total
                    +
                    entry.debit
                    -
                    entry.credit;


            },

            0

        );

    }


}


module.exports =
    LedgerBalance;