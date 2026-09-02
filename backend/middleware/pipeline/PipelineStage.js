class PipelineStage {

    constructor({
        id,
        order,
        middleware,
        enabled = true,
        dependencies = []
    }) {

        this.id = id;

        this.order = order;

        this.middleware = middleware;

        this.enabled = enabled;

        this.dependencies = dependencies;

        Object.freeze(this);
    }

}

module.exports = PipelineStage;