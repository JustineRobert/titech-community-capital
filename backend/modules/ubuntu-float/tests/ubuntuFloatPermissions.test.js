import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPermission } from '../../../middleware/platformPermissions.js';

test('applicant roles receive only the self-scoped advance capabilities', () => {
  for (const role of ['MEMBER', 'PARTICIPANT', 'GROUP_MEMBER', 'FIELD_AGENT', 'AGENT', 'SUB_AGENT', 'OUTLET_OPERATOR']) {
    assert.equal(hasPermission({ role }, 'ubuntu-float:read'), true, `${role} should read capability status`);
    assert.equal(hasPermission({ role }, 'ubuntu-float:advance:application:create'), true, `${role} may submit an application when enabled`);
    assert.equal(hasPermission({ role }, 'ubuntu-float:advance:application:read:self'), true, `${role} may read its own applications`);
    assert.equal(hasPermission({ role }, 'ubuntu-float:advance:application:read:any'), false, `${role} must not read other applicants`);
    assert.equal(hasPermission({ role }, 'ubuntu-float:agent:create'), false, `${role} must not create agents`);
    assert.equal(hasPermission({ role }, 'ubuntu-float:position:record'), false, `${role} must not record positions`);
  }
});

test('tenant administrators and head-office operators do not receive unimplemented approval/disbursement permissions', () => {
  for (const role of ['TENANT_ADMIN', 'HEAD_OFFICE', 'SUPER_AGENT', 'COMPLIANCE_OFFICER', 'APPROVER']) {
    assert.equal(hasPermission({ role }, 'ubuntu-float:advance:approve'), false);
    assert.equal(hasPermission({ role }, 'ubuntu-float:disburse'), false);
    assert.equal(hasPermission({ role }, 'ubuntu-float:repayment:collect'), false);
    assert.equal(hasPermission({ role }, 'ubuntu-float:savings:recover'), false);
  }
  assert.equal(hasPermission({ role: 'TENANT_ADMIN' }, 'ubuntu-float:agent:create'), true);
  assert.equal(hasPermission({ role: 'HEAD_OFFICE' }, 'ubuntu-float:agent:create'), true);
});
