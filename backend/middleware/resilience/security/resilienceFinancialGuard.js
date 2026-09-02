'use strict';


class ResilienceFinancialGuard {


    constructor()
    {

        this.protectedOperations =
        [

            'LEDGER_WRITE',

            'LOAN_DISBURSEMENT',

            'PAYMENT_SETTLEMENT'

        ];

    }



    validate(
        operation
    )
    {


        if(
            this.protectedOperations.includes(
                operation.name
            )
        )
        {

            if(
                operation.degraded
            )
            {

                throw new Error(

                    'Financial operation blocked during degraded mode'

                );

            }

        }



        return true;

    }



}



module.exports =
    ResilienceFinancialGuard;