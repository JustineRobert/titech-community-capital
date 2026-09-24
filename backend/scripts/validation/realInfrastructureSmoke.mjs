#!/usr/bin/env node
/**
 * TITech Community Capital
 * Real infrastructure smoke and concurrency evidence runner.
 *
 * Scope:
 *   - real MongoDB ping
 *   - replica-set transaction commit
 *   - atomic MongoDB concurrency
 *   - duplicate/idempotency uniqueness behavior
 *   - real Redis ping
 *   - Redis concurrency
 *
 * This script does not claim provider, security, DR, Kubernetes or pilot proof.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const REPORT = path.join(ROOT, 'reports', 'real-infrastructure-smoke.json');
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const dbName = process.env.TITECH_VALIDATION_DB || 'titech_validation';

const result = {
  schemaVersion: '1.0.0',
  status: 'NOT_VERIFIED',
  startedAt: new Date().toISOString(),
  runtime: { node: process.version },
  mongo: { status: 'NOT_VERIFIED', uriConfigured: Boolean(mongoUri), checks: [] },
  redis: { status: 'NOT_VERIFIED', uriConfigured: Boolean(redisUrl), checks: [] },
  notes: [],
};

fs.mkdirSync(path.dirname(REPORT), { recursive: true });

if (!mongoUri) {
  result.mongo.status = 'BLOCKED';
  result.notes.push('MONGO_URI/MONGODB_URI is not configured.');
}

let mongo;
let redis;
let mongoDb;

try {
  if (mongoUri) {
    mongo = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      retryWrites: true,
      retryReads: true,
    });
    await mongo.connect();
    mongoDb = mongo.db(dbName);

    await mongo.db('admin').command({ ping: 1 });
    result.mongo.checks.push({ name: 'ping', status: 'PASS' });

    const session = mongo.startSession();
    try {
      const transactions = mongoDb.collection('_titech_validation_transactions');
      await session.withTransaction(async () => {
        await transactions.insertOne(
          { kind: 'transaction', createdAt: new Date(), marker: 'real-infrastructure-smoke' },
          { session },
        );
      });
      result.mongo.checks.push({ name: 'transactionCommit', status: 'PASS' });
    } catch (error) {
      result.mongo.checks.push({ name: 'transactionCommit', status: 'FAIL', error: error.message });
    } finally {
      await session.endSession();
    }

    const counters = mongoDb.collection('_titech_validation_counters');
    await counters.deleteMany({ _id: 'concurrency' });
    await counters.insertOne({ _id: 'concurrency', value: 0 });
    const concurrencyCount = 25;
    await Promise.all(
      Array.from({ length: concurrencyCount }, () =>
        counters.updateOne({ _id: 'concurrency' }, { $inc: { value: 1 } }),
      ),
    );
    const counter = await counters.findOne({ _id: 'concurrency' });
    const concurrencyPass = counter?.value === concurrencyCount;
    result.mongo.checks.push({
      name: 'atomicConcurrency',
      status: concurrencyPass ? 'PASS' : 'FAIL',
      expected: concurrencyCount,
      observed: counter?.value ?? null,
    });

    const idempotency = mongoDb.collection('_titech_validation_idempotency');
    await idempotency.drop().catch(() => undefined);
    await idempotency.createIndex({ key: 1 }, { unique: true });
    const duplicateKeyResults = await Promise.allSettled(
      Array.from({ length: 10 }, () => idempotency.insertOne({ key: 'same-key', createdAt: new Date() })),
    );
    const fulfilled = duplicateKeyResults.filter((item) => item.status === 'fulfilled').length;
    const rejected = duplicateKeyResults.filter((item) => item.status === 'rejected').length;
    const idempotencyPass = fulfilled === 1 && rejected === 9;
    result.mongo.checks.push({ name: 'duplicateIdempotency', status: idempotencyPass ? 'PASS' : 'FAIL', fulfilled, rejected });

    await transactions.deleteMany({});
    await counters.deleteMany({});
    await idempotency.deleteMany({});
    result.mongo.status = result.mongo.checks.every((check) => check.status === 'PASS') ? 'PASS' : 'FAIL';
  }

  redis = new Redis(redisUrl, { connectTimeout: 5000, lazyConnect: false, maxRetriesPerRequest: 2 });
  const ping = await redis.ping();
  result.redis.checks.push({ name: 'ping', status: ping === 'PONG' ? 'PASS' : 'FAIL', observed: ping });

  const key = `titech:validation:concurrency:${Date.now()}`;
  await redis.set(key, '0');
  const redisCount = 100;
  await Promise.all(Array.from({ length: redisCount }, () => redis.incr(key)));
  const value = Number(await redis.get(key));
  const redisPass = value === redisCount;
  result.redis.checks.push({ name: 'atomicConcurrency', status: redisPass ? 'PASS' : 'FAIL', expected: redisCount, observed: value });
  await redis.del(key);
  result.redis.status = result.redis.checks.every((check) => check.status === 'PASS') ? 'PASS' : 'FAIL';
} catch (error) {
  result.notes.push(error?.stack || error?.message || String(error));
  if (result.mongo.status === 'NOT_VERIFIED') result.mongo.status = 'FAIL';
  if (result.redis.status === 'NOT_VERIFIED') result.redis.status = 'FAIL';
} finally {
  try { await redis?.quit(); } catch {}
  try { await mongo?.close(); } catch {}
}

result.finishedAt = new Date().toISOString();
const required = [result.mongo.status, result.redis.status];
result.status = required.every((status) => status === 'PASS') ? 'PASS' : 'NOT_VERIFIED';
if (result.status !== 'PASS' && !result.notes.length) {
  result.notes.push('One or more real infrastructure checks did not pass.');
}
fs.writeFileSync(REPORT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === 'PASS' ? 0 : 1;
