'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Onboarding Test Fixtures
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ SACCO Onboarding Fixtures
 * ✅ Member Onboarding Fixtures
 * ✅ User Fixtures
 * ✅ KYC Fixtures
 * ✅ Compliance Fixtures
 * ✅ Multi-Tenant Fixtures
 * ✅ Factory Builders
 * ✅ Immutable Test Data
 * ============================================================================
 */

/* ============================================================================
   TENANTS
============================================================================ */

const mockTenant = Object.freeze({

    _id: 'tenant_001',

    code: 'SACCO001',

    name: 'TITech Community SACCO',

    status: 'ACTIVE',

    country: 'UG',

    currency: 'UGX',

    timezone: 'Africa/Kampala',

    onboardingCompleted: true
});

/* ============================================================================
   USERS
============================================================================ */

const mockAdminUser = Object.freeze({

    _id: 'user_admin_001',

    firstName: 'System',

    lastName: 'Administrator',

    email: 'admin@titech.co.ug',

    phoneNumber: '+256772123546',

    role: 'ADMIN',

    status: 'ACTIVE',

    tenantId: mockTenant._id
});

const mockCreditOfficer = Object.freeze({

    _id: 'user_co_001',

    firstName: 'Justine Robert',

    lastName: 'Igune',

    email: 'credit@titech.co.ug',

    role: 'CREDIT_OFFICER',

    status: 'ACTIVE',

    tenantId: mockTenant._id
});

/* ============================================================================
   SACCO ONBOARDING
============================================================================ */

const mockSaccoOnboardingRequest = Object.freeze({

    name: 'TITech Community SACCO',

    registrationNumber: 'REG-2026-0001',

    email: 'info@sacco.co.ug',

    phoneNumber: '+256772123546',

    district: 'Kampala',

    address: 'Plot 1 Kampala Road',

    incorporationDate: '2025-01-01',

    contactPerson: {

        firstName: 'Justine Robert',

        lastName: 'Igune',

        email: 'justine@acco.co.ug',

        phoneNumber: '+256782397907',
    }
});

const mockSaccoOnboardingResponse =
    Object.freeze({

        success: true,

        tenantId:
            mockTenant._id,

        onboardingStatus:
            'COMPLETED'
    });

/* ============================================================================
   MEMBER ONBOARDING
============================================================================ */

const mockMember = Object.freeze({

    _id: 'member_001',

    memberNumber: 'MBR-0001',

    firstName: 'Jane',

    lastName: 'Namusoke',

    gender: 'FEMALE',

    dateOfBirth: '1990-01-01',

    nationalId: 'CM1234567890ABC',

    phoneNumber: '+256701111111',

    email: 'jane@example.com',

    address: 'Kampala',

    occupation: 'Teacher',

    status: 'ACTIVE',

    tenantId: mockTenant._id
});

const mockMemberOnboardingRequest =
    Object.freeze({

        firstName: 'Jane',

        lastName: 'Namusoke',

        phoneNumber: '+256701111111',

        nationalId:
            'CM1234567890ABC',

        occupation:
            'Teacher'
    });

/* ============================================================================
   KYC
============================================================================ */

const mockKycProfile = Object.freeze({

    status: 'APPROVED',

    level: 'FULL_KYC',

    identityVerified: true,

    phoneVerified: true,

    emailVerified: true,

    sanctionsScreened: true,

    pepScreened: true,

    riskRating: 'LOW'
});

const mockPendingKycProfile =
    Object.freeze({

        status: 'PENDING',

        level: 'BASIC_KYC',

        identityVerified: false,

        riskRating: 'MEDIUM'
    });

/* ============================================================================
   COMPLIANCE
============================================================================ */

const mockComplianceResult =
    Object.freeze({

        passed: true,

        score: 98,

        checks: {

            aml: true,

            kyc: true,

            sanctions: true,

            documentation: true
        }
    });

const mockComplianceFailure =
    Object.freeze({

        passed: false,

        score: 45,

        message:
            'KYC verification incomplete'
    });

/* ============================================================================
   LOAN READINESS
============================================================================ */

const mockLoanEligibility =
    Object.freeze({

        eligible: true,

        creditScore: 745,

        maxAmount: 5000000,

        riskRating: 'LOW',

        recommendation:
            'APPROVE'
    });

const mockLoanIneligible =
    Object.freeze({

        eligible: false,

        creditScore: 420,

        riskRating: 'HIGH',

        recommendation:
            'REJECT'
    });

/* ============================================================================
   DOCUMENTS
============================================================================ */

const mockDocuments =
    Object.freeze([

        {

            id:
                'doc_001',

            type:
                'NATIONAL_ID',

            status:
                'VERIFIED'
        },

        {

            id:
                'doc_002',

            type:
                'PASSPORT_PHOTO',

            status:
                'VERIFIED'
        }
    ]);

/* ============================================================================
   FACTORY HELPERS
============================================================================ */

const buildMember = (
    overrides = {}
) => ({

    ...mockMember,

    ...overrides
});

const buildUser = (
    overrides = {}
) => ({

    ...mockAdminUser,

    ...overrides
});

const buildTenant = (
    overrides = {}
) => ({

    ...mockTenant,

    ...overrides
});

const buildLoanEligibility =
    (
        overrides = {}
    ) => ({

        ...mockLoanEligibility,

        ...overrides
    });

/* ============================================================================
   NEGATIVE TEST DATA
============================================================================ */

const invalidMemberPayload =
    Object.freeze({

        firstName: '',

        phoneNumber: '',

        nationalId: ''
    });

const invalidTenantPayload =
    Object.freeze({

        name: '',

        registrationNumber: ''
    });

/* ============================================================================
   EXPORTS
============================================================================ */

module.exports = {

    mockTenant,

    mockAdminUser,

    mockCreditOfficer,

    mockMember,

    mockMemberOnboardingRequest,

    mockSaccoOnboardingRequest,

    mockSaccoOnboardingResponse,

    mockKycProfile,

    mockPendingKycProfile,

    mockComplianceResult,

    mockComplianceFailure,

    mockLoanEligibility,

    mockLoanIneligible,

    mockDocuments,

    invalidMemberPayload,

    invalidTenantPayload,

    buildTenant,

    buildUser,

    buildMember,

    buildLoanEligibility
};