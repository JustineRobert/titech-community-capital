class ApplicationContext {

    constructor({
        config,
        services,
        bootstrap,
        runtime
    }) {

        this.config = config;

        this.services = services;

        this.bootstrap = bootstrap;

        this.runtime = runtime;

        Object.freeze(this);

    }

}

module.exports = ApplicationContext;