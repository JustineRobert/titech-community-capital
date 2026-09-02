"use strict";


/**
 * ============================================================================
 * TITech Community Capital LTD
 *
 * File:
 * backend/src/modules/payments/reconciliation/reconciliation.repository.js
 *
 * Enterprise Reconciliation Repository Layer
 *
 * Responsibilities:
 *
 *  - MongoDB persistence only
 *  - Tenant isolation
 *  - Query optimization
 *  - Transaction/session support
 *  - Safe data updates
 *
 * Does NOT:
 *
 *  - Calculate reconciliation results
 *  - Match payments
 *  - Update ledger
 *  - Trigger workflows
 *
 * Business logic belongs in:
 *
 *      reconciliation.service.js
 *
 * ============================================================================
 */


const mongoose = require("mongoose");



class ReconciliationRepository {


    constructor(
        model
    ) {


        if(!model){

            throw new Error(
                "ReconciliationRepository requires a model"
            );

        }


        this.model =
            model;

    }





    /* ===================================================================== */
    /* CREATE                                                                */
    /* ===================================================================== */


    async create(
        tenantId,
        data,
        options = {}
    ){


        const document = {


            ...data,


            tenantId,


            deleted:false,


            createdAt:
                new Date(),


            updatedAt:
                new Date()


        };



        const [
            created
        ] =

            await this.model.create(

                [
                    document
                ],

                {

                    session:
                        options.session || undefined

                }

            );



        return created.toObject();

    }









    /* ===================================================================== */
    /* FIND BY ID                                                            */
    /* ===================================================================== */


    async findById(
        tenantId,
        id,
        options = {}
    ){


        if(
            !mongoose.Types.ObjectId.isValid(id)
        ){

            return null;

        }



        return this.model

            .findOne({

                _id:id,


                tenantId,


                deleted:false

            })


            .session(

                options.session || null

            )


            .lean();


    }









    /* ===================================================================== */
    /* FIND ONE                                                              */
    /* ===================================================================== */


    async findOne(
        tenantId,
        filter = {},
        options = {}
    ){


        return this.model

            .findOne({

                ...filter,


                tenantId,


                deleted:false

            })


            .session(

                options.session || null

            )


            .lean();


    }









    /* ===================================================================== */
    /* FIND ALL                                                              */
    /* ===================================================================== */


    async findAll(
        tenantId,
        filters = {},
        options = {}
    ){


        const {

            page = 1,

            limit = 50,

            sort = {
                createdAt:-1
            }


        } = options;



        const query = {


            ...filters,


            tenantId,


            deleted:false


        };



        const skip =

            (
                page - 1
            )

            *
            limit;





        const [

            data,

            total

        ] = await Promise.all([


            this.model

                .find(query)

                .sort(sort)

                .skip(skip)

                .limit(limit)

                .lean(),



            this.model

                .countDocuments(query)


        ]);





        return {


            data,


            pagination:{


                page,


                limit,


                total,


                pages:

                    Math.ceil(

                        total /
                        limit

                    )


            }


        };


    }









    /* ===================================================================== */
    /* FIND BY IDEMPOTENCY KEY                                               */
    /* ===================================================================== */


    async findByIdempotencyKey(
        tenantId,
        key,
        options = {}
    ){


        return this.model

            .findOne({

                tenantId,


                idempotencyKey:key,


                deleted:false

            })


            .session(

                options.session || null

            )


            .lean();


    }









    /* ===================================================================== */
    /* UPDATE BY ID                                                          */
    /* ===================================================================== */


    async updateById(
        tenantId,
        id,
        updates,
        options = {}
    ){


        if(
            !mongoose.Types.ObjectId.isValid(id)
        ){

            return null;

        }




        const protectedFields = [

            "_id",

            "tenantId",

            "createdAt",

            "createdBy",

            "deleted",

            "deletedAt"

        ];





        const sanitized =

            Object.keys(

                updates || {}

            )

            .filter(

                key =>

                    !protectedFields.includes(
                        key
                    )

            )

            .reduce(

                (result,key)=>{


                    result[key] =
                        updates[key];


                    return result;


                },

                {}

            );







        return this.model

            .findOneAndUpdate(

                {


                    _id:id,


                    tenantId,


                    deleted:false


                },


                {


                    $set:{


                        ...sanitized,


                        updatedAt:
                            new Date(),



                        ...(options.updatedBy && {


                            updatedBy:
                                options.updatedBy


                        })


                    }


                },


                {


                    new:true,


                    runValidators:true,


                    session:
                        options.session || undefined


                }


            )


            .lean();


    }









    /* ===================================================================== */
    /* UPDATE STATUS                                                         */
    /* ===================================================================== */


    async updateStatus(
        tenantId,
        id,
        status,
        options = {}
    ){


        return this.updateById(

            tenantId,

            id,

            {

                status

            },

            options

        );


    }









    /* ===================================================================== */
    /* BULK UPDATE                                                           */
    /* ===================================================================== */


    async bulkUpdateStatus(
        tenantId,
        ids,
        status,
        options = {}
    ){


        return this.model

            .updateMany(

                {


                    _id:
                        {

                            $in:ids

                        },


                    tenantId,


                    deleted:false


                },


                {


                    $set:{


                        status,


                        updatedAt:
                            new Date()


                    }


                },


                {


                    session:
                        options.session || undefined


                }


            );


    }









    /* ===================================================================== */
    /* SOFT DELETE                                                           */
    /* ===================================================================== */


    async softDelete(
        tenantId,
        id,
        options = {}
    ){


        return this.model

            .findOneAndUpdate(

                {


                    _id:id,


                    tenantId,


                    deleted:false


                },


                {


                    $set:{


                        deleted:true,


                        deletedAt:
                            new Date(),


                        updatedAt:
                            new Date(),


                        ...(options.deletedBy && {


                            deletedBy:
                                options.deletedBy


                        })


                    }


                },


                {


                    new:true,


                    session:
                        options.session || undefined


                }


            )


            .lean();


    }









    /* ===================================================================== */
    /* EXISTS                                                                */
    /* ===================================================================== */


    async exists(
        tenantId,
        filter={}
    ){


        return this.model.exists({

            ...filter,

            tenantId,

            deleted:false

        });


    }









    /* ===================================================================== */
    /* COUNT                                                                  */
    /* ===================================================================== */


    async count(
        tenantId,
        filter={}
    ){


        return this.model.countDocuments({

            ...filter,

            tenantId,

            deleted:false

        });


    }





}





module.exports =
    ReconciliationRepository;