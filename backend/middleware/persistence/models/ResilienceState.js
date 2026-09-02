'use strict';


const mongoose =
require('mongoose');



const schema =
new mongoose.Schema({

    type:
    {
        type:String,
        index:true
    },


    name:
    {
        type:String,
        index:true
    },


    state:
    {
        type:Object
    },


    tenantId:
    {
        type:String,
        index:true
    }


},
{
    timestamps:true
});



module.exports =
mongoose.model(

    'ResilienceState',

    schema

);