'use strict';


class AvailableBalance {


    async calculate({

        ledger,

        pending,

        reserved

    }){


        return (

            ledger

            -

            pending

            -

            reserved

        );

    }


}


module.exports =
    AvailableBalance;