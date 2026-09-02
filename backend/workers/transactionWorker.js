import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  createTransaction,
  postEntries,
  finalize,
} from '../services/ledgerService.js';

const connection = new IORedis();

const worker = new Worker(
  'transactions',
  async (job) => {
    const { amount, accountId } = job.data;

    const txn = await createTransaction({
      type: 'deposit',
      amount,
      tenantId: job.data.tenantId,
    });

    await postEntries(txn._id, [
      { accountId: 'momo_clearing', type: 'debit', amount },
      { accountId, type: 'credit', amount },
    ]);

    await finalize(txn._id);
  },
  { connection }
);

worker.on('completed', (job) => {
  console.log('Job completed:', job.id);
});

worker.on('failed', (job, err) => {
  console.error('Job failed:', err);
});