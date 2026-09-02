"use strict";


class RetryStartupProbe {



    constructor(){


        this.started =
            false;


    }





    markStarted(){


        this.started =
            true;


    }





    check(){


        return {


            started:
                this.started


        };


    }


}



module.exports={

    RetryStartupProbe

};