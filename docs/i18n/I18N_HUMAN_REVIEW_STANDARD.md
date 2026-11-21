# TITech Community Capital — qualified human translation review standard

## Purpose and governing rule

This standard governs review of every non-English application resource. Structural parity, machine-assisted suggestions, and automated checks are technical evidence only; none is a human linguistic approval.

**The required target-language review population is 1,806 entries:** 602 Kiswahili, 602 French, and 602 Arabic. English remains the controlled source language and also requires accountable source-language review.

## Reviewer qualification and evidence

Reviewer records use a reference ID and only the minimum governance data needed. Identity documents, private credentials, and personal contact information must remain in an approved restricted system and must not be copied into public repository evidence.

A reviewer profile must be verified by an accountable human administrator and contain:

- Reviewer reference ID and active/inactive state.
- Approved locale(s) and review scope.
- Demonstrated language proficiency/qualification evidence reference.
- Qualification verification status and verification date.
- Relevant translation experience and, where applicable, financial/legal specialisation.
- Current independence / conflict declaration.
- Human administrator verification reference.

A reviewer is eligible only when identity and qualification are verified, their approved language includes the assigned locale, the translation-review scope is active, and a no-conflict declaration is recorded. No reviewer profiles were supplied or verified during this repository execution; the generated reviewer registry is intentionally empty.

## Language-specific requirements

### Kiswahili (`sw`)

Use standard, regionally understandable Kiswahili appropriate to East African community and institutional communication. Review grammar, sentence structure, respectful/inclusive register, financial terminology, naturalness, and distinctions between pending, confirmed, failed, reversed, and refunded states. Avoid literal word substitution that changes complete-sentence meaning.

### French (`fr`)

Use contemporary standard professional French. Review agreement, syntax, punctuation/spacing, financial terminology, institutional register, natural instructions, and interpolation order. Do not retain awkward English sentence structure merely because individual terms were translated.

### Arabic (`ar`)

Use Modern Standard Arabic. Review grammar, vocabulary, financial terminology, punctuation, plural forms, gender agreement, readability, and exact semantics. Verify the six ECMA-402/CLDR plural categories (zero, one, two, few, many, other) through `Intl.PluralRules`. Mixed-direction account references, phone numbers, identifiers, transaction IDs and Latin codes must be isolated with Unicode bidi isolates; strings must never be manually reversed.

## Quality dimensions

Every entry is reviewed for accuracy, fluency, grammar, vocabulary, context, financial accuracy, legal accuracy, cultural suitability, terminology consistency, readability, accessibility, and technical integrity. All placeholders must be preserved exactly. Date, number, and currency values must use locale-aware formatting and must not be rewritten as translated numeric strings.

## Critical domains and independence

Critical-domain entries include payment, settlement, savings, contribution, balance, statement, transaction outcome, reconciliation, fees, financing, payroll, KYC/AML, privacy, consent, legal notices, complaints, safeguarding, and insurance/regulated-service descriptions.

Critical entries require two distinct qualified reviewers. A reviewer may not approve their own correction. Legal or regulated wording additionally requires a separate qualified legal/domain approval reference. Linguistic approval does not constitute legal advice, licensing, regulatory permission, insurer authorization, or partner approval.

## Decision integrity

Approval applies only to the exact SHA-256 hashes of the English source and target translation reviewed. Any source or target change invalidates approval and reopens the review. Decision history is append-only; corrections do not overwrite prior decisions. AI or machine-generated content can be proposed as a draft only and cannot carry `APPROVED_HUMAN` status.

## Current state

No human reviewers have been verified; no target entries have been reviewed or approved; no corrections have been reported. This is a review programme and queue package, not completed human review. The production i18n gate remains blocked.

## Critical-domain independent approval

For every critical translation, require two distinct qualified language reviewers. For financial, legal, KYC/AML, payroll and safeguarding language, also require a separate qualified domain approver. The domain approver must have verified identity and qualification, a current no-conflict declaration, the `DOMAIN_APPROVAL` scope, a domain specialisation matching the translation's critical domain, and a qualification verification reference. The approval record must be bound to the reviewed source/target SHA-256 hashes.
