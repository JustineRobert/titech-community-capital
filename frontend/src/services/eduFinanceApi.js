import api from './api';

const EDUFINANCE_BASE = '/api/v1/edufinance';

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? {};
}

export async function listMyEduFinanceApplications() {
  const response = await api.get(`${EDUFINANCE_BASE}/applications/me`);
  const data = unwrap(response);
  return Array.isArray(data) ? data : [];
}

export async function submitEduFinanceApplication(payload, idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16) {
    throw new Error('A valid request idempotency key is required.');
  }
  const response = await api.post(`${EDUFINANCE_BASE}/applications`, payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return unwrap(response);
}
