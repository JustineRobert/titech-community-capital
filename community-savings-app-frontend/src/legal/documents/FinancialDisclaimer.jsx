/**

* ============================================================================
* TITech Community Capital Ltd
* Enterprise Financial Disclaimer Document
* ============================================================================
*
* File:
* frontend/src/legal/documents/FinancialDisclaimer.jsx
*
* Version:
* 2.0.0
*
* Purpose:
* Canonical financial disclaimer content for the TITech Community Capital
* legal-document system.
*
* Architecture:
* * Content-only legal document.
* * Presentation/layout should be handled by the parent legal-page renderer.
* * Metadata, routing and document registration should be centralized in:
* ```
    ../legalConfig.js
  ```
* ```
    ../legalConstants.js
  ```
* ```
    ../legalRoutes.js
  ```
* ```
    ../legalTypes.js
  ```
*
* Important:
* This document is informational legal content and should receive final
* review and approval from qualified legal counsel before production use.
*
* Brand:
* TITech Community Capital
*
* IMPORTANT:
* Do not introduce ACFOS terminology into this file. TITech is the
* canonical product/platform name.
*
* ============================================================================
  */

'use strict';

import React from 'react';
import PropTypes from 'prop-types';

/* ============================================================================

* DOCUMENT CONTENT CONSTANTS
* ========================================================================== */

const ORGANIZATION_NAME =
'TITech Community Capital Ltd';

const PLATFORM_NAME =
'TITech Community Capital';

const JURISDICTION =
'Uganda';

const LAST_UPDATED =
'January 15, 2026';

const VERSION =
'2.0';

const LEGAL_EMAIL =
'[legal@titechcommunity.app](mailto:legal@titechcommunity.app)';

const SUPPORT_EMAIL =
'[support@titechcommunity.app](mailto:support@titechcommunity.app)';

const PHONE =
'+256 (782) 397907';

const PHONE_HREF =
'+256782397907';

const ADDRESS =
'Plot 69-71 Jinja Road, Kampala, Uganda';

/* ============================================================================

* HELPERS
* ========================================================================== */

/**

* Safely renders a document heading.
*
* The document intentionally accepts a headingLevel so that it can be
* embedded inside different legal-page layouts without creating invalid
* heading hierarchies.
  */
  function DocumentHeading({
  as: Heading = 'h2',
  id,
  children,
  }) {
  return (
  <Heading
  id={id}
  className="legal-document__section-title"

  >

  {children} </Heading>
  );
  }

DocumentHeading.propTypes = {
as:
PropTypes.oneOf([
'h2',
'h3',
'h4',
]),

id:
PropTypes.string.isRequired,

children:
PropTypes.node.isRequired,
};

/* ============================================================================

* MAIN DOCUMENT
* ========================================================================== */

export default function FinancialDisclaimer({
compact = false,
showDocumentNotice = true,
}) {
return (
<article
className={[
'legal-document',
'legal-document--financial-disclaimer',
compact
? 'legal-document--compact'
: '',
]
.filter(Boolean)
.join(' ')}
aria-labelledby="financial-disclaimer-title"
>
{/* ======================================================================
DOCUMENT HEADER
==================================================================== */}

```
  <header className="legal-document__header">
    <p className="legal-document__eyebrow">
      {PLATFORM_NAME}
    </p>

    <h1
      id="financial-disclaimer-title"
      className="legal-document__title"
    >
      Financial Disclaimer
    </h1>

    <p className="legal-document__summary">
      Important information about financial
      information, calculations, transactions,
      financial decisions and the use of TITech
      Community Capital.
    </p>

    <dl className="legal-document__metadata">
      <div>
        <dt>
          Version
        </dt>

        <dd>
          {VERSION}
        </dd>
      </div>

      <div>
        <dt>
          Last updated
        </dt>

        <dd>
          {LAST_UPDATED}
        </dd>
      </div>

      <div>
        <dt>
          Jurisdiction
        </dt>

        <dd>
          {JURISDICTION}
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
      aria-label="Important financial disclaimer notice"
    >
      <strong>
        Important notice:
      </strong>{' '}
      TITech Community Capital is a technology
      platform. Information and functionality
      provided through the platform should not,
      unless expressly stated in an applicable
      agreement, be interpreted as personalized
      financial, investment, legal, accounting
      or tax advice.
    </aside>
  )}

  {/* ======================================================================
      1. PURPOSE
      ==================================================================== */}

  <section
    id="financial-disclaimer-1"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-1-title"
  >
    <DocumentHeading
      id="financial-disclaimer-1-title"
    >
      1. Purpose of This Financial Disclaimer
    </DocumentHeading>

    <p>
      This Financial Disclaimer explains the
      limitations that apply to financial
      information, calculations, transaction
      records, reports and other financial
      functionality made available through
      {` ${PLATFORM_NAME}`}.
    </p>

    <p>
      It is intended to help users understand the
      distinction between technology-enabled
      financial management functionality and
      professional financial advice or regulated
      financial services.
    </p>

    <p>
      This Disclaimer should be read together with
      the applicable Terms of Service, Privacy
      Policy, service agreements, financial
      disclosures and other legal notices
      applicable to the relevant service.
    </p>
  </section>

  {/* ======================================================================
      2. TECHNOLOGY PLATFORM
      ==================================================================== */}

  <section
    id="financial-disclaimer-2"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-2-title"
  >
    <DocumentHeading
      id="financial-disclaimer-2-title"
    >
      2. TITech as a Technology Platform
    </DocumentHeading>

    <p>
      {PLATFORM_NAME} provides technology and
      software functionality intended to support
      community finance and financial-management
      activities.
    </p>

    <p>
      Depending on the applicable product,
      organization or configuration, the platform
      may support functionality such as:
    </p>

    <ul>
      <li>
        savings and contribution tracking;
      </li>

      <li>
        member and account management;
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
        community and organizational
        administration;
      </li>

      <li>
        financial calculations and summaries; and
      </li>

      <li>
        notifications and operational
        workflows.
      </li>
    </ul>

    <p>
      The availability and scope of these
      functions may differ according to the
      applicable service, subscription, tenant
      configuration, geographic market,
      regulatory requirements and technical
      environment.
    </p>
  </section>

  {/* ======================================================================
      3. NO FINANCIAL ADVICE
      ==================================================================== */}

  <section
    id="financial-disclaimer-3"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-3-title"
  >
    <DocumentHeading
      id="financial-disclaimer-3-title"
    >
      3. No Financial or Investment Advice
    </DocumentHeading>

    <p>
      Unless expressly stated in a separate
      written agreement, information provided
      through {PLATFORM_NAME} is not intended to
      constitute individualized financial,
      investment or wealth-management advice.
    </p>

    <p>
      Users remain responsible for obtaining
      independent professional advice where
      appropriate before making financial,
      investment, lending, borrowing or other
      material financial decisions.
    </p>

    <p>
      Nothing on the platform should be
      interpreted as a recommendation to purchase,
      sell, hold, lend, borrow, invest in or
      otherwise transact in any financial product,
      asset or service.
    </p>
  </section>

  {/* ======================================================================
      4. NO LEGAL / TAX / ACCOUNTING ADVICE
      ==================================================================== */}

  <section
    id="financial-disclaimer-4"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-4-title"
  >
    <DocumentHeading
      id="financial-disclaimer-4-title"
    >
      4. No Legal, Tax or Accounting Advice
    </DocumentHeading>

    <p>
      Financial information, reports and
      calculations displayed by the platform are
      not a substitute for professional legal,
      tax, accounting, audit or regulatory advice.
    </p>

    <p>
      Users and organizations should consult
      appropriately qualified professionals when
      determining their legal, tax, accounting,
      reporting or regulatory obligations.
    </p>

    <p>
      TITech does not assume responsibility for
      professional advice obtained or decisions
      made independently by a user, tenant,
      organization or other party.
    </p>
  </section>

  {/* ======================================================================
      5. USER-SUPPLIED INFORMATION
      ==================================================================== */}

  <section
    id="financial-disclaimer-5"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-5-title"
  >
    <DocumentHeading
      id="financial-disclaimer-5-title"
    >
      5. User-Supplied Financial Information
    </DocumentHeading>

    <p>
      Financial information displayed on the
      platform may depend on information entered,
      uploaded, authorized or otherwise supplied by
      users, tenant administrators, communities,
      financial institutions or integrated
      third-party systems.
    </p>

    <p>
      Users and authorized administrators are
      responsible for ensuring that information
      they submit is accurate, complete and
      appropriately authorized.
    </p>

    <p>
      Where information appears incorrect,
      duplicated, incomplete or unauthorized,
      users should report the issue through the
      applicable support, dispute or correction
      process promptly.
    </p>
  </section>

  {/* ======================================================================
      6. CALCULATIONS
      ==================================================================== */}

  <section
    id="financial-disclaimer-6"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-6-title"
  >
    <DocumentHeading
      id="financial-disclaimer-6-title"
    >
      6. Financial Calculations and Estimates
    </DocumentHeading>

    <p>
      TITech may provide calculations, estimates,
      summaries, projections, balances, interest
      calculations, contribution summaries or
      other financial information based on
      configured rules and available data.
    </p>

    <p>
      Calculated values may depend on factors such
      as:
    </p>

    <ul>
      <li>
        data supplied by users or organizations;
      </li>

      <li>
        configuration settings;
      </li>

      <li>
        transaction timing;
      </li>

      <li>
        applicable fees or charges;
      </li>

      <li>
        interest or contribution rules;
      </li>

      <li>
        third-party processing results;
      </li>

      <li>
        rounding conventions;
      </li>

      <li>
        currency and exchange-rate information;
      </li>

      <li>
        corrections or reversals; and
      </li>

      <li>
        applicable legal or organizational
        policies.
      </li>
    </ul>

    <p>
      Unless expressly designated as final and
      authoritative under an applicable agreement,
      calculated or displayed values should be
      treated as informational and independently
      verified when material financial decisions
      depend upon them.
    </p>
  </section>

  {/* ======================================================================
      7. BALANCES AND LEDGER RECORDS
      ==================================================================== */}

  <section
    id="financial-disclaimer-7"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-7-title"
  >
    <DocumentHeading
      id="financial-disclaimer-7-title"
    >
      7. Balances, Records and Reconciliation
    </DocumentHeading>

    <p>
      Platform balances and transaction records
      are intended to reflect information processed
      or recorded by the applicable system.
    </p>

    <p>
      Organizations should maintain appropriate
      financial controls, reconciliations and
      supporting records in accordance with their
      applicable governance, accounting and
      regulatory requirements.
    </p>

    <p>
      Where a discrepancy exists between platform
      information and an authoritative financial
      record, the matter should be investigated
      through the applicable reconciliation,
      support or dispute process.
    </p>
  </section>

  {/* ======================================================================
      8. TRANSACTIONS
      ==================================================================== */}

  <section
    id="financial-disclaimer-8"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-8-title"
  >
    <DocumentHeading
      id="financial-disclaimer-8-title"
    >
      8. Transactions and Payment Processing
    </DocumentHeading>

    <p>
      Financial transactions may depend on
      external banks, mobile-money operators,
      payment processors, telecommunications
      networks, settlement systems and other
      third-party infrastructure.
    </p>

    <p>
      As a result, transaction authorization,
      processing, settlement and confirmation may
      be affected by systems or circumstances
      outside TITech's direct control.
    </p>

    <p>
      A transaction displayed as initiated,
      pending, successful, failed, reversed or
      otherwise processed should be interpreted
      according to the applicable transaction
      status and supporting records.
    </p>

    <p>
      Users should verify important transactions
      and retain appropriate confirmation or
      reference information where available.
    </p>
  </section>

  {/* ======================================================================
      9. MOBILE MONEY
      ==================================================================== */}

  <section
    id="financial-disclaimer-9"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-9-title"
  >
    <DocumentHeading
      id="financial-disclaimer-9-title"
    >
      9. Mobile Money and Third-Party Payments
    </DocumentHeading>

    <p>
      Where TITech integrates with mobile-money
      operators or other payment providers, those
      providers may independently control
      transaction processing, availability,
      settlement, fees, limits and applicable
      customer requirements.
    </p>

    <p>
      Provider-specific terms, conditions, fees,
      limits, verification requirements and
      transaction rules may apply in addition to
      TITech's terms.
    </p>

    <p>
      Users should review the applicable
      provider's documentation and transaction
      confirmation information where necessary.
    </p>
  </section>

  {/* ======================================================================
      10. FEES
      ==================================================================== */}

  <section
    id="financial-disclaimer-10"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-10-title"
  >
    <DocumentHeading
      id="financial-disclaimer-10-title"
    >
      10. Fees, Charges and Pricing
    </DocumentHeading>

    <p>
      Fees and charges associated with TITech
      services or third-party financial services
      may vary according to the applicable plan,
      service, transaction type, provider,
      jurisdiction or contractual arrangement.
    </p>

    <p>
      Third-party providers may impose separate
      fees or charges that are outside TITech's
      control.
    </p>

    <p>
      Users should review applicable pricing and
      fee information before authorizing
      transactions or subscribing to services.
    </p>
  </section>

  {/* ======================================================================
      11. FINANCIAL OUTCOMES
      ==================================================================== */}

  <section
    id="financial-disclaimer-11"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-11-title"
  >
    <DocumentHeading
      id="financial-disclaimer-11-title"
    >
      11. No Guarantee of Financial Outcomes
    </DocumentHeading>

    <p>
      Use of TITech Community Capital does not
      guarantee savings growth, investment
      returns, loan approval, loan repayment,
      financial performance, profitability,
      liquidity or any other financial outcome.
    </p>

    <p>
      Financial outcomes depend on factors beyond
      the operation of the platform, including
      individual decisions, organizational
      governance, market conditions, economic
      circumstances, counterparties, regulatory
      requirements and other external factors.
    </p>
  </section>

  {/* ======================================================================
      12. COMMUNITY / TENANT RESPONSIBILITY
      ==================================================================== */}

  <section
    id="financial-disclaimer-12"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-12-title"
  >
    <DocumentHeading
      id="financial-disclaimer-12-title"
    >
      12. Responsibility of Communities and
      Organizations
    </DocumentHeading>

    <p>
      Organizations using TITech remain
      responsible for their internal financial
      governance, authorization procedures,
      accounting policies, member relationships,
      transaction approvals and regulatory
      obligations.
    </p>

    <p>
      Tenant administrators should implement
      appropriate controls for:
    </p>

    <ul>
      <li>
        user access and permissions;
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
        record retention;
      </li>

      <li>
        fraud prevention;
      </li>

      <li>
        dispute handling; and
      </li>

      <li>
        regulatory compliance.
      </li>
    </ul>

    <p>
      TITech technology does not replace an
      organization's governance framework or
      fiduciary responsibilities.
    </p>
  </section>

  {/* ======================================================================
      13. CREDIT / LOANS
      ==================================================================== */}

  <section
    id="financial-disclaimer-13"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-13-title"
  >
    <DocumentHeading
      id="financial-disclaimer-13-title"
    >
      13. Loans, Credit and Lending Decisions
    </DocumentHeading>

    <p>
      Where TITech supports loan, credit or
      lending-related workflows, platform
      functionality does not necessarily mean
      that TITech is the lender, creditor,
      underwriter or provider of the underlying
      financial facility.
    </p>

    <p>
      Loan eligibility, approval, pricing,
      interest rates, collateral requirements,
      repayment obligations and related decisions
      may be determined by the applicable
      organization, lender or financial
      institution.
    </p>

    <p>
      Users should carefully review the applicable
      loan agreement and related disclosures
      before accepting any financial obligation.
    </p>
  </section>

  {/* ======================================================================
      14. REGULATORY RESPONSIBILITY
      ==================================================================== */}

  <section
    id="financial-disclaimer-14"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-14-title"
  >
    <DocumentHeading
      id="financial-disclaimer-14-title"
    >
      14. Regulatory and Jurisdictional
      Requirements
    </DocumentHeading>

    <p>
      Financial and technology regulations vary
      between jurisdictions and may change over
      time.
    </p>

    <p>
      A particular TITech feature, financial
      activity, integration or service may not be
      available, authorized or appropriate in
      every jurisdiction.
    </p>

    <p>
      Users and organizations are responsible for
      complying with laws, regulations, licenses,
      reporting obligations and other requirements
      applicable to their activities, except where
      a specific obligation has expressly been
      assumed by TITech under a written agreement.
    </p>

    <p>
      Nothing in this Disclaimer is intended to
      exclude or override mandatory legal or
      regulatory requirements.
    </p>
  </section>

  {/* ======================================================================
      15. THIRD-PARTY DATA
      ==================================================================== */}

  <section
    id="financial-disclaimer-15"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-15-title"
  >
    <DocumentHeading
      id="financial-disclaimer-15-title"
    >
      15. Third-Party Data and Services
    </DocumentHeading>

    <p>
      TITech may rely on data, services or
      infrastructure supplied by third parties.
    </p>

    <p>
      Third-party information may be delayed,
      unavailable, incomplete or subject to
      correction.
    </p>

    <p>
      TITech does not guarantee the continuous
      availability, accuracy or completeness of
      information supplied by an external
      provider where such matters are outside
      TITech's reasonable control.
    </p>
  </section>

  {/* ======================================================================
      16. SECURITY
      ==================================================================== */}

  <section
    id="financial-disclaimer-16"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-16-title"
  >
    <DocumentHeading
      id="financial-disclaimer-16-title"
    >
      16. Security and Unauthorized Activity
    </DocumentHeading>

    <p>
      TITech implements security measures
      designed to protect accounts, systems and
      information.
    </p>

    <p>
      No internet-connected system can guarantee
      absolute protection against every possible
      security incident, unauthorized access,
      fraud attempt, malware event, infrastructure
      failure or other threat.
    </p>

    <p>
      Users must protect authentication
      credentials, devices, authorization
      mechanisms and other account-security
      information.
    </p>

    <p>
      Suspected unauthorized transactions,
      account compromise or security incidents
      should be reported promptly through the
      applicable support or security channel.
    </p>
  </section>

  {/* ======================================================================
      17. ERRORS AND CORRECTIONS
      ==================================================================== */}

  <section
    id="financial-disclaimer-17"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-17-title"
  >
    <DocumentHeading
      id="financial-disclaimer-17-title"
    >
      17. Errors, Corrections and Reversals
    </DocumentHeading>

    <p>
      Technical, data-entry, integration,
      transaction-processing or other errors may
      occasionally occur.
    </p>

    <p>
      Where an error is identified, TITech or an
      applicable service provider may investigate,
      correct, reconcile, reverse or otherwise
      process the affected record in accordance
      with applicable procedures and law.
    </p>

    <p>
      Users should not rely on an obvious system
      error to establish a financial entitlement
      where the underlying transaction or record
      is subsequently determined to be incorrect.
    </p>
  </section>

  {/* ======================================================================
      18. AVAILABILITY
      ==================================================================== */}

  <section
    id="financial-disclaimer-18"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-18-title"
  >
    <DocumentHeading
      id="financial-disclaimer-18-title"
    >
      18. Service Availability and Continuity
    </DocumentHeading>

    <p>
      TITech seeks to provide reliable services
      but does not guarantee uninterrupted,
      continuous or error-free availability.
    </p>

    <p>
      Financial functionality may be temporarily
      unavailable because of maintenance,
      upgrades, network failures, cybersecurity
      events, third-party outages, infrastructure
      failures, regulatory requirements or other
      circumstances beyond reasonable control.
    </p>

    <p>
      Organizations should maintain appropriate
      continuity, reconciliation and recordkeeping
      procedures for critical financial
      operations.
    </p>
  </section>

  {/* ======================================================================
      19. NO ENDORSEMENT
      ==================================================================== */}

  <section
    id="financial-disclaimer-19"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-19-title"
  >
    <DocumentHeading
      id="financial-disclaimer-19-title"
    >
      19. No Endorsement of Financial Products
    </DocumentHeading>

    <p>
      References to financial products,
      institutions, payment providers, mobile-
      money services, banks or other third-party
      services do not necessarily constitute an
      endorsement, recommendation or guarantee by
      TITech.
    </p>

    <p>
      Users should independently evaluate
      third-party products and services and review
      their applicable terms, disclosures, fees,
      risks and regulatory status.
    </p>
  </section>

  {/* ======================================================================
      20. NO GUARANTEE
      ==================================================================== */}

  <section
    id="financial-disclaimer-20"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-20-title"
  >
    <DocumentHeading
      id="financial-disclaimer-20-title"
    >
      20. No Warranty Regarding Financial
      Results
    </DocumentHeading>

    <p>
      To the maximum extent permitted by
      applicable law, TITech does not represent or
      warrant that use of the platform will
      produce a particular financial result.
    </p>

    <p>
      Nothing in this Financial Disclaimer is
      intended to exclude warranties,
      representations, rights or remedies that
      cannot lawfully be excluded or limited.
    </p>
  </section>

  {/* ======================================================================
      21. USER DECISIONS
      ==================================================================== */}

  <section
    id="financial-disclaimer-21"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-21-title"
  >
    <DocumentHeading
      id="financial-disclaimer-21-title"
    >
      21. Responsibility for Financial Decisions
    </DocumentHeading>

    <p>
      Users are responsible for evaluating their
      own financial circumstances and for making
      decisions appropriate to their objectives,
      risk tolerance, obligations and applicable
      legal requirements.
    </p>

    <p>
      Before taking material financial action,
      users should verify relevant information and,
      where appropriate, consult qualified
      financial, legal, accounting or tax
      professionals.
    </p>
  </section>

  {/* ======================================================================
      22. RELATED LEGAL DOCUMENTS
      ==================================================================== */}

  <section
    id="financial-disclaimer-22"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-22-title"
  >
    <DocumentHeading
      id="financial-disclaimer-22-title"
    >
      22. Relationship With Other Legal
      Documents
    </DocumentHeading>

    <p>
      This Financial Disclaimer forms part of the
      broader TITech legal-document framework and
      should be read together with applicable:
    </p>

    <ul>
      <li>
        Terms of Service;
      </li>

      <li>
        Privacy Policy;
      </li>

      <li>
        service agreements;
      </li>

      <li>
        subscription agreements;
      </li>

      <li>
        financial disclosures;
      </li>

      <li>
        tenant agreements;
      </li>

      <li>
        transaction terms; and
      </li>

      <li>
        other applicable policies and notices.
      </li>
    </ul>

    <p>
      Where a specific written agreement
      expressly governs a particular matter, that
      agreement will apply to the extent permitted
      by applicable law.
    </p>
  </section>

  {/* ======================================================================
      23. CHANGES
      ==================================================================== */}

  <section
    id="financial-disclaimer-23"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-23-title"
  >
    <DocumentHeading
      id="financial-disclaimer-23-title"
    >
      23. Changes to This Financial Disclaimer
    </DocumentHeading>

    <p>
      TITech Community Capital may update this
      Financial Disclaimer from time to time to
      reflect changes in services, technology,
      business operations, legal requirements or
      regulatory expectations.
    </p>

    <p>
      The published version number and effective
      date identify the applicable version of this
      document.
    </p>

    <p>
      Where required or appropriate, material
      changes may be communicated through the
      platform, website, email or another
      appropriate communication channel.
    </p>
  </section>

  {/* ======================================================================
      24. CONTACT
      ==================================================================== */}

  <section
    id="financial-disclaimer-24"
    className="legal-document__section"
    aria-labelledby="financial-disclaimer-24-title"
  >
    <DocumentHeading
      id="financial-disclaimer-24-title"
    >
      24. Contact Information
    </DocumentHeading>

    <p>
      Questions concerning this Financial
      Disclaimer or TITech financial-related
      functionality may be directed to:
    </p>

    <address className="legal-contact">
      <p>
        <strong>
          {ORGANIZATION_NAME}
        </strong>
        <br />
        {ADDRESS}
      </p>

      <p>
        Legal:{' '}
        <a
          href={`mailto:${LEGAL_EMAIL}`}
          aria-label={`Email ${ORGANIZATION_NAME} legal team`}
        >
          {LEGAL_EMAIL}
        </a>
      </p>

      <p>
        Support:{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          aria-label={`Email ${ORGANIZATION_NAME} support`}
        >
          {SUPPORT_EMAIL}
        </a>
      </p>

      <p>
        Telephone:{' '}
        <a
          href={`tel:${PHONE_HREF}`}
          aria-label={`Call ${ORGANIZATION_NAME}`}
        >
          {PHONE}
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
        Financial Disclaimer
      </strong>
    </p>

    <p>
      Version {VERSION} · Last updated{' '}
      {LAST_UPDATED}
    </p>

    <p>
      © {new Date().getFullYear()}{' '}
      {ORGANIZATION_NAME}. All rights reserved.
    </p>
  </footer>
</article>


);
}

/* ============================================================================

* PROP TYPES
* ========================================================================== */

FinancialDisclaimer.propTypes = {
compact:
PropTypes.bool,

showDocumentNotice:
PropTypes.bool,
};