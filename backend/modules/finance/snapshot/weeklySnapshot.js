'use strict';


class WeeklySnapshot {


    constructor({

        dailySnapshot

    }={}){


        this.dailySnapshot =
            dailySnapshot;

    }





    async generate(data){


        const snapshot =
            await this.dailySnapshot
                .generate(data);



        return {

            ...snapshot,

            type:
                'WEEKLY'

        };

    }


}


module.exports =
    WeeklySnapshot;