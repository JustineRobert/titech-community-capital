'use strict';


class ReservedBalance {


    constructor({

        reservationRepository

    }={}){


        this.reservationRepository =
            reservationRepository;

    }





    async calculate({

        tenantId,

        accountId

    }){


        const reservations =
            await this.reservationRepository
                .active({

                    tenantId,

                    accountId

                });



        return reservations.reduce(

            (sum,item)=>
                sum + item.amount,

            0

        );

    }


}


module.exports =
    ReservedBalance;