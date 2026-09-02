'use strict';


class SnapshotRepository {


    constructor({

        model

    }={}){


        this.model =
            model;

    }





    async save(snapshot){


        return this.model
            .create(snapshot);

    }





    async findById(id){


        return this.model
            .findById(id);

    }





    async archive(id){


        return this.model
            .updateOne(

                {
                    _id:id
                },

                {
                    archived:true
                }

            );

    }


}



module.exports =
    SnapshotRepository;