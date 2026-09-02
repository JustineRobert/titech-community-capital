'use strict';


/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * Enterprise Resilience State Repository Contract
 *
 * Responsibilities:
 *
 * ✓ Persist runtime state
 * ✓ Retrieve state
 * ✓ Update state
 * ✓ Remove state
 *
 * =============================================================================
 */


class ResilienceStateRepository {


    async save(
        state
    )
    {

        throw new Error(
            'save() not implemented'
        );

    }



    async find(
        query
    )
    {

        throw new Error(
            'find() not implemented'
        );

    }



    async update(
        id,
        update
    )
    {

        throw new Error(
            'update() not implemented'
        );

    }



    async delete(
        id
    )
    {

        throw new Error(
            'delete() not implemented'
        );

    }


}



module.exports =
    ResilienceStateRepository;