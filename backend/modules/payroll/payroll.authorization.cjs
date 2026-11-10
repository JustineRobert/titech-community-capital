'use strict';

const { ROLE_ALIASES } = require('./payroll.constants.cjs');

function normalizePayrollRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return ROLE_ALIASES[value] || value;
}

function roleMatches(user, allowedRoles) {
  const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
    .map(normalizePayrollRole)
    .filter(Boolean);
  return allowedRoles.some((role) => roles.includes(normalizePayrollRole(role)));
}

module.exports = { normalizePayrollRole, roleMatches };
