'use strict';

/**
 * Canonical compatibility exports for the enterprise middleware pipeline.
 * The actual implementations remain in their dedicated files.
 */

const MiddlewarePipeline = require('./MiddlewarePipeline');
const PipelineStage = require('./PipelineStage');
const PipelineContext = require('./PipelineContext');
const StageRegistry = require('./StageRegistry');
const StageDiagnostics = require('./StageDiagnostics');
const PipelineBuilder = require('./PipelineBuilder');
const StageValidator = require('./StageValidator');

module.exports = Object.freeze({
  MiddlewarePipeline,
  PipelineStage,
  PipelineContext,
  StageRegistry,
  StageDiagnostics,
  PipelineBuilder,
  StageValidator,
  default: MiddlewarePipeline,
});
