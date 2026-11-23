import test from 'node:test';
import assert from 'node:assert/strict';
import { decimalToMinorUnits, detectStatementFormat, parseBankStatement } from '../statementParser.mjs';
import { encryptBankEvidence, decryptBankEvidence } from '../evidenceCrypto.mjs';
import { BANK_INSTITUTIONS, getBankConnectCapabilitySummary } from '../bankInstitutionRegistry.mjs';

const csv = (body) => Buffer.from(body, 'utf8');

 test('UGX amounts are represented as integer minor units using the currency convention', () => {
  assert.equal(decimalToMinorUnits('12500', 'UGX'), 12500);
  assert.throws(() => decimalToMinorUnits('12.50', 'UGX'), /unsupported precision/i);
  assert.equal(decimalToMinorUnits('12.34', 'USD'), 1234);
  assert.equal(decimalToMinorUnits('1,234.56', 'USD'), 123456);
  assert.throws(() => decimalToMinorUnits('12,34', 'USD'), /unambiguous decimal/i);
  assert.throws(() => decimalToMinorUnits('1.00', ''), /currency code is required/i);
});

test('CSV import uses only the account currency as an explicit fallback', async () => {
  const content = 'Booking Date,Description,Debit,Credit,Reference\n2026-11-22,Member contribution,,12000,REF-1\n';
  await assert.rejects(() => parseBankStatement({ filename: 'statement.csv', mimeType: 'text/csv', buffer: csv(content) }), /currency code is required/i);
  const result = await parseBankStatement({ filename: 'statement.csv', mimeType: 'text/csv', buffer: csv(content), defaultCurrency: 'UGX' });
  assert.equal(result.format, 'CSV');
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].creditMinor, 12000);
  assert.equal(result.transactions[0].debitMinor, 0);
  assert.equal(result.transactions[0].transactionReference, 'REF-1');
});

test('CSV parser rejects invalid calendar dates, malformed quoting and spreadsheet formula payloads', async () => {
  await assert.rejects(() => parseBankStatement({ filename: 'bad.csv', mimeType: 'text/csv', defaultCurrency: 'UGX', buffer: csv('Date,Description,Amount\n2026-02-30,Payment,100\n') }), /date.*invalid/i);
  await assert.rejects(() => parseBankStatement({ filename: 'bad.csv', mimeType: 'text/csv', defaultCurrency: 'UGX', buffer: csv('Date,Description,Amount\n2026-11-22,"Unclosed,100\n') }), /unterminated/i);
  await assert.rejects(() => parseBankStatement({ filename: 'bad.csv', mimeType: 'text/csv', defaultCurrency: 'UGX', buffer: csv('Date,Description,Amount\n2026-11-22,"=HYPERLINK(""x"")",100\n') }), /formula content/i);
});

test('CSV parser requires exactly one positive debit or credit amount', async () => {
  await assert.rejects(() => parseBankStatement({ filename: 'bad.csv', mimeType: 'text/csv', defaultCurrency: 'UGX', buffer: csv('Date,Description,Debit,Credit\n2026-11-22,Conflicting,10,20\n') }), /both debit and credit/i);
  await assert.rejects(() => parseBankStatement({ filename: 'bad.csv', mimeType: 'text/csv', defaultCurrency: 'UGX', buffer: csv('Date,Description,Debit,Credit\n2026-11-22,No amount,,\n') }), /exactly one/i);
});

test('MT940 requires a declared statement currency and parses debit entries', async () => {
  const valid = [':20:STATEMENT-1', ':25:ACCOUNT-1', ':60F:C261121USD1000,00', ':61:261122D12,34NTRFNONREF//BANK-REF-1', ':86:Supplier payment', ':62F:C261122USD987,66'].join('\n');
  const parsed = await parseBankStatement({ filename: 'statement.mt940', mimeType: 'text/plain', buffer: csv(valid) });
  assert.equal(parsed.format, 'MT940');
  assert.equal(parsed.transactions[0].debitMinor, 1234);
  assert.equal(parsed.transactions[0].currency, 'USD');
  const withoutCurrency = valid.replace(':60F:C261121USD1000,00', ':60F:C2611211000,00').replace(':62F:C261122USD987,66', ':62F:C261122987,66');
  await assert.rejects(() => parseBankStatement({ filename: 'statement.mt940', mimeType: 'text/plain', buffer: csv(withoutCurrency) }), /must declare a currency/i);
});

test('ISO 20022 CAMT requires explicit Ccy and rejects DTD/entity declarations', async () => {
  const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Ntry><NtryRef>ENTRY-1</NtryRef><Amt Ccy="UGX">10000</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-11-22</Dt></BookgDt><ValDt><Dt>2026-11-22</Dt></ValDt><AddtlNtryInf>Member payment</AddtlNtryInf></Ntry></Stmt></BkToCstmrStmt></Document>`;
  const parsed = await parseBankStatement({ filename: 'statement.xml', mimeType: 'application/xml', buffer: csv(xml) });
  assert.equal(parsed.format, 'CAMT.053');
  assert.equal(parsed.transactions[0].creditMinor, 10000);
  assert.equal(parsed.transactions[0].transactionReference, 'ENTRY-1');
  const missingCurrency = xml.replace(' Ccy="UGX"', '');
  await assert.rejects(() => parseBankStatement({ filename: 'statement.xml', mimeType: 'application/xml', buffer: csv(missingCurrency) }), /no explicit currency/i);
  const malicious = `<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]>${xml}`;
  await assert.rejects(() => parseBankStatement({ filename: 'statement.xml', mimeType: 'application/xml', buffer: csv(malicious) }), /DTD or entity/i);
});

test('format detection rejects legacy XLS, unsupported signatures and oversized files', async () => {
  assert.throws(() => detectStatementFormat('statement.xls', 'application/vnd.ms-excel', Buffer.from('not a workbook')), /not accepted/i);
  assert.throws(() => detectStatementFormat('statement.xlsx', 'application/octet-stream', Buffer.from('not zip')), /unsupported/i);
  await assert.rejects(() => parseBankStatement({ filename: 'large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }), /5 MiB/i);
});

test('evidence encryption requires a 32-byte key and authenticates ciphertext', () => {
  const env = { TITECH_BANKCONNECT_EVIDENCE_ENCRYPTION_KEY: 'ab'.repeat(32), TITECH_BANKCONNECT_EVIDENCE_KEY_VERSION: 'test-v1' };
  const original = Buffer.from('private bank statement evidence');
  const encrypted = encryptBankEvidence(original, env);
  assert.deepEqual(decryptBankEvidence(encrypted, env), original);
  const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext) };
  tampered.ciphertext[0] ^= 0xff;
  assert.throws(() => decryptBankEvidence(tampered, env));
  assert.throws(() => encryptBankEvidence(original, {}), { code: 'BANKCONNECT_EVIDENCE_ENCRYPTION_UNAVAILABLE' });
});

test('bank registry does not claim external bank API, sandbox, partnership or format approval', () => {
  assert.equal(BANK_INSTITUTIONS.length, 5);
  assert.equal(BANK_INSTITUTIONS[0].id, 'CENTENARY_UG');
  for (const bank of BANK_INSTITUTIONS) {
    assert.equal(bank.connectionStatus, 'NOT_CONNECTED');
    assert.equal(bank.sandboxStatus, 'NOT_VERIFIED');
    assert.equal(bank.partnershipStatus, 'NOT_APPROVED');
    assert.equal(bank.productionApproved, false);
    assert.deepEqual(bank.bankPublishedStatementFormats, []);
  }
  assert.equal(getBankConnectCapabilitySummary().productionApproved, false);
});
