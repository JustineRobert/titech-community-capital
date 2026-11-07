/** Server-reported feature gate contract; live operations stay fail-closed. */
export function getUbuntuFloatCapabilities(env = process.env) {
  const isTrue = (key) => String(env[key] || '').trim().toLowerCase() === 'true';
  return Object.freeze({
    product: 'TITech UbuntuFloat',
    umbrella: 'TITech Community Capital — Powered by the UbuntuFloat Protocol',
    organization: 'TITech Capital LTD',
    tagline: "Community-informed liquidity infrastructure for Africa's agent networks.",
    defaultCountry: 'UG',
    defaultCurrency: 'UGX',
    status: 'CONTROLLED_FOUNDATION',
    capabilities: {
      coreAgentManagement: { enabled: isTrue('TITECH_UBUNTFLOAT_CORE_ENABLED'), liveMoneyMovement: false },
      positionObservations: { enabled: isTrue('TITECH_UBUNTFLOAT_CORE_ENABLED'), verification: 'UNVERIFIED_ONLY', availableForSettlement: false },
      advanceApplications: { enabled: isTrue('TITECH_UBUNTFLOAT_ADVANCE_APPLICATIONS_ENABLED'), createsApplicationOnly: true },
      creditApproval: { enabled: false, reason: 'No lender policy/approval evidence is configured.' },
      liveDisbursement: { enabled: false, reason: 'Partner authorization, provider settlement proof, approval controls and approved ledger mapping are not verified.' },
      repaymentCollection: { enabled: false, reason: 'No authorized collection mandate and partner settlement workflow is configured.' },
      communitySavingsRecovery: { enabled: false },
      swapLiveTransfers: { enabled: false, reason: 'Legal funds flow, counterparty and settlement gates remain open.' },
      gridCrossProviderOrchestration: { enabled: false, reason: 'Country/provider contracts and clearing/settlement are not verified.' },
      mtnAgentEFloatRead: { enabled: false, reason: 'Existing MoMo payment modules do not prove agent e-float account access.' },
      mtnAgentEFloatTopUp: { enabled: false, reason: 'Specific product/account-type permission and settlement semantics are not verified.' },
      airtelAgentEFloatRead: { enabled: false, reason: 'Country/product-specific agent e-float permission is not verified.' },
      airtelAgentEFloatTopUp: { enabled: false, reason: 'Specific product/account-type permission and settlement semantics are not verified.' },
    },
    approvalsRequired: [
      'Funding-partner agreement and approved credit policy',
      'Country-specific legal/regulatory determination',
      'Provider product/account-type access and settlement evidence',
      'Security and privacy review',
      'Financial-accounting and ledger mapping approval',
      'Operational reconciliation and recovery evidence',
    ],
  });
}
