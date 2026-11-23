import { TextDecoder } from 'node:util';
import { STATEMENT_TRANSACTION_MAX_ROWS } from './bankInstitutionRegistry.mjs';

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const FORMULA_PREFIX = /^[=+@]/;
const HEADER_ALIASES = Object.freeze({
  bookingdate: 'bookingDate', transactiondate: 'bookingDate', date: 'bookingDate', valuedate: 'valueDate',
  description: 'description', details: 'description', narrative: 'description', transactiondetails: 'description',
  reference: 'transactionReference', transactionreference: 'transactionReference', paymentreference: 'transactionReference',
  endtoendreference: 'endToEndReference', endtoendid: 'endToEndReference',
  transactionid: 'externalTransactionId', externaltransactionid: 'externalTransactionId', banktransactionid: 'externalTransactionId',
  debit: 'debit', withdrawal: 'debit', credit: 'credit', deposit: 'credit', amount: 'amount', currency: 'currency',
  direction: 'direction', type: 'direction',
});

function fail(message, code = 'STATEMENT_INVALID') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 422;
  return error;
}

function normalizeHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseDelimited(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') {
      if (cell.length) throw fail('Malformed CSV quoting.');
      quoted = true;
    } else if (char === ',') {
      row.push(cell); cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => String(value).trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (quoted) throw fail('CSV contains an unterminated quoted field.');
  row.push(cell);
  if (row.some((value) => String(value).trim() !== '')) rows.push(row);
  return rows;
}

function currencyFractionDigits(currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    throw fail(`Unsupported currency code: ${currency}.`);
  }
}

export function decimalToMinorUnits(value, currency) {
  const normalizedCurrency = String(currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw fail('A valid ISO 4217 currency code is required for every amount.');
  const decimals = currencyFractionDigits(normalizedCurrency);
  const supplied = String(value ?? '').trim().replace(/^\((.+)\)$/, '-$1');
  const raw = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(supplied) ? supplied.replaceAll(',', '') : supplied;
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw fail('Statement amount must be an unambiguous decimal string (use a dot for decimal places and optional three-digit comma grouping).');
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction.length > decimals) throw fail(`Amount has unsupported precision for ${normalizedCurrency}.`);
  const scale = 10n ** BigInt(decimals);
  const minor = (BigInt(whole) * scale) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  const signed = negative ? -minor : minor;
  const result = Number(signed);
  if (!Number.isSafeInteger(result)) throw fail('Statement amount exceeds the safe integer range.');
  return result;
}

function parseDate(value, fieldName = 'booking date') {
  const text = String(value ?? '').trim();
  if (!text) throw fail(`Statement ${fieldName} is required.`);
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?))?$/);
  if (match) {
    const [year, month, day] = match.slice(1, 4).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw fail(`Statement ${fieldName} is invalid.`);
    if (match[4]) {
      const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}`);
      if (Number.isNaN(parsed.getTime())) throw fail(`Statement ${fieldName} is invalid.`);
      return parsed;
    }
    return date;
  }
  match = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (match) return parseDate(`${match[3]}-${match[2]}-${match[1]}`, fieldName);
  match = text.match(/^(\d{6})$/);
  if (match) {
    const yy = Number(text.slice(0, 2));
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    return parseDate(`${year}-${text.slice(2, 4)}-${text.slice(4, 6)}`, fieldName);
  }
  throw fail(`Statement ${fieldName} must use an unambiguous ISO 8601, YYYY-MM-DD, DD/MM/YYYY or YYMMDD date.`);
}

function detectDirection(row) {
  const direction = String(row.direction || '').trim().toUpperCase();
  if (['D', 'DEBIT', 'DR', 'DBIT'].includes(direction)) return 'DEBIT';
  if (['C', 'CREDIT', 'CR', 'CRDT'].includes(direction)) return 'CREDIT';
  return null;
}

function normalizeRows(rawRows, format, defaultCurrency = null) {
  if (!Array.isArray(rawRows) || rawRows.length < 2) throw fail('Statement must include a header and at least one transaction.');
  const headers = rawRows[0].map(normalizeHeader).map((header) => HEADER_ALIASES[header] || header);
  if (headers.some((header) => !header)) throw fail('Statement contains an empty column heading.');
  if (new Set(headers).size !== headers.length) throw fail('Statement contains duplicate or conflicting column headings.');
  if (!headers.includes('bookingDate') || !headers.includes('description')) throw fail('Statement must include booking date and description columns.');
  if (!(headers.includes('amount') || (headers.includes('debit') && headers.includes('credit')))) throw fail('Statement must include an amount column or both debit and credit columns.');
  const transactions = [];
  for (let rowIndex = 1; rowIndex < rawRows.length; rowIndex += 1) {
    const values = rawRows[rowIndex];
    if (!values || values.every((value) => String(value ?? '').trim() === '')) continue;
    if (values.length > headers.length) throw fail(`Row ${rowIndex + 1} contains more values than the header row.`);
    const row = Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? '').trim()]));
    for (const [key, value] of Object.entries(row)) {
      if (FORMULA_PREFIX.test(value.trim()) && !['debit', 'credit', 'amount'].includes(key)) throw fail(`Potential spreadsheet formula content was rejected in row ${rowIndex + 1}.`, 'STATEMENT_FORMULA_CONTENT_REJECTED');
    }
    const currency = String(row.currency || defaultCurrency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw fail(`A currency code is required on row ${rowIndex + 1} or from the verified bank-account profile.`);
    const bookingDate = parseDate(row.bookingDate, `booking date on row ${rowIndex + 1}`);
    const valueDate = row.valueDate ? parseDate(row.valueDate, `value date on row ${rowIndex + 1}`) : bookingDate;
    const debitMinor = row.debit ? Math.abs(decimalToMinorUnits(row.debit, currency)) : 0;
    const creditMinor = row.credit ? Math.abs(decimalToMinorUnits(row.credit, currency)) : 0;
    if (debitMinor && creditMinor) throw fail(`Row ${rowIndex + 1} cannot contain both debit and credit amounts.`);
    let debit = debitMinor;
    let credit = creditMinor;
    if (row.amount !== undefined && row.amount !== '') {
      const amount = decimalToMinorUnits(row.amount, currency);
      const direction = detectDirection(row);
      if (amount < 0 || direction === 'DEBIT') debit = Math.abs(amount);
      else credit = Math.abs(amount);
    }
    if ((debit > 0) === (credit > 0)) throw fail(`Row ${rowIndex + 1} must contain exactly one positive debit or credit amount.`);
    const description = String(row.description || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 2000);
    if (!description) throw fail(`Transaction description is required on row ${rowIndex + 1}.`);
    transactions.push({
      externalTransactionId: row.externalTransactionId || null,
      transactionReference: row.transactionReference || null,
      endToEndReference: row.endToEndReference || null,
      bookingDate,
      valueDate,
      description,
      debitMinor: debit,
      creditMinor: credit,
      currency,
      sourceRow: rowIndex + 1,
      sourceFormat: format,
    });
    if (transactions.length > STATEMENT_TRANSACTION_MAX_ROWS) throw fail(`Statement exceeds the ${STATEMENT_TRANSACTION_MAX_ROWS} transaction limit.`, 'STATEMENT_ROW_LIMIT_EXCEEDED');
  }
  if (!transactions.length) throw fail('Statement contains no valid transactions.');
  return transactions;
}

function decodeXmlText(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function xmlTag(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}\\s*>`, 'i'));
  return match ? decodeXmlText(match[1].replace(/<[^>]+>/g, '').trim()) : null;
}

function parseCamt(text, format) {
  if (/<!DOCTYPE|<!ENTITY|SYSTEM\s+["']|PUBLIC\s+["']/i.test(text)) throw fail('XML statements containing DTD or entity declarations are not accepted.', 'STATEMENT_XML_DTD_REJECTED');
  if (!/<(?:[A-Za-z0-9_-]+:)?Document\b/i.test(text) || !/(BkToCstmrStmt|BkToCstmrAcctRpt|BkToCstmrDbtCdtNtfctn)/i.test(text)) throw fail('XML file is not a supported ISO 20022 camt statement or notification.');
  const blocks = [...text.matchAll(/<(?:[A-Za-z0-9_-]+:)?Ntry\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?Ntry\s*>/gi)].map((match) => match[1]);
  if (!blocks.length) throw fail('ISO 20022 file contains no entry records.');
  const records = blocks.map((block, index) => {
    const amountMatch = block.match(/<(?:[A-Za-z0-9_-]+:)?Amt\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?Amt\s*>/i);
    if (!amountMatch) throw fail(`ISO 20022 entry ${index + 1} has no amount.`);
    const currency = amountMatch[1].match(/Ccy=["']([A-Z]{3})["']/i)?.[1]?.toUpperCase();
    if (!currency) throw fail(`ISO 20022 entry ${index + 1} has no explicit currency code.`);
    const amount = decimalToMinorUnits(decodeXmlText(amountMatch[2].replace(/<[^>]+>/g, '').trim()), currency);
    const indicator = (xmlTag(block, 'CdtDbtInd') || '').toUpperCase();
    if (!['CRDT', 'DBIT'].includes(indicator)) throw fail(`ISO 20022 entry ${index + 1} has no valid credit/debit indicator.`);
    const bookingBlock = block.match(/<(?:[A-Za-z0-9_-]+:)?BookgDt\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?BookgDt\s*>/i)?.[1] || '';
    const valueBlock = block.match(/<(?:[A-Za-z0-9_-]+:)?ValDt\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?ValDt\s*>/i)?.[1] || '';
    const dateValue = xmlTag(bookingBlock, 'Dt') || xmlTag(bookingBlock, 'DtTm');
    const valueDateValue = xmlTag(valueBlock, 'Dt') || xmlTag(valueBlock, 'DtTm') || dateValue;
    const description = xmlTag(block, 'AddtlNtryInf') || xmlTag(block, 'Ustrd') || 'Bank statement transaction';
    const reference = xmlTag(block, 'NtryRef') || xmlTag(block, 'AcctSvcrRef') || xmlTag(block, 'EndToEndId');
    if (!dateValue) throw fail(`ISO 20022 entry ${index + 1} has no booking date.`);
    return {
      externalTransactionId: xmlTag(block, 'AcctSvcrRef') || null,
      transactionReference: reference || null,
      endToEndReference: xmlTag(block, 'EndToEndId') || null,
      bookingDate: parseDate(dateValue, `booking date on entry ${index + 1}`),
      valueDate: parseDate(valueDateValue, `value date on entry ${index + 1}`),
      description: description.slice(0, 2000),
      debitMinor: indicator === 'DBIT' ? Math.abs(amount) : 0,
      creditMinor: indicator === 'CRDT' ? Math.abs(amount) : 0,
      currency,
      sourceRow: index + 1,
      sourceFormat: format,
    };
  });
  return records;
}

function parseMt940(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const currency = text.match(/^:6[02][FM]:[CD]\d{6}([A-Z]{3})/m)?.[1] || null;
  if (!currency) throw fail('MT940 statement must declare a currency in its opening or closing balance record.');
  const entries = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^:61:(\d{6})(?:\d{4})?([A-Z]{0,2})(\d+(?:,\d+)?)(.*)$/);
    if (match) {
      if (current) entries.push(current);
      const directionMarker = match[2].includes('D') ? 'D' : match[2].includes('C') ? 'C' : null;
      if (!directionMarker) throw fail('MT940 transaction is missing a debit/credit marker.');
      const amount = decimalToMinorUnits(match[3].replace(',', '.'), currency);
      const trailing = match[4] || '';
      const reference = trailing.match(/\/\/([^\s]+)$/)?.[1] || null;
      current = {
        externalTransactionId: reference,
        transactionReference: reference,
        endToEndReference: null,
        bookingDate: parseDate(match[1], 'MT940 booking date'),
        valueDate: parseDate(match[1], 'MT940 value date'),
        description: 'MT940 bank transaction',
        debitMinor: directionMarker === 'D' ? Math.abs(amount) : 0,
        creditMinor: directionMarker === 'C' ? Math.abs(amount) : 0,
        currency,
        sourceRow: entries.length + 1,
        sourceFormat: 'MT940',
      };
    } else if (current && line.startsWith(':86:')) {
      current.description = line.slice(4).slice(0, 2000) || current.description;
    } else if (current && line.trim() && !line.startsWith(':')) {
      current.description = `${current.description} ${line.trim()}`.slice(0, 2000);
    }
  }
  if (current) entries.push(current);
  if (!entries.length) throw fail('MT940 statement contains no :61: transaction entries.');
  if (entries.length > STATEMENT_TRANSACTION_MAX_ROWS) throw fail('MT940 statement exceeds the transaction limit.', 'STATEMENT_ROW_LIMIT_EXCEEDED');
  return entries;
}

export function detectStatementFormat(filename, mimeType, buffer) {
  const name = String(filename || '').toLowerCase();
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!bytes.length) throw fail('Statement file is empty.');
  if (name.endsWith('.xlsx') && bytes.subarray(0, 2).toString('hex') === '504b') return 'XLSX';
  if (name.endsWith('.xml')) {
    const text = textDecoder.decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
    if (/(BkToCstmrStmt|BkToCstmrAcctRpt|BkToCstmrDbtCdtNtfctn)/i.test(text)) {
      if (/camt\.052/i.test(text)) return 'CAMT.052';
      if (/camt\.054/i.test(text)) return 'CAMT.054';
      return 'CAMT.053';
    }
  }
  if (name.endsWith('.mt940') || name.endsWith('.sta')) return 'MT940';
  if (name.endsWith('.csv')) return 'CSV';
  if (name.endsWith('.xls')) throw fail('Legacy .xls is not accepted until a hardened BIFF parser is installed and security-reviewed.', 'STATEMENT_FORMAT_NOT_SUPPORTED');
  throw fail(`Unsupported statement format or content signature (${String(mimeType || 'unknown MIME type')}).`, 'STATEMENT_FORMAT_NOT_SUPPORTED');
}


function validateXlsxArchive(buffer) {
  // XLSX is a ZIP container. Inspect the central directory before handing it to
  // ExcelJS so compressed bombs, traversal names and encrypted entries fail
  // before workbook expansion.
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > buffer.length) throw fail('XLSX ZIP directory is missing or malformed.');
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const commentLength = buffer.readUInt16LE(eocd + 20);
  if (diskNumber || centralDisk || diskEntries !== totalEntries || totalEntries < 1 || totalEntries > 500 || centralSize > 1024 * 1024 || centralOffset + centralSize > eocd || eocd + 22 + commentLength > buffer.length) {
    throw fail('XLSX archive structure exceeds safe limits or uses unsupported ZIP features.');
  }
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let entry = 0; entry < totalEntries; entry += 1) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50) throw fail('XLSX central-directory entry is malformed.');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const entryCommentLength = buffer.readUInt16LE(cursor + 32);
    const diskStart = buffer.readUInt16LE(cursor + 34);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const entryLength = 46 + nameLength + extraLength + entryCommentLength;
    if (!nameLength || cursor + entryLength > eocd || diskStart !== 0 || (flags & 0x1) || ![0, 8].includes(method)) throw fail('XLSX archive contains an encrypted, split or unsupported ZIP entry.');
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const segments = name.replace(/\\/g, '/').split('/');
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || segments.includes('..') || segments.includes('.')) throw fail('XLSX archive contains an unsafe entry path.');
    const unixMode = (externalAttributes >>> 16) & 0xf000;
    if (unixMode === 0xa000) throw fail('XLSX archive contains a symbolic link.');
    expandedBytes += uncompressedSize;
    if (expandedBytes > 25 * 1024 * 1024 || (compressedSize === 0 ? uncompressedSize > 0 : uncompressedSize / compressedSize > 100)) throw fail('XLSX archive exceeds safe expanded-size or compression-ratio limits.', 'STATEMENT_ARCHIVE_LIMIT_EXCEEDED');
    cursor += entryLength;
  }
  if (cursor !== centralOffset + centralSize) throw fail('XLSX archive central directory is inconsistent.');
}

async function parseXlsx(buffer, defaultCurrency) {
  validateXlsxArchive(buffer);
  let ExcelJS;
  try { ({ default: ExcelJS } = await import('exceljs')); }
  catch { throw fail('XLSX parser dependency is unavailable.', 'STATEMENT_PARSER_UNAVAILABLE'); }
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer, { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'extLst'] }); }
  catch { throw fail('XLSX workbook is malformed or cannot be safely parsed.'); }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw fail('XLSX workbook contains no worksheet.');
  if (worksheet.rowCount > STATEMENT_TRANSACTION_MAX_ROWS + 1) throw fail('XLSX workbook exceeds the transaction limit.', 'STATEMENT_ROW_LIMIT_EXCEEDED');
  const rawRows = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => rawRows.push(row.values.slice(1).map((value) => {
    if (value && typeof value === 'object' && 'formula' in value) throw fail('Formula cells are not accepted in uploaded bank statements.', 'STATEMENT_FORMULA_CONTENT_REJECTED');
    if (value && typeof value === 'object' && 'text' in value) return value.text;
    if (value && typeof value === 'object' && 'result' in value) return value.result;
    return value instanceof Date ? value.toISOString().slice(0, 10) : value ?? '';
  })));
  return normalizeRows(rawRows, 'XLSX', defaultCurrency);
}

export async function parseBankStatement({ filename, mimeType, buffer, defaultCurrency = null }) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
  if (buffer.length > 5 * 1024 * 1024) throw fail('Statement exceeds the 5 MiB upload limit.', 'STATEMENT_FILE_TOO_LARGE');
  const format = detectStatementFormat(filename, mimeType, buffer);
  if (format === 'XLSX') return { format, transactions: await parseXlsx(buffer, defaultCurrency), balances: null };
  const text = textDecoder.decode(buffer);
  if (text.includes('\u0000')) throw fail('Statement contains unexpected binary content.');
  let transactions;
  if (format === 'CSV') transactions = normalizeRows(parseDelimited(text.replace(/^\uFEFF/, '')), format, defaultCurrency);
  else if (format === 'MT940') transactions = parseMt940(text);
  else transactions = parseCamt(text, format);
  return { format, transactions, balances: null };
}
