import test from 'node:test';
import assert from 'node:assert/strict';
import { up, down } from '../../../migrations/20261123_190000_group_creation_idempotency.js';

function makeMongoose({ duplicateAt = 0 } = {}) {
  const calls = { aggregates: 0, indexes: [] };
  const collection = {
    aggregate(pipeline) {
      calls.aggregates += 1;
      return {
        async toArray() {
          return calls.aggregates === duplicateAt ? [{ _id: 'duplicate', count: 2 }] : [];
        },
      };
    },
    async createIndex(keys, options) {
      calls.indexes.push({ keys, options });
      return options.name;
    },
  };
  return {
    calls,
    mongoose: { connection: { db: { collection: (name) => {
      assert.equal(name, 'groups');
      return collection;
    } } } },
  };
}

test('group idempotency migration performs duplicate preflight then creates both integrity indexes', async () => {
  const { mongoose, calls } = makeMongoose();
  await up({ mongoose });
  assert.equal(calls.aggregates, 2);
  assert.equal(calls.indexes.length, 2);
  assert.equal(calls.indexes[0].options.name, 'uq_group_tenant_active_name');
  assert.equal(calls.indexes[0].options.unique, true);
  assert.equal(calls.indexes[1].options.name, 'uq_group_creation_idempotency_key');
  assert.equal(calls.indexes[1].options.unique, true);
});

test('group idempotency migration fails closed on duplicate active names before creating indexes', async () => {
  const { mongoose, calls } = makeMongoose({ duplicateAt: 1 });
  await assert.rejects(up({ mongoose }), /duplicate active group names/);
  assert.equal(calls.indexes.length, 0);
});

test('group idempotency migration fails closed on duplicate request keys', async () => {
  const { mongoose, calls } = makeMongoose({ duplicateAt: 2 });
  await assert.rejects(up({ mongoose }), /duplicate request keys/);
  assert.equal(calls.indexes.length, 0);
});

test('group idempotency migration requires MongoDB and blocks unsafe destructive rollback', async () => {
  await assert.rejects(up({ mongoose: {} }), /active MongoDB connection/);
  await assert.rejects(down(), /dropping the group uniqueness\/idempotency indexes/);
});
