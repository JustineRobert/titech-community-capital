/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Dispatcher
 * ============================================================================
 */


const {
    CallbackProviderNotFoundError
} = require("./callbackErrors");


class CallbackDispatcher {


    constructor({
        registry,
        logger
    }) {

        this.registry = registry;

        this.logger = logger;
    }



    async dispatch({

        provider,

        payload,

        context = {}

    }) {


        const handler =
            this.registry.resolve(provider);



        if (!handler) {

            throw new CallbackProviderNotFoundError(
                provider
            );

        }



        this.logger?.info(
            "Callback handler resolved",
            {
                provider
            }
        );



        return handler.handle({

            payload,

            context

        });


    }


}


module.exports = CallbackDispatcher;