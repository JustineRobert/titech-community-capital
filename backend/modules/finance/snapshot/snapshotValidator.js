'use strict';


class SnapshotValidator {


    async validate(snapshot){


        const errors=[];



        if(!snapshot.tenantId){

            errors.push(
                'Missing tenant'
            );

        }



        if(!snapshot.type){

            errors.push(
                'Missing snapshot type'
            );

        }



        return {


            valid:
                errors.length===0,


            errors

        };

    }


}



module.exports =
    SnapshotValidator;