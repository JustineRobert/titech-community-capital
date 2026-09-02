// services/ledger.service.js
const { Pool } = require('pg');
const format = require('pg-format');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const auditService = require('./auditService');

/**
 * LedgerService
 * - createTransaction(reference, description, tenantId, entries[])
 * - validateTransaction(entries) -> ensures debits == credits
 * - postTransaction(transactionId)
 * - reverseTransaction(transactionId, reason)
 *
 * entries[] = [{ accountId, amount (integer), direction: 'debit'|'credit', metadata }]
 */

class LedgerService {
  static async validateEntries(entries) {
    if (!Array.isArray(entries) || entries.length < 2) {
      throw new Error('Transaction must have at least two entries');
    }
    let debit = 0;
    let credit = 0;
    for (const e of entries) {
      if (!e.accountId || typeof e.amount !== 'number' || e.amount <= 0) {
        throw new Error('Invalid entry: accountId and positive integer amount required');
      }
      if (e.direction === 'debit') debit += e.amount;
      else if (e.direction === 'credit') credit += e.amount;
      else throw new Error('Invalid entry direction');
    }
    if (debit !== credit) {
      throw new Error(`Entries do not balance: debit=${debit} credit=${credit}`);
    }
    return true;
  }

  static async createTransaction({ reference, description, tenantId, entries, metadata = {} }) {
    await LedgerService.validateEntries(entries);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const txRes = await client.query(
        `INSERT INTO transactions (reference, description, status, tenant_id, metadata)
         VALUES ($1,$2,'pending',$3,$4) RETURNING id, created_at`,
        [reference, description || null, tenantId, metadata]
      );
      const transactionId = txRes.rows[0].id;

      const insertValues = entries.map(e => [
        transactionId,
        e.accountId,
        e.amount,
        e.direction,
        e.metadata || {}
      ]);

      const insertQuery = format(
        `INSERT INTO entries (transaction_id, account_id, amount, direction, metadata) VALUES %L RETURNING id`,
        insertValues
      );

      await client.query(insertQuery);

      await client.query('COMMIT');
      try { await auditService.logAction({ action: 'ledger:create_transaction', tenantId, entityType: 'LedgerTransaction', entityId: transactionId, metadata: { reference, description, entries } }); } catch(e){}
      return { transactionId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async postTransaction(transactionId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Ensure transaction exists and is pending
      const tx = await client.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE', [transactionId]);
      if (tx.rowCount === 0) throw new Error('Transaction not found');
      if (tx.rows[0].status !== 'pending') throw new Error('Only pending transactions can be posted');

      // Validate entries sum again (defensive)
      const entriesRes = await client.query('SELECT direction, SUM(amount) as total FROM entries WHERE transaction_id=$1 GROUP BY direction', [transactionId]);
      let debit = 0, credit = 0;
      for (const r of entriesRes.rows) {
        if (r.direction === 'debit') debit = parseInt(r.total, 10);
        if (r.direction === 'credit') credit = parseInt(r.total, 10);
      }
      if (debit !== credit) throw new Error('Transaction entries do not balance at post time');

      // Mark transaction as posted
      await client.query('UPDATE transactions SET status=$1, posted_at=now() WHERE id=$2', ['posted', transactionId]);

      // Optionally: push to account_balance_cache (deferred to worker)
      // Insert into a posting queue table or update cache here if desired.

      await client.query('COMMIT');
      try { await auditService.logAction({ action: 'ledger:post_transaction', tenantId: tx.rows[0].tenant_id, entityType: 'LedgerTransaction', entityId: transactionId, metadata: {} }); } catch(e){}
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async reverseTransaction(transactionId, { reference, reason, tenantId }) {
    // Create reversing transaction with opposite directions
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const txRes = await client.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE', [transactionId]);
      if (txRes.rowCount === 0) throw new Error('Transaction not found');
      const tx = txRes.rows[0];
      if (tx.status !== 'posted') throw new Error('Only posted transactions can be reversed');

      // Fetch entries
      const entriesRes = await client.query('SELECT account_id, amount, direction, metadata FROM entries WHERE transaction_id=$1', [transactionId]);
      const originalEntries = entriesRes.rows;
      if (originalEntries.length < 2) throw new Error('Original transaction invalid');

      // Build reversed entries
      const reversedEntries = originalEntries.map(e => ({
        accountId: e.account_id,
        amount: parseInt(e.amount, 10),
        direction: e.direction === 'debit' ? 'credit' : 'debit',
        metadata: { reversed_from: transactionId, original_metadata: e.metadata }
      }));

      // Create reversal transaction
      const reversalRef = reference || `REV-${tx.reference}-${Date.now()}`;
      const createRes = await client.query(
        `INSERT INTO transactions (reference, description, status, tenant_id, metadata) VALUES ($1,$2,'pending',$3,$4) RETURNING id`,
        [reversalRef, `Reversal of ${tx.reference}: ${reason || ''}`, tenantId || tx.tenant_id, { reversal_of: transactionId, reason }]
      );
      const reversalId = createRes.rows[0].id;

      // Insert reversal entries
      const insertValues = reversedEntries.map(e => [reversalId, e.accountId, e.amount, e.direction, e.metadata || {}]);
      const insertQuery = format(
        `INSERT INTO entries (transaction_id, account_id, amount, direction, metadata) VALUES %L`,
        insertValues
      );
      await client.query(insertQuery);

      // Post reversal immediately
      await client.query('UPDATE transactions SET status=$1, posted_at=now() WHERE id=$2', ['posted', reversalId]);

      // Mark original transaction as reversed
      await client.query(
        `UPDATE transactions
   SET status = $1,
       metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{reversed_by}',
         to_jsonb($2)
       )
   WHERE id = $3`,
        ['reversed', reversalId, transactionId]
      );

      await client.query('COMMIT');
      try { await auditService.logAction({ action: 'ledger:reverse_transaction', tenantId: tx.tenant_id, entityType: 'LedgerTransaction', entityId: reversalId, metadata: { reversedOf: transactionId, reason } }); } catch(e){}
      return { reversalId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Utility: get account balance from cache
  static async getAccountBalance(accountId) {
    const res = await pool.query('SELECT balance, currency, last_updated FROM account_balance_cache WHERE account_id=$1', [accountId]);
    if (res.rowCount === 0) return { balance: 0, currency: 'UGX' };
    return res.rows[0];
  }
}

module.exports = LedgerService;
