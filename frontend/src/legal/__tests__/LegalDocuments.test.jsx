import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  LegalIndexPage,
  LegalInformationPage,
  PrivacyPolicyPage,
  TermsOfServicePage,
} from '../LegalDocuments.jsx';
import { LEGAL_DOCUMENTS, LEGAL_PUBLICATION_STATUS } from '../legalContent.js';

function renderWithRouter(element, initialEntries = ['/legal']) {
  return render(<MemoryRouter initialEntries={initialEntries}>{element}</MemoryRouter>);
}

describe('TITech legal document pages', () => {
  it('exposes legal information, terms, and privacy routes as independently renderable pages', () => {
    expect(LEGAL_DOCUMENTS.legal.path).toBe('/legal');
    expect(LEGAL_DOCUMENTS.terms.path).toBe('/terms');
    expect(LEGAL_DOCUMENTS.privacy.path).toBe('/privacy');
    expect(LEGAL_DOCUMENTS.legal.sections.length).toBeGreaterThan(0);
    expect(LEGAL_DOCUMENTS.terms.sections.length).toBeGreaterThan(0);
    expect(LEGAL_DOCUMENTS.privacy.sections.length).toBeGreaterThan(0);
  });

  it('keeps unapproved legal copy visibly marked as draft', () => {
    expect(LEGAL_PUBLICATION_STATUS).toBe('draft');
    renderWithRouter(<LegalIndexPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/not approved for production publication/i);
    expect(screen.getByRole('heading', { name: /legal information and policies/i })).toBeInTheDocument();
  });

  it('renders the service-boundary legal page', () => {
    renderWithRouter(<LegalInformationPage />);
    expect(screen.getByRole('heading', { name: 'Legal information' })).toBeInTheDocument();
    expect(screen.getByText(/not, merely by operating this software, a bank/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' }).length).toBeGreaterThan(0);
  });

  it('renders terms without claiming a particular fee or unauthorised financial licence', () => {
    renderWithRouter(<TermsOfServicePage />);
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.getByText(/This draft establishes no fee amount/i)).toBeInTheDocument();
    expect(screen.getByText(/does not itself accept deposits/i)).toBeInTheDocument();
  });

  it('renders privacy categories and flags contact details as unverified', () => {
    renderWithRouter(<PrivacyPolicyPage />);
    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText(/NOT YET VERIFIED/i)).toBeInTheDocument();
    expect(screen.getByText(/This draft does not assert that all listed categories are currently collected/i)).toBeInTheDocument();
  });
});
