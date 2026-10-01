'use strict';

const { parseCsv } = require('../../../modules/payroll/payroll.csv.cjs');

describe('TITech payroll financial input safety', () => {
  test('rejects negative amounts', () => {
    expect(() => parseCsv('employeeId,employeeName,phoneNumber,amount\nEMP-1,A,256700000001,-10')).toThrow('amount is invalid');
  });

  test('rejects mixed currencies in one batch', () => {
    expect(() => parseCsv('employeeId,employeeName,phoneNumber,amount,currency\nEMP-1,A,256700000001,10,UGX\nEMP-2,B,256700000002,20,KES')).toThrow('single payroll batch must use one currency');
  });
});
