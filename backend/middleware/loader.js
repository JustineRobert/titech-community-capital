"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Middleware Loader
 *
 * Responsibilities:
 *
 * - Discover middleware modules
 * - Validate middleware manifests
 * - Build middleware inventory
 * - Register middleware metadata
 *
 */



const fs =
    require("fs");

const path =
    require("path");



const {

    MiddlewareBootstrapError

}
=
require("./errors");









/**
 * Default configuration
 */
const DEFAULT_CONFIG = {


    directory:

        __dirname,



    recursive:

        true,



    extensions:

        [

            ".js"

        ],



    ignore:

        [

            "index.js",

            "loader.js",

            "pipeline.js",

            "registry.js",

            "errors.js"

        ]



};









/**
 * Validate middleware manifest
 */
function validateManifest(

    middleware

){



    const required =

        [

            "name",

            "factory"

        ];








    const missing =

        required.filter(

            field =>

                !middleware[field]

        );








    if(

        missing.length

    ){



        throw new MiddlewareBootstrapError(

            "Invalid middleware manifest",

            {

                missing

            }

        );


    }








    return true;


}









/**
 * Check duplicate middleware
 */
function ensureUnique(

    registry,

    middleware

){



    if(

        registry.has(

            middleware.name

        )

    ){



        throw new MiddlewareBootstrapError(

            "Duplicate middleware detected",

            {

                name:

                    middleware.name

            }

        );


    }


}









/**
 * Discover files recursively
 */
function discoverFiles(

    directory,

    config

){



    let files = [];








    const entries =

        fs.readdirSync(

            directory,

            {

                withFileTypes:true

            }

        );








    for(

        const entry of entries

    ){



        const fullPath =

            path.join(

                directory,

                entry.name

            );








        if(

            entry.isDirectory()

            &&

            config.recursive

        ){



            files.push(

                ...discoverFiles(

                    fullPath,

                    config

                )

            );

            continue;

        }








        if(

            !entry.isFile()

        ){

            continue;

        }








        if(

            !config.extensions.includes(

                path.extname(

                    entry.name

                )

            )

        ){

            continue;

        }








        if(

            config.ignore.includes(

                entry.name

            )

        ){

            continue;

        }








        files.push(

            fullPath

        );


    }








    return files;


}









/**
 * Middleware Loader
 */
class MiddlewareLoader {



    constructor(options = {}){


        this.config = {


            ...DEFAULT_CONFIG,


            ...options


        };




        this.registry =

            new Map();



    }









    /**
     * Load middleware module
     */
    loadModule(

        file

    ){



        try {



            delete require.cache[

                require.resolve(

                    file

                )

            ];








            const middleware =

                require(

                    file

                );








            if(

                !middleware

            ){

                return null;

            }








            /**
             * Ignore normal files
             */
            if(

                !middleware.name

            ){

                return null;

            }








            validateManifest(

                middleware

            );








            ensureUnique(

                this.registry,

                middleware

            );








            this.registry.set(

                middleware.name,

                {

                    ...middleware,


                    file

                }

            );








            return middleware;


        }


        catch(error){



            throw new MiddlewareBootstrapError(

                "Failed loading middleware",

                {

                    file,

                    error:
                        error.message

                }

            );


        }



    }









    /**
     * Load all middleware
     */
    load(){



        const files =

            discoverFiles(

                this.config.directory,

                this.config

            );








        const loaded = [];








        for(

            const file of files

        ){



            const middleware =

                this.loadModule(

                    file

                );








            if(

                middleware

            ){

                loaded.push(

                    middleware

                );

            }


        }








        return loaded;


    }









    /**
     * Return registry
     */
    getRegistry(){



        return Array.from(

            this.registry.values()

        );


    }









    /**
     * Find middleware
     */
    get(

        name

    ){



        return this.registry.get(

            name

        );


    }









    /**
     * Diagnostics
     */
    diagnostics(){



        return {


            count:

                this.registry.size,



            middleware:

                Array.from(

                    this.registry.keys()

                )



        };


    }



}









/**
 * Factory helper
 */
function createMiddlewareLoader(

    options

){



    return new MiddlewareLoader(

        options

    );


}









/**
 * Health check
 */
async function healthCheck(){


    return {


        status:

            "healthy"



    };


}









module.exports = {


    MiddlewareLoader,


    createMiddlewareLoader,


    validateManifest,


    discoverFiles,


    healthCheck


};