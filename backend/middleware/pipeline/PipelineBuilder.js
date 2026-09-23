'use strict';

/**
 * Minimal builder contract retained for legacy middleware bootstrap callers.
 * It composes the canonical MiddlewarePipeline rather than creating a second
 * pipeline implementation.
 */

const MiddlewarePipeline = require('./MiddlewarePipeline');

class PipelineBuilder {
  constructor(options = {}) {
    this.registry = options.registry || null;
    this.pipeline = new MiddlewarePipeline(this.registry, options);
  }

  use(middleware) {
    this.pipeline.register(middleware);
    return this;
  }

  build() {
    return this.pipeline;
  }
}

module.exports = PipelineBuilder;
module.exports.default = PipelineBuilder;
