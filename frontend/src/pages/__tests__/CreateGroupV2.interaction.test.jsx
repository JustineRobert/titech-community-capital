import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    tenantId: 'tenant-test-id',
    user: {
      id: 'tenant-admin-test-user',
      email: 'admin@example.org',
      tenantId: 'tenant-test-id',
      role: 'tenant_admin',
      roles: ['tenant_admin'],
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock('../../services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('react-toastify', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import CreateGroupV2 from '../CreateGroupV2.jsx';

describe('CreateGroupV2 member email entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the email field focused while typing and preserves row identity after removing another row', async () => {
    const user = userEvent.setup({
      advanceTimers: (milliseconds) => vi.advanceTimersByTime(milliseconds),
    });

    render(<CreateGroupV2 />);

    await user.type(
      screen.getByLabelText(/Group Name/i),
      'North Kampala Community Group',
    );
    await user.type(screen.getByLabelText(/Description/i), 'A community group supporting shared savings and mutual development.');
    await user.click(screen.getByRole('button', { name: /Next/i }));

    const firstEmailInput = screen.getByLabelText('Member 1 email address');
    await user.type(firstEmailInput, 'first.member@example.org');

    expect(firstEmailInput).toHaveValue('first.member@example.org');
    expect(document.activeElement).toBe(firstEmailInput);

    await user.click(screen.getByRole('button', { name: /Add Member/i }));
    const secondEmailInput = screen.getByLabelText('Member 2 email address');
    await user.type(secondEmailInput, 'second.member@example.org');

    expect(secondEmailInput).toHaveValue('second.member@example.org');
    expect(document.activeElement).toBe(secondEmailInput);

    await user.click(screen.getByRole('button', { name: 'Remove member 1' }));

    const remainingEmailInput = screen.getByLabelText('Member 1 email address');
    expect(remainingEmailInput).toBe(secondEmailInput);
    expect(remainingEmailInput).toHaveValue('second.member@example.org');
  });
});
