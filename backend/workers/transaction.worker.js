// workers/transaction.worker.js
'use strict';

const { Worker, QueueScheduler } = require('bullmq');
const IORedis = require('ioredis');
const logger = require('../utils/logger'); // your structured logger
const { httpRequestsTotal, httpErrorsTotal } = require('../utils/metrics'); // optional metrics

// Redis connection (URL preferred)
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_URI || null;
const redisConnection = REDIS_URL
  ? new IORedis(REDIS_URL)
  : new IORedis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    });

// Ensure a QueueScheduler exists for retries/delayed jobs
const scheduler = new QueueScheduler('transactions', { connection: redisConnection });

// Worker options
const CONCURRENCY = parseInt(process.env.TRANSACTION_WORKER_CONCURRENCY || '5', 10);
const WORKER_NAME = 'transactions-worker';

// Create worker
const worker = new Worker(
  'transactions',
  async (job) => {
    const start = Date.now();
    try {
      logger.info('Processing transaction job start', { jobId: job.id, name: job.name, data: job.data });

      // ===== Your job processing logic goes here =====
      // Example placeholder:
      // const transactionService = require('../services/transaction.service');
      // await transactionService.handleTransactionJob(job.data);
      // =================================================

      // Example: simulate work for clarity (remove in production)
      // await new Promise((r) => setTimeout(r, 100));

      logger.info('Processing transaction job success', { jobId: job.id, name: job.name });
      if (httpRequestsTotal) {
        httpRequestsTotal.inc({ method: 'WORKER', route: 'transactions', status: 'completed' });
      }
      return { success: true };
    } catch (err) {
      logger.error('Processing transaction job failed', { jobId: job.id, name: job.name, error: err.message, stack: err.stack });
      if (httpErrorsTotal) {
        httpErrorsTotal.inc({ method: 'WORKER', route: 'transactions', status: 'failed' });
      }
      // Re-throw so BullMQ can apply attempts/backoff configured when job was added
      throw err;
    } finally {
      const durationMs = Date.now() - start;
      logger.debug('Transaction job duration', { jobId: job.id, durationMs });
    }
  },
  {
    connection: redisConnection,
    concurrency: CONCURRENCY,
    // Optional: set lockDuration, autorun, etc. via worker options if needed
  }
);

// Worker lifecycle listeners
worker.on('completed', (job) => {
  logger.info('Job completed', { jobId: job.id, name: job.name });
});

worker.on('failed', (job, err) => {
  logger.warn('Job failed', { jobId: job?.id, name: job?.name, attemptsMade: job?.attemptsMade, failedReason: err?.message });
});

worker.on('error', (err) => {
  logger.error('Worker error', { worker: WORKER_NAME, error: err.message, stack: err.stack });
});

// Graceful shutdown
const shutdown = async (signal) => {
  try {
    logger.info('Shutting down transaction worker', { signal });
    await worker.close(); // stops processing new jobs and waits for active jobs to finish
    await scheduler.close();
    await redisConnection.quit();
    logger.info('Transaction worker shut down complete');
    // Do not call process.exit here; let the caller decide
  } catch (err) {
    logger.error('Error during worker shutdown', { error: err.message, stack: err.stack });
    // force exit if necessary in your orchestrator
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Export worker and shutdown helper for external lifecycle control or tests
module.exports = {
  worker,
  shutdown,
};
