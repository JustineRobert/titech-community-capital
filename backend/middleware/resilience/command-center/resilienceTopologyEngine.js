'use strict';


class ResilienceTopologyEngine {


    constructor()
    {

        this.nodes=[];

    }



    addNode(
        node
    )
    {

        this.nodes.push(node);

    }



    graph()
    {


        return {


            nodes:

                this.nodes,


            generatedAt:

                new Date()

        };

    }



}



module.exports =
    ResilienceTopologyEngine;