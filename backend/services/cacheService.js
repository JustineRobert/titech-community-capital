'use strict';

/**
 * Small compatibility facade over the repository Redis service.
 * Financial cache policy remains owned by config/cache.js; this facade is used
 * only by legacy tenant/feature middleware caches.
 */

const redis = require('./redis.cjs');
const localStore = new Map();

function serialize(value) {
  return JSON.stringify(value);
}

function deserialize(value) {
  if (value === null || value === undefined) return null;
  try { return JSON.parse(value); } catch { return value; }
}

async function get(key) {
  if (redis?.client && redis.isReady?.()) {
    return deserialize(await redis.client.get(key));
  }
  const entry = localStore.get(key);
  if (!entry || (entry.expiresAt && entry.expiresAt <= Date.now())) {
    localStore.delete(key);
    return null;
  }
  return entry.value;
}

async function set(key, value, ttlSeconds = 300) {
  const ttl = Number(ttlSeconds);
  if (redis?.client && redis.isReady?.()) {
    const payload = serialize(value);
    if (Number.isFinite(ttl) && ttl > 0) {
      await redis.client.set(key, payload, 'EX', Math.max(1, Math.floor(ttl)));
    } else {
      await redis.client.set(key, payload);
    }
    return true;
  }

  localStore.set(key, {
    value,
    expiresAt: Number.isFinite(ttl) && ttl > 0 ? Date.now() + ttl * 1000 : null,
  });
  return true;
}

async function del(key) {
  localStore.delete(key);
  if (redis?.client && redis.isReady?.()) return redis.client.del(key);
  return 1;
}

async function exists(key) {
  if (redis?.client && redis.isReady?.()) return Number(await redis.client.exists(key)) > 0;
  return (await get(key)) !== null;
}

module.exports = Object.freeze({ get, set, del, delete: del, exists });
