import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LegalConsentFields, isLegalAcceptanceComplete } from '../LegalConsentFields.jsx';

describe('registration legal acceptance fragment', () => {
  it('requires distinct terms acceptance and privacy acknowledgement', () => {
    const onTermsAcceptedChange = vi.fn();
    const onPrivacyAcknowledgedChange = vi.fn();
    render(
      <MemoryRouter>
        <LegalConsentFields
          termsAccepted={false}
          onTermsAcceptedChange={onTermsAcceptedChange}
          privacyAcknowledged={false}
          onPrivacyAcknowledgedChange={onPrivacyAcknowledgedChange}
        />
      </MemoryRouter>,
    );
    const terms = screen.getByRole('checkbox', { name: /agree to the terms of service/i });
    const privacy = screen.getByRole('checkbox', { name: /read the privacy policy/i });
    expect(terms).toBeRequired();
    expect(privacy).toBeRequired();
    fireEvent.click(terms);
    fireEvent.click(privacy);
    expect(onTermsAcceptedChange).toHaveBeenCalledWith(true);
    expect(onPrivacyAcknowledgedChange).toHaveBeenCalledWith(true);
  });

  it('does not consider incomplete acceptance complete', () => {
    expect(isLegalAcceptanceComplete({ termsAccepted: true, privacyAcknowledged: false })).toBe(false);
    expect(isLegalAcceptanceComplete({ termsAccepted: false, privacyAcknowledged: true })).toBe(false);
    expect(isLegalAcceptanceComplete({ termsAccepted: true, privacyAcknowledged: true })).toBe(true);
  });
});
