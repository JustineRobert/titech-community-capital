/**
 * TITech Community Capital legal-document source content.
 *
 * IMPORTANT: This is a structured draft. Do not publish as effective legal text
 * until the release checklist is signed by qualified Uganda counsel and the
 * product/privacy owners have verified all statements against actual practice.
 */
export const LEGAL_DOCUMENT_VERSION = 'draft-2026-10-25';
export const LEGAL_PUBLICATION_STATUS = 'draft';
export const LEGAL_LAST_REVIEWED = '2026-10-25';

export const LEGAL_DOCUMENTS = Object.freeze({
  legal: Object.freeze({
    path: '/legal',
    title: 'Legal information',
    summary: 'Who operates the service, what TITech does, and the limits of the platform.',
    intro:
      'TITech Community Capital is designed as community-finance infrastructure for savings groups, VSLAs/ROSCAs, SACCOs, cooperatives, community enterprises, and authorised institutional partners.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Product and organization identity',
        paragraphs: [
          'Product name: TITech Community Capital.',
          'Organization identity for this document: TITech Capital LTD. The organization’s registration status, registered number, registered office, and authority to contract must be confirmed from official corporate records before these pages are published as binding notices.',
        ],
      }),
      Object.freeze({
        heading: 'What the platform does',
        paragraphs: [
          'The platform is intended to help participating institutions maintain structured community-finance records and workflows, including group and member administration, consented data handling, payment-instruction orchestration, transaction records, ledger and reconciliation support, reporting, and operational audit trails where those modules are enabled.',
          'Available functionality depends on the tenant, its agreement, enabled features, technical verification, and the participation of the relevant institution or external provider. A feature being visible in software does not prove that it is operationally available or approved for use.',
        ],
      }),
      Object.freeze({
        heading: 'Financial-services boundary',
        paragraphs: [
          'Unless specifically authorised and disclosed in a separate agreement, TITech is infrastructure software. It is not, merely by operating this software, a bank, deposit-taking institution, electronic-money issuer, payment-service provider, lender, insurer, investment firm, or guarantor of another institution’s obligations.',
          'Deposits, loans, insurance distribution, investments, payment execution, and other regulated financial activities may only be offered by appropriately authorised parties under valid agreements and applicable law. No such product should be considered active merely because a screen, workflow, test fixture, or code module exists.',
        ],
      }),
      Object.freeze({
        heading: 'Participating institutions and providers',
        paragraphs: [
          'A participating savings group, SACCO, cooperative, financial institution, NGO, insurer, payment provider, or other partner may have its own legal duties, customer terms, privacy notice, licences, and complaint process. The identity of the party responsible for each service and financial obligation must be shown at the point of use.',
          'Provider-specific availability, status, settlement, fees, eligibility and remedies are subject to verified integration, the relevant provider’s terms, partner agreements and applicable law. A timeout or unresolved status is not proof that a payment succeeded or failed.',
        ],
      }),
      Object.freeze({
        heading: 'Personal data and privacy',
        paragraphs: [
          'Personal information should be processed only for identified purposes, with a valid legal basis, appropriate transparency, access controls, retention rules and security protections. Read the Privacy Policy for the draft description of data categories, purposes, sharing, safeguards and data-subject requests.',
          'The precise controller/processor roles and contact details for each deployment must be verified and disclosed. Where an institution independently determines the purposes and means of processing, its own privacy responsibilities and notices may also apply.',
        ],
      }),
      Object.freeze({
        heading: 'Refugee, asylum-seeker and host-community inclusion',
        paragraphs: [
          'An approved institution may support assisted onboarding and alternative identity evidence where the applicable law, partner procedures and risk controls allow it. No individual should be denied a route solely because a particular national identifier is unavailable unless that requirement is legally or operationally necessary and properly disclosed.',
          'Identity documents and supporting evidence are sensitive. Their collection, scanning, storage, sharing and retention must be limited to approved purposes and handled through verified safeguards. This page does not claim that any particular assisted or offline flow is already operational or authorised.',
        ],
      }),
      Object.freeze({
        heading: 'Complaints and contact details',
        paragraphs: [
          'Before publication, the operator must provide a monitored business contact, a privacy/data-rights contact, a postal or registered-office address, a complaints escalation path, and any required regulator or partner contact details. Do not direct personal-data requests to a public issue tracker.',
          'Required contact fields are intentionally not invented in this draft. A release owner must populate and verify the approved details before any production deployment.',
        ],
      }),
      Object.freeze({
        heading: 'Applicable law and further terms',
        paragraphs: [
          'Ugandan law, including applicable data-protection, electronic-transactions, consumer, payment-system and financial-sector requirements, may apply depending on the service, parties, data, and deployment. A qualified legal adviser must confirm the governing-law, dispute-resolution, consumer-rights and cross-border positions for the specific published service.',
          'This page is an information summary and does not replace the Terms of Service, the Privacy Policy, a partner agreement, product-specific financial disclosures, or professional legal advice.',
        ],
      }),
    ]),
  }),
  terms: Object.freeze({
    path: '/terms',
    title: 'Terms of Service',
    summary: 'Rules for accessing and using TITech Community Capital.',
    intro:
      'These draft terms describe the intended contract framework for access to TITech Community Capital. They are not effective until approved, completed with verified corporate/contact details, and published by the authorised operator.',
    sections: Object.freeze([
      Object.freeze({
        heading: '1. Operator, product and acceptance',
        paragraphs: [
          'The product is TITech Community Capital. The intended operator identity for this draft is TITech Capital LTD (“TITech”, “we”, “us” or “our”), subject to confirmation of its legal registration, registered office and contracting authority.',
          'By accessing or using a service, you agree to the published terms that apply to that service. An account must not be created unless the user has an opportunity to review the applicable terms and complete any required acceptance. The published version and server-recorded acceptance time must be retained as evidence.',
        ],
      }),
      Object.freeze({
        heading: '2. Eligibility and authority',
        paragraphs: [
          'You must provide accurate information and have legal capacity to use the service. If you act for an institution, group, employer, insurer, NGO, partner, or other organisation, you confirm that you are authorised to act within the permissions assigned to you. The operator may require additional checks before enabling sensitive functions.',
          'Where a service involves a child or a person needing assisted onboarding, access must follow applicable law, the responsible institution’s approved process, appropriate safeguards, and any required guardian or representative authority.',
        ],
      }),
      Object.freeze({
        heading: '3. Account security and access',
        paragraphs: [
          'You are responsible for protecting your authentication factors, using an approved device, keeping contact information current, and promptly reporting suspected compromise. Do not share credentials or attempt to bypass role-based or tenant-scoped access controls.',
          'TITech may suspend or restrict access where reasonably necessary to protect people, data, financial integrity, the service, a participating institution, or legal compliance. Where lawful and practical, the operator should give notice and a route to challenge an error.',
        ],
      }),
      Object.freeze({
        heading: '4. Permitted and prohibited use',
        paragraphs: [
          'Use the service only for lawful, authorised, institutionally approved purposes. Do not submit false identity or financial information, impersonate another person, probe or exploit security controls, interfere with service availability, upload malware, misuse personal data, evade applicable eligibility rules, or attempt unauthorised access to another tenant’s records.',
          'You must not use the service to facilitate fraud, money laundering, terrorist financing, sanctions evasion, exploitation, unlawful discrimination, or any other prohibited activity.',
        ],
      }),
      Object.freeze({
        heading: '5. Platform scope and third-party services',
        paragraphs: [
          'TITech provides software and workflow infrastructure. Unless expressly stated in a signed agreement and permitted by law, TITech does not itself accept deposits, issue electronic money, provide a loan, underwrite insurance, give investment advice, guarantee a member’s obligation, or act as the settlement institution for a payment.',
          'External payment, banking, identity, communications, insurance, hosting, or other services may be governed by separate provider terms and availability. Provider services will not be represented as active unless the integration, provider authority, operational verification, and applicable approval gates are satisfied.',
        ],
      }),
      Object.freeze({
        heading: '6. Financial records, payment status and corrections',
        paragraphs: [
          'A financial amount or status shown in the platform is subject to the underlying verified records, the applicable institution’s rules, provider confirmation and reconciliation. A queued request, pending instruction, network timeout, unverified callback, or provisional display is not by itself evidence of settlement.',
          'Financial records must not be altered to conceal errors. Corrections and reversals should use authorised, traceable processes. Report suspected duplicate, missing, incorrect or unauthorised transactions through the approved institution or support channel once it has been published.',
        ],
      }),
      Object.freeze({
        heading: '7. Fees, disclosures and institution-specific terms',
        paragraphs: [
          'Any subscription, transaction, provider, service or other fee must be disclosed before the user becomes liable for it, with the responsible charging party identified. No fee amount is established by this draft. Institution-specific product terms, loan contracts, insurance documents, contribution rules, and provider disclosures take precedence for their particular obligations to the extent stated and permitted by law.',
        ],
      }),
      Object.freeze({
        heading: '8. Community fundraising and education',
        paragraphs: [
          'A campaign, contribution, education-support or community-fundraising page does not by itself create an investment, deposit, loan, trust, insurance policy, guaranteed return, or entitlement to funding. Campaign purpose, beneficiary, fundraiser authority, handling of funds, fees, refunds, eligibility and reporting must be disclosed in the campaign-specific terms before contributions are solicited.',
          'No fundraising feature should be activated until its funds-flow, safeguarding, refund, fraud-monitoring, legal classification, and authorised collection/payment arrangements have been reviewed.',
        ],
      }),
      Object.freeze({
        heading: '9. Data protection and privacy',
        paragraphs: [
          'Personal information is subject to the Privacy Policy, the roles of the relevant institution and service providers, and applicable data-protection law. You must only disclose another person’s personal information where you have authority and an appropriate legal basis.',
          'A privacy-policy acknowledgement is not blanket consent to every use of personal information. Where consent is the chosen legal basis, it must be specific, informed, freely given, appropriately recorded, and capable of withdrawal where required by law.',
        ],
      }),
      Object.freeze({
        heading: '10. Intellectual property and user submissions',
        paragraphs: [
          'The operator and its licensors retain rights in the software, branding, documentation, and other protected material. Subject to applicable rights and agreements, you receive a limited, non-exclusive, non-transferable right to use the service for its intended authorised purpose.',
          'You retain rights you hold in content you submit, while granting only the permissions necessary to operate, secure, support and provide the relevant service under the applicable agreement and law. The final published agreement must specify any additional licence required for institution-uploaded or campaign content.',
        ],
      }),
      Object.freeze({
        heading: '11. Availability, suspension and termination',
        paragraphs: [
          'The service may be changed, suspended or unavailable due to maintenance, technical incidents, provider failures, legal obligations, security risks, or events outside reasonable control. The operator should use reasonable operational controls and communicate material interruptions where practical.',
          'On termination, access may cease. Financial, audit, compliance and other records may be retained for legally required or documented legitimate periods, subject to the Privacy Policy and applicable law. The operator must not promise deletion where statutory retention or an unresolved legal obligation requires retention.',
        ],
      }),
      Object.freeze({
        heading: '12. Disclaimers and liability',
        paragraphs: [
          'The service is provided subject to the express commitments in the final approved agreement and applicable mandatory law. The operator does not promise uninterrupted availability, error-free processing, a particular financial outcome, a provider’s solvency, or a partner’s performance.',
          'Any exclusions or limits of liability must be reviewed for enforceability and must not exclude rights or liabilities that cannot legally be excluded. Nothing in these draft terms limits non-waivable consumer, privacy, payment or other statutory rights.',
        ],
      }),
      Object.freeze({
        heading: '13. Changes and notifications',
        paragraphs: [
          'Material changes to these terms should be published with a new version and effective date. Where required, affected users must receive notice and be asked to accept revised terms before continuing to use the affected service. Acceptance records must identify the specific version and be held securely.',
        ],
      }),
      Object.freeze({
        heading: '14. Complaints, governing law and disputes',
        paragraphs: [
          'The final terms must state verified complaints channels, response expectations, escalation options, governing law and dispute process after review by qualified counsel. This draft does not select a court, arbitration venue, mandatory pre-dispute process, or waiver of statutory rights.',
          'Insert the approved business contact, registered-office address and legal notice channel before publication. Do not use placeholder contact details in a production release.',
        ],
      }),
    ]),
  }),
  privacy: Object.freeze({
    path: '/privacy',
    title: 'Privacy Policy',
    summary: 'How personal information may be handled by TITech and participating institutions.',
    intro:
      'This draft is structured for review against Uganda’s applicable data-protection requirements and the actual deployed product. It must be reconciled with real data flows, vendors, retention schedules, institutional roles and contact channels before publication.',
    sections: Object.freeze([
      Object.freeze({
        heading: '1. Who is responsible',
        paragraphs: [
          'The product is TITech Community Capital. The intended operator identity for this draft is TITech Capital LTD, subject to verification of legal registration details and the role it performs for each processing activity.',
          'Depending on the institution, feature and agreement, TITech may act as a data controller, joint controller, processor or service provider. A participating SACCO, cooperative, insurer, NGO, employer, payment provider or other institution may make independent decisions about why and how it processes information. The production notice must identify the relevant entity and privacy contact for each relationship.',
        ],
      }),
      Object.freeze({
        heading: '2. Information categories',
        paragraphs: [
          'Depending on enabled features and the service you use, categories may include identity and contact details; account and authentication metadata; institution, group and membership records; consent and permission records; service requests and support correspondence; security, device and technical logs; contribution, payment-instruction, transaction, ledger, receipt and reconciliation records; and operational audit events.',
          'If an approved institution activates KYC, refugee/asylum-seeker assisted onboarding, insurance, claims, fundraising or other specialised modules, additional identity documents, eligibility information, beneficiary data, policy/claim references, or other sensitive information may be processed. Such information must not be collected simply because the software can support it; the specific purpose, legal basis, safeguards, access and retention must first be approved.',
          'The operator must verify which categories are actually collected, which are optional, which are inferred, and whether cookies, analytics, location data, biometrics, children’s data or advertising/marketing data are used. This draft does not assert that all listed categories are currently collected.',
        ],
      }),
      Object.freeze({
        heading: '3. Purposes and legal bases',
        paragraphs: [
          'Potential purposes include creating and securing accounts; authenticating users; administering institution and group membership; maintaining accurate records; routing and reconciling authorised payment instructions; preventing fraud and abuse; responding to support requests; preserving audit evidence; fulfilling contractual and legal obligations; and providing optional features where lawfully enabled.',
          'For each processing activity, the controller must document the applicable legal basis under the law, provide the required information, and obtain consent where consent is the appropriate basis. Service delivery, statutory duties, legitimate interests, or an institution’s instructions must not be assumed to justify every use. Optional marketing and unrelated secondary uses must be handled separately where required.',
        ],
      }),
      Object.freeze({
        heading: '4. Consent, choices and withdrawal',
        paragraphs: [
          'Where consent is used, it should be freely given, specific, informed, unambiguous, purpose-bound and recorded. Withdrawing consent does not invalidate processing that was lawfully completed before withdrawal, and some information may still need to be retained for a different valid legal obligation or basis.',
          'Acceptance of the Terms of Service and acknowledgement that the Privacy Policy has been presented are not, on their own, blanket consent to every processing operation. Any additional consent—such as optional data sharing with a capital provider, optional marketing, or a specific sensitive-data purpose—must be separately described and captured when required.',
        ],
      }),
      Object.freeze({
        heading: '5. Sharing and recipients',
        paragraphs: [
          'Information may be disclosed to the institution that administers your account or group, authorised personnel with a need to know, contracted hosting and security providers, payment providers for an authorised instruction, communications providers for requested messages, and legal or regulatory authorities when disclosure is required or permitted by law.',
          'Optional data sharing with insurers, capital providers, risk/analytics partners, donors or other recipients requires a documented purpose, appropriate authority, and consent where applicable. A request for capital connectivity must not disclose personal data without the required active consent and approvals. A recipient list and vendor register must be maintained by the operator and made available as required.',
        ],
      }),
      Object.freeze({
        heading: '6. Cross-border processing',
        paragraphs: [
          'Infrastructure providers or institutional partners may process information in countries outside Uganda. Before release, the operator must inventory actual hosting regions, subprocessors and remote-access arrangements, assess applicable transfer restrictions, implement required safeguards, and explain the relevant arrangements to users where required by law.',
          'No claim is made in this draft that any particular transfer mechanism, adequacy assessment, contract or safeguard has already been completed.',
        ],
      }),
      Object.freeze({
        heading: '7. Retention and deletion',
        paragraphs: [
          'Information should be kept only as long as necessary for the stated purpose, subject to statutory recordkeeping, financial reconciliation, fraud investigations, dispute resolution, regulatory duties and other valid retention grounds. Exact periods must be set in an approved retention schedule for each record class.',
          'When retention is no longer justified, information should be securely deleted, anonymised or otherwise disposed of using documented procedures. Backups, audit records, immutable ledgers and legal holds require special handling; a request to delete personal data does not automatically authorise deletion or alteration of financial records that must be preserved.',
        ],
      }),
      Object.freeze({
        heading: '8. Security safeguards',
        paragraphs: [
          'Appropriate safeguards should include least-privilege access, server-enforced tenant isolation and role permissions, secure authentication and session handling, encryption in transit and appropriate protection at rest, controlled key management, audit monitoring, secure backups, tested recovery, vulnerability management and incident response.',
          'Sensitive identity documents must be stored only through the approved private-document workflow. Malware scanning, storage permissions, access logging, key recovery and deletion controls must be verified in the actual deployed environment. No digital service can promise absolute security.',
        ],
      }),
      Object.freeze({
        heading: '9. Financial and institution-specific information',
        paragraphs: [
          'Financial information should be visible only to authorised users for a documented purpose and within the correct institution/tenant scope. The platform should distinguish instructions, attempts, provider responses, settlement evidence and ledger postings. A pending or uncertain payment state must not be represented as final settlement.',
          'The institution or authorised provider may have additional notices for lending, insurance, payment, fundraising, risk assessment or account administration. Such notices must be displayed before the relevant specialised service is activated.',
        ],
      }),
      Object.freeze({
        heading: '10. Your rights and requests',
        paragraphs: [
          'Subject to applicable law and the facts of the processing, individuals may have rights to request information about processing, access their information, correct inaccuracies, seek deletion or restriction where available, object to certain processing, withdraw consent where it is the legal basis, or raise a complaint with the competent authority.',
          'Requests should be routed to the verified privacy contact below once supplied. The production policy must describe identity verification, the responsible controller, response process and statutory exceptions. Do not send identity documents or sensitive personal data to a public issue tracker or an unverified email address.',
        ],
      }),
      Object.freeze({
        heading: '11. Children and assisted onboarding',
        paragraphs: [
          'Children’s personal data and information about refugees, asylum seekers, vulnerable beneficiaries and other sensitive populations require particular care. The operator and relevant institution must verify age/representative safeguards, lawful basis, minimum necessary evidence, access restrictions and risks before enabling those workflows.',
          'Assisted onboarding must not create a blanket exception to privacy, security, consent, retention or fairness requirements. Offline queues must be protected, expire where appropriate, avoid storing unnecessary sensitive content and never be treated as authoritative financial confirmation until verified by the server.',
        ],
      }),
      Object.freeze({
        heading: '12. Cookies, device storage and telemetry',
        paragraphs: [
          'Before publication, the operator must inspect the deployed application for essential cookies, authentication cookies, local/session storage, browser databases, analytics, crash reporting, metrics, pixels and third-party scripts. The final notice must name the technologies actually used, their purposes, lifetime, providers and user choices where applicable.',
          'Authentication tokens must not be placed in browser localStorage or sessionStorage if the established security architecture requires memory-only access tokens and protected HttpOnly refresh cookies. Diagnostics should not expose tokens, passwords, payment details, KYC documents or unnecessary identifiers.',
        ],
      }),
      Object.freeze({
        heading: '13. Changes to this policy',
        paragraphs: [
          'Material policy changes should receive a version number, approval record and publication date. Users should be informed of material changes and any new consent should be requested where required. Historical notices and acceptance evidence must be retained according to approved governance rules.',
        ],
      }),
      Object.freeze({
        heading: '14. Privacy contact and complaints',
        paragraphs: [
          'Privacy contact: NOT YET VERIFIED — insert a monitored, company-approved data-protection contact before publication. Registered-office address: NOT YET VERIFIED — insert verified corporate details. Do not publish these pages as final while these required fields are unresolved.',
          'The operator must verify applicable registration, data-protection officer and notification duties; establish request-handling procedures; and provide the applicable regulator complaint channel. A qualified Uganda privacy adviser must approve the final notice against the Data Protection and Privacy Act, 2019, the Data Protection and Privacy Regulations, 2021, and any applicable amendments or guidance.',
        ],
      }),
    ]),
  }),
});
