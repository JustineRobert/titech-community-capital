'use strict';


class FinancialSafetyValidator {


    validate(
        transactionState
    )
    {


        return {


            ledgerBalanced:

                transactionState.debit ===
                transactionState.credit,



            transactionProtected:

                transactionState.status !==
                'CORRUPTED'

        };

    }



}



module.exports =
    FinancialSafetyValidator;