import React from 'react';
import { Link } from 'react-router-dom';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_VERSION,
  LEGAL_LAST_REVIEWED,
  LEGAL_PUBLICATION_STATUS,
} from './legalContent.js';
import './LegalDocuments.css';

const NAV_ITEMS = [
  { key: 'legal', label: 'Legal information', to: '/legal' },
  { key: 'terms', label: 'Terms of Service', to: '/terms' },
  { key: 'privacy', label: 'Privacy Policy', to: '/privacy' },
];

function LegalHeader() {
  return (
    <header className="titech-legal-header">
      <Link className="titech-legal-brand" to="/" aria-label="TITech Community Capital home">
        <img
          className="titech-legal-logo"
          src="/brand/titech-community-capital-transparent.png"
          alt=""
          width="44"
          height="44"
        />
        <span>
          <strong>TITech Community Capital</strong>
          <small>Community Finance. Stronger Together.</small>
        </span>
      </Link>
      <nav aria-label="Legal documents" className="titech-legal-nav">
        {NAV_ITEMS.map((item) => (
          <Link key={item.key} to={item.to}>{item.label}</Link>
        ))}
      </nav>
      <div className="titech-legal-theme-bar" aria-hidden="true" />
    </header>
  );
}

function DraftStatus() {
  if (LEGAL_PUBLICATION_STATUS !== 'draft') return null;
  return (
    <aside className="titech-legal-draft-notice" role="alert" aria-labelledby="titech-legal-draft-heading">
      <strong id="titech-legal-draft-heading">Draft — not approved for production publication</strong>
      <p>
        These documents require qualified legal review and verification of the operator’s identity,
        contact details, actual data practices, and applicable partner/regulatory obligations before
        they may be treated as effective terms or notices.
      </p>
    </aside>
  );
}

function LegalDocument({ documentKey }) {
  const document = LEGAL_DOCUMENTS[documentKey];
  if (!document) return <LegalIndexPage />;

  return (
    <div className="titech-legal-page">
      <LegalHeader />
      <main className="titech-legal-main" id="main-content">
        <nav className="titech-legal-breadcrumbs" aria-label="Breadcrumb">
          <Link to="/legal">Legal information</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{document.title}</span>
        </nav>
        <DraftStatus />
        <article className="titech-legal-card">
          <p className="titech-legal-eyebrow">TITech Capital LTD · TITech Community Capital</p>
          <h1>{document.title}</h1>
          <p className="titech-legal-lead">{document.intro}</p>
          <dl className="titech-legal-meta">
            <div><dt>Document version</dt><dd>{LEGAL_DOCUMENT_VERSION}</dd></div>
            <div><dt>Review date</dt><dd>{LEGAL_LAST_REVIEWED}</dd></div>
            <div><dt>Status</dt><dd>{LEGAL_PUBLICATION_STATUS === 'draft' ? 'Draft — approval pending' : 'Published'}</dd></div>
          </dl>
          <div className="titech-legal-sections">
            {document.sections.map((section) => (
              <section key={section.heading} aria-labelledby={`legal-${documentKey}-${section.heading.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>
                <h2 id={`legal-${documentKey}-${section.heading.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>{section.heading}</h2>
                {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.bullets?.length ? (
                  <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>
                ) : null}
              </section>
            ))}
          </div>
          <div className="titech-legal-related">
            <h2>Related documents</h2>
            <p><Link to="/terms">Terms of Service</Link> · <Link to="/privacy">Privacy Policy</Link> · <Link to="/legal">Legal information</Link></p>
          </div>
        </article>
      </main>
      <LegalFooter />
    </div>
  );
}

function LegalFooter() {
  return (
    <footer className="titech-legal-footer">
      <span>© {new Date().getFullYear()} TITech Capital LTD · TITech Community Capital</span>
      <nav aria-label="Footer legal links">
        {NAV_ITEMS.map((item) => <Link key={item.key} to={item.to}>{item.label}</Link>)}
      </nav>
    </footer>
  );
}

export function LegalIndexPage() {
  return (
    <div className="titech-legal-page">
      <LegalHeader />
      <main className="titech-legal-main" id="main-content">
        <DraftStatus />
        <section className="titech-legal-card titech-legal-index">
          <p className="titech-legal-eyebrow">TITech Capital LTD</p>
          <h1>Legal information and policies</h1>
          <p className="titech-legal-lead">
            Review the terms that govern access to TITech Community Capital and the information about
            how personal data may be handled. These documents remain drafts until approved for release.
          </p>
          <div className="titech-legal-link-grid">
            {NAV_ITEMS.map((item) => {
              const document = LEGAL_DOCUMENTS[item.key];
              return (
                <Link className="titech-legal-link-card" key={item.key} to={item.to}>
                  <span className="titech-legal-link-card__title">{document.title}</span>
                  <span>{document.summary}</span>
                  <span className="titech-legal-link-card__action">Read document <span aria-hidden="true">→</span></span>
                </Link>
              );
            })}
          </div>
          <p className="titech-legal-smallprint">
            This information is not legal advice and does not itself establish a licence, regulatory approval,
            payment-provider certification or permission to provide a regulated financial service.
          </p>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}

export function LegalInformationPage() { return <LegalDocument documentKey="legal" />; }
export function TermsOfServicePage() { return <LegalDocument documentKey="terms" />; }
export function PrivacyPolicyPage() { return <LegalDocument documentKey="privacy" />; }

/** Links for use on the existing login/signup pages without replacing their auth architecture. */
export function LegalDocumentLinks({ className = '' }) {
  return (
    <nav aria-label="Legal information and policies" className={`titech-legal-inline-links ${className}`.trim()}>
      <Link to="/legal">Legal information</Link>
      <Link to="/terms">Terms of Service</Link>
      <Link to="/privacy">Privacy Policy</Link>
    </nav>
  );
}
