// services/queue.js
'use strict';

const { Queue, Worker, QueueScheduler } = require('bullmq');
const IORedis = require('ioredis');
const logger = require('../utils/logger');

// Redis connection (supports URL or host/port)
const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI || null;
const redisOptions = redisUrl
  ? { connection: new IORedis(redisUrl) }
  : {
      connection: new IORedis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
      }),
    };

// Create queue schedulers (required for delayed/retry jobs)
const paymentRetryScheduler = new QueueScheduler('payment-retries', redisOptions);
const emailScheduler = new QueueScheduler('emails', redisOptions);
const overdueLoanScheduler = new QueueScheduler('overdue-loans', redisOptions);
const notificationScheduler = new QueueScheduler('notifications', redisOptions);

// Create queues
const paymentRetryQueue = new Queue('payment-retries', redisOptions);
const emailQueue = new Queue('emails', redisOptions);
const overdueLoanQueue = new Queue('overdue-loans', redisOptions);
const notificationQueue = new Queue('notifications', redisOptions);

// Default worker options
const DEFAULT_CONCURRENCY = parseInt(process.env.QUEUE_WORKER_CONCURRENCY || '5', 10);
const MAX_PAYMENT_RETRIES = parseInt(process.env.MAX_PAYMENT_RETRIES || '3', 10);

// Payment retry worker
const paymentRetryWorker = new Worker(
  'payment-retries',
  async (job) => {
    const { paymentIntentId, retryCount = 0 } = job.data;
    const backoffMs = 1000 * Math.pow(2, retryCount);

    try {
      const PaymentIntent = require('../models/PaymentIntent');
      const pi = await PaymentIntent.findById(paymentIntentId);
      if (!pi) throw new Error('Payment intent not found');

      // TODO: implement provider retry logic here (call provider SDK)
      pi.attempts = (pi.attempts || 0) + 1;
      await pi.save();

      logger.info('Payment retry processed', { paymentIntentId, attempt: pi.attempts, jobId: job.id });
      return { success: true };
    } catch (err) {
      logger.error('Payment retry failed', { paymentIntentId, error: err.message, jobId: job.id });

      // Re-throw to let BullMQ handle retries/backoff according to job opts
      throw err;
    }
  },
  { connection: redisOptions.connection, concurrency: DEFAULT_CONCURRENCY }
);

// Email worker
const emailWorker = new Worker(
  'emails',
  async (job) => {
    const { to, subject, html, text } = job.data;
    const EmailService = require('./emailService');

    try {
      await EmailService.send({ to, subject, html, text });
      logger.info('Email sent', { to, subject, jobId: job.id });
      return { success: true };
    } catch (err) {
      logger.error('Email failed', { to, error: err.message, jobId: job.id });
      throw err;
    }
  },
  { connection: redisOptions.connection, concurrency: DEFAULT_CONCURRENCY }
);

// Overdue loan detection worker (scheduled job should add a job to this queue)
const overdueLoanWorker = new Worker(
  'overdue-loans',
  async (job) => {
    const Loan = require('../models/Loan');
    const LoanRepaymentSchedule = require('../models/LoanRepaymentSchedule');
    const LoanWorkflowService = require('./loanWorkflowService');

    try {
      const loans = await Loan.find({ status: 'active' });
      for (const loan of loans) {
        const schedule = await LoanRepaymentSchedule.findOne({ loan: loan._id }).sort({ nextDueDate: 1 });
        if (schedule && schedule.nextDueDate && schedule.nextDueDate < new Date()) {
          await LoanWorkflowService.changeLoanStatus(loan._id, 'overdue', 'system', 'Past due date');
          await notificationQueue.add(
            'loan-overdue',
            { type: 'loan-overdue', loanId: loan._id, userId: loan.user },
            { removeOnComplete: true, removeOnFail: false }
          );
        }
      }
      logger.info('Overdue detection completed', { jobId: job.id });
      return { success: true };
    } catch (err) {
      logger.error('Overdue detection failed', { error: err.message, jobId: job.id });
      throw err;
    }
  },
  { connection: redisOptions.connection, concurrency: 1 } // run single-threaded to avoid race conditions
);

// Notification worker
const notificationWorker = new Worker(
  'notifications',
  async (job) => {
    const { type, loanId, userId } = job.data;

    try {
      if (type === 'loan-overdue') {
        const Loan = require('../models/Loan');
        const User = require('../models/User');
        const loan = await Loan.findById(loanId);
        if (!loan) throw new Error('Loan not found');

        const user = await User.findById(loan.user || userId);
        if (!user) throw new Error('User not found');

        // Queue email notification
        await emailQueue.add(
          'loan-overdue-email',
          {
            to: user.email,
            subject: 'Loan Payment Overdue',
            text: `Your loan is overdue. Please contact support.`,
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true }
        );
      }

      // Optionally emit real-time notifications (socket.io) if available
      try {
        const { io } = require('../server');
        if (io) {
          io.emit('notification', job.data);
        }
      } catch (emitErr) {
        // non-fatal: log and continue
        logger.debug('Socket emit failed', { error: emitErr.message, jobId: job.id });
      }

      logger.info('Notification processed', { type, loanId, jobId: job.id });
      return { success: true };
    } catch (err) {
      logger.error('Notification failed', { error: err.message, jobId: job.id });
      throw err;
    }
  },
  { connection: redisOptions.connection, concurrency: DEFAULT_CONCURRENCY }
);

// Global event listeners for workers
const attachWorkerListeners = (worker, name) => {
  worker.on('completed', (job) => {
    logger.info(`${name} job completed`, { jobId: job.id, name: job.name });
  });

  worker.on('failed', (job, err) => {
    logger.error(`${name} job failed`, { jobId: job?.id, name: job?.name, error: err?.message });
  });

  worker.on('error', (err) => {
    logger.error(`${name} worker error`, { error: err.message });
  });
};

attachWorkerListeners(paymentRetryWorker, 'payment-retries');
attachWorkerListeners(emailWorker, 'emails');
attachWorkerListeners(overdueLoanWorker, 'overdue-loans');
attachWorkerListeners(notificationWorker, 'notifications');

// Graceful shutdown helper
const shutdown = async () => {
  try {
    logger.info('Shutting down queue workers and schedulers');
    await Promise.all([
      paymentRetryWorker.close(),
      emailWorker.close(),
      overdueLoanWorker.close(),
      notificationWorker.close(),
      paymentRetryScheduler.close(),
      emailScheduler.close(),
      overdueLoanScheduler.close(),
      notificationScheduler.close(),
    ]);
    logger.info('Queue shutdown complete');
  } catch (err) {
    logger.error('Error during queue shutdown', { error: err.message });
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Export queues so other modules can add jobs
module.exports = {
  paymentRetryQueue,
  emailQueue,
  overdueLoanQueue,
  notificationQueue,
  // expose shutdown for external lifecycle management if needed
  shutdownQueues: shutdown,
};
