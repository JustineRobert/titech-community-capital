# TITech Community Capital — Market Validation & Strategic Positioning — 2026-09-25

## Executive position

TITech is pursuing a **Community Financial Infrastructure** model rather than competing feature-for-feature with savings-group apps, SACCO cores, MFIs or generic banking platforms.

The strategic thesis is:

> Make community financial activity **legible, trusted, interoperable and financeable** through the payment and financial infrastructure that already exists.

TITech therefore sits between community institutions and external infrastructure:

```text
Community institutions
(VSLAs / ROSCAs / SACCOs / cooperatives / community enterprises)
                         |
                         v
               TITech Control Plane
                         |
        +----------------+----------------+
        |                |                |
      Ledger       Payment/Settlement   Data Trust
        |                |                |
 Reconciliation    MTN/Airtel/M-Pesa     Consent
        |                |               Provenance
        +----------------+----------------+
                         |
                         v
                Risk / Eligibility
                         |
                         v
                 Capital Partners
```

## Market validation signals

The market is not an empty greenfield.

- World Bank's 2025 Global Findex reporting says **40% of adults in Sub-Saharan Africa had a mobile-money account in 2024**, up from 27% in 2021. Uganda's 2024 account-ownership rate is reported at **73%** in the Global Findex. [World Bank: mobile money adoption](https://blogs.worldbank.org/en/developmenttalk/digital-technology-is-unlocking-financial-inclusion) and [Global Findex 2025 report](https://openknowledge.worldbank.org/bitstreams/9288bdc5-7a9b-42de-a47c-3746fd68f22a/download)
- World Bank reports **35% of adults in Sub-Saharan Africa saved formally in 2024**, illustrating that formal/digital saving channels are already material. [World Bank](https://www.worldbank.org/en/news/press-release/2025/07/16/mobile-phone-technology-powers-saving-surge-in-developing-economies)
- GSMA's 2026 mobile-money report says the industry processed **$2.1 trillion in 2025**, with **2.3 billion registered accounts** and **593 million active 30-day accounts** globally. [GSMA SOTIR 2026](https://www.gsma.com/sotir/)
- GSMA reports that mobile technologies and services contributed **$240 billion to Africa's economy in 2025**, equal to 7.8% of GDP. [GSMA Mobile Economy Africa 2026](https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-economy/africa/)

These facts validate the infrastructure context, not TITech's product-market fit. TITech must still prove institutional adoption, transaction reliability, retention, paid usage and partner trust.

## Competitive landscape

### Chomoka / Ensibuuko

Ensibuuko currently positions Chomoka and its broader platform around community finance, savings groups, SACCOs and digital lending infrastructure. Its current public site reports **97+ cooperatives, 240,876+ active members, 194,174+ member savings accounts, 1M+ lives impacted, 21,000+ institutions/groups and six-country coverage**, with a stated 15+ country expansion ambition by 2028. These are company-reported figures and should be treated as self-reported market signals, not independently audited benchmarks. [Ensibuuko](https://ensibuuko.com/) [Chomoka product page](https://ensibuuko.com/products/chomoka)

TITech should not attempt to win by cloning this lifecycle product surface.

### Kwara

Kwara reports more than **230 credit unions/SACCOs**, with customers primarily in Kenya and additional customers in South Africa and the Philippines. Its public security materials emphasize maker-checker workflows, immutable audit trails and granular permissions. [Kwara FAQ](https://kwara.com/faq/) [Kwara Security](https://kwara.com/security/)

Implication: generic SACCO core functionality is already a mature category. TITech needs an interoperability/control-plane wedge.

### Musoni

Musoni demonstrates the value of institutional MFI/core-finance software. Its public customer stories include Hayman Microfinance with 150,000+ clients, Proximity Finance with 230,000+ end customers, and Tugende operations in Uganda and Kenya. [Musoni customer stories](https://musonisystem.com/customer-success-stories/)

Implication: TITech should learn from institutional software distribution and integrations rather than compete on core-MFI feature count.

### MifosSave / Fineract ecosystem

MifosSave explicitly targets VSLA/ROSCA/SHG community banking with offline-first mobile workflows and Fineract integration. [MifosSave](https://github.com/openMF/mifos-x-group-banking)

Implication: TITech can be complementary to financial cores rather than replacing every core system.

### Mambu

Mambu's September 2026 Intelligent Core announcement connects core banking, payments and agentic AI around an open, composable platform. [Mambu Intelligent Core](https://mambu.com/en/insights/press/mambu-launches-intelligent-core)

Implication: TITech should adopt the **composable infrastructure mindset** at a smaller, Africa-community-finance-specific layer rather than imitate Mambu's breadth.

## Strategic differentiation to prove

The differentiation should be:

```text
Community financial core
        +
Provider-neutral payment orchestration
        +
Ledger and settlement integrity
        +
Enterprise reconciliation
        +
Consent + provenance
        +
Governed risk intelligence
        +
Capital connectivity
        +
Offline/low-data operation
        +
Partner-neutral APIs
```

This is a **hypothesis to validate**, not a claim that TITech currently has a durable moat.

## Priority commercial opportunities

### 1. Community finance digitization

Entry wedge: groups, institutions, members, meetings, contributions, loans, receipts and records.

The product goal is to become the trusted operating record from which more valuable infrastructure services can emerge.

### 2. Payment orchestration

Expose one canonical transaction model across MTN, Airtel, M-Pesa, banks and approved aggregators. Provider-specific logic belongs inside adapters.

### 3. Reconciliation as a product

Turn provider-vs-ledger-vs-settlement mismatch management into an explicit enterprise capability with APIs, dashboards, exception workflows, SLAs and audit evidence.

### 4. Consent-driven community financial data

Create the data value chain:

```text
Contribution history
+ Attendance / group stability
+ Repayment behaviour
+ Cash-flow evidence
+ Consent + provenance
          |
          v
Trusted financial profile
          |
          v
Governed risk signals
          |
          v
Partner underwriting
          |
          v
External capital
```

Raw data, derived features and material decisions must remain separate and governed.

### 5. NGO / donor / government programme operations

Potential use cases include controlled disbursement, community grants, programme payments, agricultural programmes, youth finance, cooperative programmes and other funded interventions. Do not enter a programme without a real partner and defined regulatory/compliance model.

### 6. Community-to-MSME financing infrastructure

Map:

```text
Community
  -> household / microenterprise
  -> verified financial history
  -> risk profile
  -> financing request
  -> licensed funding partner
```

TITech should generally provide infrastructure and evidence rather than assume the lender role.

## The distribution lesson

Competitors' strongest asset is not necessarily code. It is distribution, institutional trust, deployment experience and partner relationships.

The next breakthrough therefore should prioritize:

```text
5 institutions
  -> 50 groups
  -> 1,000+ active members
  -> real transactions
  -> real reconciliation
  -> real provider failures
  -> real support incidents
  -> paid contracts
  -> retention
  -> partner references
```

The numbers above are **validation targets**, not current traction claims.

## Commercial breakthrough gate

A credible pilot company requires evidence of:

- at least 3-5 participating institutions;
- a meaningful live member cohort;
- two verified payment rails where commercially appropriate;
- measured transaction reliability and reconciliation;
- at least one external capital/underwriting or programme partner conversation progressing to structured validation;
- at least one paid or contractually committed pilot where feasible;
- customer support and incident processes operating in practice;
- customer retention/engagement data.

A scale-readiness / investability case should additionally show sustained data history, repeatable acquisition, referenceable customers, unit economics and partner revenue pathways. Do not call those conditions satisfied without evidence.

## Product metrics that matter more than file count

Track:

- activated institutions;
- activated groups;
- active members;
- monthly active institutions/groups/members;
- transaction count and transaction value;
- successful/failed/pending settlement rates;
- reconciliation match rate and ageing;
- incident rate and time-to-resolution;
- provider uptime/latency/error rates;
- retention by institution/group;
- revenue per institution;
- implementation time;
- support burden;
- partner-sourced pipeline;
- consent coverage;
- data-quality completeness;
- capital referrals and funded outcomes where permitted.

Do not optimize engineering effort against source-file count.
