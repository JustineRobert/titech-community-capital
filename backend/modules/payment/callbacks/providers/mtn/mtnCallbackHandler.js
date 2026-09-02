/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Handler
 * ============================================================================
 */

class MtnCallbackHandler {


    constructor({

        normalizer,

        validator,

        logger

    }) {

        this.normalizer = normalizer;

        this.validator = validator;

        this.logger = logger;

    }



    async handle({

        payload,

        context = {}

    }) {


        await this.validator.validate({

            provider: "mtn_momo",

            payload,

            signature:
                context.signature

        });



        const normalized =
            await this.normalizer.normalize(
                payload
            );



        this.logger?.info(
            "MTN callback processed",
            {
                transactionId:
                    normalized.transactionId
            }
        );


        return normalized;


    }


}



module.exports = MtnCallbackHandler;