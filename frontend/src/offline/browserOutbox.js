'use strict';

const DATABASE_NAME = 'titech-offline-outbox';
const DATABASE_VERSION = 1;
const STORE_NAME = 'operations';
const MAX_OPERATION_BYTES = 1024 * 1024;

function assertIndexedDb() {
  if (typeof indexedDB === 'undefined') {
    const error = new Error(
      'Durable offline storage is unavailable in this browser.'
    );
    error.code = 'OFFLINE_STORAGE_UNAVAILABLE';
    throw error;
  }
}

function openDatabase() {
  assertIndexedDb();

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      DATABASE_NAME,
      DATABASE_VERSION
    );

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(
          STORE_NAME,
          { keyPath: 'eventId' }
        );
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(mode, callback) {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;

    try {
      result = callback(store);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Offline storage transaction aborted.'));
    };
  }));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

async function sha256(value) {
  const serialized = stableSerialize(value);

  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(serialized);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  const error = new Error('Web Crypto is required for offline event integrity.');
  error.code = 'OFFLINE_CRYPTO_UNAVAILABLE';
  throw error;
}

export async function createOfflineEvent({
  eventType,
  payload = {},
  tenantId,
  deviceId,
  userId = null,
  aggregateType = null,
  aggregateId = null,
  sequenceNumber = null,
  idempotencyKey,
}) {
  if (!eventType || !tenantId || !deviceId || !idempotencyKey) {
    const error = new Error(
      'eventType, tenantId, deviceId, and idempotencyKey are required.'
    );
    error.code = 'OFFLINE_EVENT_INVALID';
    throw error;
  }

  const event = {
    eventId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    eventType: String(eventType).trim(),
    eventVersion: 1,
    tenantId: String(tenantId).trim(),
    deviceId: String(deviceId).trim(),
    userId: userId ? String(userId).trim() : null,
    aggregateType,
    aggregateId,
    sequenceNumber,
    idempotencyKey: String(idempotencyKey).trim(),
    payload,
    occurredAt: new Date().toISOString(),
  };

  const eventHash = await sha256(event);
  const record = {
    ...event,
    eventHash,
    status: 'PENDING',
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastError: null,
  };

  if (new TextEncoder().encode(stableSerialize(record)).byteLength > MAX_OPERATION_BYTES) {
    const error = new Error('Offline event exceeds the permitted payload size.');
    error.code = 'OFFLINE_EVENT_TOO_LARGE';
    throw error;
  }

  return record;
}

export async function enqueueOfflineEvent(event) {
  return runTransaction('readwrite', store => {
    store.put(event);
    return event;
  });
}

export async function listOfflineEvents({ limit = 50 } = {}) {
  const events = await runTransaction('readonly', store => requestResult(store.getAll()));
  return events
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(0, limit);
}

export async function getPendingOfflineEvents({ limit = 50 } = {}) {
  const events = await listOfflineEvents({ limit: Number.MAX_SAFE_INTEGER });
  return events
    .filter(event => event.status === 'PENDING' || event.status === 'FAILED')
    .slice(0, limit);
}

export async function updateOfflineEvent(eventId, updates) {
  let next = null;

  await runTransaction('readwrite', store => {
    const request = store.get(eventId);
    request.onsuccess = () => {
      if (request.result) {
        next = {
          ...request.result,
          ...updates,
          updatedAt: Date.now(),
        };
        store.put(next);
      }
    };
  });

  return next;
}

export async function removeOfflineEvent(eventId) {
  return runTransaction('readwrite', store => store.delete(eventId));
}

export async function countOfflineEvents() {
  return runTransaction('readonly', store => requestResult(store.count()));
}
