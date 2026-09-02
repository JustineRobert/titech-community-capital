'use strict';


class PendingBalance {


    constructor({

        transactionRepository

    }={}){


        this.transactionRepository =
            transactionRepository;

    }





    async calculate({

        tenantId,

        accountId

    }){


        const pending =
            await this.transactionRepository
                .findPending({

                    tenantId,

                    accountId

                });



        return pending.reduce(

            (sum,item)=>
                sum + item.amount,

            0

        );

    }


}


module.exports =
    PendingBalance;