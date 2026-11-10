import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

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

import { useAuth } from '../../context/AuthContext';
import { getPayrollReport, getWebhookAuditLogs } from '../../features/payroll/payrollApi';
import Payroll from '../../pages/Payroll';

describe('Payroll page RBAC contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ user: { role: 'payroll_auditor' } });
  });

  it('allows payroll auditor report visibility without exposing administrator controls', async () => {
    render(<Payroll />);
    expect(await screen.findByRole('heading', { name: /Payroll Disbursement/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Process batch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Upload payroll/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Simulator audit trail/i })).toBeInTheDocument();
  });

  it('allows tenant administrators to view reports and audit history without payroll mutation controls', async () => {
    useAuth.mockReturnValue({ user: { role: 'tenant_admin' } });
    render(<Payroll />);
    expect(await screen.findByRole('heading', { name: /Payroll Disbursement/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Simulator audit trail/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Upload payroll/i })).not.toBeInTheDocument();
  });

  it('shows an explicit unavailable state instead of zero totals when report retrieval fails', async () => {
    getPayrollReport.mockRejectedValueOnce(new Error('403 Forbidden'));
    render(<Payroll />);
    expect(await screen.findByRole('alert', { name: /Payroll data unavailable/i })).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.queryByText(/No payroll batches are available/i)).not.toBeInTheDocument();
  });

  it('does not request payroll report or audit data for a member without those permissions', async () => {
    useAuth.mockReturnValue({ user: { role: 'member' } });
    render(<Payroll />);
    expect(await screen.findByRole('status', { name: /Payroll report access is not available/i })).toBeInTheDocument();
    expect(getPayrollReport).not.toHaveBeenCalled();
    expect(getWebhookAuditLogs).not.toHaveBeenCalled();
  });

  it('shows bounded batch upload and webhook controls to the payroll officer only', async () => {
    useAuth.mockReturnValue({ user: { role: 'payroll_officer' } });
    render(<Payroll />);
    expect(await screen.findByRole('heading', { name: /Payroll Disbursement/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Upload payroll/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Process batch/i })).not.toBeInTheDocument();
  });
});
