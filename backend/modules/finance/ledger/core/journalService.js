/**
 * TITech Community Capital — financial journal command builder.
 *
 * This boundary creates deterministic journal commands for PostingEngine.
 * Persistence remains owned by the configured ledger/journal repository.
 */
import crypto from 'node:crypto';

const JOURNAL_TYPES = Object.freeze({
  CONTRIBUTION: 'SAVINGS_DEPOSIT',
  DEPOSIT: 'SAVINGS_DEPOSIT',
  WITHDRAWAL: 'SAVINGS_WITHDRAWAL',
  LOAN_DISBURSEMENT: 'LOAN_DISBURSEMENT',
  LOAN_REPAYMENT: 'LOAN_REPAYMENT',
  SETTLEMENT: 'MOMO_SETTLEMENT',
  ADJUSTMENT: 'ADJUSTMENT',
  REVERSAL: 'REVERSAL',
});

function normalizeAmount(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text) || Number(text) <= 0) {
    throw Object.assign(new Error('Journal amount must be a positive decimal amount.'), { code: 'JOURNAL_INVALID_AMOUNT', statusCode: 400 });
  }
  return text;
}


function toMinorUnits(value) {
  const [whole, fraction = ''] = String(value).split('.');
  const normalizedFraction = `${fraction}00`.slice(0, 2);
  return BigInt(whole) * 100n + BigInt(normalizedFraction);
}

function buildFingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

class JournalService {
  constructor({ clock = () => new Date(), idGenerator = () => crypto.randomUUID() } = {}) {
    this.clock = clock;
    this.idGenerator = idGenerator;
  }

  async build({ operation = {}, context = {} } = {}) {
    const tenantId = String(operation.tenantId ?? context?.tenant?.tenantId ?? '').trim();
    if (!tenantId) throw Object.assign(new Error('Journal tenant is required.'), { code: 'JOURNAL_TENANT_REQUIRED', statusCode: 400 });

    const currency = String(operation.currency ?? 'UGX').trim().toUpperCase();
    const entries = Array.isArray(operation.entries) ? operation.entries : [];
    if (entries.length < 2) throw Object.assign(new Error('A journal requires at least two entries.'), { code: 'JOURNAL_MIN_ENTRIES', statusCode: 400 });

    const normalizedEntries = entries.map((entry, index) => ({
      accountId: String(entry.accountId ?? entry.account ?? '').trim(),
      entryType: String(entry.entryType ?? entry.direction ?? '').trim().toUpperCase(),
      amount: normalizeAmount(entry.amount),
      currency: String(entry.currency ?? currency).toUpperCase(),
      sequence: index + 1,
    }));

    if (normalizedEntries.some((entry) => !entry.accountId || !['DEBIT', 'CREDIT'].includes(entry.entryType))) {
      throw Object.assign(new Error('Every journal entry requires accountId and DEBIT/CREDIT entryType.'), { code: 'JOURNAL_INVALID_ENTRY', statusCode: 400 });
    }

    const debit = normalizedEntries.filter((entry) => entry.entryType === 'DEBIT').reduce((sum, entry) => sum + toMinorUnits(entry.amount), 0n);
    const credit = normalizedEntries.filter((entry) => entry.entryType === 'CREDIT').reduce((sum, entry) => sum + toMinorUnits(entry.amount), 0n);
    if (debit !== credit) {
      throw Object.assign(new Error('Journal debits and credits must balance exactly.'), { code: 'JOURNAL_UNBALANCED', statusCode: 422, details: { debitMinor: debit.toString(), creditMinor: credit.toString() } });
    }

    const journalId = String(operation.journalId ?? `JNL-${this.idGenerator()}`);
    const payload = { tenantId, journalId, operationType: operation.operationType ?? 'FINANCIAL_OPERATION', currency, entries: normalizedEntries };
    return {
      ...payload,
      journalType: operation.journalType ?? operation.type ?? JOURNAL_TYPES[operation.operationType] ?? 'ADJUSTMENT',
      transactionId: operation.transactionId ?? operation.sourceId ?? null,
      description: operation.description ?? 'TITech financial journal',
      postingReference: operation.postingReference ?? journalId,
      createdAt: this.clock().toISOString(),
      fingerprint: buildFingerprint(payload),
      entries: normalizedEntries,
    };
  }

  diagnostics() { return { module: 'JournalService', status: 'IMPLEMENTED', journalTypes: JOURNAL_TYPES }; }
}

export { JournalService, JOURNAL_TYPES };
export default JournalService;
