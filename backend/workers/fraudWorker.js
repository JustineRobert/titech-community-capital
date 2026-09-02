import { Worker } from 'bullmq';
import { evaluateTransaction } from '../services/fraudEngine.js';

new Worker('transactions', async (job) => {
  const txn = job.data;

  const fraud = evaluateTransaction(txn);

  if (fraud.riskLevel === 'HIGH') {
    console.warn('🚨 FRAUD DETECTED', txn);
  }
});