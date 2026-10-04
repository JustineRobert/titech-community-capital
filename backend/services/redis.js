/**
 * TITech Redis ESM compatibility facade.
 *
 * Canonical implementation is kept in redis.cjs because the legacy Redis
 * implementation is CommonJS. This explicit boundary prevents Node's ESM
 * loader from treating CommonJS source as ESM while preserving one Redis
 * implementation.
 */
import redis from './redis.cjs';

export const client = redis.client;
export const isReady = redis.isReady;
export const getStatus = redis.getStatus;
export const waitForReady = redis.waitForReady;
export const createRateLimitStore = redis.createRateLimitStore;
export const events = redis.events;
export const gracefullyDegraded = redis.gracefullyDegraded;
export default redis;
