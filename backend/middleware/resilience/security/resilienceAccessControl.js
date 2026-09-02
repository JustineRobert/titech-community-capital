'use strict';


const PERMISSIONS =
Object.freeze({

    VIEW:

        'RESILIENCE_VIEW',


    CONFIGURE:

        'RESILIENCE_CONFIGURE',


    RECOVER:

        'RESILIENCE_RECOVERY',


    ADMIN:

        'RESILIENCE_ADMIN'

});



class ResilienceAccessControl {


    authorize(
        context,
        permission
    )
    {


        if(
            !context
            ||
            !context.permissions
        )
        {

            return false;

        }



        return context.permissions.includes(

            permission

        );

    }



}



module.exports =
{

    ResilienceAccessControl,

    PERMISSIONS

};