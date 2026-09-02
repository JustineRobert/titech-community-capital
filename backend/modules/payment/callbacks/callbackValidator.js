/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Validator
 * ============================================================================
 */


class CallbackValidator {


    constructor({

        signatureVerifier,

        clock = Date

    }) {


        this.signatureVerifier =
            signatureVerifier;


        this.clock =
            clock;

    }



    async validate({

        provider,

        payload,

        signature

    }) {


        if (!payload) {

            throw new Error(
                "Callback payload missing"
            );

        }



        if(signature) {

            const valid =
                await this.signatureVerifier.verify({

                    provider,

                    payload,

                    signature

                });



            if(!valid) {

                throw new Error(
                    "Invalid callback signature"
                );

            }

        }



        return true;

    }


}



module.exports = CallbackValidator;