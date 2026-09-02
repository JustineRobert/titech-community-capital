'use strict';

/**
 * ============================================================================
 * ENTERPRISE MEMBER SERVICE
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * File:
 * backend/modules/members/services/memberService.js
 *
 * Purpose:
 * Enterprise application service responsible for orchestrating member
 * lifecycle operations across the SACCO platform.
 *
 * Responsibilities:
 *
 *  - Multi-tenant member management
 *  - Member lifecycle management
 *  - KYC orchestration
 *  - National ID verification
 *  - Phone verification
 *  - Member document management
 *  - Mobile money wallet linking
 *  - Account integration
 *  - Savings integration
 *  - Loan integration
 *  - Credit scoring integration
 *  - Risk profile integration
 *  - Member dashboards
 *  - Member statements
 *  - Analytics
 *  - Growth reporting
 *  - Audit trail generation
 *  - Bulk member import
 *  - Export orchestration
 *
 * Design Principles:
 *
 *  - Service layer contains business orchestration.
 *  - Repository layer owns persistence.
 *  - Tenant isolation is mandatory.
 *  - Financial records are never mutated directly here.
 *  - Audit events are generated for material state changes.
 *  - Sensitive values must never be written to logs.
 *  - Existing public APIs are preserved.
 * ============================================================================
 */

const logger = require('../../../utils/logger');

const MemberRepository =
    require('../../../repositories/memberRepository');

const AccountRepository =
    require('../../../repositories/accountRepository');

const SavingsRepository =
    require('../../../repositories/savingsRepository');

const LoanRepository =
    require('../../../repositories/loanRepository');

const AuditRepository =
    require('../../../repositories/auditRepository');

const DocumentRepository =
    require('../../../repositories/documentRepository');

const WalletRepository =
    require('../../../repositories/walletRepository');

const CreditScoreService =
    require('../../credit/services/creditScoreService');

const RiskEngineService =
    require('../../risk/services/riskEngineService');


/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const MEMBER_STATUS = Object.freeze({
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    ACTIVE: 'ACTIVE',
    SUSPENDED: 'SUSPENDED',
    DORMANT: 'DORMANT',
    CLOSED: 'CLOSED',
    REJECTED: 'REJECTED'
});

const KYC_STATUS = Object.freeze({
    PENDING: 'PENDING',
    VERIFIED: 'VERIFIED',
    FAILED: 'FAILED',
    EXPIRED: 'EXPIRED',
    REQUIRES_REVIEW: 'REQUIRES_REVIEW'
});

const AUDIT_ACTION = Object.freeze({
    CREATED: 'MEMBER_CREATED',
    UPDATED: 'MEMBER_UPDATED',
    DELETED: 'MEMBER_DELETED',
    APPROVED: 'MEMBER_APPROVED',
    SUSPENDED: 'MEMBER_SUSPENDED',
    ACTIVATED: 'MEMBER_ACTIVATED',
    KYC_VERIFIED: 'MEMBER_KYC_VERIFIED',
    NATIONAL_ID_VERIFIED: 'MEMBER_NATIONAL_ID_VERIFIED',
    PHONE_VERIFIED: 'MEMBER_PHONE_VERIFIED',
    DOCUMENTS_UPLOADED: 'MEMBER_DOCUMENTS_UPLOADED',
    WALLET_LINKED: 'MEMBER_WALLET_LINKED',
    MEMBERS_IMPORTED: 'MEMBERS_IMPORTED'
});


/**
 * ============================================================================
 * SERVICE
 * ============================================================================
 */

class MemberService {

    /**
     * ========================================================================
     * INTERNAL VALIDATION
     * ========================================================================
     */

    static assertTenantId(tenantId) {

        if (
            tenantId === undefined ||
            tenantId === null ||
            String(tenantId).trim() === ''
        ) {
            throw new Error('Tenant ID is required');
        }

        return tenantId;
    }

    static assertMemberId(memberId) {

        if (
            memberId === undefined ||
            memberId === null ||
            String(memberId).trim() === ''
        ) {
            throw new Error('Member ID is required');
        }

        return memberId;
    }

    static assertUser(user) {

        if (!user) {
            throw new Error('Authenticated user is required');
        }

        return user;
    }

    static getActorId(user) {

        return (
            user?._id ||
            user?.id ||
            user?.userId ||
            null
        );
    }

    static getActorName(user) {

        return (
            user?.name ||
            user?.fullName ||
            user?.username ||
            null
        );
    }

    /**
     * ========================================================================
     * AUDIT HELPER
     * ========================================================================
     *
     * Audit failures are deliberately not allowed to silently disappear.
     * Material member state changes must remain auditable.
     */

    static async audit({
        tenantId,
        action,
        entityId,
        user,
        metadata = {}
    }) {

        try {

            if (!AuditRepository?.create) {
                logger.warn(
                    'MemberService audit repository unavailable',
                    {
                        tenantId,
                        action,
                        entityId
                    }
                );

                return null;
            }

            return await AuditRepository.create({

                tenantId,

                action,

                entityType:
                    'Member',

                entityId,

                performedBy:
                    this.getActorId(user),

                performedByName:
                    this.getActorName(user),

                metadata
            });

        } catch (error) {

            logger.error(
                'MemberService.audit failed',
                {
                    tenantId,
                    action,
                    entityId,
                    error: error.message
                }
            );

            throw error;
        }
    }

    /**
     * ========================================================================
     * MEMBER EXISTENCE
     * ========================================================================
     */

    static async requireMember(
        memberId,
        tenantId
    ) {

        this.assertMemberId(memberId);
        this.assertTenantId(tenantId);

        const member =
            await MemberRepository.findById(
                memberId,
                tenantId
            );

        if (!member) {

            const error =
                new Error('Member not found');

            error.code =
                'MEMBER_NOT_FOUND';

            error.statusCode =
                404;

            throw error;
        }

        return member;
    }

    /**
     * ========================================================================
     * CREATE MEMBER
     * ========================================================================
     */

    static async createMember(
        tenantId,
        memberData,
        user
    ) {

        try {

            this.assertTenantId(tenantId);
            this.assertUser(user);

            if (
                !memberData ||
                typeof memberData !== 'object'
            ) {
                throw new Error(
                    'Member data is required'
                );
            }

            const member =
                await MemberRepository.create({

                    tenantId,

                    ...memberData
                });

            if (!member) {
                throw new Error(
                    'Member creation failed'
                );
            }

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.CREATED,

                entityId:
                    member._id,

                user,

                metadata: {

                    memberNumber:
                        member.memberNumber,

                    status:
                        member.status ||
                        MEMBER_STATUS.PENDING
                }
            });

            logger.info(
                'Member created successfully',
                {
                    tenantId,
                    memberId: member._id,
                    memberNumber:
                        member.memberNumber
                }
            );

            return member;

        } catch (error) {

            logger.error(
                'MemberService.createMember failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * GET MEMBER BY ID
     * ========================================================================
     */

    static async getMemberById(
        memberId,
        tenantId
    ) {

        try {

            return await this.requireMember(
                memberId,
                tenantId
            );

        } catch (error) {

            logger.error(
                'MemberService.getMemberById failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * GET MEMBERS
     * ========================================================================
     */

    static async getMembers(
        tenantId,
        filters = {}
    ) {

        try {

            this.assertTenantId(tenantId);

            if (
                !filters ||
                typeof filters !== 'object'
            ) {
                filters = {};
            }

            return await MemberRepository.findAll({

                tenantId,

                ...filters,

                // Tenant cannot be overridden by caller.
                tenantId
            });

        } catch (error) {

            logger.error(
                'MemberService.getMembers failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * UPDATE MEMBER
     * ========================================================================
     */

    static async updateMember(
        memberId,
        tenantId,
        updateData,
        user
    ) {

        try {

            this.assertTenantId(tenantId);
            this.assertMemberId(memberId);
            this.assertUser(user);

            if (
                !updateData ||
                typeof updateData !== 'object'
            ) {
                throw new Error(
                    'Member update data is required'
                );
            }

            await this.requireMember(
                memberId,
                tenantId
            );

            /*
             * Prevent tenant reassignment through the service layer.
             */

            const sanitizedUpdate = {
                ...updateData
            };

            delete sanitizedUpdate.tenantId;
            delete sanitizedUpdate._id;
            delete sanitizedUpdate.createdAt;

            const member =
                await MemberRepository.update(
                    memberId,
                    tenantId,
                    sanitizedUpdate
                );

            if (!member) {
                throw new Error(
                    'Member update failed'
                );
            }

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.UPDATED,

                entityId:
                    memberId,

                user,

                metadata: {

                    fields:
                        Object.keys(
                            sanitizedUpdate
                        )
                }
            });

            logger.info(
                'Member updated successfully',
                {
                    tenantId,
                    memberId,
                    fields:
                        Object.keys(
                            sanitizedUpdate
                        )
                }
            );

            return member;

        } catch (error) {

            logger.error(
                'MemberService.updateMember failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * DELETE MEMBER
     * ========================================================================
     *
     * Prefer repository-level soft deletion where supported.
     */

    static async deleteMember(
        memberId,
        tenantId,
        user
    ) {

        try {

            this.assertTenantId(tenantId);
            this.assertMemberId(memberId);
            this.assertUser(user);

            const member =
                await this.requireMember(
                    memberId,
                    tenantId
                );

            /*
             * Do not physically delete an active member without checking
             * downstream financial relationships.
             */

            const loans =
                LoanRepository?.findByMember
                    ? await LoanRepository.findByMember(
                        memberId,
                        tenantId
                    )
                    : [];

            const activeLoans =
                Array.isArray(loans)
                    ? loans.filter(
                        loan =>
                            ![
                                'CLOSED',
                                'WRITTEN_OFF',
                                'RECOVERED'
                            ].includes(
                                loan.status
                            )
                    )
                    : [];

            if (activeLoans.length > 0) {

                const error =
                    new Error(
                        'Member cannot be deleted while active loans exist'
                    );

                error.code =
                    'MEMBER_HAS_ACTIVE_LOANS';

                error.statusCode =
                    409;

                throw error;
            }

            await MemberRepository.delete(
                memberId,
                tenantId
            );

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.DELETED,

                entityId:
                    memberId,

                user,

                metadata: {

                    memberNumber:
                        member.memberNumber,

                    deletionType:
                        'REPOSITORY_DELETE'
                }
            });

            logger.info(
                'Member deleted successfully',
                {
                    tenantId,
                    memberId
                }
            );

            return true;

        } catch (error) {

            logger.error(
                'MemberService.deleteMember failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * VERIFY KYC
     * ========================================================================
     */

    static async verifyKYC(
        memberId,
        tenantId,
        user
    ) {

        try {

            this.assertUser(user);

            await this.requireMember(
                memberId,
                tenantId
            );

            const member =
                await MemberRepository.verifyKYC(
                    memberId,
                    tenantId
                );

            if (!member) {
                throw new Error(
                    'KYC verification failed'
                );
            }

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.KYC_VERIFIED,

                entityId:
                    memberId,

                user,

                metadata: {

                    kycStatus:
                        member.kycStatus ||
                        KYC_STATUS.VERIFIED,

                    verifiedAt:
                        member.verifiedAt ||
                        new Date()
                }
            });

            logger.info(
                'Member KYC verified',
                {
                    tenantId,
                    memberId
                }
            );

            return member;

        } catch (error) {

            logger.error(
                'MemberService.verifyKYC failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER DASHBOARD
     * ========================================================================
     */

    static async getMemberDashboard(
        memberId,
        tenantId
    ) {

        try {

            const [
                member,
                accounts,
                loans,
                savings
            ] = await Promise.all([

                this.requireMember(
                    memberId,
                    tenantId
                ),

                AccountRepository.findByMember(
                    memberId,
                    tenantId
                ),

                LoanRepository.findByMember(
                    memberId,
                    tenantId
                ),

                SavingsRepository.findByMember(
                    memberId,
                    tenantId
                )
            ]);

            const accountList =
                Array.isArray(accounts)
                    ? accounts
                    : [];

            const loanList =
                Array.isArray(loans)
                    ? loans
                    : [];

            const savingsList =
                Array.isArray(savings)
                    ? savings
                    : [];

            const activeLoans =
                loanList.filter(
                    loan =>
                        [
                            'APPROVED',
                            'DISBURSED',
                            'ACTIVE',
                            'OVERDUE',
                            'DEFAULTED',
                            'RESTRUCTURED'
                        ].includes(
                            loan.status
                        )
                );

            const totalOutstanding =
                activeLoans.reduce(
                    (total, loan) =>
                        total +
                        Number(
                            loan.outstandingBalance ||
                            0
                        ),
                    0
                );

            const totalSavings =
                savingsList.reduce(
                    (total, saving) =>
                        total +
                        Number(
                            saving.balance ||
                            saving.currentBalance ||
                            0
                        ),
                    0
                );

            return {

                member,

                accounts:
                    accountList,

                loans:
                    loanList,

                savings:
                    savingsList,

                financialSummary: {

                    accountCount:
                        accountList.length,

                    loanCount:
                        loanList.length,

                    activeLoanCount:
                        activeLoans.length,

                    savingsAccountCount:
                        savingsList.length,

                    totalOutstandingLoanBalance:
                        totalOutstanding,

                    totalSavingsBalance:
                        totalSavings
                },

                generatedAt:
                    new Date().toISOString()
            };

        } catch (error) {

            logger.error(
                'MemberService.getMemberDashboard failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * APPROVE MEMBER
     * ========================================================================
     */

    static async approveMember(
        memberId,
        tenantId,
        user
    ) {

        try {

            this.assertUser(user);

            const member =
                await this.requireMember(
                    memberId,
                    tenantId
                );

            if (
                [
                    MEMBER_STATUS.CLOSED,
                    MEMBER_STATUS.REJECTED
                ].includes(
                    member.status
                )
            ) {
                throw new Error(
                    `Member cannot be approved from status ${member.status}`
                );
            }

            const updatedMember =
                await MemberRepository.updateStatus(
                    memberId,
                    tenantId,
                    MEMBER_STATUS.APPROVED
                );

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.APPROVED,

                entityId:
                    memberId,

                user,

                metadata: {

                    previousStatus:
                        member.status,

                    newStatus:
                        MEMBER_STATUS.APPROVED
                }
            });

            return updatedMember;

        } catch (error) {

            logger.error(
                'MemberService.approveMember failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * SUSPEND MEMBER
     * ========================================================================
     */

    static async suspendMember(
        memberId,
        tenantId,
        reason,
        user
    ) {

        try {

            this.assertUser(user);

            if (
                !reason ||
                String(reason).trim() === ''
            ) {
                throw new Error(
                    'Suspension reason is required'
                );
            }

            const member =
                await this.requireMember(
                    memberId,
                    tenantId
                );

            if (
                member.status ===
                MEMBER_STATUS.CLOSED
            ) {
                throw new Error(
                    'Closed members cannot be suspended'
                );
            }

            const updatedMember =
                await MemberRepository.updateStatus(
                    memberId,
                    tenantId,
                    MEMBER_STATUS.SUSPENDED
                );

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.SUSPENDED,

                entityId:
                    memberId,

                user,

                metadata: {

                    previousStatus:
                        member.status,

                    newStatus:
                        MEMBER_STATUS.SUSPENDED,

                    reason
                }
            });

            return updatedMember;

        } catch (error) {

            logger.error(
                'MemberService.suspendMember failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * ACTIVATE MEMBER
     * ========================================================================
     */

    static async activateMember(
        memberId,
        tenantId,
        user
    ) {

        try {

            this.assertUser(user);

            const member =
                await this.requireMember(
                    memberId,
                    tenantId
                );

            if (
                member.status ===
                MEMBER_STATUS.CLOSED
            ) {
                throw new Error(
                    'Closed members cannot be activated'
                );
            }

            const updatedMember =
                await MemberRepository.updateStatus(
                    memberId,
                    tenantId,
                    MEMBER_STATUS.ACTIVE
                );

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.ACTIVATED,

                entityId:
                    memberId,

                user,

                metadata: {

                    previousStatus:
                        member.status,

                    newStatus:
                        MEMBER_STATUS.ACTIVE
                }
            });

            return updatedMember;

        } catch (error) {

            logger.error(
                'MemberService.activateMember failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * BULK MEMBER IMPORT
     * ========================================================================
     */

    static async bulkImportMembers(
        tenantId,
        members,
        user
    ) {

        try {

            this.assertTenantId(tenantId);
            this.assertUser(user);

            if (
                !Array.isArray(members) ||
                members.length === 0
            ) {
                throw new Error(
                    'Members array is required'
                );
            }

            const normalizedMembers =
                members.map(
                    member => ({

                        ...member,

                        tenantId
                    })
                );

            const imported =
                await MemberRepository.bulkCreate(
                    tenantId,
                    normalizedMembers
                );

            const importedList =
                Array.isArray(imported)
                    ? imported
                    : [];

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.MEMBERS_IMPORTED,

                entityId:
                    null,

                user,

                metadata: {

                    requestedCount:
                        members.length,

                    importedCount:
                        importedList.length,

                    failedCount:
                        Math.max(
                            members.length -
                            importedList.length,
                            0
                        )
                }
            });

            logger.info(
                'Bulk member import completed',
                {
                    tenantId,
                    requested:
                        members.length,
                    imported:
                        importedList.length
                }
            );

            return imported;

        } catch (error) {

            logger.error(
                'MemberService.bulkImportMembers failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * EXPORT MEMBERS
     * ========================================================================
     */

    static async exportMembers(
        tenantId,
        filters = {}
    ) {

        try {

            this.assertTenantId(tenantId);

            const exportFilters = {
                ...filters,

                // Tenant must always be authoritative.
                tenantId
            };

            const data =
                await MemberRepository.export(
                    tenantId,
                    exportFilters
                );

            logger.info(
                'Member export generated',
                {
                    tenantId,
                    records:
                        Array.isArray(data)
                            ? data.length
                            : 0,
                    format:
                        filters?.format ||
                        'JSON'
                }
            );

            return data;

        } catch (error) {

            logger.error(
                'MemberService.exportMembers failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER STATEMENT
     * ========================================================================
     */

    static async generateMemberStatement(
        memberId,
        tenantId
    ) {

        try {

            const [
                member,
                loans,
                savings,
                accounts
            ] = await Promise.all([

                this.requireMember(
                    memberId,
                    tenantId
                ),

                LoanRepository.findByMember(
                    memberId,
                    tenantId
                ),

                SavingsRepository.findByMember(
                    memberId,
                    tenantId
                ),

                AccountRepository.findByMember(
                    memberId,
                    tenantId
                )
            ]);

            return {

                member,

                loans:
                    Array.isArray(loans)
                        ? loans
                        : [],

                savings:
                    Array.isArray(savings)
                        ? savings
                        : [],

                accounts:
                    Array.isArray(accounts)
                        ? accounts
                        : [],

                generatedAt:
                    new Date().toISOString()
            };

        } catch (error) {

            logger.error(
                'MemberService.generateMemberStatement failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER RISK PROFILE
     * ========================================================================
     */

    static async getMemberRiskProfile(
        memberId,
        tenantId
    ) {

        try {

            await this.requireMember(
                memberId,
                tenantId
            );

            if (
                LoanRepository?.getRiskProfile
            ) {

                return await LoanRepository
                    .getRiskProfile(
                        memberId,
                        tenantId
                    );
            }

            if (
                RiskEngineService?.getMemberRiskProfile
            ) {

                return await RiskEngineService
                    .getMemberRiskProfile(
                        memberId,
                        tenantId
                    );
            }

            return null;

        } catch (error) {

            logger.error(
                'MemberService.getMemberRiskProfile failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER CREDIT SCORE
     * ========================================================================
     */

    static async getMemberCreditScore(
        memberId,
        tenantId
    ) {

        try {

            await this.requireMember(
                memberId,
                tenantId
            );

            if (
                CreditScoreService?.calculateScore
            ) {

                return await CreditScoreService
                    .calculateScore(
                        memberId,
                        tenantId
                    );
            }

            if (
                LoanRepository?.calculateCreditScore
            ) {

                return await LoanRepository
                    .calculateCreditScore(
                        memberId,
                        tenantId
                    );
            }

            return null;

        } catch (error) {

            logger.error(
                'MemberService.getMemberCreditScore failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER AUDIT TRAIL
     * ========================================================================
     */

    static async getMemberAuditTrail(
        memberId,
        tenantId
    ) {

        try {

            await this.requireMember(
                memberId,
                tenantId
            );

            return await AuditRepository
                .findByEntity(
                    tenantId,
                    'Member',
                    memberId
                );

        } catch (error) {

            logger.error(
                'MemberService.getMemberAuditTrail failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER KYC STATUS
     * ========================================================================
     */

    static async getMemberKYCStatus(
        memberId,
        tenantId
    ) {

        try {

            const member =
                await this.requireMember(
                    memberId,
                    tenantId
                );

            return {

                memberId,

                kycStatus:
                    member.kycStatus ||
                    KYC_STATUS.PENDING,

                verifiedAt:
                    member.verifiedAt ||
                    null,

                nationalIdVerified:
                    Boolean(
                        member.nationalIdVerified
                    ),

                phoneVerified:
                    Boolean(
                        member.phoneVerified
                    ),

                kycComplete:
                    (
                        member.kycStatus ===
                        KYC_STATUS.VERIFIED
                    ) &&
                    Boolean(
                        member.nationalIdVerified
                    ) &&
                    Boolean(
                        member.phoneVerified
                    )
            };

        } catch (error) {

            logger.error(
                'MemberService.getMemberKYCStatus failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * UPLOAD MEMBER DOCUMENTS
     * ========================================================================
     */

    static async uploadMemberDocuments(
        memberId,
        tenantId,
        documents,
        user
    ) {

        try {

            this.assertMemberId(memberId);
            this.assertTenantId(tenantId);

            if (
                !Array.isArray(documents) ||
                documents.length === 0
            ) {
                throw new Error(
                    'Documents are required'
                );
            }

            await this.requireMember(
                memberId,
                tenantId
            );

            let result;

            if (
                MemberRepository?.attachDocuments
            ) {

                result =
                    await MemberRepository.attachDocuments(
                        memberId,
                        tenantId,
                        documents
                    );

            } else if (
                DocumentRepository?.attachToMember
            ) {

                result =
                    await DocumentRepository.attachToMember(
                        memberId,
                        tenantId,
                        documents
                    );

            } else {

                throw new Error(
                    'Document attachment service is unavailable'
                );
            }

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.DOCUMENTS_UPLOADED,

                entityId:
                    memberId,

                user,

                metadata: {

                    documentCount:
                        documents.length
                }
            });

            return result;

        } catch (error) {

            logger.error(
                'MemberService.uploadMemberDocuments failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * VERIFY NATIONAL ID
     * ========================================================================
     */

    static async verifyNationalId(
        memberId,
        tenantId,
        nationalId,
        user
    ) {

        try {

            await this.requireMember(
                memberId,
                tenantId
            );

            if (
                !nationalId ||
                String(nationalId).trim() === ''
            ) {
                throw new Error(
                    'National ID is required'
                );
            }

            const verified =
                await MemberRepository
                    .verifyNationalId(
                        memberId,
                        tenantId,
                        nationalId
                    );

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.NATIONAL_ID_VERIFIED,

                entityId:
                    memberId,

                user,

                metadata: {

                    verificationResult:
                        Boolean(verified)
                }
            });

            return {

                verified:
                    Boolean(verified)
            };

        } catch (error) {

            logger.error(
                'MemberService.verifyNationalId failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * VERIFY PHONE NUMBER
     * ========================================================================
     */

    static async verifyPhoneNumber(
        memberId,
        tenantId,
        otp,
        user
    ) {

        try {

            await this.requireMember(
                memberId,
                tenantId
            );

            if (
                otp === undefined ||
                otp === null ||
                String(otp).trim() === ''
            ) {
                throw new Error(
                    'OTP is required'
                );
            }

            const verified =
                await MemberRepository
                    .verifyPhoneOTP(
                        memberId,
                        tenantId,
                        otp
                    );

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.PHONE_VERIFIED,

                entityId:
                    memberId,

                user,

                metadata: {

                    verificationResult:
                        Boolean(verified)
                }
            });

            return {

                verified:
                    Boolean(verified)
            };

        } catch (error) {

            logger.error(
                'MemberService.verifyPhoneNumber failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * LINK MOBILE MONEY WALLET
     * ========================================================================
     */

    static async linkMobileMoneyWallet(
        memberId,
        tenantId,
        walletData,
        user
    ) {

        try {

            await this.requireMember(
                memberId,
                tenantId
            );

            if (
                !walletData ||
                typeof walletData !== 'object'
            ) {
                throw new Error(
                    'Wallet data is required'
                );
            }

            let result;

            if (
                MemberRepository?.linkWallet
            ) {

                result =
                    await MemberRepository.linkWallet(
                        memberId,
                        tenantId,
                        walletData
                    );

            } else if (
                WalletRepository?.linkMemberWallet
            ) {

                result =
                    await WalletRepository.linkMemberWallet(
                        memberId,
                        tenantId,
                        walletData
                    );

            } else {

                throw new Error(
                    'Wallet linking service is unavailable'
                );
            }

            await this.audit({

                tenantId,

                action:
                    AUDIT_ACTION.WALLET_LINKED,

                entityId:
                    memberId,

                user,

                metadata: {

                    provider:
                        walletData.provider,

                    channel:
                        walletData.channel
                }
            });

            return result;

        } catch (error) {

            logger.error(
                'MemberService.linkMobileMoneyWallet failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER ACCOUNTS
     * ========================================================================
     */

    static async getMemberAccounts(
        memberId,
        tenantId
    ) {

        try {

            await this.requireMember(
                memberId,
                tenantId
            );

            return await AccountRepository
                .findByMember(
                    memberId,
                    tenantId
                );

        } catch (error) {

            logger.error(
                'MemberService.getMemberAccounts failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER LOANS
     * ========================================================================
     */

    static async getMemberLoans(
        memberId,
        tenantId
    ) {

        try {

            await this.requireMember(
                memberId,
                tenantId
            );

            return await LoanRepository
                .findByMember(
                    memberId,
                    tenantId
                );

        } catch (error) {

            logger.error(
                'MemberService.getMemberLoans failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER SAVINGS
     * ========================================================================
     */

    static async getMemberSavings(
        memberId,
        tenantId
    ) {

        try {

            await this.requireMember(
                memberId,
                tenantId
            );

            return await SavingsRepository
                .findByMember(
                    memberId,
                    tenantId
                );

        } catch (error) {

            logger.error(
                'MemberService.getMemberSavings failed',
                {
                    memberId,
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER ANALYTICS
     * ========================================================================
     */

    static async getAnalytics(
        tenantId
    ) {

        try {

            this.assertTenantId(tenantId);

            const [
                totalMembers,
                activeMembers,
                verifiedMembers,
                dormantMembers
            ] = await Promise.all([

                MemberRepository.count({
                    tenantId
                }),

                MemberRepository.countActive({
                    tenantId
                }),

                MemberRepository.countVerified({
                    tenantId
                }),

                MemberRepository.countDormant({
                    tenantId
                })
            ]);

            const total =
                Number(totalMembers || 0);

            const active =
                Number(activeMembers || 0);

            const verified =
                Number(verifiedMembers || 0);

            const dormant =
                Number(dormantMembers || 0);

            return {

                tenantId,

                totalMembers:
                    total,

                activeMembers:
                    active,

                verifiedMembers:
                    verified,

                dormantMembers:
                    dormant,

                inactiveMembers:
                    Math.max(
                        total -
                        active,
                        0
                    ),

                activeRate:
                    total > 0
                        ? Number(
                            (
                                (
                                    active /
                                    total
                                ) *
                                100
                            ).toFixed(2)
                        )
                        : 0,

                verificationRate:
                    total > 0
                        ? Number(
                            (
                                (
                                    verified /
                                    total
                                ) *
                                100
                            ).toFixed(2)
                        )
                        : 0,

                generatedAt:
                    new Date().toISOString()
            };

        } catch (error) {

            logger.error(
                'MemberService.getAnalytics failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }


    /**
     * ========================================================================
     * MEMBER GROWTH REPORT
     * ========================================================================
     */

    static async getGrowthReport(
        tenantId
    ) {

        try {

            this.assertTenantId(tenantId);

            const [
                monthlyGrowth,
                demographics,
                branchDistribution
            ] = await Promise.all([

                MemberRepository.getGrowthTrend({
                    tenantId
                }),

                MemberRepository.getDemographics({
                    tenantId
                }),

                MemberRepository.getBranchDistribution({
                    tenantId
                })
            ]);

            return {

                tenantId,

                monthlyGrowth:
                    monthlyGrowth || [],

                demographics:
                    demographics || [],

                branchDistribution:
                    branchDistribution || [],

                generatedAt:
                    new Date().toISOString()
            };

        } catch (error) {

            logger.error(
                'MemberService.getGrowthReport failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }
}


/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports = MemberService;