"use strict";


class RetryPCIControls {



    validatePaymentContext(context){


        if(
            context.operation === "payment"
        ){


            if(
                !context.idempotencyKey
            ){

                throw new Error(
                    "Payment retry requires idempotency key"
                );

            }


        }


        return true;


    }



}



module.exports={

    RetryPCIControls

};