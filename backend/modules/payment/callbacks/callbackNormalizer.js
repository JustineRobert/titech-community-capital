/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Normalizer
 * ============================================================================
 */


class CallbackNormalizer {


    constructor() {

        this.normalizers = new Map();

    }



    register(provider, normalizer) {

        this.normalizers.set(
            provider,
            normalizer
        );

    }



    normalize(provider, payload) {


        const normalizer =
            this.normalizers.get(provider);



        if (!normalizer) {

            throw new Error(
                `No normalizer registered for ${provider}`
            );

        }



        return normalizer.normalize(
            payload
        );


    }


}



module.exports = CallbackNormalizer;