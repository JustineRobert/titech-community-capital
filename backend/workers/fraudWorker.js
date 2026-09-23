import { Worker } from 'bullmq';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { evaluateTransaction } =
  require('../services/fraudEngine.js');

new Worker('transactions', async (job) => {
  const txn = job.data;

  const fraud = evaluateTransaction(txn);

  if (fraud.riskLevel === 'HIGH') {
    console.warn('🚨 FRAUD DETECTED', txn);
  }
});