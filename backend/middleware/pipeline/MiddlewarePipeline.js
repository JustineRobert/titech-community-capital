"use strict";

/**
 * Canonical middleware pipeline builder/executor.
 */
class MiddlewarePipeline {
  constructor(registry = null, options = {}) {
    this.registry = registry;
    this.timeout = Number(options.timeout || 30000);
    this.logger = options.logger || null;
    this.executionHistory = [];
    this.installed = [];
    this.failed = [];
  }

  register(middleware) {
    if (this.registry?.register) this.registry.register(middleware);
    else this.installed.push(middleware);
    return this;
  }

  resolveExecutionOrder() {
    if (this.registry?.resolveExecutionOrder) return this.registry.resolveExecutionOrder();
    if (Array.isArray(this.registry?.middleware)) return [...this.registry.middleware];
    return [...this.installed];
  }

  async execute(context = {}) {
    const started = Date.now();
    const middleware = this.resolveExecutionOrder();
    const installed = [];

    try {
      for (const entry of middleware) {
        if (!entry) continue;
        if (typeof entry === "function") {
          installed.push(await entry(context));
        } else if (typeof entry.install === "function") {
          installed.push(await entry.install(context));
        } else {
          installed.push(entry);
        }
      }

      this.executionHistory.push({ status: "completed", started, completed: Date.now(), installed: [...installed] });
      return installed;
    } catch (error) {
      this.failed.push({ error, timestamp: Date.now() });
      this.executionHistory.push({ status: "failed", started, completed: Date.now(), error: error?.message });
      throw error;
    }
  }

  get history() { return [...this.executionHistory]; }
}

module.exports = MiddlewarePipeline;
module.exports.default = MiddlewarePipeline;
