'use strict';


class BalanceSnapshot {


    constructor({

        repository

    }={}){


        this.repository =
            repository;

    }





    async create(balance){


        return this.repository
            .create({

                ...balance,

                snapshotDate:
                    new Date()

            });

    }


}


module.exports =
    BalanceSnapshot;