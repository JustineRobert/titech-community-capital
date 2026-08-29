/**
* ============================================================================
* TITech Community Capital Ltd
* Enterprise Terms of Service Document
* ============================================================================
*
* File:
* frontend/src/legal/documents/TermsOfService.jsx
*
* Version:
* 2.0.0
*
* Purpose:
* Canonical Terms of Service content component for the TITech Community
* Capital enterprise legal-document system.
*
* Architecture:
* * Content-focused legal document.
* * Routing belongs in legalRoutes.js.
* * Document metadata belongs in legalConfig.js.
* * Shared legal constants belong in legalConstants.js.
* * Runtime validation belongs in legalTypes.js.
* * Acceptance and audit behavior belongs in legalAcceptance.js.
*
* Brand:
* TITech Community Capital
*
* IMPORTANT:
* TITech Community Capital is the canonical product/platform identity.
* Legacy ACFOS terminology must not be introduced into this document.
*
* Legal review:
* This document provides an enterprise-oriented contractual framework.
* Final publication should be reviewed and approved by qualified legal
* counsel and aligned with TITech's actual contracts, product behavior,
* regulatory obligations, pricing, SLAs, data-processing arrangements,
* payment-provider relationships and applicable Ugandan/African law.
*
* ============================================================================
  */

'use strict';

import React from 'react';
import PropTypes from 'prop-types';

/* ============================================================================

* FALLBACK METADATA
*
* legalConfig.js should remain the authoritative source when this component
* is rendered through the centralized legal-document system.
*
* These defaults allow the component to remain independently renderable.
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

effectiveDate:
'January 15, 2026',

legalEmail:
'[legal@titechcommunity.app](mailto:legal@titechcommunity.app)',

supportEmail:
'[support@titechcommunity.app](mailto:support@titechcommunity.app)',

privacyEmail:
'[privacy@titechcommunity.app](mailto:privacy@titechcommunity.app)',

phone:
'+256 (782) 397907',

phoneHref:
'+256782397907',

address:
'Plot 69-71 Jinja Road, Kampala, Uganda',
});

/* ============================================================================

* REUSABLE PRESENTATIONAL COMPONENTS
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

* MAIN TERMS OF SERVICE DOCUMENT
* ========================================================================== */

export default function TermsOfService({
compact = false,

showDocumentNotice = true,

metadata = {},
}) {
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
effectiveDate,
legalEmail,
supportEmail,
privacyEmail,
phone,
phoneHref,
address,
} = documentMetadata;

return (
<article
className={[
'legal-document',
'legal-document--terms-of-service',
compact
? 'legal-document--compact'
: '',
]
.filter(Boolean)
.join(' ')}
aria-labelledby="terms-of-service-title"
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
      id="terms-of-service-title"
      className="legal-document__title"
    >
      Terms of Service
    </h1>

    <p className="legal-document__summary">
      These Terms of Service govern access to and
      use of the {platform} platform, products,
      applications and related services provided by{' '}
      {organization}.
    </p>

    <dl
      className="legal-document__metadata"
      aria-label="Terms of Service metadata"
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
          Effective date
        </dt>

        <dd>
          {effectiveDate}
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
          Governing jurisdiction
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
      aria-label="Important terms notice"
    >
      <strong>
        Important:
      </strong>{' '}
      TITech is a technology platform. Specific
      financial products, payment services,
      regulated services, customer agreements and
      tenant arrangements may be subject to
      additional terms, disclosures or agreements.
    </aside>
  )}

  {/* ======================================================================
      1. ACCEPTANCE
      ==================================================================== */}

  <section
    id="terms-of-service-1"
    className="legal-document__section"
    aria-labelledby="terms-of-service-1-title"
  >
    <SectionHeading id="terms-of-service-1-title">
      1. Acceptance of These Terms
    </SectionHeading>

    <p>
      These Terms of Service ("Terms") constitute a
      legally binding agreement between you and{' '}
      {organization} concerning your access to and
      use of {platform}.
    </p>

    <p>
      By accessing, registering for, activating or
      using the platform, you acknowledge that you
      have read, understood and agree to be bound by
      these Terms and any additional terms expressly
      incorporated into them.
    </p>

    <p>
      If you do not agree to these Terms, you must
      not access or use the applicable services.
    </p>

    <p>
      Where you use TITech on behalf of an
      organization, you represent that you have
      authority to bind that organization to the
      applicable agreement.
    </p>
  </section>

  {/* ======================================================================
      2. ELIGIBILITY
      ==================================================================== */}

  <section
    id="terms-of-service-2"
    className="legal-document__section"
    aria-labelledby="terms-of-service-2-title"
  >
    <SectionHeading id="terms-of-service-2-title">
      2. Eligibility and Authority
    </SectionHeading>

    <p>
      You may use TITech only where you are legally
      capable of entering into a binding agreement
      and are otherwise permitted to use the
      applicable service under applicable law.
    </p>

    <p>
      Certain services may impose additional
      eligibility requirements, verification
      procedures, minimum-age requirements or
      organizational approval requirements.
    </p>

    <p>
      If you are accessing TITech on behalf of a
      tenant, SACCO, savings group, cooperative,
      microfinance institution, community
      organization or other entity, you confirm that
      you are authorized to do so.
    </p>
  </section>

  {/* ======================================================================
      3. DEFINITIONS
      ==================================================================== */}

  <section
    id="terms-of-service-3"
    className="legal-document__section"
    aria-labelledby="terms-of-service-3-title"
  >
    <SectionHeading id="terms-of-service-3-title">
      3. Definitions
    </SectionHeading>

    <p>
      For purposes of these Terms:
    </p>

    <dl className="legal-document__definitions">
      <div>
        <dt>
          "TITech"
        </dt>

        <dd>
          means {organization}, including its
          applicable products, services and
          authorized affiliates.
        </dd>
      </div>

      <div>
        <dt>
          "Platform"
        </dt>

        <dd>
          means the websites, applications,
          software, APIs, infrastructure and
          services made available by TITech under
          the applicable service arrangement.
        </dd>
      </div>

      <div>
        <dt>
          "User"
        </dt>

        <dd>
          means an individual who accesses or uses
          the platform.
        </dd>
      </div>

      <div>
        <dt>
          "Tenant"
        </dt>

        <dd>
          means an organization or account
          environment using TITech under a
          separate organizational arrangement.
        </dd>
      </div>

      <div>
        <dt>
          "Content"
        </dt>

        <dd>
          means information, documents, records,
          data or other material submitted to or
          generated through the platform.
        </dd>
      </div>

      <div>
        <dt>
          "Services"
        </dt>

        <dd>
          means the TITech products, features and
          functionality made available to a User
          or Tenant.
        </dd>
      </div>
    </dl>
  </section>

  {/* ======================================================================
      4. ACCOUNT
      ==================================================================== */}

  <section
    id="terms-of-service-4"
    className="legal-document__section"
    aria-labelledby="terms-of-service-4-title"
  >
    <SectionHeading id="terms-of-service-4-title">
      4. Account Registration and Management
    </SectionHeading>

    <p>
      Certain TITech services require an account.
      Users must provide information that is
      accurate, complete and reasonably current.
    </p>

    <p>
      Users are responsible for maintaining the
      confidentiality of their account credentials
      and for activity performed through their
      accounts, except to the extent that applicable
      law provides otherwise.
    </p>

    <p>
      Users must promptly notify TITech or their
      relevant Tenant administrator of suspected
      unauthorized access, credential compromise or
      other account-security incidents.
    </p>

    <p>
      Users must not share authentication credentials
      where sharing is prohibited by TITech policy,
      Tenant policy or applicable security
      requirements.
    </p>
  </section>

  {/* ======================================================================
      5. IDENTITY VERIFICATION
      ==================================================================== */}

  <section
    id="terms-of-service-5"
    className="legal-document__section"
    aria-labelledby="terms-of-service-5-title"
  >
    <SectionHeading id="terms-of-service-5-title">
      5. Identity Verification and Compliance
    </SectionHeading>

    <p>
      TITech or an applicable Tenant may require
      identity, contact, organizational or other
      information to establish or maintain an
      account.
    </p>

    <p>
      Where legally required or reasonably
      necessary for a service, users may be subject
      to verification, fraud-prevention,
      sanctions-screening, anti-money-laundering or
      other compliance procedures.
    </p>

    <p>
      Failure to provide information reasonably
      required for lawful verification may result in
      delayed, restricted or unavailable services.
    </p>
  </section>

  {/* ======================================================================
      6. TENANT RESPONSIBILITIES
      ==================================================================== */}

  <section
    id="terms-of-service-6"
    className="legal-document__section"
    aria-labelledby="terms-of-service-6-title"
  >
    <SectionHeading id="terms-of-service-6-title">
      6. Tenant and Organization Responsibilities
    </SectionHeading>

    <p>
      Organizations using TITech are responsible
      for:
    </p>

    <ul>
      <li>
        managing authorized users and administrators;
      </li>

      <li>
        configuring appropriate roles and permissions;
      </li>

      <li>
        ensuring that submitted information is
        accurate and lawfully obtained;
      </li>

      <li>
        maintaining appropriate internal controls;
      </li>

      <li>
        complying with applicable financial,
        cooperative, privacy and other regulatory
        requirements;
      </li>

      <li>
        maintaining appropriate member
        authorization procedures;
      </li>

      <li>
        safeguarding administrator credentials;
      </li>

      <li>
        reviewing transactions and records;
      </li>

      <li>
        notifying TITech of suspected security
        incidents; and
      </li>

      <li>
        complying with any separate enterprise,
        subscription or service agreement.
      </li>
    </ul>
  </section>

  {/* ======================================================================
      7. ACCEPTABLE USE
      ==================================================================== */}

  <section
    id="terms-of-service-7"
    className="legal-document__section"
    aria-labelledby="terms-of-service-7-title"
  >
    <SectionHeading id="terms-of-service-7-title">
      7. Acceptable Use
    </SectionHeading>

    <p>
      Users must use TITech only for lawful and
      authorized purposes.
    </p>

    <p>
      Users must not:
    </p>

    <ul>
      <li>
        violate applicable law or regulation;
      </li>

      <li>
        use the platform to commit fraud or
        facilitate unlawful activity;
      </li>

      <li>
        impersonate another person or organization;
      </li>

      <li>
        submit false, misleading or fraudulent
        information;
      </li>

      <li>
        access another user's account without
        authorization;
      </li>

      <li>
        bypass security or access controls;
      </li>

      <li>
        interfere with platform availability or
        integrity;
      </li>

      <li>
        introduce malware, malicious code or
        harmful software;
      </li>

      <li>
        conduct unauthorized security testing;
      </li>

      <li>
        reverse engineer the platform except to the
        extent expressly permitted by law;
      </li>

      <li>
        scrape or systematically extract platform
        information without authorization;
      </li>

      <li>
        misuse APIs or technical interfaces;
      </li>

      <li>
        use TITech to infringe intellectual-property
        rights; or
      </li>

      <li>
        use the platform in a manner that could
        reasonably compromise its security,
        reliability or availability.
      </li>
    </ul>
  </section>

  {/* ======================================================================
      8. FINANCIAL TRANSACTIONS
      ==================================================================== */}

  <section
    id="terms-of-service-8"
    className="legal-document__section"
    aria-labelledby="terms-of-service-8-title"
  >
    <SectionHeading id="terms-of-service-8-title">
      8. Transactions and Financial Records
    </SectionHeading>

    <p>
      TITech may provide technology for recording,
      initiating, supporting, reconciling or
      reporting financial and community-finance
      activities.
    </p>

    <p>
      Unless expressly stated in a separate
      agreement or disclosure, TITech does not
      guarantee the underlying financial obligations
      between users, members, Tenants or third-party
      financial institutions.
    </p>

    <p>
      Users and Tenants are responsible for reviewing
      transaction information and reporting suspected
      errors promptly through the applicable support
      or dispute process.
    </p>

    <p>
      Transaction processing may depend on third
      parties, including banks, mobile-money
      operators, payment processors and other
      financial-service providers.
    </p>
  </section>

  {/* ======================================================================
      9. PAYMENT PROVIDERS
      ==================================================================== */}

  <section
    id="terms-of-service-9"
    className="legal-document__section"
    aria-labelledby="terms-of-service-9-title"
  >
    <SectionHeading id="terms-of-service-9-title">
      9. Third-Party Payment and Financial Services
    </SectionHeading>

    <p>
      TITech may integrate with third-party payment,
      mobile-money, banking or financial technology
      providers.
    </p>

    <p>
      Such providers may impose their own terms,
      fees, eligibility requirements, transaction
      limits, verification procedures and service
      availability conditions.
    </p>

    <p>
      A third-party provider may independently
      process information and transactions in
      accordance with its own legal and contractual
      obligations.
    </p>

    <p>
      TITech does not control third-party provider
      systems and cannot guarantee uninterrupted
      availability of external services.
    </p>
  </section>

  {/* ======================================================================
      10. FEES
      ==================================================================== */}

  <section
    id="terms-of-service-10"
    className="legal-document__section"
    aria-labelledby="terms-of-service-10-title"
  >
    <SectionHeading id="terms-of-service-10-title">
      10. Fees, Charges and Taxes
    </SectionHeading>

    <p>
      Certain TITech services may be subject to
      subscription fees, transaction fees,
      implementation charges, usage charges or
      other applicable fees.
    </p>

    <p>
      Applicable pricing will be disclosed through
      the relevant pricing page, order form,
      subscription agreement or other contractual
      documentation.
    </p>

    <p>
      Third-party financial providers may impose
      additional charges that are outside TITech's
      control.
    </p>

    <p>
      Users and Tenants are responsible for
      applicable taxes, duties or governmental
      charges associated with their use of the
      Services, except where TITech is legally
      required to collect or pay them.
    </p>
  </section>

  {/* ======================================================================
      11. CONTENT
      ==================================================================== */}

  <section
    id="terms-of-service-11"
    className="legal-document__section"
    aria-labelledby="terms-of-service-11-title"
  >
    <SectionHeading id="terms-of-service-11-title">
      11. User and Tenant Content
    </SectionHeading>

    <p>
      Users and Tenants retain their respective
      rights in Content they lawfully submit to
      TITech, subject to applicable agreements and
      third-party rights.
    </p>

    <p>
      Users grant TITech the limited rights
      reasonably necessary to host, process,
      transmit, display, secure, back up and
      otherwise operate the Services in accordance
      with the applicable agreement and Privacy
      Policy.
    </p>

    <p>
      Users must ensure that they have the necessary
      rights, permissions and lawful authority to
      submit Content to TITech.
    </p>
  </section>

  {/* ======================================================================
      12. INTELLECTUAL PROPERTY
      ==================================================================== */}

  <section
    id="terms-of-service-12"
    className="legal-document__section"
    aria-labelledby="terms-of-service-12-title"
  >
    <SectionHeading id="terms-of-service-12-title">
      12. Intellectual Property
    </SectionHeading>

    <p>
      Except for rights expressly granted under
      these Terms, TITech and its licensors retain
      all rights, title and interest in the
      platform, software, interfaces, trademarks,
      branding, documentation, designs and other
      proprietary materials.
    </p>

    <p>
      No ownership rights are transferred to a User
      merely because the User accesses or uses the
      Services.
    </p>

    <p>
      TITech, TITech Community Capital and related
      names, marks and branding may constitute
      trademarks or protected identifiers of TITech
      or their respective owners.
    </p>
  </section>

  {/* ======================================================================
      13. LICENSE
      ==================================================================== */}

  <section
    id="terms-of-service-13"
    className="legal-document__section"
    aria-labelledby="terms-of-service-13-title"
  >
    <SectionHeading id="terms-of-service-13-title">
      13. Limited License
    </SectionHeading>

    <p>
      Subject to these Terms, TITech grants an
      applicable User a limited, non-exclusive,
      non-transferable and revocable right to access
      and use the Services for their intended
      purposes.
    </p>

    <p>
      This license does not authorize resale,
      sublicensing, unauthorized copying,
      distribution, modification, reverse
      engineering or creation of derivative works
      except where expressly permitted.
    </p>
  </section>

  {/* ======================================================================
      14. API
      ==================================================================== */}

  <section
    id="terms-of-service-14"
    className="legal-document__section"
    aria-labelledby="terms-of-service-14-title"
  >
    <SectionHeading id="terms-of-service-14-title">
      14. APIs and Integrations
    </SectionHeading>

    <p>
      Where TITech provides APIs or integration
      capabilities, access is subject to applicable
      technical documentation, credentials, usage
      limits and security requirements.
    </p>

    <p>
      API credentials must be treated as confidential
      authentication information and must not be
      publicly exposed, embedded in insecure
      client-side applications or shared with
      unauthorized parties.
    </p>

    <p>
      TITech may restrict, suspend or modify API
      access where reasonably necessary to protect
      platform security, reliability or compliance.
    </p>
  </section>

  {/* ======================================================================
      15. AVAILABILITY
      ==================================================================== */}

  <section
    id="terms-of-service-15"
    className="legal-document__section"
    aria-labelledby="terms-of-service-15-title"
  >
    <SectionHeading id="terms-of-service-15-title">
      15. Service Availability
    </SectionHeading>

    <p>
      TITech seeks to provide reliable and secure
      Services but does not guarantee that the
      platform will always be uninterrupted,
      error-free or continuously available.
    </p>

    <p>
      Availability may be affected by maintenance,
      upgrades, infrastructure failures, third-party
      dependencies, telecommunications failures,
      cybersecurity events, force majeure events or
      circumstances outside TITech's reasonable
      control.
    </p>

    <p>
      Enterprise customers may receive separate
      service-level commitments under a written
      agreement.
    </p>
  </section>

  {/* ======================================================================
      16. MAINTENANCE
      ==================================================================== */}

  <section
    id="terms-of-service-16"
    className="legal-document__section"
    aria-labelledby="terms-of-service-16-title"
  >
    <SectionHeading id="terms-of-service-16-title">
      16. Maintenance and Changes to Services
    </SectionHeading>

    <p>
      TITech may modify, improve, replace, suspend
      or discontinue features of the Services where
      reasonably necessary for operational,
      technical, security, business or legal
      reasons.
    </p>

    <p>
      Where required by an applicable enterprise
      agreement, TITech will provide notice of
      material changes in accordance with that
      agreement.
    </p>
  </section>

  {/* ======================================================================
      17. SECURITY
      ==================================================================== */}

  <section
    id="terms-of-service-17"
    className="legal-document__section"
    aria-labelledby="terms-of-service-17-title"
  >
    <SectionHeading id="terms-of-service-17-title">
      17. Security Responsibilities
    </SectionHeading>

    <p>
      TITech maintains technical and organizational
      safeguards intended to protect the platform and
      information processed through it.
    </p>

    <p>
      Users and Tenants must also implement
      reasonable security controls appropriate to
      their responsibilities.
    </p>

    <p>
      Security incidents, suspected account
      compromise and unauthorized access should be
      reported promptly through the appropriate
      TITech support or security channel.
    </p>
  </section>

  {/* ======================================================================
      18. PRIVACY
      ==================================================================== */}

  <section
    id="terms-of-service-18"
    className="legal-document__section"
    aria-labelledby="terms-of-service-18-title"
  >
    <SectionHeading id="terms-of-service-18-title">
      18. Privacy and Data Protection
    </SectionHeading>

    <p>
      Processing of personal information through
      TITech is described in the applicable Privacy
      Policy and, where applicable, additional
      contractual data-processing terms.
    </p>

    <p>
      Users and Tenants must provide personal
      information only where they have an appropriate
      lawful basis or authority to do so.
    </p>

    <p>
      The Privacy Policy forms part of the overall
      legal framework governing use of the Services
      to the extent stated in that document.
    </p>
  </section>

  {/* ======================================================================
      19. CONFIDENTIALITY
      ==================================================================== */}

  <section
    id="terms-of-service-19"
    className="legal-document__section"
    aria-labelledby="terms-of-service-19-title"
  >
    <SectionHeading id="terms-of-service-19-title">
      19. Confidentiality
    </SectionHeading>

    <p>
      Each party may receive confidential
      information belonging to the other party in
      connection with the Services.
    </p>

    <p>
      Confidential information should be protected
      using reasonable safeguards and should not be
      disclosed except where necessary to perform
      contractual obligations, where authorized or
      where required by law.
    </p>

    <p>
      Separate confidentiality provisions in an
      enterprise agreement may apply where
      applicable.
    </p>
  </section>

  {/* ======================================================================
      20. COMPLIANCE
      ==================================================================== */}

  <section
    id="terms-of-service-20"
    className="legal-document__section"
    aria-labelledby="terms-of-service-20-title"
  >
    <SectionHeading id="terms-of-service-20-title">
      20. Legal and Regulatory Compliance
    </SectionHeading>

    <p>
      Users and Tenants must use TITech in
      compliance with applicable laws and
      regulations.
    </p>

    <p>
      Depending on the service and the role of the
      relevant organization, additional obligations
      may apply concerning financial services,
      payments, consumer protection, privacy,
      records, taxation, anti-money laundering,
      fraud prevention and other regulated
      activities.
    </p>

    <p>
      TITech does not represent that use of its
      technology alone makes a User or Tenant
      compliant with every legal or regulatory
      obligation applicable to that User or Tenant.
    </p>
  </section>

  {/* ======================================================================
      21. PROHIBITED ACTIVITIES
      ==================================================================== */}

  <section
    id="terms-of-service-21"
    className="legal-document__section"
    aria-labelledby="terms-of-service-21-title"
  >
    <SectionHeading id="terms-of-service-21-title">
      21. Fraud, Abuse and Prohibited Activities
    </SectionHeading>

    <p>
      TITech may investigate suspected fraud,
      abuse, unauthorized activity or violations of
      these Terms.
    </p>

    <p>
      Where appropriate and legally permitted,
      TITech may restrict access, preserve relevant
      records, suspend accounts or cooperate with
      authorized authorities.
    </p>

    <p>
      Nothing in this section limits TITech's
      obligations under applicable law or an
      applicable contractual agreement.
    </p>
  </section>

  {/* ======================================================================
      22. SUSPENSION
      ==================================================================== */}

  <section
    id="terms-of-service-22"
    className="legal-document__section"
    aria-labelledby="terms-of-service-22-title"
  >
    <SectionHeading id="terms-of-service-22-title">
      22. Suspension and Restriction
    </SectionHeading>

    <p>
      TITech may suspend or restrict access where
      reasonably necessary to:
    </p>

    <ul>
      <li>
        protect platform security;
      </li>

      <li>
        investigate suspected unauthorized activity;
      </li>

      <li>
        prevent fraud or abuse;
      </li>

      <li>
        comply with legal or regulatory obligations;
      </li>

      <li>
        address non-payment where contractually
        permitted;
      </li>

      <li>
        protect other users or Tenants; or
      </li>

      <li>
        enforce these Terms or another applicable
        agreement.
      </li>
    </ul>

    <p>
      Where appropriate, TITech may provide notice
      and an opportunity to resolve the issue before
      restricting access, except where immediate
      action is reasonably necessary.
    </p>
  </section>

  {/* ======================================================================
      23. TERMINATION
      ==================================================================== */}

  <section
    id="terms-of-service-23"
    className="legal-document__section"
    aria-labelledby="terms-of-service-23-title"
  >
    <SectionHeading id="terms-of-service-23-title">
      23. Termination
    </SectionHeading>

    <p>
      A User or Tenant may terminate their use of
      applicable Services in accordance with the
      relevant account or contractual procedures.
    </p>

    <p>
      TITech may terminate or discontinue access
      where permitted under these Terms or an
      applicable agreement.
    </p>

    <p>
      Termination does not automatically eliminate
      obligations that by their nature should survive
      termination, including payment obligations,
      confidentiality, intellectual-property rights,
      limitations of liability, dispute provisions
      and applicable record-retention requirements.
    </p>
  </section>

  {/* ======================================================================
      24. DATA AFTER TERMINATION
      ==================================================================== */}

  <section
    id="terms-of-service-24"
    className="legal-document__section"
    aria-labelledby="terms-of-service-24-title"
  >
    <SectionHeading id="terms-of-service-24-title">
      24. Data Following Termination
    </SectionHeading>

    <p>
      Following termination, information may be
      retained, deleted, archived or otherwise
      processed in accordance with the applicable
      Privacy Policy, contractual requirements,
      backup processes, security requirements and
      applicable law.
    </p>

    <p>
      Specific enterprise customers may have
      additional data-export, deletion or transition
      rights under a written agreement.
    </p>
  </section>

  {/* ======================================================================
      25. DISCLAIMERS
      ==================================================================== */}

  <section
    id="terms-of-service-25"
    className="legal-document__section"
    aria-labelledby="terms-of-service-25-title"
  >
    <SectionHeading id="terms-of-service-25-title">
      25. Disclaimers
    </SectionHeading>

    <p>
      To the maximum extent permitted by applicable
      law, the Services are provided subject to the
      terms, conditions and limitations expressly
      stated in the applicable agreement.
    </p>

    <p>
      TITech does not guarantee that the Services
      will meet every individual or organizational
      requirement, operate without interruption,
      remain unchanged or be free from every error or
      defect.
    </p>

    <p>
      Information displayed through the platform is
      not automatically a substitute for independent
      professional, legal, accounting, tax,
      investment or financial advice.
    </p>
  </section>

  {/* ======================================================================
      26. FINANCIAL DISCLAIMER
      ==================================================================== */}

  <section
    id="terms-of-service-26"
    className="legal-document__section"
    aria-labelledby="terms-of-service-26-title"
  >
    <SectionHeading id="terms-of-service-26-title">
      26. Financial Services Disclaimer
    </SectionHeading>

    <p>
      Unless expressly stated in a separate
      agreement and authorized under applicable law,
      TITech provides technology and software
      services and does not itself constitute every
      financial service that may be accessed through
      an integrated workflow.
    </p>

    <p>
      Financial decisions, lending decisions,
      savings policies, member approvals, interest
      policies, contributions and other organizational
      financial decisions remain the responsibility
      of the applicable User, Tenant or authorized
      financial institution, as applicable.
    </p>

    <p>
      Users should obtain independent professional
      advice where appropriate before making
      significant financial, legal, tax or investment
      decisions.
    </p>
  </section>

  {/* ======================================================================
      27. THIRD-PARTY SERVICES
      ==================================================================== */}

  <section
    id="terms-of-service-27"
    className="legal-document__section"
    aria-labelledby="terms-of-service-27-title"
  >
    <SectionHeading id="terms-of-service-27-title">
      27. Third-Party Services
    </SectionHeading>

    <p>
      TITech may depend on third-party infrastructure,
      communications networks, payment services,
      hosting providers, identity services, analytics
      providers and other technology providers.
    </p>

    <p>
      Third-party services may be governed by their
      own terms and policies.
    </p>

    <p>
      TITech is not responsible for third-party
      services to the extent that their failures or
      actions are outside TITech's reasonable control,
      subject to applicable contractual and legal
      obligations.
    </p>
  </section>

  {/* ======================================================================
      28. INDEMNIFICATION
      ==================================================================== */}

  <section
    id="terms-of-service-28"
    className="legal-document__section"
    aria-labelledby="terms-of-service-28-title"
  >
    <SectionHeading id="terms-of-service-28-title">
      28. Indemnification
    </SectionHeading>

    <p>
      To the extent permitted by applicable law and
      any applicable enterprise agreement, a User or
      Tenant may be responsible for losses, claims,
      liabilities, damages, costs or expenses arising
      from:
    </p>

    <ul>
      <li>
        unlawful use of the Services;
      </li>

      <li>
        violation of these Terms;
      </li>

      <li>
        unauthorized access caused by the User's
        failure to maintain appropriate credentials
        or controls;
      </li>

      <li>
        infringement of third-party rights through
        submitted Content; or
      </li>

      <li>
        other acts or omissions for which the User
        or Tenant is legally responsible.
      </li>
    </ul>

    <p>
      The precise scope of indemnification may be
      governed by a separate written agreement.
    </p>
  </section>

  {/* ======================================================================
      29. LIMITATION OF LIABILITY
      ==================================================================== */}

  <section
    id="terms-of-service-29"
    className="legal-document__section"
    aria-labelledby="terms-of-service-29-title"
  >
    <SectionHeading id="terms-of-service-29-title">
      29. Limitation of Liability
    </SectionHeading>

    <p>
      To the maximum extent permitted by applicable
      law, TITech will not be liable for indirect,
      incidental, special, consequential or punitive
      losses arising from use of the Services,
      including loss of profits, revenue,
      opportunities, goodwill or anticipated savings,
      except where such limitation is prohibited by
      law.
    </p>

    <p>
      Nothing in these Terms excludes or limits
      liability that cannot lawfully be excluded or
      limited.
    </p>

    <p>
      Where a separate enterprise agreement
      establishes liability limits, that agreement
      will govern to the extent of any conflict.
    </p>
  </section>

  {/* ======================================================================
      30. FORCE MAJEURE
      ==================================================================== */}

  <section
    id="terms-of-service-30"
    className="legal-document__section"
    aria-labelledby="terms-of-service-30-title"
  >
    <SectionHeading id="terms-of-service-30-title">
      30. Force Majeure
    </SectionHeading>

    <p>
      Neither party will be responsible for delay
      or failure to perform obligations to the extent
      caused by circumstances reasonably beyond its
      control, including natural disasters,
      telecommunications failures, widespread
      infrastructure outages, governmental actions,
      civil disturbances, war, epidemics,
      cybersecurity incidents of extraordinary
      nature or other comparable events.
    </p>
  </section>

  {/* ======================================================================
      31. NOTICES
      ==================================================================== */}

  <section
    id="terms-of-service-31"
    className="legal-document__section"
    aria-labelledby="terms-of-service-31-title"
  >
    <SectionHeading id="terms-of-service-31-title">
      31. Notices and Electronic Communications
    </SectionHeading>

    <p>
      Users consent, to the extent permitted by
      applicable law, to receive electronic
      communications relating to account activity,
      security, transactions, legal notices,
      service changes and other operational matters.
    </p>

    <p>
      Notices may be delivered through the platform,
      email, SMS, application notifications,
      registered contact details or other reasonable
      communication methods.
    </p>
  </section>

  {/* ======================================================================
      32. ELECTRONIC SIGNATURES
      ==================================================================== */}

  <section
    id="terms-of-service-32"
    className="legal-document__section"
    aria-labelledby="terms-of-service-32-title"
  >
    <SectionHeading id="terms-of-service-32-title">
      32. Electronic Acceptance and Signatures
    </SectionHeading>

    <p>
      Where permitted by applicable law, electronic
      acceptance of these Terms, including selecting
      an acceptance control, confirming electronically
      or otherwise indicating agreement through an
      authorized workflow, may constitute evidence of
      acceptance.
    </p>

    <p>
      TITech may maintain records of acceptance,
      including the applicable Terms version,
      timestamp, account identifier and related
      technical information, subject to the Privacy
      Policy and applicable law.
    </p>
  </section>

  {/* ======================================================================
      33. MODIFICATIONS
      ==================================================================== */}

  <section
    id="terms-of-service-33"
    className="legal-document__section"
    aria-labelledby="terms-of-service-33-title"
  >
    <SectionHeading id="terms-of-service-33-title">
      33. Changes to These Terms
    </SectionHeading>

    <p>
      TITech may update these Terms from time to
      time to reflect changes in the Services,
      technology, business operations, security
      requirements or applicable law.
    </p>

    <p>
      The published version number and last-updated
      date identify the current version.
    </p>

    <p>
      Where legally required or contractually
      appropriate, TITech may provide notice of
      material changes before they become effective.
    </p>

    <p>
      Continued use of the applicable Services after
      the effective date of updated Terms may
      constitute acceptance where permitted by
      applicable law.
    </p>
  </section>

  {/* ======================================================================
      34. GOVERNING LAW
      ==================================================================== */}

  <section
    id="terms-of-service-34"
    className="legal-document__section"
    aria-labelledby="terms-of-service-34-title"
  >
    <SectionHeading id="terms-of-service-34-title">
      34. Governing Law
    </SectionHeading>

    <p>
      These Terms are intended to be governed by the
      laws of {jurisdiction}, except to the extent
      that mandatory provisions of applicable law
      require otherwise.
    </p>

    <p>
      Where an enterprise or customer agreement
      specifies different governing-law provisions,
      that agreement will govern to the extent
      applicable.
    </p>
  </section>

  {/* ======================================================================
      35. DISPUTE RESOLUTION
      ==================================================================== */}

  <section
    id="terms-of-service-35"
    className="legal-document__section"
    aria-labelledby="terms-of-service-35-title"
  >
    <SectionHeading id="terms-of-service-35-title">
      35. Dispute Resolution
    </SectionHeading>

    <p>
      TITech encourages Users and Tenants to first
      contact the appropriate support or legal
      representative to attempt to resolve disputes
      in good faith.
    </p>

    <p>
      Where a dispute cannot be resolved
      informally, the applicable contractual
      agreement and mandatory law will determine the
      appropriate dispute-resolution mechanism,
      forum and procedure.
    </p>
  </section>

  {/* ======================================================================
      36. SEVERABILITY
      ==================================================================== */}

  <section
    id="terms-of-service-36"
    className="legal-document__section"
    aria-labelledby="terms-of-service-36-title"
  >
    <SectionHeading id="terms-of-service-36-title">
      36. Severability
    </SectionHeading>

    <p>
      If any provision of these Terms is determined
      to be unlawful, invalid or unenforceable, that
      provision will be interpreted or limited to the
      minimum extent necessary where legally
      permitted, and the remaining provisions will
      continue in effect.
    </p>
  </section>

  {/* ======================================================================
      37. WAIVER
      ==================================================================== */}

  <section
    id="terms-of-service-37"
    className="legal-document__section"
    aria-labelledby="terms-of-service-37-title"
  >
    <SectionHeading id="terms-of-service-37-title">
      37. No Waiver
    </SectionHeading>

    <p>
      Failure by TITech to enforce a provision of
      these Terms does not constitute a waiver of
      the right to enforce that provision later,
      unless expressly stated in writing.
    </p>
  </section>

  {/* ======================================================================
      38. ASSIGNMENT
      ==================================================================== */}

  <section
    id="terms-of-service-38"
    className="legal-document__section"
    aria-labelledby="terms-of-service-38-title"
  >
    <SectionHeading id="terms-of-service-38-title">
      38. Assignment
    </SectionHeading>

    <p>
      Users may not assign or transfer their rights
      or obligations under these Terms without
      appropriate authorization where required.
    </p>

    <p>
      TITech may assign or transfer these Terms in
      connection with a merger, acquisition,
      restructuring, financing, sale of assets or
      other corporate transaction, subject to
      applicable law.
    </p>
  </section>

  {/* ======================================================================
      39. ENTIRE AGREEMENT
      ==================================================================== */}

  <section
    id="terms-of-service-39"
    className="legal-document__section"
    aria-labelledby="terms-of-service-39-title"
  >
    <SectionHeading id="terms-of-service-39-title">
      39. Entire Agreement and Order of Precedence
    </SectionHeading>

    <p>
      These Terms, together with applicable privacy
      notices, service-specific terms, order forms,
      enterprise agreements and other documents
      expressly incorporated by reference, form the
      applicable agreement governing use of the
      Services.
    </p>

    <p>
      If there is a conflict between these Terms and
      a separately executed enterprise or service
      agreement, the separately executed agreement
      will generally govern to the extent expressly
      stated in that agreement.
    </p>
  </section>

  {/* ======================================================================
      40. NO PARTNERSHIP
      ==================================================================== */}

  <section
    id="terms-of-service-40"
    className="legal-document__section"
    aria-labelledby="terms-of-service-40-title"
  >
    <SectionHeading id="terms-of-service-40-title">
      40. Independent Relationship
    </SectionHeading>

    <p>
      Use of TITech does not create a partnership,
      joint venture, employment relationship, agency
      relationship or fiduciary relationship between
      TITech and a User unless expressly established
      by a separate written agreement.
    </p>
  </section>

  {/* ======================================================================
      41. NO FINANCIAL ADVICE
      ==================================================================== */}

  <section
    id="terms-of-service-41"
    className="legal-document__section"
    aria-labelledby="terms-of-service-41-title"
  >
    <SectionHeading id="terms-of-service-41-title">
      41. No Professional Advice
    </SectionHeading>

    <p>
      Information or functionality made available
      through TITech should not automatically be
      interpreted as legal, tax, accounting,
      investment, lending or other professional
      advice.
    </p>

    <p>
      Users and organizations should obtain
      independent professional advice when
      appropriate to their circumstances.
    </p>
  </section>

  {/* ======================================================================
      42. CONTACT
      ==================================================================== */}

  <section
    id="terms-of-service-42"
    className="legal-document__section"
    aria-labelledby="terms-of-service-42-title"
  >
    <SectionHeading id="terms-of-service-42-title">
      42. Contact Information
    </SectionHeading>

    <p>
      Questions concerning these Terms may be
      directed to TITech using the contact details
      below.
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
        Privacy:{' '}
        <a
          href={`mailto:${privacyEmail}`}
          aria-label={`Email ${organization} privacy team`}
        >
          {privacyEmail}
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
        Terms of Service
      </strong>
    </p>

    <p>
      Version {version} · Effective{' '}
      {effectiveDate} · Last updated{' '}
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

TermsOfService.propTypes = {
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

  effectiveDate:
    PropTypes.string,

  legalEmail:
    PropTypes.string,

  supportEmail:
    PropTypes.string,

  privacyEmail:
    PropTypes.string,

  phone:
    PropTypes.string,

  phoneHref:
    PropTypes.string,

  address:
    PropTypes.string,
}),


};