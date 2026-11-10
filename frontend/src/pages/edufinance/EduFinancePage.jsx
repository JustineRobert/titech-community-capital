import React from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider.jsx';
import './edufinance.css';

export default function EduFinancePage() {
  const { t, direction } = useI18n();
  const text = (key) => t(`education.${key}`);

  return (
    <main className="titech-edufinance-page" dir={direction}>
      <header className="titech-edufinance-hero">
        <p className="titech-edufinance-eyebrow">TITech Community Capital · TITech Capital SMC LTD</p>
        <h1>{text('eduFinanceTitle')}</h1>
        <p className="titech-edufinance-subtitle">{text('eduFinanceSubtitle')}</p>
        <p className="titech-edufinance-tagline">{text('eduFinanceTagline')}</p>
        <p>{text('eduFinanceDescription')}</p>
        <div className="titech-edufinance-actions">
          <Link className="titech-edufinance-button titech-edufinance-button--primary" to="/book-a-demo">{text('eduFinancePartnerEnquiry')}</Link>
          <Link className="titech-edufinance-button titech-edufinance-button--secondary" to="/education-support">{text('eduFinanceCommunitySupport')}</Link>
        </div>
      </header>

      <section className="titech-edufinance-grid" aria-label={text('eduFinanceControlsHeading')}>
        <article className="titech-edufinance-card">
          <h2>{text('eduFinanceBorrowerHeading')}</h2>
          <p>{text('eduFinanceBorrower')}</p>
        </article>
        <article className="titech-edufinance-card">
          <h2>{text('eduFinancePartnerHeading')}</h2>
          <p>{text('eduFinancePartner')}</p>
        </article>
        <article className="titech-edufinance-card">
          <h2>{text('eduFinanceControlsHeading')}</h2>
          <p>{text('eduFinanceControls')}</p>
        </article>
      </section>

      <aside className="titech-edufinance-notice" role="note">
        <strong>{text('eduFinanceCurrentStateHeading')}</strong>
        <p>{text('eduFinanceCurrentState')}</p>
        <p>{text('eduFinanceAvailability')}</p>
      </aside>
    </main>
  );
}
