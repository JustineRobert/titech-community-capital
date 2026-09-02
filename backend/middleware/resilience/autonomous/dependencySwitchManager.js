'use strict';


class DependencySwitchManager {


    constructor()
    {

        this.providers =
            {};

    }



    register(
        service,
        providers
    )
    {

        this.providers[service] =
            providers;

    }





    switch(
        service
    )
    {


        const list =
            this.providers[service];



        if(!list)
        {

            return null;

        }



        const backup =
            list.find(

                p=>p.available

            );



        return backup;

    }



}



module.exports =
    DependencySwitchManager;