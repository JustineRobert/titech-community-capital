import api from './api';

const OPERATIONS_BASE = '/api/v1/operations';

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? {};
}

export async function listPartnerCases({ status, priority, limit = 50 } = {}) {
  const params = { limit: Math.min(Math.max(Number(limit) || 50, 1), 100) };
  if (status) params.status = status;
  if (priority) params.priority = priority;
  const response = await api.get(`${OPERATIONS_BASE}/cases`, { params });
  const data = unwrap(response);
  return Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
}

export async function createPartnerCase(payload) {
  const response = await api.post(`${OPERATIONS_BASE}/cases`, payload);
  return unwrap(response);
}

export async function transitionPartnerCase(caseId, { status, note, evidenceRefs = [] }) {
  const response = await api.post(`${OPERATIONS_BASE}/cases/${encodeURIComponent(caseId)}/transition`, { status, note, evidenceRefs });
  return unwrap(response);
}
