'use strict';

const {
  MAX_CSV_BYTES,
  MAX_ROWS,
  PROVIDERS,
} = require('./payroll.constants.cjs');
const { PayrollError } = require('./payroll.errors.cjs');

const HEADER_ALIASES = Object.freeze({
  employeeid: 'employeeId',
  employee_id: 'employeeId',
  employeeno: 'employeeId',
  employeenumber: 'employeeId',
  employeename: 'employeeName',
  employee_name: 'employeeName',
  name: 'employeeName',
  phonenumber: 'phoneNumber',
  phone_number: 'phoneNumber',
  phone: 'phoneNumber',
  mobile: 'phoneNumber',
  amount: 'amount',
  currency: 'currency',
  provider: 'provider',
});

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function parseCsv(text) {
  if (typeof text !== 'string') {
    throw new PayrollError('PAYROLL_CSV_REQUIRED', 'CSV payroll content is required.', 400);
  }

  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > MAX_CSV_BYTES) {
    throw new PayrollError('PAYROLL_CSV_TOO_LARGE', `Payroll CSV exceeds ${MAX_CSV_BYTES} bytes.`, 413);
  }

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((value) => String(value).trim() !== '')) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  if (quoted) {
    throw new PayrollError('PAYROLL_CSV_MALFORMED', 'CSV contains an unterminated quoted field.', 400);
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => String(value).trim() !== '')) rows.push(row);
  }

  if (rows.length < 2) {
    throw new PayrollError('PAYROLL_CSV_EMPTY', 'CSV must contain a header row and at least one payroll row.', 400);
  }

  const headers = rows[0].map((value) => HEADER_ALIASES[normalizeHeader(value)] || null);
  if (headers.some((value) => !value)) {
    throw new PayrollError('PAYROLL_CSV_HEADERS_INVALID', 'CSV contains unsupported or empty headers.', 400, {
      headers: rows[0],
    });
  }

  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length) {
    throw new PayrollError('PAYROLL_CSV_HEADERS_DUPLICATE', 'CSV contains duplicate headers.', 400, {
      headers: duplicateHeaders,
    });
  }

  const required = ['employeeId', 'employeeName', 'phoneNumber', 'amount'];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new PayrollError('PAYROLL_CSV_HEADERS_MISSING', 'CSV is missing required payroll columns.', 400, { missing });
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS) {
    throw new PayrollError('PAYROLL_CSV_ROW_LIMIT', `Payroll CSV exceeds the ${MAX_ROWS} row limit.`, 413);
  }

  const seenEmployees = new Set();
  const normalizedRows = dataRows.map((values, index) => {
    const source = Object.fromEntries(headers.map((header, headerIndex) => [header, String(values[headerIndex] ?? '').trim()]));
    const employeeId = source.employeeId;
    const employeeName = source.employeeName;
    const phoneNumber = source.phoneNumber;
    const amount = source.amount;
    const currency = (source.currency || 'UGX').toUpperCase();
    const provider = (source.provider || PROVIDERS.MTN_MOMO).toUpperCase();

    if (!employeeId || !employeeName || !phoneNumber || !amount) {
      throw new PayrollError('PAYROLL_ROW_INVALID', `Payroll row ${index + 2} is missing a required value.`, 400, { row: index + 2 });
    }

    if (seenEmployees.has(employeeId)) {
      throw new PayrollError('PAYROLL_DUPLICATE_EMPLOYEE', `Employee ${employeeId} appears more than once in the batch.`, 400, { row: index + 2 });
    }
    seenEmployees.add(employeeId);

    if (!/^\d+(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) {
      throw new PayrollError('PAYROLL_AMOUNT_INVALID', `Payroll amount is invalid on row ${index + 2}.`, 400, { row: index + 2 });
    }

    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new PayrollError('PAYROLL_CURRENCY_INVALID', `Currency is invalid on row ${index + 2}.`, 400, { row: index + 2 });
    }

    if (!Object.values(PROVIDERS).includes(provider)) {
      throw new PayrollError('PAYROLL_PROVIDER_INVALID', `Provider is invalid on row ${index + 2}.`, 400, { row: index + 2 });
    }

    return {
      employeeId,
      employeeName,
      phoneNumber,
      amount,
      currency,
      provider,
    };
  });

  const currencies = new Set(normalizedRows.map((row) => row.currency));
  if (currencies.size > 1) {
    throw new PayrollError('PAYROLL_MULTI_CURRENCY_BATCH', 'A single payroll batch must use one currency.', 400, { currencies: [...currencies] });
  }

  return normalizedRows;
}

module.exports = { parseCsv };
