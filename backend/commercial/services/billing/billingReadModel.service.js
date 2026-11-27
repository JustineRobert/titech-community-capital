'use strict';

/**
 * TITech Community Capital — read-only SaaS billing projection.
 *
 * This service deliberately reads only the canonical commercial collections
 * established by the existing 2026-08-30 SaaS billing migrations. It does not
 * issue invoices, initiate/settle payments, post journals, alter subscriptions
 * or mutate savings/member/community financial records.
 */

const COLLECTIONS = Object.freeze({
  plans: 'titech_billing_plans',
  subscriptions: 'titech_subscriptions',
  invoices: 'titech_billing_invoices',
  usage: 'titech_usage_records',
  payments: 'titech_billing_payments',
});

const PAGE_DEFAULT = 1;
const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const PROJECTIONS = Object.freeze({
  subscriptions: Object.freeze({
    tenantId: 1,
    planId: 1,
    planVersion: 1,
    status: 1,
    billingInterval: 1,
    currency: 1,
    unitAmount: 1,
    quantity: 1,
    trialStartsAt: 1,
    trialEndsAt: 1,
    currentPeriodStart: 1,
    currentPeriodEnd: 1,
    cancelAtPeriodEnd: 1,
    cancelledAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }),
  invoices: Object.freeze({
    tenantId: 1,
    subscriptionId: 1,
    invoiceNumber: 1,
    status: 1,
    currency: 1,
    subtotal: 1,
    discount: 1,
    tax: 1,
    total: 1,
    amountPaid: 1,
    amountDue: 1,
    periodStart: 1,
    periodEnd: 1,
    issuedAt: 1,
    dueDate: 1,
    paidAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }),
  payments: Object.freeze({
    tenantId: 1,
    invoiceId: 1,
    subscriptionId: 1,
    provider: 1,
    providerPaymentId: 1,
    internalPaymentReference: 1,
    amount: 1,
    currency: 1,
    status: 1,
    postedAt: 1,
    failedAt: 1,
    failureCode: 1,
    createdAt: 1,
    updatedAt: 1,
  }),
});

function safeInteger(value, fallback, minimum, maximum) {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizePagination(query = {}) {
  const page = safeInteger(query.page, PAGE_DEFAULT, 1, 1_000_000);
  const pageSize = safeInteger(query.pageSize, PAGE_SIZE_DEFAULT, 1, PAGE_SIZE_MAX);
  return Object.freeze({ page, pageSize, skip: (page - 1) * pageSize });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRecord(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeRecord);
  if (typeof value !== 'object') return value;
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (value._bsontype === 'Decimal128' || value._bsontype === 'Long') return value.toString();
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__v' || key === 'metadata' || key === 'providerPayload' || key === 'rawResponse') continue;
    result[key] = normalizeRecord(item);
  }
  return result;
}

function normalizeStatusFilter(value) {
  if (value == null || String(value).trim() === '') return null;
  const status = String(value).trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,39}$/.test(status) ? status : null;
}

function parseDateFilter(value) {
  if (value == null || String(value).trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildTenantScope(tenantId, toObjectId = null) {
  if (tenantId == null || String(tenantId).trim() === '') {
    const error = new TypeError('An authenticated tenant context is required.');
    error.code = 'BILLING_TENANT_CONTEXT_REQUIRED';
    throw error;
  }
  const values = [String(tenantId)];
  if (typeof toObjectId === 'function') {
    try {
      const objectId = toObjectId(String(tenantId));
      if (objectId && String(objectId) !== String(tenantId)) values.push(objectId);
    } catch {
      // String tenant identifiers remain supported for legacy/test tenants.
    }
  }
  return { tenantId: { $in: values } };
}

function decimalParts(value) {
  const source = value == null ? '0' : String(value);
  if (source.length > 128 || !/^-?\d+(?:\.\d+)?$/.test(source)) {
    const error = new TypeError('Billing decimal values must be bounded plain decimal strings.');
    error.code = 'BILLING_DECIMAL_INVALID';
    throw error;
  }
  const negative = source.startsWith('-');
  const unsigned = negative ? source.slice(1) : source;
  const [whole, fraction = ''] = unsigned.split('.');
  return { negative, digits: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function addDecimalStrings(values = []) {
  const parts = values.map(decimalParts);
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  const total = parts.reduce((sum, part) => {
    const normalized = part.digits * (10n ** BigInt(scale - part.scale));
    return sum + (part.negative ? -normalized : normalized);
  }, 0n);
  const negative = total < 0n;
  const absolute = negative ? -total : total;
  if (scale === 0) return `${negative ? '-' : ''}${absolute}`;
  const padded = absolute.toString().padStart(scale + 1, '0');
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function aggregateStatus(pipelineResult = []) {
  return pipelineResult.reduce((result, row) => {
    if (row?._id) result[String(row._id).toUpperCase()] = Number(row.count || 0);
    return result;
  }, {});
}

class BillingReadModelService {
  constructor({ connection, toObjectId = null, clock = () => new Date() } = {}) {
    if (!connection) throw new TypeError('BillingReadModelService requires the established Mongoose connection.');
    this.connection = connection;
    this.toObjectId = toObjectId;
    this.clock = clock;
  }

  getDatabase() {
    if (this.connection.readyState !== 1 || !this.connection.db) {
      const error = new Error('Billing read data is unavailable because the established database connection is not ready.');
      error.code = 'BILLING_DATA_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }
    return this.connection.db;
  }

  collection(name) {
    return this.getDatabase().collection(name);
  }

  scope(tenantId = null) {
    return tenantId == null ? {} : buildTenantScope(tenantId, this.toObjectId);
  }

  async count(collectionName, match = {}) {
    return this.collection(collectionName).countDocuments(match);
  }

  async groupStatus(collectionName, match = {}) {
    const rows = await this.collection(collectionName).aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray();
    return aggregateStatus(rows);
  }

  async invoiceTotals(match = {}) {
    const rows = await this.collection(COLLECTIONS.invoices).aggregate([
      { $match: match },
      {
        $group: {
          _id: '$currency',
          invoiceCount: { $sum: 1 },
          invoiced: { $sum: '$total' },
          paid: { $sum: '$amountPaid' },
          outstanding: { $sum: '$amountDue' },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();
    return rows.map((row) => ({
      currency: String(row._id || 'UNSPECIFIED').toUpperCase(),
      invoiceCount: Number(row.invoiceCount || 0),
      invoiced: normalizeRecord(row.invoiced ?? '0'),
      paid: normalizeRecord(row.paid ?? '0'),
      outstanding: normalizeRecord(row.outstanding ?? '0'),
    }));
  }

  async paymentTotals(match = {}) {
    const rows = await this.collection(COLLECTIONS.payments).aggregate([
      { $match: match },
      {
        $group: {
          _id: { currency: '$currency', status: '$status' },
          paymentCount: { $sum: 1 },
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.currency': 1, '_id.status': 1 } },
    ]).toArray();
    return rows.map((row) => ({
      currency: String(row._id?.currency || 'UNSPECIFIED').toUpperCase(),
      status: String(row._id?.status || 'UNKNOWN').toUpperCase(),
      paymentCount: Number(row.paymentCount || 0),
      amount: normalizeRecord(row.amount ?? '0'),
    }));
  }

  async aging(match = {}) {
    const now = this.clock();
    const rows = await this.collection(COLLECTIONS.invoices).aggregate([
      { $match: { ...match, status: { $in: ['OPEN', 'PARTIALLY_PAID', 'PAST_DUE'] }, dueDate: { $lt: now }, amountDue: { $gt: 0 } } },
      {
        $addFields: {
          daysOverdue: {
            $floor: { $divide: [{ $subtract: [now, '$dueDate'] }, DAY_MS] },
          },
        },
      },
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $lte: ['$daysOverdue', 30] }, then: '1–30 days' },
                { case: { $lte: ['$daysOverdue', 60] }, then: '31–60 days' },
                { case: { $lte: ['$daysOverdue', 90] }, then: '61–90 days' },
              ],
              default: '91+ days',
            },
          },
          invoiceCount: { $sum: 1 },
        },
      },
    ]).toArray();
    const byBand = new Map(rows.map((row) => [String(row._id), Number(row.invoiceCount || 0)]));
    return [
      { band: '1–30 days', invoices: byBand.get('1–30 days') || 0 },
      { band: '31–60 days', invoices: byBand.get('31–60 days') || 0 },
      { band: '61–90 days', invoices: byBand.get('61–90 days') || 0 },
      { band: '91+ days', invoices: byBand.get('91+ days') || 0 },
    ];
  }

  async getOverview({ tenantId = null } = {}) {
    const scope = this.scope(tenantId);
    const [
      subscriptionCount,
      invoiceCount,
      paymentCount,
      planCount,
      subscriptionStatuses,
      invoiceStatuses,
      paymentStatuses,
      invoicesByCurrency,
      paymentsByCurrencyAndStatus,
      aging,
    ] = await Promise.all([
      this.count(COLLECTIONS.subscriptions, scope),
      this.count(COLLECTIONS.invoices, scope),
      this.count(COLLECTIONS.payments, scope),
      tenantId == null ? this.count(COLLECTIONS.plans) : Promise.resolve(null),
      this.groupStatus(COLLECTIONS.subscriptions, scope),
      this.groupStatus(COLLECTIONS.invoices, scope),
      this.groupStatus(COLLECTIONS.payments, scope),
      this.invoiceTotals(scope),
      this.paymentTotals(scope),
      this.aging(scope),
    ]);

    return {
      dataState: 'AUTHORITATIVE_READ_MODEL',
      scope: tenantId == null ? 'PLATFORM' : 'AUTHENTICATED_TENANT',
      subscriptions: {
        total: subscriptionCount,
        byStatus: subscriptionStatuses,
      },
      invoices: {
        total: invoiceCount,
        byStatus: invoiceStatuses,
        byCurrency: invoicesByCurrency,
        overdueCount: aging.reduce((sum, row) => sum + row.invoices, 0),
        overdueAging: aging,
      },
      payments: {
        total: paymentCount,
        byStatus: paymentStatuses,
        byCurrencyAndStatus: paymentsByCurrencyAndStatus,
      },
      ...(tenantId == null ? { plans: { total: planCount } } : {}),
      financialReporting: {
        mrr: 'NOT_AVAILABLE',
        arr: 'NOT_AVAILABLE',
        recognizedRevenue: 'NOT_AVAILABLE',
        cashSettled: 'NOT_AVAILABLE',
        reason: 'Approved pricing, invoice accounting, canonical journal and settlement evidence are not yet integrated into a complete verified lifecycle.',
      },
      capabilities: {
        dashboardRead: true,
        planMutation: false,
        subscriptionMutation: false,
        invoiceIssuance: false,
        paymentInitiation: false,
        paymentSettlement: false,
        receiptIssuance: false,
        creditNotes: false,
        refunds: false,
        reconciliationMutation: false,
      },
      productionApproved: false,
      generatedAt: this.clock().toISOString(),
    };
  }

  async list(resource, { tenantId = null, page, pageSize, status, search, from, to } = {}) {
    const collectionName = COLLECTIONS[resource];
    if (!['subscriptions', 'invoices', 'payments'].includes(resource) || !collectionName) {
      const error = new TypeError('Unsupported billing read resource.');
      error.code = 'BILLING_RESOURCE_UNSUPPORTED';
      throw error;
    }

    const pagination = normalizePagination({ page, pageSize });
    const match = this.scope(tenantId);
    const normalizedStatus = normalizeStatusFilter(status);
    if (normalizedStatus) match.status = normalizedStatus;
    const dateFrom = parseDateFilter(from);
    const dateTo = parseDateFilter(to);
    if (dateFrom || dateTo) {
      const dateField = resource === 'invoices' ? 'issuedAt' : 'createdAt';
      match[dateField] = {
        ...(dateFrom ? { $gte: dateFrom } : {}),
        ...(dateTo ? { $lte: dateTo } : {}),
      };
    }
    const normalizedSearch = String(search || '').trim().slice(0, 80);
    if (normalizedSearch && resource === 'invoices') {
      match.invoiceNumber = { $regex: escapeRegExp(normalizedSearch), $options: 'i' };
    }
    if (normalizedSearch && resource === 'payments') {
      match.$or = [
        { internalPaymentReference: { $regex: escapeRegExp(normalizedSearch), $options: 'i' } },
        { providerPaymentId: { $regex: escapeRegExp(normalizedSearch), $options: 'i' } },
      ];
    }

    const collection = this.collection(collectionName);
    const [total, rows] = await Promise.all([
      collection.countDocuments(match),
      collection.find(match, { projection: PROJECTIONS[resource] })
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.pageSize)
        .toArray(),
    ]);

    return {
      items: rows.map(normalizeRecord),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      pages: Math.ceil(total / pagination.pageSize),
    };
  }

  async getCollectionsOverview() {
    const [overview, overdueInvoices, paymentExceptions] = await Promise.all([
      this.getOverview(),
      this.collection(COLLECTIONS.invoices).find(
        { status: { $in: ['OPEN', 'PARTIALLY_PAID', 'PAST_DUE'] }, dueDate: { $lt: this.clock() }, amountDue: { $gt: 0 } },
        { projection: PROJECTIONS.invoices },
      ).sort({ dueDate: 1 }).limit(50).toArray(),
      this.collection(COLLECTIONS.payments).find(
        { status: { $in: ['PENDING', 'PROCESSING', 'FAILED', 'REVERSED'] } },
        { projection: PROJECTIONS.payments },
      ).sort({ createdAt: -1 }).limit(50).toArray(),
    ]);
    return {
      ...overview,
      collections: {
        overdueInvoices: overdueInvoices.map(normalizeRecord),
        paymentExceptions: paymentExceptions.map(normalizeRecord),
      },
    };
  }
}

export {
  BillingReadModelService,
  COLLECTIONS,
  PROJECTIONS,
  addDecimalStrings,
  buildTenantScope,
  normalizePagination,
  normalizeRecord,
};
