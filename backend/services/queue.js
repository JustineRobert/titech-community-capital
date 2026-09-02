// services/queue.js
'use strict';

const { Queue } = require('bullmq');

const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI || null;
const connection = redisUrl
  ? { connection: { url: redisUrl } }
  : {
      connection: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    };

// Primary transaction queue (BullMQ)
const transactionQueue = new Queue('transactions', connection);

// Export queues for use across the app
module.exports = {
  transactionQueue,
};
