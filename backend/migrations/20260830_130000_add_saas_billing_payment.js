'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * SaaS Billing Payment Persistence Migration
 * =============================================================================
 *
 * File:
 *   backend/migrations/20260830_130000_add_saas_billing_payment.js
 *
 * Purpose:
 *   Establish production-grade MongoDB indexes required by the canonical TITech
 *   Commercial SaaS Billing Payment model.
 *
 * Migration contract:
 *   - Additive only.
 *   - Never drops or mutates customer financial data.
 *   - Never writes to wallets, ledgers, balances, transactions, or settlements.
 *   - Safe to execute through the existing TITech MigrationRunner.
 *   - Safe to re-run manually when the migration record already exists.
 *   - Detects conflicting pre-existing indexes instead of silently replacing them.
 *   - Uses a partial unique provider-reference index so multiple pending payments
 *     without a provider payment ID do not collide.
 *
 * Financial authority boundary:
 *
 *   Commercial Billing Payment
 *          |
 *          v
 *   Billing/payment state only
 *          |
 *          v
 *   Existing TITech Financial Core
 *          |
 *          +--> Financial Transaction
 *          +--> Ledger
 *          +--> Wallet / Balance
 *          +--> Settlement / Reconciliation
 *
 * This migration operates ONLY on:
 *
 *   titech_billing_payments
 *
 * =============================================================================
 */

const mongoose = require('mongoose');

const COLLECTION_NAME = 'titech_billing_payments';

const INDEX_NAMES = Object.freeze({
  TENANT_IDEMPOTENCY:
    'uniq_titech_billing_payment_tenant_idempotency',

  PROVIDER_REFERENCE:
    'uniq_titech_billing_payment_provider_reference',

  INVOICE_STATUS:
    'idx_titech_billing_payment_invoice_status',

  TENANT_STATUS_CREATED:
    'idx_titech_billing_payment_tenant_status_created',

  TENANT_INVOICE_CREATED:
    'idx_titech_billing_payment_tenant_invoice_created',

  FINANCIAL_TRANSACTION:
    'idx_titech_billing_payment_financial_transaction',
});

const INDEX_DEFINITIONS = Object.freeze([
  {
    name: INDEX_NAMES.TENANT_IDEMPOTENCY,
    key: {
      tenantId: 1,
      idempotencyKey: 1,
    },
    options: {
      unique: true,
      name: INDEX_NAMES.TENANT_IDEMPOTENCY,
    },
  },

  {
    name: INDEX_NAMES.PROVIDER_REFERENCE,
    key: {
      provider: 1,
      providerPaymentId: 1,
    },
    options: {
      unique: true,
      name: INDEX_NAMES.PROVIDER_REFERENCE,

      /*
       * IMPORTANT:
       *
       * providerPaymentId is allowed to be null while a payment is still
       * pending/provider-neutral.
       *
       * A conventional { unique: true, sparse: true } index is not sufficient
       * for the model because documents explicitly storing null can still
       * participate in uniqueness semantics.
       *
       * Restrict uniqueness to actual string provider IDs.
       */
      partialFilterExpression: {
        providerPaymentId: {
          $type: 'string',
        },
      },
    },
  },

  {
    name: INDEX_NAMES.INVOICE_STATUS,
    key: {
      invoiceId: 1,
      status: 1,
      createdAt: -1,
    },
    options: {
      name: INDEX_NAMES.INVOICE_STATUS,
    },
  },

  {
    name: INDEX_NAMES.TENANT_STATUS_CREATED,
    key: {
      tenantId: 1,
      status: 1,
      createdAt: -1,
    },
    options: {
      name: INDEX_NAMES.TENANT_STATUS_CREATED,
    },
  },

  {
    name: INDEX_NAMES.TENANT_INVOICE_CREATED,
    key: {
      tenantId: 1,
      invoiceId: 1,
      createdAt: -1,
    },
    options: {
      name: INDEX_NAMES.TENANT_INVOICE_CREATED,
    },
  },

  {
    name: INDEX_NAMES.FINANCIAL_TRANSACTION,
    key: {
      financialTransactionId: 1,
    },
    options: {
      name: INDEX_NAMES.FINANCIAL_TRANSACTION,
      sparse: true,
    },
  },
]);

/**
 * ============================================================================
 * Connection Guard
 * ============================================================================
 */

function assertMongoConnection() {
  const readyState = mongoose.connection?.readyState;

  if (readyState !== 1 || !mongoose.connection?.db) {
    throw new Error(
      '[TITech SaaS Billing Migration] An active MongoDB connection is required.'
    );
  }
}

/**
 * ============================================================================
 * Index Comparison Helpers
 * ============================================================================
 */

function normalizeIndexKey(key) {
  return JSON.stringify(key || {});
}

function normalizePartialFilterExpression(expression) {
  return JSON.stringify(expression || null);
}

/**
 * Compare an existing MongoDB index with the index this migration expects.
 *
 * We intentionally fail on specification conflicts rather than dropping or
 * replacing indexes automatically. This prevents a migration from silently
 * destroying an intentionally modified production index.
 */
function isEquivalentIndex(existingIndex, definition) {
  if (
    normalizeIndexKey(existingIndex.key) !==
    normalizeIndexKey(definition.key)
  ) {
    return false;
  }

  const existingUnique = Boolean(existingIndex.unique);
  const expectedUnique = Boolean(definition.options?.unique);

  if (existingUnique !== expectedUnique) {
    return false;
  }

  const existingSparse = Boolean(existingIndex.sparse);
  const expectedSparse = Boolean(definition.options?.sparse);

  if (existingSparse !== expectedSparse) {
    return false;
  }

  return (
    normalizePartialFilterExpression(
      existingIndex.partialFilterExpression
    ) ===
    normalizePartialFilterExpression(
      definition.options?.partialFilterExpression
    )
  );
}

/**
 * Load the complete existing index catalog.
 */
async function getExistingIndexes(collection) {
  const indexes = await collection.indexes();

  return new Map(
    indexes.map((index) => [
      index.name,
      index,
    ])
  );
}

/**
 * ============================================================================
 * Safe Index Creation
 * ============================================================================
 */

async function ensureIndex(
  collection,
  definition,
  existingIndexes
) {
  const existing =
    existingIndexes.get(definition.name);

  if (existing) {
    if (
      !isEquivalentIndex(
        existing,
        definition
      )
    ) {
      throw new Error(
        [
          `[TITech SaaS Billing Migration] Conflicting index detected: ${definition.name}.`,
          `Expected key: ${normalizeIndexKey(definition.key)}`,
          `Existing key: ${normalizeIndexKey(existing.key)}`,
          `Expected unique: ${Boolean(definition.options?.unique)}`,
          `Existing unique: ${Boolean(existing.unique)}`,
          `Expected sparse: ${Boolean(definition.options?.sparse)}`,
          `Existing sparse: ${Boolean(existing.sparse)}`,
          `Expected partial filter: ${normalizePartialFilterExpression(
            definition.options?.partialFilterExpression
          )}`,
          `Existing partial filter: ${normalizePartialFilterExpression(
            existing.partialFilterExpression
          )}`,
          'No existing index was modified. Reconcile the index manually before rerunning the migration.',
        ].join(' ')
      );
    }

    return {
      name: definition.name,
      action: 'already-present',
    };
  }

  await collection.createIndex(
    definition.key,
    definition.options
  );

  return {
    name: definition.name,
    action: 'created',
  };
}

/**
 * ============================================================================
 * Optional Diagnostics
 * ============================================================================
 *
 * Collection statistics are diagnostic only. If the deployment does not expose
 * stats for the collection, migration success is not affected.
 */

async function getCollectionStats(collection) {
  try {
    return await collection.stats();
  } catch (error) {
    return {
      warning:
        error?.message ||
        'Collection statistics unavailable.',
    };
  }
}

/**
 * ============================================================================
 * Migration
 * ============================================================================
 */

module.exports = {
  name:
    '20260830_130000_add_saas_billing_payment',

  description:
    'Additive TITech SaaS billing-payment indexes with tenant-scoped idempotency and provider-reference protection.',

  /**
   * Apply migration.
   *
   * IMPORTANT:
   * No customer financial records are modified.
   */
  async up() {
    assertMongoConnection();

    const { db } =
      mongoose.connection;

    const collection =
      db.collection(
        COLLECTION_NAME
      );

    const existingIndexes =
      await getExistingIndexes(
        collection
      );

    const results = [];

    for (
      const definition
      of INDEX_DEFINITIONS
    ) {
      // Sequential creation intentionally avoids unnecessary concurrent index
      // builds and makes partial failure behavior deterministic.
      // eslint-disable-next-line no-await-in-loop
      results.push(
        await ensureIndex(
          collection,
          definition,
          existingIndexes
        )
      );

      /*
       * Keep the local catalog synchronized for the remainder of this migration.
       * This also makes the migration deterministic when executed against a
       * newly-created collection.
       */
      existingIndexes.set(
        definition.name,
        {
          name:
            definition.name,

          key:
            definition.key,

          unique:
            definition.options?.unique,

          sparse:
            definition.options?.sparse,

          partialFilterExpression:
            definition.options
              ?.partialFilterExpression,
        }
      );
    }

    const stats =
      await getCollectionStats(
        collection
      );

    return {
      collection:
        COLLECTION_NAME,

      status:
        'ready',

      additive:
        true,

      financialBalancesChanged:
        false,

      indexes:
        results,

      collectionStats:
        stats,
    };
  },

  /**
   * Roll back ONLY the indexes introduced by this migration.
   *
   * This does NOT drop the billing-payment collection.
   * This does NOT delete billing payments.
   * This does NOT alter financial transactions, wallets, balances or ledgers.
   */
  async down() {
    assertMongoConnection();

    const { db } =
      mongoose.connection;

    const collection =
      db.collection(
        COLLECTION_NAME
      );

    let existingIndexes;

    try {
      existingIndexes =
        await getExistingIndexes(
          collection
        );
    } catch (error) {
      /*
       * MongoDB error code 26 / NamespaceNotFound means the collection does not
       * exist. There is therefore nothing to roll back.
       */
      if (
        error?.codeName ===
          'NamespaceNotFound' ||
        error?.code === 26
      ) {
        return {
          collection:
            COLLECTION_NAME,

          status:
            'not-present',

          financialBalancesChanged:
            false,
        };
      }

      throw error;
    }

    const dropped = [];
    const skipped = [];

    for (
      const indexName
      of Object.values(INDEX_NAMES)
    ) {
      if (
        !existingIndexes.has(
          indexName
        )
      ) {
        skipped.push(
          indexName
        );
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await collection.dropIndex(
        indexName
      );

      dropped.push(
        indexName
      );
    }

    return {
      collection:
        COLLECTION_NAME,

      status:
        'indexes-removed',

      additiveRollback:
        true,

      financialBalancesChanged:
        false,

      dropped,

      skipped,
    };
  },
};