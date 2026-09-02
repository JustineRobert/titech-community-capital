'use strict';


class SlaSloManager {


    constructor()
    {

        this.targets =
        {

            availability:

                99.9,


            recoveryTime:

                300

        };

    }



    report()
    {

        return {


            targets:

                this.targets,


            status:

                'COMPLIANT'


        };

    }



}



module.exports =
    SlaSloManager;