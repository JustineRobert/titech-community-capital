'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Airtel Reconciliation Matcher
 * ----------------------------------------------------------
 * Enterprise transaction matching intelligence component.
 *
 * Responsibilities
 * ----------------
 * • Provider transaction matching
 * • Ledger transaction matching
 * • Multi-factor reconciliation rules
 * • Reference matching
 * • Amount validation
 * • Currency validation
 * • Date tolerance handling
 * • Duplicate detection
 * • Missing transaction detection
 * • Confidence scoring
 * • Match explanation generation
 * • Exception classification
 * • Metrics instrumentation
 * • Audit hooks
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Provider API calls
 * • Ledger writes
 * • Settlement execution
 * • Payment processing
 *
 * ==========================================================
 */


const crypto = require('crypto');

const {
    normalizeError
} = require('../../shared/errors');



const MATCH_RESULT = Object.freeze({

    MATCHED: 'MATCHED',

    PARTIAL_MATCH:

        'PARTIAL_MATCH',

    FAILED:

        'FAILED',

    DUPLICATE:

        'DUPLICATE',

    MISSING:

        'MISSING',

    REVIEW:

        'REVIEW'

});



const MATCH_RULES = Object.freeze({

    EXACT_REFERENCE:

        100,


    PROVIDER_REFERENCE:

        90,


    AMOUNT:

        40,


    CURRENCY:

        20,


    DATE:

        10

});






class ReconciliationMatcher {


    constructor({

        logger,

        metrics,

        tracer,

        tolerance = {

            amount: 0,

            days: 1

        },

        clock = Date


    } = {}) {



        this.logger =
            logger;


        this.metrics =
            metrics;


        this.tracer =
            tracer;


        this.tolerance =
            tolerance;


        this.clock =
            clock;




        this.statistics = {

            comparisons: 0,

            matched: 0,

            failed: 0,

            duplicates: 0,

            reviews: 0

        };


    }







    /**
     * ------------------------------------------------------
     * Match Single Transaction
     * ------------------------------------------------------
     */
    match({

        providerTransaction,

        ledgerTransaction


    }) {


        try {


            this.statistics.comparisons++;



            if(!providerTransaction || !ledgerTransaction){


                return this.createResult({

                    status:

                        MATCH_RESULT.MISSING,


                    score:

                        0

                });


            }






            let score = 0;

            const reasons = [];






            /**
             * Exact transaction reference
             */
            if(

                providerTransaction.reference

                &&

                providerTransaction.reference ===

                ledgerTransaction.reference

            ){


                score +=

                    MATCH_RULES.EXACT_REFERENCE;



                reasons.push(

                    'REFERENCE_MATCH'

                );


            }






            /**
             * Provider reference fallback
             */
            else if(

                providerTransaction.providerReference

                &&

                providerTransaction.providerReference ===

                ledgerTransaction.providerReference

            ){



                score +=

                    MATCH_RULES.PROVIDER_REFERENCE;



                reasons.push(

                    'PROVIDER_REFERENCE_MATCH'

                );


            }








            /**
             * Amount validation
             */
            if(

                this.amountMatches(

                    providerTransaction.amount,

                    ledgerTransaction.amount

                )

            ){


                score +=

                    MATCH_RULES.AMOUNT;



                reasons.push(

                    'AMOUNT_MATCH'

                );


            }







            /**
             * Currency validation
             */
            if(

                providerTransaction.currency ===

                ledgerTransaction.currency

            ){



                score +=

                    MATCH_RULES.CURRENCY;



                reasons.push(

                    'CURRENCY_MATCH'

                );

            }







            /**
             * Date validation
             */
            if(

                this.dateMatches(

                    providerTransaction.createdAt,

                    ledgerTransaction.createdAt

                )

            ){



                score +=

                    MATCH_RULES.DATE;



                reasons.push(

                    'DATE_MATCH'

                );


            }







            const status =

                this.resolveStatus(score);






            if(status === MATCH_RESULT.MATCHED){


                this.statistics.matched++;


            }

            else if(status === MATCH_RESULT.REVIEW){


                this.statistics.reviews++;


            }

            else {


                this.statistics.failed++;

            }








            return this.createResult({

                status,

                score,

                reasons,

                providerTransaction,

                ledgerTransaction

            });




        }


        catch(error){


            throw normalizeError(error, {


                metadata:{

                    operation:

                        'airtel_reconciliation_match'

                }

            });


        }


    }









    /**
     * ------------------------------------------------------
     * Batch Matching
     * ------------------------------------------------------
     */
    matchBatch({

        providerTransactions = [],

        ledgerTransactions = []


    }) {



        const ledgerIndex =

            this.buildLedgerIndex(

                ledgerTransactions

            );





        const results = [];





        for(const providerTx of providerTransactions){


            const candidates =

                this.findCandidates(

                    providerTx,

                    ledgerIndex

                );





            if(candidates.length === 0){


                results.push(

                    this.createResult({

                        status:

                            MATCH_RESULT.MISSING,


                        providerTransaction:

                            providerTx

                    })

                );


                continue;

            }







            const matches =

                candidates.map(candidate =>


                    this.match({

                        providerTransaction:

                            providerTx,


                        ledgerTransaction:

                            candidate

                    })

                );







            const best =

                matches.sort(

                    (a,b)=>

                        b.score - a.score

                )[0];






            results.push(best);



        }






        return results;


    }









    /**
     * ------------------------------------------------------
     * Find Matching Candidates
     * ------------------------------------------------------
     */
    findCandidates(transaction,index){


        const keys = [

            transaction.reference,

            transaction.providerReference

        ];



        const matches = [];





        for(const key of keys){



            if(key && index.has(key)){


                matches.push(

                    index.get(key)

                );


            }


        }



        return matches;


    }









    /**
     * ------------------------------------------------------
     * Build Ledger Index
     * ------------------------------------------------------
     */
    buildLedgerIndex(transactions){



        const index = new Map();




        for(const tx of transactions){



            if(tx.reference){


                index.set(

                    tx.reference,

                    tx

                );

            }





            if(tx.providerReference){


                index.set(

                    tx.providerReference,

                    tx

                );

            }


        }





        return index;


    }









    /**
     * ------------------------------------------------------
     * Duplicate Detection
     * ------------------------------------------------------
     */
    detectDuplicates(transactions = []){


        const seen = new Set();

        const duplicates = [];





        for(const tx of transactions){



            const fingerprint =

                this.generateFingerprint(tx);





            if(seen.has(fingerprint)){



                duplicates.push(tx);



                this.statistics.duplicates++;


            }





            seen.add(fingerprint);


        }




        return duplicates;


    }









    /**
     * ------------------------------------------------------
     * Fingerprint Generator
     * ------------------------------------------------------
     */
    generateFingerprint(transaction){


        return crypto

            .createHash('sha256')

            .update(

                JSON.stringify({

                    reference:

                        transaction.reference,


                    amount:

                        transaction.amount,


                    currency:

                        transaction.currency


                })

            )

            .digest('hex');


    }









    /**
     * ------------------------------------------------------
     * Amount Comparison
     * ------------------------------------------------------
     */
    amountMatches(a,b){


        return Math.abs(

            Number(a) - Number(b)

        )

        <=

        this.tolerance.amount;


    }









    /**
     * ------------------------------------------------------
     * Date Comparison
     * ------------------------------------------------------
     */
    dateMatches(a,b){


        if(!a || !b){

            return false;

        }




        const diff =

            Math.abs(

                new Date(a)

                -

                new Date(b)

            );





        return diff <=

            (

                this.tolerance.days *

                86400000

            );


    }









    /**
     * ------------------------------------------------------
     * Resolve Match Status
     * ------------------------------------------------------
     */
    resolveStatus(score){



        if(score >= 100){

            return MATCH_RESULT.MATCHED;

        }



        if(score >= 70){

            return MATCH_RESULT.PARTIAL_MATCH;

        }



        if(score >= 40){

            return MATCH_RESULT.REVIEW;

        }




        return MATCH_RESULT.FAILED;


    }









    /**
     * ------------------------------------------------------
     * Result Builder
     * ------------------------------------------------------
     */
    createResult({

        status,

        score = 0,

        reasons = [],

        providerTransaction = null,

        ledgerTransaction = null


    }){


        return {


            status,


            score,


            confidence:

                Math.min(score,100),


            reasons,


            providerTransaction,


            ledgerTransaction,


            timestamp:

                new this.clock()


        };


    }









    /**
     * ------------------------------------------------------
     * Statistics
     * ------------------------------------------------------
     */
    stats(){


        return {

            ...this.statistics

        };


    }





    /**
     * ------------------------------------------------------
     * Health
     * ------------------------------------------------------
     */
    health(){


        return {


            status:

                'UP',


            statistics:

                this.stats()


        };


    }



}




module.exports = {

    ReconciliationMatcher,

    MATCH_RESULT,

    MATCH_RULES

};