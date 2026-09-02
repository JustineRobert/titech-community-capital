'use strict';


class LiquidityOptimizer {


    constructor({

        predictionEngine

    } = {}) {


        this.predictionEngine =
            predictionEngine;


    }



    async forecast({

        transactions

    }) {


        return this.predictionEngine.predictLiquidity({

            transactions

        });


    }



    async optimize({

        forecast

    }) {


        return {


            recommendation:

                'OPTIMIZE_SETTLEMENT_WINDOW',


            forecast


        };


    }


}



module.exports = LiquidityOptimizer;