// utils/tracing.js
'use strict';

// start tracing as early as possible
require('./utils/tracing');

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http'); // http exporter fallback
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'titech-fintech-api';
const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
const SAMPLE_RATE = parseFloat(process.env.OTEL_SAMPLE_RATE || '1.0'); // 0.0 - 1.0

// Create resource describing this service
const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
});

// Configure exporter only if endpoint provided
const exporters = [];
if (OTEL_ENDPOINT) {
  const traceExporter = new OTLPTraceExporter({
    url: OTEL_ENDPOINT,
    headers: {}, // add auth headers here if needed: { 'api-key': process.env.OTEL_API_KEY }
  });
  exporters.push(new BatchSpanProcessor(traceExporter));
} else {
  // No remote exporter configured — SDK will still enable local instrumentation and sampling.
  // This is intentional for local/dev environments.
  // You may add a console exporter here for debugging if desired.
}

// Build SDK
const sdk = new NodeSDK({
  resource,
  instrumentations: [getNodeAutoInstrumentations()],
  spanProcessor: exporters.length ? exporters[0] : undefined,
  sampler: SAMPLE_RATE >= 1 ? undefined : new (require('@opentelemetry/core').ParentBasedSampler)(
    new (require('@opentelemetry/core').TraceIdRatioBasedSampler)(SAMPLE_RATE)
  ),
});

// Start SDK and handle lifecycle
(async () => {
  try {
    await sdk.start();
    console.info('✅ OpenTelemetry tracing started', { service: SERVICE_NAME, env: process.env.NODE_ENV });
  } catch (err) {
    console.error('❌ Failed to start OpenTelemetry SDK', err);
  }
})();

// Graceful shutdown on process termination
const shutdown = async (signal) => {
  try {
    console.info(`🛑 Tracing shutdown initiated (${signal})`);
    await sdk.shutdown();
    console.info('✅ OpenTelemetry tracing stopped gracefully');
    // allow process to exit naturally
  } catch (err) {
    console.error('❌ Error during OpenTelemetry shutdown', err);
    // force exit if shutdown fails
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Export SDK instance for tests or advanced usage
module.exports = { sdk };
