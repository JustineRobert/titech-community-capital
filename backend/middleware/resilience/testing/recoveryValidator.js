'use strict';


class RecoveryValidator {


    validate(
        before,
        after
    )
    {


        return {


            recovered:

                before.state !== after.state,


            before,


            after


        };

    }



}



module.exports =
    RecoveryValidator;