/**

* ============================================================================
* TITech Community Capital Ltd
* Enterprise General Disclaimer Document
* ============================================================================
*
* File:
* frontend/src/legal/documents/GeneralDisclaimer.jsx
*
* Version:
* 2.0.0
*
* Purpose:
* Canonical general disclaimer content for the TITech Community Capital
* enterprise legal-document system.
*
* Architecture:
* * Content-focused legal document component.
* * Intended to be rendered by the centralized legal document/page system.
* * Routing should be handled by legalRoutes.js.
* * Document metadata should be controlled by legalConfig.js.
* * Shared constants should be controlled by legalConstants.js.
* * Legal document validation should be controlled by legalTypes.js.
* * Acceptance/audit behavior should be controlled by legalAcceptance.js.
*
* Brand:
* TITech Community Capital
*
* IMPORTANT:
* Do not introduce ACFOS terminology into this document.
* TITech Community Capital is the canonical product/platform identity.
*
* Legal notice:
* This document is a production-oriented technical implementation of
* general disclaimer content. Final legal language should be reviewed,
* approved and adapted by qualified legal counsel before being relied upon
* as a binding corporate legal document.
*
* ============================================================================
  */

'use strict';

import React from 'react';
import PropTypes from 'prop-types';

/* ============================================================================

* CANONICAL DOCUMENT FALLBACK METADATA
*
* These values are intentionally kept local only as safe rendering fallbacks.
* The enterprise legal registry should remain the authoritative source.
* ========================================================================== */

const FALLBACK_METADATA = Object.freeze({
organization:
'TITech Community Capital Ltd',

platform:
'TITech Community Capital',

jurisdiction:
'Uganda',

version:
'2.0',

lastUpdated:
'January 15, 2026',

legalEmail:
'[legal@titechcommunity.app](mailto:legal@titechcommunity.app)',

supportEmail:
'[support@titechcommunity.app](mailto:support@titechcommunity.app)',

phone:
'+256 (782) 397907',

phoneHref:
'+256782397907',

address:
'Plot 69-71 Jinja Road, Kampala, Uganda',
});

/* ============================================================================

* SMALL REUSABLE DOCUMENT COMPONENTS
* ========================================================================== */

function SectionHeading({
id,
children,
}) {
return ( <h2
   id={id}
   className="legal-document__section-title"
 >
{children} </h2>
);
}

SectionHeading.propTypes = {
id:
PropTypes.string.isRequired,

children:
PropTypes.node.isRequired,
};

/* ============================================================================

* MAIN DOCUMENT
* ========================================================================== */

export default function GeneralDisclaimer({
compact = false,

showDocumentNotice = true,

metadata = {},
}) {
/*

* Merge optional centralized metadata with safe local fallbacks.
*
* This makes the component resilient during migration while allowing
* legalConfig.js to become the single source of truth.
  */
  const documentMetadata = {
  ...FALLBACK_METADATA,
  ...metadata,
  };

const {
organization,
platform,
jurisdiction,
version,
lastUpdated,
legalEmail,
supportEmail,
phone,
phoneHref,
address,
} = documentMetadata;

return (
<article
className={[
'legal-document',
'legal-document--general-disclaimer',
compact
? 'legal-document--compact'
: '',
]
.filter(Boolean)
.join(' ')}
aria-labelledby="general-disclaimer-title"
>
{/* ======================================================================
DOCUMENT HEADER
==================================================================== */}

```
  <header className="legal-document__header">
    <p className="legal-document__eyebrow">
      {platform}
    </p>

    <h1
      id="general-disclaimer-title"
      className="legal-document__title"
    >
      General Disclaimer
    </h1>

    <p className="legal-document__summary">
      Important information concerning the
      availability, accuracy, use and limitations
      of information and services provided through
      {` ${platform}`}.
    </p>

    <dl
      className="legal-document__metadata"
      aria-label="General Disclaimer metadata"
    >
      <div>
        <dt>
          Version
        </dt>

        <dd>
          {version}
        </dd>
      </div>

      <div>
        <dt>
          Last updated
        </dt>

        <dd>
          {lastUpdated}
        </dd>
      </div>

      <div>
        <dt>
          Jurisdiction
        </dt>

        <dd>
          {jurisdiction}
        </dd>
      </div>
    </dl>
  </header>

  {/* ======================================================================
      IMPORTANT NOTICE
      ==================================================================== */}

  {showDocumentNotice && (
    <aside
      className="legal-document__notice"
      role="note"
      aria-label="Important disclaimer notice"
    >
      <strong>
        Important notice:
      </strong>{' '}
      Information provided through {platform}{' '}
      is intended to support users and
      organizations in using the platform. It
      should not automatically be interpreted as
      professional legal, financial, investment,
      tax, accounting or other professional advice.
    </aside>
  )}

  {/* ======================================================================
      1. PURPOSE
      ==================================================================== */}

  <section
    id="general-disclaimer-1"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-1-title"
  >
    <SectionHeading id="general-disclaimer-1-title">
      1. Purpose of This Disclaimer
    </SectionHeading>

    <p>
      This General Disclaimer explains important
      limitations and responsibilities associated
      with information, content, functionality and
      services made available through {platform}.
    </p>

    <p>
      It is intended to promote responsible use of
      the platform and to clarify that certain
      information and functionality may depend on
      user-provided information, organizational
      decisions, third-party services, network
      conditions and other factors outside
      {` ${organization}'s`} direct control.
    </p>

    <p>
      This Disclaimer should be read together with
      the applicable Terms of Service, Privacy
      Policy, Financial Disclaimer and other
      applicable legal documents.
    </p>
  </section>

  {/* ======================================================================
      2. TECHNOLOGY PLATFORM
      ==================================================================== */}

  <section
    id="general-disclaimer-2"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-2-title"
  >
    <SectionHeading id="general-disclaimer-2-title">
      2. Nature of the TITech Platform
    </SectionHeading>

    <p>
      {platform} is a technology platform
      designed to support community finance,
      financial-management and organizational
      operations.
    </p>

    <p>
      Depending on the applicable service,
      organization or configuration, the platform
      may provide tools for:
    </p>

    <ul>
      <li>
        member and organization management;
      </li>

      <li>
        savings and contribution management;
      </li>

      <li>
        transaction recording and processing;
      </li>

      <li>
        financial reporting and analytics;
      </li>

      <li>
        payment and mobile-money integrations;
      </li>

      <li>
        administrative workflows;
      </li>

      <li>
        notifications and communications;
      </li>

      <li>
        account and access management; and
      </li>

      <li>
        other community-finance functionality.
      </li>
    </ul>

    <p>
      The availability and scope of functionality
      may vary according to the applicable plan,
      service, tenant configuration, geographic
      location, regulatory environment and
      technical circumstances.
    </p>
  </section>

  {/* ======================================================================
      3. INFORMATIONAL PURPOSE
      ==================================================================== */}

  <section
    id="general-disclaimer-3"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-3-title"
  >
    <SectionHeading id="general-disclaimer-3-title">
      3. Information Provided for General
      Purposes
    </SectionHeading>

    <p>
      Information presented through {platform}{' '}
      may be provided for general informational,
      operational or administrative purposes.
    </p>

    <p>
      Information should not be considered
      individually tailored advice unless
      expressly provided under a separate
      authorized professional or contractual
      service.
    </p>

    <p>
      Users should consider their own
      circumstances and obtain appropriate
      professional advice before making decisions
      where professional advice is required.
    </p>
  </section>

  {/* ======================================================================
      4. ACCURACY
      ==================================================================== */}

  <section
    id="general-disclaimer-4"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-4-title"
  >
    <SectionHeading id="general-disclaimer-4-title">
      4. Accuracy and Completeness of Information
    </SectionHeading>

    <p>
      {organization} seeks to provide reliable and
      useful information. However, no system can
      guarantee that all information will always be
      complete, current, accurate or error-free.
    </p>

    <p>
      Information may be affected by:
    </p>

    <ul>
      <li>
        user input;
      </li>

      <li>
        administrative configuration;
      </li>

      <li>
        data synchronization;
      </li>

      <li>
        third-party systems;
      </li>

      <li>
        network conditions;
      </li>

      <li>
        processing delays;
      </li>

      <li>
        technical errors;
      </li>

      <li>
        corrections or reversals; or
      </li>

      <li>
        changes in applicable requirements.
      </li>
    </ul>

    <p>
      Users should independently verify material
      information before relying upon it for
      significant decisions or transactions.
    </p>
  </section>

  {/* ======================================================================
      5. USER RESPONSIBILITY
      ==================================================================== */}

  <section
    id="general-disclaimer-5"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-5-title"
  >
    <SectionHeading id="general-disclaimer-5-title">
      5. User Responsibility
    </SectionHeading>

    <p>
      Users are responsible for the information,
      instructions and actions they submit or
      authorize through the platform.
    </p>

    <p>
      Users should:
    </p>

    <ul>
      <li>
        maintain accurate account information;
      </li>

      <li>
        protect authentication credentials;
      </li>

      <li>
        review important transaction details;
      </li>

      <li>
        maintain appropriate records;
      </li>

      <li>
        report suspected unauthorized activity;
      </li>

      <li>
        comply with applicable laws and
        organizational policies; and
      </li>

      <li>
        use the platform only for authorized
        purposes.
      </li>
    </ul>
  </section>

  {/* ======================================================================
      6. COMMUNITY / TENANT RESPONSIBILITY
      ==================================================================== */}

  <section
    id="general-disclaimer-6"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-6-title"
  >
    <SectionHeading id="general-disclaimer-6-title">
      6. Community and Tenant Responsibility
    </SectionHeading>

    <p>
      Organizations using {platform} remain
      responsible for their internal governance,
      financial controls, member relationships,
      authorization procedures and applicable
      regulatory obligations.
    </p>

    <p>
      Tenant administrators are responsible for
      appropriately configuring and managing
      access, permissions, approvals, organizational
      policies and other administrative controls
      within their authority.
    </p>

    <p>
      Technology provided by {platform} does not
      replace the legal, fiduciary, governance,
      accounting or operational responsibilities
      of a community, SACCO, cooperative, savings
      group, microfinance organization or other
      tenant.
    </p>
  </section>

  {/* ======================================================================
      7. PROFESSIONAL ADVICE
      ==================================================================== */}

  <section
    id="general-disclaimer-7"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-7-title"
  >
    <SectionHeading id="general-disclaimer-7-title">
      7. No Professional Advice
    </SectionHeading>

    <p>
      Unless expressly stated in a separate
      agreement, information available through
      {` ${platform}`} does not constitute:
    </p>

    <ul>
      <li>
        legal advice;
      </li>

      <li>
        financial advice;
      </li>

      <li>
        investment advice;
      </li>

      <li>
        tax advice;
      </li>

      <li>
        accounting advice;
      </li>

      <li>
        audit advice;
      </li>

      <li>
        insurance advice; or
      </li>

      <li>
        other professional advice.
      </li>
    </ul>

    <p>
      Users should consult appropriately qualified
      professionals when their circumstances
      require specialized advice.
    </p>
  </section>

  {/* ======================================================================
      8. FINANCIAL DECISIONS
      ==================================================================== */}

  <section
    id="general-disclaimer-8"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-8-title"
  >
    <SectionHeading id="general-disclaimer-8-title">
      8. Financial Decisions and Outcomes
    </SectionHeading>

    <p>
      Use of {platform} does not guarantee any
      particular financial result, savings outcome,
      investment return, loan outcome,
      profitability, liquidity or financial
      performance.
    </p>

    <p>
      Financial decisions should be made after
      considering relevant information, risks,
      obligations and individual or organizational
      circumstances.
    </p>

    <p>
      Users remain responsible for financial
      decisions made using information obtained
      through the platform.
    </p>
  </section>

  {/* ======================================================================
      9. TRANSACTIONS
      ==================================================================== */}

  <section
    id="general-disclaimer-9"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-9-title"
  >
    <SectionHeading id="general-disclaimer-9-title">
      9. Transactions and Electronic Processing
    </SectionHeading>

    <p>
      Transactions conducted through or in
      connection with {platform} may depend on
      telecommunications networks, banks, mobile-
      money operators, payment processors, cloud
      infrastructure and other external systems.
    </p>

    <p>
      Transaction processing may therefore be
      affected by delays, interruptions, errors,
      provider policies, network failures or other
      circumstances outside {organization}'s direct
      control.
    </p>

    <p>
      Users should review transaction details
      before authorization and retain relevant
      confirmations or references where
      appropriate.
    </p>
  </section>

  {/* ======================================================================
      10. THIRD-PARTY SERVICES
      ==================================================================== */}

  <section
    id="general-disclaimer-10"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-10-title"
  >
    <SectionHeading id="general-disclaimer-10-title">
      10. Third-Party Services
    </SectionHeading>

    <p>
      {platform} may integrate with or provide
      references to third-party services.
    </p>

    <p>
      These may include:
    </p>

    <ul>
      <li>
        payment providers;
      </li>

      <li>
        mobile-money providers;
      </li>

      <li>
        banks and financial institutions;
      </li>

      <li>
        identity and verification services;
      </li>

      <li>
        telecommunications providers;
      </li>

      <li>
        cloud and infrastructure providers; and
      </li>

      <li>
        other technology or service providers.
      </li>
    </ul>

    <p>
      Third-party services may have separate
      terms, privacy policies, fees, limitations
      and service-level commitments.
    </p>

    <p>
      {organization} does not automatically
      endorse or guarantee third-party products or
      services merely because they are integrated
      with or referenced by the platform.
    </p>
  </section>

  {/* ======================================================================
      11. EXTERNAL LINKS
      ==================================================================== */}

  <section
    id="general-disclaimer-11"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-11-title"
  >
    <SectionHeading id="general-disclaimer-11-title">
      11. External Links and Resources
    </SectionHeading>

    <p>
      The platform may contain links to external
      websites, applications, documents or
      resources.
    </p>

    <p>
      External links may be provided for
      convenience or informational purposes and
      do not necessarily constitute an endorsement
      or guarantee of the linked content.
    </p>

    <p>
      Users should review the terms, privacy
      policies, security practices and other
      conditions applicable to external services
      before using them.
    </p>
  </section>

  {/* ======================================================================
      12. AVAILABILITY
      ==================================================================== */}

  <section
    id="general-disclaimer-12"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-12-title"
  >
    <SectionHeading id="general-disclaimer-12-title">
      12. Service Availability
    </SectionHeading>

    <p>
      {organization} seeks to maintain reliable
      availability of {platform}, but uninterrupted
      or error-free operation cannot be guaranteed.
    </p>

    <p>
      Service interruptions may result from:
    </p>

    <ul>
      <li>
        planned maintenance;
      </li>

      <li>
        software updates;
      </li>

      <li>
        infrastructure failures;
      </li>

      <li>
        network interruptions;
      </li>

      <li>
        cybersecurity incidents;
      </li>

      <li>
        third-party service outages;
      </li>

      <li>
        regulatory requirements;
      </li>

      <li>
        force majeure events; or
      </li>

      <li>
        other circumstances outside reasonable
        control.
      </li>
    </ul>
  </section>

  {/* ======================================================================
      13. SECURITY
      ==================================================================== */}

  <section
    id="general-disclaimer-13"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-13-title"
  >
    <SectionHeading id="general-disclaimer-13-title">
      13. Security and Cybersecurity
    </SectionHeading>

    <p>
      {organization} implements technical,
      organizational and administrative measures
      intended to protect the platform and
      information processed through it.
    </p>

    <p>
      However, no internet-connected system,
      application, network or storage environment
      can guarantee absolute protection against
      every possible security threat.
    </p>

    <p>
      Users are responsible for maintaining the
      security of their own credentials, devices,
      authentication methods and authorized access.
    </p>

    <p>
      Suspected account compromise, unauthorized
      access or suspicious activity should be
      reported promptly through the appropriate
      security or support channel.
    </p>
  </section>

  {/* ======================================================================
      14. TECHNICAL ERRORS
      ==================================================================== */}

  <section
    id="general-disclaimer-14"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-14-title"
  >
    <SectionHeading id="general-disclaimer-14-title">
      14. Technical Errors and Corrections
    </SectionHeading>

    <p>
      Software systems may occasionally experience
      defects, interruptions, synchronization
      problems, configuration errors, data
      inconsistencies or other technical issues.
    </p>

    <p>
      Where appropriate, {organization} may
      investigate, correct, restore, reconcile or
      otherwise address affected information or
      functionality.
    </p>

    <p>
      Users should promptly report suspected
      technical or data errors through the
      applicable support process.
    </p>
  </section>

  {/* ======================================================================
      15. NO WARRANTY
      ==================================================================== */}

  <section
    id="general-disclaimer-15"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-15-title"
  >
    <SectionHeading id="general-disclaimer-15-title">
      15. No Guarantee or Warranty of Outcomes
    </SectionHeading>

    <p>
      Except to the extent expressly provided in
      an applicable written agreement or required
      by law, {organization} does not guarantee
      that use of the platform will achieve a
      particular operational, commercial or
      financial result.
    </p>

    <p>
      The platform is provided subject to the
      applicable terms, service commitments and
      limitations governing the relevant product
      or service.
    </p>

    <p>
      Nothing in this Disclaimer is intended to
      exclude or limit rights, warranties,
      representations or remedies that cannot
      lawfully be excluded or limited.
    </p>
  </section>

  {/* ======================================================================
      16. REGULATORY LIMITATIONS
      ==================================================================== */}

  <section
    id="general-disclaimer-16"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-16-title"
  >
    <SectionHeading id="general-disclaimer-16-title">
      16. Regulatory and Jurisdictional
      Limitations
    </SectionHeading>

    <p>
      Laws and regulatory requirements governing
      financial services, technology, data
      protection, consumer protection and related
      activities vary between jurisdictions.
    </p>

    <p>
      A feature or service available through
      {` ${platform}`} may not be available,
      authorized or appropriate in every
      jurisdiction.
    </p>

    <p>
      Users and organizations are responsible for
      complying with laws and regulations
      applicable to their activities, except where
      a specific obligation has expressly been
      assumed by {organization} under a written
      agreement.
    </p>

    <p>
      Nothing in this Disclaimer is intended to
      override mandatory legal or regulatory
      requirements.
    </p>
  </section>

  {/* ======================================================================
      17. GOVERNANCE
      ==================================================================== */}

  <section
    id="general-disclaimer-17"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-17-title"
  >
    <SectionHeading id="general-disclaimer-17-title">
      17. Organizational Governance
    </SectionHeading>

    <p>
      Organizations using {platform} are
      responsible for establishing governance
      policies appropriate to their operations.
    </p>

    <p>
      Such policies may include:
    </p>

    <ul>
      <li>
        member onboarding and verification;
      </li>

      <li>
        access control;
      </li>

      <li>
        transaction authorization;
      </li>

      <li>
        segregation of duties;
      </li>

      <li>
        financial reconciliation;
      </li>

      <li>
        dispute management;
      </li>

      <li>
        fraud prevention;
      </li>

      <li>
        record retention; and
      </li>

      <li>
        regulatory compliance.
      </li>
    </ul>

    <p>
      The platform provides technology to support
      these activities but does not independently
      assume the organization's governance
      responsibilities.
    </p>
  </section>

  {/* ======================================================================
      18. CONTENT
      ==================================================================== */}

  <section
    id="general-disclaimer-18"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-18-title"
  >
    <SectionHeading id="general-disclaimer-18-title">
      18. User-Generated and Organizational
      Content
    </SectionHeading>

    <p>
      Users and authorized organizations may
      create, submit, upload or otherwise make
      information available through the platform.
    </p>

    <p>
      The party providing such information remains
      responsible for ensuring that it is accurate,
      lawful, appropriately authorized and suitable
      for the intended purpose.
    </p>

    <p>
      {organization} does not necessarily verify
      every item of user-generated or
      organization-generated information before it
      is displayed or processed.
    </p>
  </section>

  {/* ======================================================================
      19. PRIVACY
      ==================================================================== */}

  <section
    id="general-disclaimer-19"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-19-title"
  >
    <SectionHeading id="general-disclaimer-19-title">
      19. Privacy and Personal Information
    </SectionHeading>

    <p>
      The processing of personal information
      through {platform} is governed by the
      applicable TITech Privacy Policy and other
      relevant privacy notices.
    </p>

    <p>
      Users should review the applicable privacy
      documentation to understand how personal
      information may be collected, used, disclosed,
      retained and protected.
    </p>
  </section>

  {/* ======================================================================
      20. CHILDREN
      ==================================================================== */}

  <section
    id="general-disclaimer-20"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-20-title"
  >
    <SectionHeading id="general-disclaimer-20-title">
      20. Children and Age Requirements
    </SectionHeading>

    <p>
      Access to certain TITech services may be
      subject to minimum-age requirements or
      restrictions imposed by applicable law,
      product rules or organizational policies.
    </p>

    <p>
      Users should not provide access to persons
      who are not authorized to use the applicable
      service.
    </p>

    <p>
      Where services involve minors or
      youth-related activities, the applicable
      legal, safeguarding and organizational
      requirements must be followed.
    </p>
  </section>

  {/* ======================================================================
      21. FORCE MAJEURE
      ==================================================================== */}

  <section
    id="general-disclaimer-21"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-21-title"
  >
    <SectionHeading id="general-disclaimer-21-title">
      21. Events Beyond Reasonable Control
    </SectionHeading>

    <p>
      Service performance may be affected by
      circumstances beyond reasonable control,
      including natural disasters, infrastructure
      failures, telecommunications interruptions,
      public emergencies, cyber incidents,
      government actions, regulatory changes,
      labor disruptions and failures of third-party
      providers.
    </p>

    <p>
      {organization} will take reasonable steps to
      restore affected services where practicable,
      subject to applicable law and operational
      circumstances.
    </p>
  </section>

  {/* ======================================================================
      22. RELATED LEGAL DOCUMENTS
      ==================================================================== */}

  <section
    id="general-disclaimer-22"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-22-title"
  >
    <SectionHeading id="general-disclaimer-22-title">
      22. Relationship With Other Legal Documents
    </SectionHeading>

    <p>
      This General Disclaimer should be read
      together with applicable TITech legal and
      contractual documents, including:
    </p>

    <ul>
      <li>
        Terms of Service;
      </li>

      <li>
        Privacy Policy;
      </li>

      <li>
        Financial Disclaimer;
      </li>

      <li>
        applicable service agreements;
      </li>

      <li>
        subscription agreements;
      </li>

      <li>
        tenant agreements;
      </li>

      <li>
        transaction terms;
      </li>

      <li>
        applicable disclosures; and
      </li>

      <li>
        other policies or notices incorporated
        into the applicable service.
      </li>
    </ul>

    <p>
      Where a specific written agreement expressly
      governs a particular matter, that agreement
      will apply to the extent permitted by
      applicable law.
    </p>
  </section>

  {/* ======================================================================
      23. CHANGES
      ==================================================================== */}

  <section
    id="general-disclaimer-23"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-23-title"
  >
    <SectionHeading id="general-disclaimer-23-title">
      23. Changes to This Disclaimer
    </SectionHeading>

    <p>
      {organization} may update this General
      Disclaimer from time to time to reflect
      changes in services, technology, business
      operations, legal requirements or regulatory
      expectations.
    </p>

    <p>
      The published version number and last-updated
      date identify the applicable published
      version.
    </p>

    <p>
      Where required or reasonably appropriate,
      material changes may be communicated through
      the platform, website, email or another
      suitable communication channel.
    </p>
  </section>

  {/* ======================================================================
      24. CONTACT
      ==================================================================== */}

  <section
    id="general-disclaimer-24"
    className="legal-document__section"
    aria-labelledby="general-disclaimer-24-title"
  >
    <SectionHeading id="general-disclaimer-24-title">
      24. Contact Information
    </SectionHeading>

    <p>
      Questions concerning this General
      Disclaimer or the use of TITech Community
      Capital may be directed to:
    </p>

    <address className="legal-contact">
      <p>
        <strong>
          {organization}
        </strong>
        <br />
        {address}
      </p>

      <p>
        Legal:{' '}
        <a
          href={`mailto:${legalEmail}`}
          aria-label={`Email ${organization} legal team`}
        >
          {legalEmail}
        </a>
      </p>

      <p>
        Support:{' '}
        <a
          href={`mailto:${supportEmail}`}
          aria-label={`Email ${organization} support`}
        >
          {supportEmail}
        </a>
      </p>

      <p>
        Telephone:{' '}
        <a
          href={`tel:${phoneHref}`}
          aria-label={`Call ${organization}`}
        >
          {phone}
        </a>
      </p>
    </address>
  </section>

  {/* ======================================================================
      DOCUMENT FOOTER
      ==================================================================== */}

  <footer className="legal-document__footer">
    <p>
      <strong>
        General Disclaimer
      </strong>
    </p>

    <p>
      Version {version} · Last updated{' '}
      {lastUpdated}
    </p>

    <p>
      © {new Date().getFullYear()}{' '}
      {organization}. All rights reserved.
    </p>
  </footer>
</article>


);
}

/* ============================================================================

* PROP TYPES
* ========================================================================== */

GeneralDisclaimer.propTypes = {
compact:
PropTypes.bool,

showDocumentNotice:
PropTypes.bool,

metadata:
PropTypes.shape({
organization:
PropTypes.string,


  platform:
    PropTypes.string,

  jurisdiction:
    PropTypes.string,

  version:
    PropTypes.string,

  lastUpdated:
    PropTypes.string,

  legalEmail:
    PropTypes.string,

  supportEmail:
    PropTypes.string,

  phone:
    PropTypes.string,

  phoneHref:
    PropTypes.string,

  address:
    PropTypes.string,
}),


};