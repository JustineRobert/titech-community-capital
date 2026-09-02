'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Onboarding Test Builders
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Builder Pattern
 * ✅ SACCO Builder
 * ✅ Tenant Builder
 * ✅ User Builder
 * ✅ Member Builder
 * ✅ KYC Builder
 * ✅ Compliance Builder
 * ✅ Loan Eligibility Builder
 * ✅ Fluent API
 * ✅ Immutable Defaults
 * ✅ Jest Compatible
 * ✅ Vitest Compatible
 * ✅ Schema Validation (Optional)
 * ============================================================================
 */

const {
  mockTenant,
  mockMember,
  mockAdminUser,
  mockKycProfile,
  mockComplianceResult,
  mockLoanEligibility,
  mockSaccoOnboardingRequest,
} = require('../fixtures/onboardingFixtures');

/* ============================================================================
   BASE BUILDER
============================================================================ */

class BaseBuilder {
  constructor(defaults = {}) {
    this._data = Object.freeze({ ...defaults });
  }

  with(key, value) {
    return new this.constructor({ ...this._data, [key]: value });
  }

  merge(values = {}) {
    return new this.constructor({ ...this._data, ...values });
  }

  build() {
    return { ...this._data };
  }
}

/* ============================================================================
   SPECIALIZED BUILDERS
============================================================================ */

class TenantBuilder extends BaseBuilder {
  constructor(defaults = mockTenant) {
    super(defaults);
  }
}

class UserBuilder extends BaseBuilder {
  constructor(defaults = mockAdminUser) {
    super(defaults);
  }
}

class MemberBuilder extends BaseBuilder {
  constructor(defaults = mockMember) {
    super(defaults);
  }
}

class KYCBuilder extends BaseBuilder {
  constructor(defaults = mockKycProfile) {
    super(defaults);
  }
}

class ComplianceBuilder extends BaseBuilder {
  constructor(defaults = mockComplianceResult) {
    super(defaults);
  }
}

class LoanEligibilityBuilder extends BaseBuilder {
  constructor(defaults = mockLoanEligibility) {
    super(defaults);
  }
}

class SACCOOnboardingBuilder extends BaseBuilder {
  constructor(defaults = mockSaccoOnboardingRequest) {
    super(defaults);
  }

  withTenant(tenant) {
    return this.merge({ tenant });
  }

  withMember(member) {
    return this.merge({ member });
  }

  withAdminUser(user) {
    return this.merge({ adminUser: user });
  }

  withKYC(kyc) {
    return this.merge({ kyc });
  }

  withCompliance(compliance) {
    return this.merge({ compliance });
  }

  withLoanEligibility(eligibility) {
    return this.merge({ loanEligibility: eligibility });
  }
}

/* ============================================================================
   EXPORTS
============================================================================ */

module.exports = {
  TenantBuilder,
  UserBuilder,
  MemberBuilder,
  KYCBuilder,
  ComplianceBuilder,
  LoanEligibilityBuilder,
  SACCOOnboardingBuilder,
};
