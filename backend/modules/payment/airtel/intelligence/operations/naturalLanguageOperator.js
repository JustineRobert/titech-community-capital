'use strict';


class NaturalLanguageOperator {


    constructor({

        commandEngine

    } = {}) {


        this.commandEngine =
            commandEngine;


    }



    async execute(command) {


        return this.commandEngine.interpret({

            command

        });


    }


}



module.exports = NaturalLanguageOperator;