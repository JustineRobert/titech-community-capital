'use strict';

const { parseCsv } = require('../../../modules/payroll/payroll.csv.cjs');

describe('TITech payroll CSV validation', () => {
  test('parses quoted fields, defaults currency/provider and preserves decimal text', () => {
    const rows = parseCsv('employeeId,employeeName,phoneNumber,amount\nEMP-1,"Grace, Namara",256700000001,150000.25');
    expect(rows).toEqual([{ employeeId: 'EMP-1', employeeName: 'Grace, Namara', phoneNumber: '256700000001', amount: '150000.25', currency: 'UGX', provider: 'MTN_MOMO' }]);
  });

  test('rejects duplicate employees', () => {
    expect(() => parseCsv('employeeId,employeeName,phoneNumber,amount\nEMP-1,A,256700000001,10\nEMP-1,B,256700000002,20')).toThrow('appears more than once');
  });

  test('rejects malformed amounts', () => {
    expect(() => parseCsv('employeeId,employeeName,phoneNumber,amount\nEMP-1,A,256700000001,10.1234567')).toThrow('amount is invalid');
  });
});
