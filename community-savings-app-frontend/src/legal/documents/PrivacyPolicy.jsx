/**

* ============================================================================
* TITech Community Capital Ltd
* Enterprise Privacy Policy Document
* ============================================================================
*
* File:
* frontend/src/legal/documents/PrivacyPolicy.jsx
*
* Version:
* 2.0.0
*
* Purpose:
* Canonical Privacy Policy content component for the TITech Community
* Capital enterprise legal-document system.
*
* Architecture:
* * Content-focused legal document.
* * Intended to be rendered by the centralized legal-page renderer.
* * Routing belongs in legalRoutes.js.
* * Document metadata belongs in legalConfig.js.
* * Shared legal constants belong in legalConstants.js.
* * Runtime document validation belongs in legalTypes.js.
* * Acceptance/audit behavior belongs in legalAcceptance.js.
*
* Brand:
* TITech Community Capital
*
* Important:
* ACFOS terminology must not be introduced into this file.
* TITech Community Capital is the canonical brand/platform identity.
*
* Legal review:
* This implementation provides production-oriented privacy-policy
* structure and frontend presentation. Final legal wording, data-controller
* status, lawful bases, retention periods, cross-border transfer mechanisms,
* regulatory references and contact details should be reviewed and approved
* by qualified privacy/legal counsel before publication.
*
* ============================================================================
  */

'use strict';

import React from 'react';
import PropTypes from 'prop-types';

/* ============================================================================

* FALLBACK METADATA
*
* The centralized legal registry should be authoritative. These values exist
* as safe defaults so this component remains independently renderable.
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

privacyEmail:
'[privacy@titechcommunity.app](mailto:privacy@titechcommunity.app)',

dpoEmail:
'[dpo@titechcommunity.app](mailto:dpo@titechcommunity.app)',

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

* DOCUMENT COMPONENTS
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

* MAIN PRIVACY POLICY
* ========================================================================== */

export default function PrivacyPolicy({
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
legalEmail,
privacyEmail,
dpoEmail,
supportEmail,
phone,
phoneHref,
address,
} = documentMetadata;

return (
<article
className={[
'legal-document',
'legal-document--privacy-policy',
compact
? 'legal-document--compact'
: '',
]
.filter(Boolean)
.join(' ')}
aria-labelledby="privacy-policy-title"
>
{/* ======================================================================
HEADER
==================================================================== */}

```
  <header className="legal-document__header">
    <p className="legal-document__eyebrow">
      {platform}
    </p>

    <h1
      id="privacy-policy-title"
      className="legal-document__title"
    >
      Privacy Policy
    </h1>

    <p className="legal-document__summary">
      This Privacy Policy explains how {organization}{' '}
      collects, uses, protects, discloses and
      retains personal information in connection
      with {platform}.
    </p>

    <dl
      className="legal-document__metadata"
      aria-label="Privacy Policy metadata"
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
          Primary jurisdiction
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
      aria-label="Important privacy notice"
    >
      <strong>
        Important privacy notice:
      </strong>{' '}
      The information collected and processed by
      TITech may vary according to the services
      used, the user's role, tenant configuration,
      applicable law and the user's interactions
      with the platform.
    </aside>
  )}

  {/* ======================================================================
      1. INTRODUCTION
      ==================================================================== */}

  <section
    id="privacy-policy-1"
    className="legal-document__section"
    aria-labelledby="privacy-policy-1-title"
  >
    <SectionHeading id="privacy-policy-1-title">
      1. Introduction
    </SectionHeading>

    <p>
      {organization} ("TITech", "we", "us" or
      "our") respects the privacy of individuals
      whose personal information is processed in
      connection with {platform}.
    </p>

    <p>
      This Privacy Policy describes the categories
      of personal information we may collect, the
      purposes for which we may process it, how it
      may be disclosed, how we seek to protect it,
      and the rights and choices that may be
      available to individuals.
    </p>

    <p>
      This Privacy Policy applies to personal
      information processed through applicable
      TITech websites, applications, software
      platforms, communications, integrations and
      related services, unless a separate privacy
      notice expressly applies.
    </p>

    <p>
      By using TITech services, users acknowledge
      that personal information may be processed as
      described in this Privacy Policy, subject to
      applicable law and any additional notices
      provided at the point of collection.
    </p>
  </section>

  {/* ======================================================================
      2. SCOPE
      ==================================================================== */}

  <section
    id="privacy-policy-2"
    className="legal-document__section"
    aria-labelledby="privacy-policy-2-title"
  >
    <SectionHeading id="privacy-policy-2-title">
      2. Scope and Application
    </SectionHeading>

    <p>
      This Privacy Policy may apply to personal
      information relating to:
    </p>

    <ul>
      <li>
        registered users;
      </li>

      <li>
        members of organizations using TITech;
      </li>

      <li>
        tenant administrators;
      </li>

      <li>
        authorized representatives;
      </li>

      <li>
        prospective customers;
      </li>

      <li>
        website visitors;
      </li>

      <li>
        support users;
      </li>

      <li>
        individuals who communicate with TITech;
      </li>

      <li>
        authorized representatives of business or
        community organizations; and
      </li>

      <li>
        other individuals whose information is
        lawfully provided to or collected by TITech.
      </li>
    </ul>

    <p>
      Where TITech processes personal information
      on behalf of a customer organization, the
      customer organization's own privacy notices
      and instructions may also apply.
    </p>
  </section>

  {/* ======================================================================
      3. INFORMATION WE COLLECT
      ==================================================================== */}

  <section
    id="privacy-policy-3"
    className="legal-document__section"
    aria-labelledby="privacy-policy-3-title"
  >
    <SectionHeading id="privacy-policy-3-title">
      3. Information We Collect
    </SectionHeading>

    <p>
      Depending on the services used and the
      applicable legal requirements, TITech may
      collect or receive the following categories
      of information.
    </p>

    <h3 className="legal-document__subsection-title">
      3.1 Identity and Registration Information
    </h3>

    <ul>
      <li>
        full name;
      </li>

      <li>
        username;
      </li>

      <li>
        account identifiers;
      </li>

      <li>
        date of birth where required and lawfully
        collected;
      </li>

      <li>
        identification or verification information;
      </li>

      <li>
        organization or membership information;
      </li>

      <li>
        profile information; and
      </li>

      <li>
        other information necessary for account
        administration.
      </li>
    </ul>

    <h3 className="legal-document__subsection-title">
      3.2 Contact Information
    </h3>

    <ul>
      <li>
        email address;
      </li>

      <li>
        telephone number;
      </li>

      <li>
        postal or physical address where required;
      </li>

      <li>
        emergency or alternative contact details
        where appropriately provided; and
      </li>

      <li>
        communication preferences.
      </li>
    </ul>

    <h3 className="legal-document__subsection-title">
      3.3 Financial and Transaction Information
    </h3>

    <p>
      Depending on the applicable service, TITech
      may process information associated with
      savings, contributions, transactions,
      balances, payment instructions, fees,
      repayments, financial records and related
      activity.
    </p>

    <p>
      Financial information may be provided by the
      user, an authorized organization or an
      integrated third-party provider.
    </p>

    <h3 className="legal-document__subsection-title">
      3.4 Device and Technical Information
    </h3>

    <ul>
      <li>
        IP address;
      </li>

      <li>
        browser type and version;
      </li>

      <li>
        operating system;
      </li>

      <li>
        device identifiers;
      </li>

      <li>
        application information;
      </li>

      <li>
        language and regional settings;
      </li>

      <li>
        timestamps;
      </li>

      <li>
        diagnostic information; and
      </li>

      <li>
        security and authentication events.
      </li>
    </ul>

    <h3 className="legal-document__subsection-title">
      3.5 Usage Information
    </h3>

    <p>
      We may collect information about how users
      interact with our websites, applications and
      services, including pages or features
      accessed, actions performed, errors
      encountered and service-performance events.
    </p>

    <h3 className="legal-document__subsection-title">
      3.6 Communications
    </h3>

    <p>
      We may retain information contained in
      communications submitted to TITech, including
      support requests, feedback, inquiries,
      complaints and other correspondence.
    </p>

    <h3 className="legal-document__subsection-title">
      3.7 Verification and Compliance Information
    </h3>

    <p>
      Where required for a particular service,
      transaction, customer relationship or legal
      obligation, TITech may process information
      necessary for identity verification,
      compliance screening, fraud prevention,
      security and regulatory obligations.
    </p>
  </section>

  {/* ======================================================================
      4. SOURCES
      ==================================================================== */}

  <section
    id="privacy-policy-4"
    className="legal-document__section"
    aria-labelledby="privacy-policy-4-title"
  >
    <SectionHeading id="privacy-policy-4-title">
      4. How We Obtain Personal Information
    </SectionHeading>

    <p>
      Personal information may be obtained from:
    </p>

    <ul>
      <li>
        users directly;
      </li>

      <li>
        organizations and tenant administrators;
      </li>

      <li>
        authorized representatives;
      </li>

      <li>
        TITech applications and websites;
      </li>

      <li>
        payment or mobile-money providers;
      </li>

      <li>
        identity or verification providers;
      </li>

      <li>
        service providers and technology partners;
      </li>

      <li>
        public or legally accessible sources where
        permitted;
      </li>

      <li>
        cookies and similar technologies; and
      </li>

      <li>
        other lawful sources.
      </li>
    </ul>
  </section>

  {/* ======================================================================
      5. PURPOSES
      ==================================================================== */}

  <section
    id="privacy-policy-5"
    className="legal-document__section"
    aria-labelledby="privacy-policy-5-title"
  >
    <SectionHeading id="privacy-policy-5-title">
      5. How We Use Personal Information
    </SectionHeading>

    <p>
      Subject to applicable law, TITech may process
      personal information for purposes including:
    </p>

    <ul>
      <li>
        creating and managing user accounts;
      </li>

      <li>
        providing and operating TITech services;
      </li>

      <li>
        processing and recording transactions;
      </li>

      <li>
        supporting savings and community-finance
        workflows;
      </li>

      <li>
        verifying identity and account information;
      </li>

      <li>
        preventing fraud, abuse and unauthorized
        activity;
      </li>

      <li>
        maintaining platform security;
      </li>

      <li>
        providing customer and technical support;
      </li>

      <li>
        communicating service-related information;
      </li>

      <li>
        processing payments and related instructions;
      </li>

      <li>
        improving services and user experience;
      </li>

      <li>
        monitoring system performance;
      </li>

      <li>
        detecting and resolving technical issues;
      </li>

      <li>
        complying with legal and regulatory
        obligations;
      </li>

      <li>
        establishing, exercising or defending legal
        claims;
      </li>

      <li>
        enforcing applicable agreements and policies;
      </li>

      <li>
        conducting legitimate business operations;
      </li>

      <li>
        maintaining records and audit trails; and
      </li>

      <li>
        other purposes disclosed at the time of
        collection or otherwise permitted by law.
      </li>
    </ul>
  </section>

  {/* ======================================================================
      6. LEGAL BASES
      ==================================================================== */}

  <section
    id="privacy-policy-6"
    className="legal-document__section"
    aria-labelledby="privacy-policy-6-title"
  >
    <SectionHeading id="privacy-policy-6-title">
      6. Legal Bases for Processing
    </SectionHeading>

    <p>
      Where applicable law requires a specific
      lawful basis for processing, TITech may rely
      on one or more legally recognized bases,
      including:
    </p>

    <ul>
      <li>
        performance of a contract or steps taken
        at the user's request before entering into
        a contract;
      </li>

      <li>
        compliance with a legal or regulatory
        obligation;
      </li>

      <li>
        protection of vital interests where
        applicable;
      </li>

      <li>
        legitimate interests, where permitted and
        balanced against applicable rights and
        interests; and
      </li>

      <li>
        consent, where consent is required.
      </li>
    </ul>

    <p>
      The applicable legal basis may vary depending
      on the nature and purpose of the processing.
    </p>
  </section>

  {/* ======================================================================
      7. CONSENT
      ==================================================================== */}

  <section
    id="privacy-policy-7"
    className="legal-document__section"
    aria-labelledby="privacy-policy-7-title"
  >
    <SectionHeading id="privacy-policy-7-title">
      7. Consent
    </SectionHeading>

    <p>
      Where TITech relies on consent as the legal
      basis for processing, consent will be
      obtained through an appropriate mechanism
      where required.
    </p>

    <p>
      Subject to applicable law, individuals may
      withdraw consent where processing is based on
      consent. Withdrawal does not necessarily
      affect the lawfulness of processing carried
      out before withdrawal.
    </p>

    <p>
      Certain services may continue to process
      information under another lawful basis where
      permitted by applicable law.
    </p>
  </section>

  {/* ======================================================================
      8. DISCLOSURE
      ==================================================================== */}

  <section
    id="privacy-policy-8"
    className="legal-document__section"
    aria-labelledby="privacy-policy-8-title"
  >
    <SectionHeading id="privacy-policy-8-title">
      8. How We Share Personal Information
    </SectionHeading>

    <p>
      TITech may disclose personal information
      where necessary, appropriate and lawful to:
    </p>

    <ul>
      <li>
        the user's authorized organization or
        tenant;
      </li>

      <li>
        authorized administrators;
      </li>

      <li>
        payment processors;
      </li>

      <li>
        mobile-money providers;
      </li>

      <li>
        banks or financial institutions where
        applicable;
      </li>

      <li>
        identity and verification providers;
      </li>

      <li>
        cloud, hosting and infrastructure providers;
      </li>

      <li>
        security and fraud-prevention providers;
      </li>

      <li>
        professional advisers;
      </li>

      <li>
        auditors;
      </li>

      <li>
        regulators, courts, law-enforcement bodies
        or government authorities where legally
        required or permitted;
      </li>

      <li>
        transaction counterparties where required
        to provide the applicable service; and
      </li>

      <li>
        other parties where authorized by the user
        or permitted by applicable law.
      </li>
    </ul>

    <p>
      TITech does not sell personal information
      merely because it is processed in connection
      with providing the platform.
    </p>
  </section>

  {/* ======================================================================
      9. TENANT MODEL
      ==================================================================== */}

  <section
    id="privacy-policy-9"
    className="legal-document__section"
    aria-labelledby="privacy-policy-9-title"
  >
    <SectionHeading id="privacy-policy-9-title">
      9. Organization and Multi-Tenant Data
      Processing
    </SectionHeading>

    <p>
      TITech may provide services to organizations
      operating as separate tenants within the
      platform.
    </p>

    <p>
      Depending on the service and applicable
      agreement, an organization may determine
      certain purposes and means for which member or
      organizational information is processed.
    </p>

    <p>
      Tenant administrators may therefore have
      authorized access to information associated
      with their organization in accordance with
      their roles, permissions, contractual
      arrangements and applicable law.
    </p>

    <p>
      Users should contact their relevant
      organization where their request concerns
      organizational records or processing
      controlled by that organization.
    </p>
  </section>

  {/* ======================================================================
      10. COOKIES
      ==================================================================== */}

  <section
    id="privacy-policy-10"
    className="legal-document__section"
    aria-labelledby="privacy-policy-10-title"
  >
    <SectionHeading id="privacy-policy-10-title">
      10. Cookies and Similar Technologies
    </SectionHeading>

    <p>
      TITech may use cookies, local storage,
      session technologies, pixels, SDKs and
      similar technologies to support platform
      functionality and security.
    </p>

    <p>
      These technologies may be used for purposes
      including:
    </p>

    <ul>
      <li>
        authentication and session management;
      </li>

      <li>
        security;
      </li>

      <li>
        remembering preferences;
      </li>

      <li>
        performance monitoring;
      </li>

      <li>
        analytics;
      </li>

      <li>
        diagnosing technical problems; and
      </li>

      <li>
        other purposes permitted by applicable law.
      </li>
    </ul>

    <p>
      Browser and device settings may provide
      controls over certain cookies or similar
      technologies. Disabling necessary
      technologies may affect platform
      functionality.
    </p>
  </section>

  {/* ======================================================================
      11. ANALYTICS
      ==================================================================== */}

  <section
    id="privacy-policy-11"
    className="legal-document__section"
    aria-labelledby="privacy-policy-11-title"
  >
    <SectionHeading id="privacy-policy-11-title">
      11. Analytics and Service Improvement
    </SectionHeading>

    <p>
      Where lawfully permitted, TITech may analyze
      technical and usage information to understand
      service performance, identify problems,
      improve functionality, monitor reliability and
      enhance user experience.
    </p>

    <p>
      Where practical and appropriate, analytical
      information may be aggregated, anonymized or
      otherwise de-identified before being used for
      broader operational analysis.
    </p>
  </section>

  {/* ======================================================================
      12. SECURITY
      ==================================================================== */}

  <section
    id="privacy-policy-12"
    className="legal-document__section"
    aria-labelledby="privacy-policy-12-title"
  >
    <SectionHeading id="privacy-policy-12-title">
      12. Data Security
    </SectionHeading>

    <p>
      TITech maintains technical and organizational
      safeguards designed to protect personal
      information against unauthorized access,
      alteration, disclosure, loss, misuse or
      destruction.
    </p>

    <p>
      Depending on the nature of the information and
      service, safeguards may include:
    </p>

    <ul>
      <li>
        authentication and access controls;
      </li>

      <li>
        role-based permissions;
      </li>

      <li>
        encryption or other protective controls;
      </li>

      <li>
        logging and monitoring;
      </li>

      <li>
        security testing;
      </li>

      <li>
        backup and recovery mechanisms;
      </li>

      <li>
        incident-management procedures;
      </li>

      <li>
        personnel controls; and
      </li>

      <li>
        vendor and infrastructure security
        controls.
      </li>
    </ul>

    <p>
      No internet-connected system can guarantee
      absolute security. Users are also responsible
      for protecting passwords, devices,
      authentication factors and other credentials.
    </p>
  </section>

  {/* ======================================================================
      13. RETENTION
      ==================================================================== */}

  <section
    id="privacy-policy-13"
    className="legal-document__section"
    aria-labelledby="privacy-policy-13-title"
  >
    <SectionHeading id="privacy-policy-13-title">
      13. Data Retention
    </SectionHeading>

    <p>
      TITech retains personal information only for
      as long as reasonably necessary for the
      purposes for which it was collected or as
      required or permitted by applicable law.
    </p>

    <p>
      Retention periods may depend on factors
      including:
    </p>

    <ul>
      <li>
        the nature and sensitivity of the
        information;
      </li>

      <li>
        the purpose of processing;
      </li>

      <li>
        contractual requirements;
      </li>

      <li>
        accounting and financial-record
        requirements;
      </li>

      <li>
        regulatory obligations;
      </li>

      <li>
        dispute resolution;
      </li>

      <li>
        fraud prevention and security requirements;
      </li>

      <li>
        legal claims; and
      </li>

      <li>
        applicable limitation periods.
      </li>
    </ul>

    <p>
      Information may remain in secure backups or
      archival systems for an additional period
      before being securely deleted or rendered
      inaccessible, subject to applicable retention
      requirements.
    </p>
  </section>

  {/* ======================================================================
      14. INTERNATIONAL TRANSFERS
      ==================================================================== */}

  <section
    id="privacy-policy-14"
    className="legal-document__section"
    aria-labelledby="privacy-policy-14-title"
  >
    <SectionHeading id="privacy-policy-14-title">
      14. International Data Transfers
    </SectionHeading>

    <p>
      Depending on the location of users, TITech,
      its service providers and infrastructure,
      personal information may be processed or
      stored in jurisdictions outside the country
      in which it was originally collected.
    </p>

    <p>
      Where applicable law imposes requirements on
      cross-border transfers, TITech will seek to
      implement appropriate safeguards or rely on
      another lawful transfer mechanism.
    </p>

    <p>
      Specific transfer arrangements may vary
      according to the applicable service,
      jurisdiction and service-provider
      infrastructure.
    </p>
  </section>

  {/* ======================================================================
      15. USER RIGHTS
      ==================================================================== */}

  <section
    id="privacy-policy-15"
    className="legal-document__section"
    aria-labelledby="privacy-policy-15-title"
  >
    <SectionHeading id="privacy-policy-15-title">
      15. Privacy Rights
    </SectionHeading>

    <p>
      Subject to applicable law, individuals may
      have rights concerning their personal
      information, which may include:
    </p>

    <ul>
      <li>
        requesting access to personal information;
      </li>

      <li>
        requesting correction of inaccurate
        information;
      </li>

      <li>
        requesting deletion where legally available;
      </li>

      <li>
        requesting restriction of certain
        processing;
      </li>

      <li>
        objecting to certain processing;
      </li>

      <li>
        requesting data portability where legally
        applicable;
      </li>

      <li>
        withdrawing consent where processing is
        based on consent; and
      </li>

      <li>
        lodging a complaint with an appropriate
        supervisory or regulatory authority.
      </li>
    </ul>

    <p>
      These rights are not absolute and may be
      subject to legal exceptions, contractual
      requirements, security considerations and
      other lawful limitations.
    </p>
  </section>

  {/* ======================================================================
      16. HOW TO EXERCISE RIGHTS
      ==================================================================== */}

  <section
    id="privacy-policy-16"
    className="legal-document__section"
    aria-labelledby="privacy-policy-16-title"
  >
    <SectionHeading id="privacy-policy-16-title">
      16. Privacy Requests
    </SectionHeading>

    <p>
      Privacy-related requests may be submitted
      using the privacy contact information provided
      at the end of this Privacy Policy.
    </p>

    <p>
      To protect individuals and personal
      information, TITech may take reasonable steps
      to verify the identity and authority of a
      person submitting a request.
    </p>

    <p>
      Where information is controlled by a customer
      organization or another data controller, TITech
      may refer the request to that organization or
      assist with the request as required by the
      applicable contractual arrangement and law.
    </p>
  </section>

  {/* ======================================================================
      17. MARKETING
      ==================================================================== */}

  <section
    id="privacy-policy-17"
    className="legal-document__section"
    aria-labelledby="privacy-policy-17-title"
  >
    <SectionHeading id="privacy-policy-17-title">
      17. Marketing Communications
    </SectionHeading>

    <p>
      Where permitted by applicable law, TITech may
      send service-related communications necessary
      to operate accounts and provide requested
      services.
    </p>

    <p>
      Where marketing communications require
      consent or another specific legal basis,
      TITech will provide appropriate choices and
      controls.
    </p>

    <p>
      Users may be able to unsubscribe from
      promotional communications using the
      applicable unsubscribe mechanism, while
      essential service communications may continue.
    </p>
  </section>

  {/* ======================================================================
      18. CHILDREN
      ==================================================================== */}

  <section
    id="privacy-policy-18"
    className="legal-document__section"
    aria-labelledby="privacy-policy-18-title"
  >
    <SectionHeading id="privacy-policy-18-title">
      18. Children's Privacy
    </SectionHeading>

    <p>
      TITech services may be subject to minimum-age
      requirements and other restrictions imposed
      by applicable law or product rules.
    </p>

    <p>
      TITech does not knowingly seek to collect
      personal information from children in
      circumstances where such collection is
      prohibited by applicable law.
    </p>

    <p>
      Where a service is intentionally designed to
      involve minors, additional notices,
      safeguards, consent requirements and
      organizational controls may apply.
    </p>
  </section>

  {/* ======================================================================
      19. AUTOMATED PROCESSING
      ==================================================================== */}

  <section
    id="privacy-policy-19"
    className="legal-document__section"
    aria-labelledby="privacy-policy-19-title"
  >
    <SectionHeading id="privacy-policy-19-title">
      19. Automated Processing and Decision-Making
    </SectionHeading>

    <p>
      TITech may use automated systems to support
      security, fraud detection, transaction
      processing, service operations, analytics or
      other legitimate business functions.
    </p>

    <p>
      Where applicable law grants individuals
      specific rights regarding solely automated
      decisions producing legal or similarly
      significant effects, TITech will address such
      rights in accordance with the requirements
      applicable to the relevant processing.
    </p>
  </section>

  {/* ======================================================================
      20. DATA BREACH / INCIDENTS
      ==================================================================== */}

  <section
    id="privacy-policy-20"
    className="legal-document__section"
    aria-labelledby="privacy-policy-20-title"
  >
    <SectionHeading id="privacy-policy-20-title">
      20. Data Security Incidents
    </SectionHeading>

    <p>
      TITech maintains procedures intended to
      identify, investigate, contain and respond to
      suspected personal-data and security
      incidents.
    </p>

    <p>
      Where applicable law requires notification of
      a personal-data breach or other security
      incident, TITech will make notifications to
      the appropriate parties and authorities within
      the applicable legal requirements.
    </p>
  </section>

  {/* ======================================================================
      21. THIRD-PARTY LINKS
      ==================================================================== */}

  <section
    id="privacy-policy-21"
    className="legal-document__section"
    aria-labelledby="privacy-policy-21-title"
  >
    <SectionHeading id="privacy-policy-21-title">
      21. Third-Party Websites and Services
    </SectionHeading>

    <p>
      TITech services may contain links to or
      integrations with third-party websites,
      applications or services.
    </p>

    <p>
      Third-party services may operate under their
      own privacy notices and practices. Users
      should review those notices before providing
      personal information to third parties.
    </p>

    <p>
      TITech is not responsible for privacy
      practices of third parties except to the
      extent required by applicable law or expressly
      agreed in writing.
    </p>
  </section>

  {/* ======================================================================
      22. BUSINESS TRANSFERS
      ==================================================================== */}

  <section
    id="privacy-policy-22"
    className="legal-document__section"
    aria-labelledby="privacy-policy-22-title"
  >
    <SectionHeading id="privacy-policy-22-title">
      22. Corporate Transactions
    </SectionHeading>

    <p>
      Personal information may be transferred or
      disclosed as part of a merger, acquisition,
      restructuring, financing, sale of assets,
      investment, business transfer or similar
      corporate transaction, subject to applicable
      law and appropriate safeguards.
    </p>

    <p>
      Where required, affected individuals may
      receive appropriate notice of material changes
      to the handling of their personal information.
    </p>
  </section>

  {/* ======================================================================
      23. DATA ACCURACY
      ==================================================================== */}

  <section
    id="privacy-policy-23"
    className="legal-document__section"
    aria-labelledby="privacy-policy-23-title"
  >
    <SectionHeading id="privacy-policy-23-title">
      23. Accuracy of Personal Information
    </SectionHeading>

    <p>
      TITech seeks to maintain personal information
      that is reasonably accurate and appropriate
      for the purposes for which it is processed.
    </p>

    <p>
      Users should provide accurate information and
      promptly update information that has changed.
    </p>

    <p>
      Requests to correct personal information may
      be submitted through the applicable privacy or
      account-support process.
    </p>
  </section>

  {/* ======================================================================
      24. DATA MINIMIZATION
      ==================================================================== */}

  <section
    id="privacy-policy-24"
    className="legal-document__section"
    aria-labelledby="privacy-policy-24-title"
  >
    <SectionHeading id="privacy-policy-24-title">
      24. Data Minimization
    </SectionHeading>

    <p>
      TITech seeks to collect and process personal
      information that is relevant and reasonably
      necessary for identified business, contractual,
      operational, security or legal purposes.
    </p>

    <p>
      The categories of information collected may
      therefore differ according to the service,
      user role, tenant configuration and applicable
      requirements.
    </p>
  </section>

  {/* ======================================================================
      25. RECORDS AND AUDIT
      ==================================================================== */}

  <section
    id="privacy-policy-25"
    className="legal-document__section"
    aria-labelledby="privacy-policy-25-title"
  >
    <SectionHeading id="privacy-policy-25-title">
      25. Records, Audit and Accountability
    </SectionHeading>

    <p>
      TITech may maintain records of account
      activity, administrative actions, transactions,
      security events, system events and other
      activities where necessary for service
      delivery, security, dispute resolution,
      auditing, compliance or other lawful purposes.
    </p>

    <p>
      Such records may be retained for periods
      determined by applicable legal, contractual,
      operational and security requirements.
    </p>
  </section>

  {/* ======================================================================
      26. GOVERNANCE
      ==================================================================== */}

  <section
    id="privacy-policy-26"
    className="legal-document__section"
    aria-labelledby="privacy-policy-26-title"
  >
    <SectionHeading id="privacy-policy-26-title">
      26. Organizational Privacy Responsibilities
    </SectionHeading>

    <p>
      Organizations using TITech may have
      independent privacy and data-protection
      responsibilities concerning information they
      collect, determine, upload or otherwise
      process through the platform.
    </p>

    <p>
      Organizations are responsible for providing
      appropriate privacy notices, obtaining
      required permissions or consents, configuring
      access controls and complying with applicable
      data-protection obligations within their
      respective areas of responsibility.
    </p>
  </section>

  {/* ======================================================================
      27. GOVERNMENT / LAW ENFORCEMENT
      ==================================================================== */}

  <section
    id="privacy-policy-27"
    className="legal-document__section"
    aria-labelledby="privacy-policy-27-title"
  >
    <SectionHeading id="privacy-policy-27-title">
      27. Legal and Regulatory Disclosures
    </SectionHeading>

    <p>
      TITech may disclose personal information when
      reasonably necessary to comply with applicable
      law, court orders, regulatory requirements,
      lawful government requests or legal process.
    </p>

    <p>
      Where legally permitted, TITech may take
      reasonable steps to notify affected
      individuals or organizations before or after
      such disclosure, depending on the applicable
      circumstances.
    </p>
  </section>

  {/* ======================================================================
      28. PRIVACY BY DESIGN
      ==================================================================== */}

  <section
    id="privacy-policy-28"
    className="legal-document__section"
    aria-labelledby="privacy-policy-28-title"
  >
    <SectionHeading id="privacy-policy-28-title">
      28. Privacy and Security by Design
    </SectionHeading>

    <p>
      TITech seeks to incorporate privacy and
      security considerations into the design,
      development, deployment and operation of its
      services.
    </p>

    <p>
      Depending on the applicable processing,
      controls may include access restrictions,
      authentication, logging, encryption,
      retention controls, monitoring, data
      minimization and other safeguards.
    </p>
  </section>

  {/* ======================================================================
      29. POLICY CHANGES
      ==================================================================== */}

  <section
    id="privacy-policy-29"
    className="legal-document__section"
    aria-labelledby="privacy-policy-29-title"
  >
    <SectionHeading id="privacy-policy-29-title">
      29. Changes to This Privacy Policy
    </SectionHeading>

    <p>
      TITech may update this Privacy Policy from
      time to time to reflect changes in services,
      technology, business practices, legal
      requirements, regulatory expectations or
      privacy practices.
    </p>

    <p>
      The published version number and last-updated
      date identify the applicable version of this
      Privacy Policy.
    </p>

    <p>
      Where required or appropriate, material
      changes may be communicated through the
      platform, website, email or another suitable
      communication channel.
    </p>

    <p>
      Users should periodically review this Privacy
      Policy for updates.
    </p>
  </section>

  {/* ======================================================================
      30. COMPLAINTS
      ==================================================================== */}

  <section
    id="privacy-policy-30"
    className="legal-document__section"
    aria-labelledby="privacy-policy-30-title"
  >
    <SectionHeading id="privacy-policy-30-title">
      30. Privacy Complaints and Regulatory
      Oversight
    </SectionHeading>

    <p>
      Individuals who believe their personal
      information has been processed improperly may
      contact TITech using the privacy contact
      information below.
    </p>

    <p>
      Where permitted by applicable law,
      individuals may also have the right to lodge
      a complaint with the relevant data-protection
      or supervisory authority.
    </p>
  </section>

  {/* ======================================================================
      31. CONTACT
      ==================================================================== */}

  <section
    id="privacy-policy-31"
    className="legal-document__section"
    aria-labelledby="privacy-policy-31-title"
  >
    <SectionHeading id="privacy-policy-31-title">
      31. Privacy Contact Information
    </SectionHeading>

    <p>
      Questions, privacy requests and concerns
      regarding this Privacy Policy may be directed
      to:
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
        Privacy:{' '}
        <a
          href={`mailto:${privacyEmail}`}
          aria-label={`Email ${organization} privacy team`}
        >
          {privacyEmail}
        </a>
      </p>

      <p>
        Data Protection:{' '}
        <a
          href={`mailto:${dpoEmail}`}
          aria-label={`Email ${organization} data protection team`}
        >
          {dpoEmail}
        </a>
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
      FOOTER
      ==================================================================== */}

  <footer className="legal-document__footer">
    <p>
      <strong>
        Privacy Policy
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

PrivacyPolicy.propTypes = {
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

  privacyEmail:
    PropTypes.string,

  dpoEmail:
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