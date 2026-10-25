import React from 'react';
import { Link } from 'react-router-dom';
import './LegalDocuments.css';

/**
 * Optional form fragment to add to the existing canonical registration screen.
 * Wire values into the current registration service; do not create a second auth path.
 * The backend must validate acceptance and write its own authoritative timestamp,
 * document version, actor, and audit event. Never trust client-supplied timestamps.
 */
export function LegalConsentFields({
  termsAccepted,
  onTermsAcceptedChange,
  privacyAcknowledged,
  onPrivacyAcknowledgedChange,
  disabled = false,
}) {
  return (
    <fieldset className="titech-legal-consent" disabled={disabled}>
      <legend>Review the legal documents</legend>
      <label className="titech-legal-consent__item">
        <input
          type="checkbox"
          name="acceptedTerms"
          checked={Boolean(termsAccepted)}
          onChange={(event) => onTermsAcceptedChange?.(event.target.checked)}
          required
        />
        <span>I agree to the <Link to="/terms">Terms of Service</Link>.</span>
      </label>
      <label className="titech-legal-consent__item">
        <input
          type="checkbox"
          name="acknowledgedPrivacy"
          checked={Boolean(privacyAcknowledged)}
          onChange={(event) => onPrivacyAcknowledgedChange?.(event.target.checked)}
          required
        />
        <span>I have read the <Link to="/privacy">Privacy Policy</Link> and understand how my personal information may be handled.</span>
      </label>
      <p className="titech-legal-consent__note">
        This privacy acknowledgement is not blanket consent to every use of personal data. Where separate,
        purpose-specific consent is legally required, it must be presented and recorded separately.
      </p>
    </fieldset>
  );
}

export function isLegalAcceptanceComplete({ termsAccepted, privacyAcknowledged } = {}) {
  return termsAccepted === true && privacyAcknowledged === true;
}
