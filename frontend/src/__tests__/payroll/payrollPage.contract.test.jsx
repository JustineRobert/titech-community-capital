import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'AUDITOR' } }),
}));

vi.mock('../../features/payroll/payrollApi', () => ({
  getPayrollReport: vi.fn(async () => ({ data: { batches: [], transactions: [] } })),
  getWebhookAuditLogs: vi.fn(async () => ({ data: { items: [] } })),
  listWebhookSubscriptions: vi.fn(async () => ({ data: { subscriptions: [] } })),
  uploadPayroll: vi.fn(),
  processPayrollBatch: vi.fn(),
  reconcilePayrollBatch: vi.fn(),
  retryFailedPayroll: vi.fn(),
  createWebhookSubscription: vi.fn(),
  deleteWebhookSubscription: vi.fn(),
  testWebhook: vi.fn(),
}));

vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import Payroll from '../../pages/Payroll';

describe('Payroll page RBAC contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows auditor report visibility without exposing administrator controls', async () => {
    render(<Payroll />);
    expect(await screen.findByRole('heading', { name: /Payroll Disbursement/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Process batch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Upload payroll/i })).not.toBeInTheDocument();
  });
});
