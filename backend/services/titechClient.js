'use strict';

/**
 * titechClient
 *
 * Lightweight HTTP client wrapper for calling TITech services.
 * - Uses axios
 * - Adds service auth header from env
 * - Exposes typed helpers for entity visibility checks
 *
 * Environment variables expected:
 * - TITECH_BASE_URL
 * - TITECH_SERVICE_TOKEN (or TITECH_API_KEY)
 *
 * Replace endpoints with your real TITech service routes.
 */

const axios = require('axios');

const TITECH_BASE = process.env.TITECH_BASE_URL || 'https://titech.internal';
const SERVICE_TOKEN = process.env.TITECH_SERVICE_TOKEN || process.env.TITECH_API_KEY || '';

const DEFAULT_TIMEOUT = 3000; // ms

const client = axios.create({
  baseURL: TITECH_BASE,
  timeout: Number(process.env.TITECH_TIMEOUT_MS || DEFAULT_TIMEOUT),
  headers: {
    'Content-Type': 'application/json',
    ...(SERVICE_TOKEN ? { Authorization: `Bearer ${SERVICE_TOKEN}` } : {})
  }
});

// Simple retry wrapper (linear backoff). Keep small to avoid thundering herd.
async function requestWithRetry(config, retries = 1) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    try {
      const res = await client.request(config);
      return res;
    } catch (err) {
      lastErr = err;
      attempt += 1;
      if (attempt > retries) break;
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  throw lastErr;
}

/*
|---------------------------------------------------------------------------
| Visibility check helpers
|---------------------------------------------------------------------------
| Each helper returns boolean: true if user can view the entity, false otherwise.
| They call TITech endpoints that must implement the visibility logic.
| Replace endpoint paths and response parsing to match your TITech API.
*/

async function canViewLoan(userId, loanId) {
  if (!loanId) return false;
  const url = `/loans/${loanId}/visibility`;
  const res = await requestWithRetry({ method: 'GET', url, params: { userId } }, 1);
  // Expect { data: { canView: true } } or HTTP 200/403
  if (res?.data && typeof res.data.canView === 'boolean') return res.data.canView;
  // Fallback: treat 200 as allowed
  return res.status === 200;
}

async function canViewSavings(userId, savingsId) {
  if (!savingsId) return false;
  const url = `/savings/${savingsId}/visibility`;
  const res = await requestWithRetry({ method: 'GET', url, params: { userId } }, 1);
  if (res?.data && typeof res.data.canView === 'boolean') return res.data.canView;
  return res.status === 200;
}

async function canViewTransaction(userId, transactionId) {
  if (!transactionId) return false;
  const url = `/transactions/${transactionId}/visibility`;
  const res = await requestWithRetry({ method: 'GET', url, params: { userId } }, 1);
  if (res?.data && typeof res.data.canView === 'boolean') return res.data.canView;
  return res.status === 200;
}

async function canViewSupportTicket(userId, ticketId) {
  if (!ticketId) return false;
  const url = `/support/tickets/${ticketId}/visibility`;
  const res = await requestWithRetry({ method: 'GET', url, params: { userId } }, 1);
  if (res?.data && typeof res.data.canView === 'boolean') return res.data.canView;
  return res.status === 200;
}

async function canViewGroup(userId, groupId) {
  if (!groupId) return false;
  const url = `/groups/${groupId}/membership`;
  const res = await requestWithRetry({ method: 'GET', url, params: { userId } }, 1);
  // Expect { data: { isMember: true } }
  if (res?.data && typeof res.data.isMember === 'boolean') return res.data.isMember;
  return res.status === 200;
}

module.exports = {
  canViewLoan,
  canViewSavings,
  canViewTransaction,
  canViewSupportTicket,
  canViewGroup,
  // expose raw client for advanced calls if needed
  client
};
