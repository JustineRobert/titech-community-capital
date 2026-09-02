'use strict';


class YearEndSnapshot {


    constructor({

        monthlySnapshot

    }={}){


        this.monthlySnapshot =
            monthlySnapshot;

    }





    async generate(data){


        const snapshot =
            await this.monthlySnapshot
                .generate(data);



        return {

            ...snapshot,

            type:
                'YEAR_END',

            finalized:true

        };

    }


}



module.exports =
    YearEndSnapshot;