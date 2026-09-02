'use strict';


class ResilienceAgent {


    constructor(
        name,
        intelligence
    )
    {

        this.name =
            name;


        this.intelligence =
            intelligence;

    }



    async analyze(
        incident
    )
    {


        const risk =
            await this.intelligence.predict(

                incident

            );



        if(
            risk.risk === 'HIGH'
        )
        {


            return {


                agent:

                    this.name,


                action:

                    'SELF_HEAL',


                incident

            };


        }



        return {


            agent:

                this.name,


            action:

                null

        };


    }



}



module.exports =
    ResilienceAgent;