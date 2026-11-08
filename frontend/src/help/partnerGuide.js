/**
 * TITech Community Capital — Partner Portal onboarding content.
 * The guide describes only implemented workspace actions as available. Any
 * capability whose canonical API is not wired is labelled as not connected.
 */
export const PARTNER_GUIDE_CHAPTERS = Object.freeze([
  {
    number: 1,
    id: 'welcome',
    title: 'Welcome to the Partner Portal',
    subtitle: 'Your Customer Support Dashboard',
    intro: 'This portal is a controlled workspace for authorized institutional support users. It provides access to tenant-scoped support cases and a practical guide to the support process.',
    tips: [
      ['All-in-One Workspace', 'Create and follow support cases from one authenticated workspace. Customer lookup, message history and account settings are not exposed here until their tenant-safe APIs are integrated.'],
      ['Security & Privacy', 'Access is restricted by the signed-in identity, tenant context and server-side permissions. Only access information needed for an assigned support task.'],
      ['Clear Status', 'Case status is read from the support-case API. Messaging-provider health is not inferred from application availability.'],
    ],
    note: 'BUILD LESS. PROVE MORE. — FINANCIAL CORRECTNESS BEFORE CONVENIENCE.',
  },
  {
    number: 2,
    id: 'navigation',
    title: 'Understanding Your Dashboard',
    subtitle: 'Find the right support workspace',
    intro: 'The page is organized around support cases, technical issue reporting, capability availability and this guide.',
    tips: [
      ['Support cases', 'View recent cases available to your tenant and open a case to review its status and recorded events.'],
      ['Create a case', 'Submit a concise subject, category, priority and description. The server derives your tenant and actor from the authenticated request.'],
      ['Guide and Help Dots', 'Use the chapter selector or Previous/Next controls. Contextual Help Dots explain the visible workspace and can be switched off without hiding security or error notices.'],
    ],
    note: 'A route or navigation item is not proof that an underlying service is operational. Use the explicit capability status shown on this page.',
  },
  {
    number: 3,
    id: 'customer-messages',
    title: 'Find Customers and Review Their Messages',
    subtitle: 'Customer lookup and delivery evidence',
    intro: 'The supplied repository snapshot does not expose a tenant-scoped partner customer-search or customer-message-history API. The Partner Portal therefore does not query the platform-admin member directory or display synthetic customer/message records.',
    tips: [
      ['Customer reference', 'Where a support case relates to a member, include only an approved reference that your institution is already authorized to use. A reference does not grant access to the customer record.'],
      ['Message delivery', 'Provider acceptance is not confirmed customer delivery. A message must be marked DELIVERED only when an authoritative provider delivery receipt supports that state.'],
      ['Escalation', 'Create a support case and include a safe correlation or provider reference. Do not paste tokens, OTPs, PINs, credentials or full customer records.'],
    ],
    note: 'Customer lookup and message history are NOT CONNECTED in this repository snapshot. Do not use unrestricted /api/members as a partner workaround.',
  },
  {
    number: 4,
    id: 'account-settings',
    title: 'Understanding Customer Account Settings',
    subtitle: 'View only what your role permits',
    intro: 'A tenant-safe customer account-settings endpoint for partner support is not mounted in the canonical API route registry in this snapshot.',
    tips: [
      ['Account profile', 'Do not infer account, verification or institution status from an unrelated member listing or cached browser state.'],
      ['View versus change', 'Support inspection and account mutation are separate permissions. Any future edit must use the platform approval, audit and identity controls.'],
      ['Restricted information', 'Passwords, PINs, OTPs, tokens, refresh credentials, API secrets and private keys must never be displayed to support users.'],
    ],
    note: 'Customer account-settings inspection is NOT CONNECTED. This guide does not authorize account changes or access to another tenant.',
  },
  {
    number: 5,
    id: 'support-tickets',
    title: 'Create and Manage Support Tickets',
    subtitle: 'Use the tenant-scoped case workflow',
    intro: 'Support cases use the existing authenticated /api/v1/operations/cases API. Server-side permissions and tenant context are authoritative.',
    tips: [
      ['Create a case', 'Choose an accurate category and priority, then describe the observed problem, the affected module and the steps needed to reproduce it.'],
      ['Track progress', 'Review the case status and its recorded case events. Authorized support personnel can move cases through the supported state transitions.'],
      ['Technical errors', 'Use the Technical error category for application problems. The submitted diagnostic context is allowlisted and sensitive fields are discarded or redacted.'],
    ],
    note: 'The case event history is stored with the case. It is not represented as a substitute for the platform-wide tamper-evident audit chain.',
  },
  {
    number: 6,
    id: 'pathways',
    title: 'Understanding Messaging and System Health',
    subtitle: 'Separate availability from delivery',
    intro: 'This snapshot does not mount a partner-facing, provider-specific messaging-pathway monitoring API. The portal deliberately shows that capability as unavailable rather than generating a green status.',
    tips: [
      ['Application availability', 'The general application health endpoint, if reachable, describes application health only.'],
      ['Provider connectivity', 'A provider connectivity result requires a current provider-specific observation. Configuration alone is not a health check.'],
      ['Customer delivery', 'Submission, provider acceptance and delivery confirmation are separate states. Missing or stale evidence must remain UNKNOWN.'],
    ],
    note: 'Message pathway status is NOT CONNECTED. Escalate through a support case and include a safe correlation ID where available.',
  },
  {
    number: 7,
    id: 'security',
    title: 'Protecting Customers and Using the Portal Responsibly',
    subtitle: 'Security, privacy and support best practices',
    intro: 'Use the portal only through your own authorized account and only for a legitimate institutional support purpose.',
    tips: [
      ['Protect credentials', 'Never share passwords, one-time codes, PINs, access tokens, refresh tokens or device secrets. Sign out from shared workstations.'],
      ['Respect tenant boundaries', 'Access only records within your institution and assigned role. Do not attempt to discover another institution’s customer, case, conversation or attachment identifiers.'],
      ['Report incidents', 'Report suspected data exposure, account compromise or unauthorized access immediately through the approved incident process.'],
    ],
    note: 'You are ready to use the TITech Partner Portal for the support functions that are explicitly enabled for your account.',
  },
]);

export const PARTNER_HELP_DOTS = Object.freeze([
  { id: 'case-list', chapter: 5, target: 'partner-case-list', title: 'Support case list', text: 'Cases are loaded from the authenticated tenant-scoped Operations API. An empty list is not converted into a made-up ticket count.' },
  { id: 'case-create', chapter: 5, target: 'partner-case-create', title: 'Create a support case', text: 'Use a descriptive subject and factual issue summary. The backend supplies the actor and tenant context.' },
  { id: 'capability-boundaries', chapter: 3, target: 'partner-capability-boundaries', title: 'Capability availability', text: 'Not connected means the canonical partner-safe API is not available in this snapshot. Do not bypass it using an administrative endpoint.' },
  { id: 'guide-controls', chapter: 1, target: 'partner-guide-launcher', title: 'Interactive user guide', text: 'Open any of the seven chapters, move between chapters, or switch contextual Help Dots on and off.' },
]);

export function getGuideChapter(number) {
  return PARTNER_GUIDE_CHAPTERS.find((chapter) => chapter.number === Number(number)) || null;
}

export function isValidGuideChapterSet(chapters = PARTNER_GUIDE_CHAPTERS) {
  return chapters.length === 7 && chapters.every((chapter, index) => chapter.number === index + 1 && Boolean(chapter.id && chapter.title && chapter.intro));
}
