'use strict';

/**
 * Legacy USSD/member lookup facade. Member persistence remains owned by the
 * canonical Member model; this file exists to resolve an older service path.
 */

async function getMemberModel() {
  const module = await import('../models/Member.js');
  return module.Member || module.default;
}

async function findByPhone(tenantId, phoneNumber) {
  const Member = await getMemberModel();
  return Member.findByPhoneNumber(tenantId, phoneNumber);
}

module.exports = Object.freeze({ findByPhone });
