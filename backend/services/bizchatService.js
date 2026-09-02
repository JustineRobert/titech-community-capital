const { roleHasPermission } = require('./rbacService');
const auditService = require('./auditService');

// Simple parser: extracts intent, amount, and target from plain English commands
function parseCommand(text) {
  const out = { intent: null, amount: null, target: null, raw: text };
  const normalized = (text || '').toLowerCase();
  if (/send\s+\d+[\,\d]*\s*(ugx|usd|ghs|kes)?/.test(normalized)) {
    out.intent = 'send_money';
    const m = normalized.match(/send\s+(\d+[\,\d]*)/);
    if (m) out.amount = parseInt(m[1].replace(/,/g, ''), 10);
    const t = normalized.match(/to\s+([a-z0-9\s]+)/);
    if (t) out.target = t[1].trim();
  } else if (/check my sacco balance|check balance|balance/.test(normalized)) {
    out.intent = 'check_balance';
  } else if (/approve loan for|approve loan/.test(normalized)) {
    out.intent = 'approve_loan';
    const m = normalized.match(/approve loan for\s+([a-z0-9\s]+)/);
    if (m) out.target = m[1].trim();
  }
  return out;
}

async function executeCommand({ text, user }) {
  const cmd = parseCommand(text);
  if (!cmd.intent) throw new Error('Could not parse command');

  // permission checks
  if (cmd.intent === 'approve_loan') {
    const ok = await roleHasPermission(user.role, 'loans:approve');
    if (!ok) throw new Error('Forbidden');
    // call loan service
    const loanService = require('../services/loanService');
    const res = await loanService.approveByName(cmd.target, user);
    await auditService.logAction({ action: 'bizchat:approve_loan', userId: user.id, tenantId: user.tenantId, entityType: 'Loan', entityId: res._id, metadata: { cmd } });
    return res;
  }

  if (cmd.intent === 'send_money') {
    const ok = await roleHasPermission(user.role, 'transactions:write');
    if (!ok) throw new Error('Forbidden');
    const transactionService = require('../services/transactionService');
    const res = await transactionService.createPayment({ fromUserId: user.id, amount: cmd.amount, target: cmd.target, tenantId: user.tenantId });
    await auditService.logAction({ action: 'bizchat:send_money', userId: user.id, tenantId: user.tenantId, entityType: 'Transaction', entityId: res._id, metadata: { cmd } });
    return res;
  }

  if (cmd.intent === 'check_balance') {
    const walletService = require('../services/walletService');
    const bal = await walletService.getBalanceByUser(user.id, user.tenantId);
    await auditService.logAction({ action: 'bizchat:check_balance', userId: user.id, tenantId: user.tenantId, entityType: 'Wallet', entityId: user.id, metadata: { balance: bal } });
    return { balance: bal };
  }

  throw new Error('Intent not implemented');
}

module.exports = { parseCommand, executeCommand };
