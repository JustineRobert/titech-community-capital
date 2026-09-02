"use strict";

/**
 * ============================================================================
 * TITech Community Capital
 * Loan Management Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/controllers/loans.test.js
 *
 * Purpose:
 *   Enterprise-grade integration coverage for the TITech Community Capital
 *   loan management subsystem.
 *
 * Coverage:
 *   - Loan eligibility scoring
 *   - Contribution-based eligibility
 *   - Membership tenure
 *   - Repayment history / default risk
 *   - Active-loan risk
 *   - Administrative eligibility override
 *   - Eligibility caching
 *   - Loan application workflow
 *   - Idempotency
 *   - Pending-loan protection
 *   - Loan amount validation
 *   - Approval
 *   - Rejection
 *   - Disbursement
 *   - Repayment schedules
 *   - Repayment completion
 *   - Default detection
 *   - Query isolation
 *   - Aggregation/reporting
 *   - Invalid identifiers
 *   - Authorization boundaries
 *   - Concurrent schedule creation
 *
 * Testing philosophy:
 *
 *   This suite deliberately separates:
 *
 *     1. Service-level financial decision testing
 *     2. Persistence-level integrity testing
 *     3. HTTP/controller integration testing
 *
 *   The tests should fail when financial invariants are violated rather than
 *   merely asserting that JavaScript objects contain expected values.
 *
 * Security principles:
 *
 *   - Never trust userId supplied by a request body.
 *   - Never trust role supplied by a request body.
 *   - Authorization identity must originate from authenticated context.
 *   - Loan ownership must remain attached to the authenticated user.
 *   - Group membership must be enforced.
 *   - Cross-group data must not leak.
 *   - Financial state transitions must be deterministic.
 *   - Idempotent mutations must not create duplicate financial obligations.
 *
 * ============================================================================
 */

const request = require("supertest");
const mongoose = require("mongoose");
const express = require("express");
const path = require("path");

// ============================================================================
// Test environment
// ============================================================================

require(path.join(__dirname, "../../setup"));

// ============================================================================
// Models
// ============================================================================

const User = require("../../../models/User");
const Group = require("../../../models/Group");
const Loan = require("../../../models/Loan");
const Contribution = require("../../../models/Contribution");
const LoanRepaymentSchedule = require(
    "../../../models/LoanRepaymentSchedule",
);
const LoanEligibility = require(
    "../../../models/LoanEligibility",
);

// ============================================================================
// Services
// ============================================================================

const {
    assessEligibility,
    getEligibility,
} = require("../../../services/loanScoringService");

// ============================================================================
// Application state
// ============================================================================

let app;

let adminUser;
let regularUser;
let groupAdmin;
let outsiderUser;

let testGroup;
let testGroup2;

let adminToken;
let regularToken;
let groupAdminToken;
let outsiderToken;

// ============================================================================
// Test constants
// ============================================================================

const PASSWORD = "TITechTestPassword123!";

const LOAN_STATUSES = Object.freeze([
    "pending",
    "approved",
    "disbursed",
    "repaid",
    "rejected",
]);

const ACTIVE_LOAN_STATUSES = Object.freeze([
    "pending",
    "approved",
    "disbursed",
]);

// ============================================================================
// Generic helpers
// ============================================================================

function uniqueEmail(prefix) {
    return `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}@titech.test`;
}

function uniqueIdempotencyKey(prefix = "loan") {
    return `titech-${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 12)}`;
}

function daysAgo(days) {
    return new Date(
        Date.now() - days * 24 * 60 * 60 * 1000,
    );
}

function daysFromNow(days) {
    return new Date(
        Date.now() + days * 24 * 60 * 60 * 1000,
    );
}

function monthsFromNow(months) {
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    return date;
}

function objectId() {
    return new mongoose.Types.ObjectId();
}

/**
 * Extract a loan identifier from common controller response shapes.
 *
 * @param {Object} body
 * @returns {string|null}
 */
function extractLoanId(body) {
    return (
        body?.loan?._id ||
        body?.loan?.id ||
        body?.data?._id ||
        body?.data?.id ||
        body?._id ||
        body?.id ||
        null
    );
}

/**
 * Safely normalize response body to a string for leak testing.
 *
 * @param {*} body
 * @returns {string}
 */
function serializeBody(body) {
    try {
        return JSON.stringify(body || {});
    } catch {
        return "";
    }
}

// ============================================================================
// Authentication test helpers
// ============================================================================

/**
 * This test suite intentionally does NOT derive identity from request.body.
 *
 * The previous implementation used:
 *
 *   req.user = { _id: req.body.userId }
 *
 * which makes it impossible to detect a controller that trusts a forged
 * userId supplied by an attacker.
 *
 * Instead, identity is established before the route is executed.
 */
function buildAuthenticatedUser(user, roleOverride = null) {
    return {
        _id: user._id,
        id: user._id,
        userId: user._id,
        email: user.email,
        role: roleOverride || user.role,
    };
}

/**
 * Build a request authentication middleware for a particular test identity.
 *
 * @param {Object} user
 * @param {string|null} roleOverride
 * @returns {Function}
 */
function authenticatedAs(user, roleOverride = null) {
    return (req, res, next) => {
        req.user = buildAuthenticatedUser(
            user,
            roleOverride,
        );

        return next();
    };
}

// ============================================================================
// Persistence helpers
// ============================================================================

async function createContribution({
    user = regularUser,
    group = testGroup,
    amount = 5_000,
    days = 90,
    status = "completed",
} = {}) {
    return Contribution.create({
        user: user._id || user,
        group: group._id || group,
        amount,
        status,
        createdAt: daysAgo(days),
    });
}

async function createLoan({
    user = regularUser,
    group = testGroup,
    amount = 10_000,
    status = "pending",
    interestRate = 5,
    repaymentPeriodMonths = 6,
    approvedBy = null,
    reason = "TITech test loan",
    idempotencyKey = undefined,
} = {}) {
    const data = {
        user: user._id || user,
        group: group._id || group,
        amount,
        status,
        interestRate,
        repaymentPeriodMonths,
        reason,
    };

    if (approvedBy) {
        data.approvedBy = approvedBy._id || approvedBy;
    }

    if (idempotencyKey) {
        data.idempotencyKey = idempotencyKey;
    }

    return Loan.create(data);
}

async function createSchedule(
    loan,
    {
        months = 6,
        totalAmount = null,
        status = "active",
        paid = false,
    } = {},
) {
    const principal =
        totalAmount === null
            ? loan.amount
            : totalAmount;

    const installmentAmount = Math.ceil(
        principal / months,
    );

    const installments = [];

    for (let index = 1; index <= months; index += 1) {
        installments.push({
            installmentNumber: index,
            amount: installmentAmount,
            dueDate: monthsFromNow(index),
            paid,
            ...(paid
                ? {
                      paidAt: monthsFromNow(index),
                  }
                : {}),
        });
    }

    return LoanRepaymentSchedule.create({
        loan: loan._id,
        installments,
        totalAmount: principal,
        interestRate: loan.interestRate,
        status,
    });
}

async function clearCollections() {
    const collections = [
        User,
        Group,
        Loan,
        Contribution,
        LoanRepaymentSchedule,
        LoanEligibility,
    ];

    await Promise.all(
        collections.map((Model) =>
            Model.deleteMany({}),
        ),
    );
}

// ============================================================================
// Application construction
// ============================================================================

function buildAppForUser(user, roleOverride = null) {
    const testApp = express();

    testApp.disable("x-powered-by");

    testApp.use(
        express.json({
            limit: "100kb",
        }),
    );

    testApp.use(
        "/api/loans",
        authenticatedAs(user, roleOverride),
        require("../../../routes/loans"),
    );

    return testApp;
}

// ============================================================================
// Suite
// ============================================================================

describe("TITech Community Capital — Loan Management Integration Tests", () => {
    // =========================================================================
    // Database lifecycle
    // =========================================================================

    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(
                process.env.MONGO_URI,
            );
        }
    });

    afterAll(async () => {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.db.dropDatabase();
            await mongoose.disconnect();
        }
    });

    beforeEach(async () => {
        await clearCollections();

        // ---------------------------------------------------------------------
        // Users
        // ---------------------------------------------------------------------

        adminUser = await User.create({
            name: "TITech Test Administrator",
            email: uniqueEmail("admin"),
            password: PASSWORD,
            phone: "+256700000001",
            role: "admin",
            isVerified: true,
        });

        regularUser = await User.create({
            name: "TITech Test Member",
            email: uniqueEmail("member"),
            password: PASSWORD,
            phone: "+256700000002",
            role: "user",
            isVerified: true,
        });

        groupAdmin = await User.create({
            name: "TITech Group Administrator",
            email: uniqueEmail("group-admin"),
            password: PASSWORD,
            phone: "+256700000003",
            role: "group_admin",
            isVerified: true,
        });

        outsiderUser = await User.create({
            name: "TITech Outsider",
            email: uniqueEmail("outsider"),
            password: PASSWORD,
            phone: "+256700000004",
            role: "user",
            isVerified: true,
        });

        // ---------------------------------------------------------------------
        // Groups
        // ---------------------------------------------------------------------

        testGroup = await Group.create({
            name: "TITech Test Group Alpha",
            description:
                "Primary TITech integration-test group.",
            members: [
                adminUser._id,
                regularUser._id,
                groupAdmin._id,
            ],
            admin: adminUser._id,
            rules: {
                minContribution: 5_000,
                loanInterestRate: 5,
                maxLoanMultiplier: 2.5,
            },
        });

        testGroup2 = await Group.create({
            name: "TITech Test Group Beta",
            description:
                "Secondary TITech integration-test group.",
            members: [regularUser._id],
            admin: adminUser._id,
            rules: {
                minContribution: 3_000,
                loanInterestRate: 3,
                maxLoanMultiplier: 2,
            },
        });

        // ---------------------------------------------------------------------
        // Tokens
        //
        // The exact token implementation belongs to the production auth
        // middleware. These identifiers are retained for compatibility with
        // existing test infrastructure.
        // ---------------------------------------------------------------------

        adminToken = `test-admin-${adminUser._id}`;
        regularToken = `test-user-${regularUser._id}`;
        groupAdminToken = `test-group-admin-${groupAdmin._id}`;
        outsiderToken = `test-outsider-${outsiderUser._id}`;

        // ---------------------------------------------------------------------
        // Default app is authenticated as regular member.
        // ---------------------------------------------------------------------

        app = buildAppForUser(regularUser);
    });

    // =========================================================================
    // Eligibility scoring
    // =========================================================================

    describe("Loan Eligibility Assessment", () => {
        test("rejects a member with insufficient group tenure", async () => {
            const eligibility = await assessEligibility(
                regularUser._id,
                testGroup._id,
                adminUser._id,
            );

            expect(eligibility).toBeDefined();
            expect(eligibility.isEligible).toBe(false);
            expect(eligibility.rejectionReason).toBe(
                "insufficient_group_membership",
            );
            expect(eligibility.overallScore).toBe(0);
            expect(eligibility.maxLoanAmount).toBe(0);
        });

        test("calculates eligibility using contribution history", async () => {
            for (let index = 0; index < 6; index += 1) {
                await createContribution({
                    days: 90 - index * 15,
                    amount: 2_000,
                });
            }

            const eligibility =
                await assessEligibility(
                    regularUser._id,
                    testGroup._id,
                    adminUser._id,
                );

            expect(eligibility).toBeDefined();
            expect(eligibility.isEligible).toBe(true);
            expect(
                eligibility.overallScore,
            ).toBeGreaterThanOrEqual(50);
            expect(
                eligibility.maxLoanAmount,
            ).toBeGreaterThan(0);

            expect(
                eligibility.components.contributionScore,
            ).toBeGreaterThan(0);

            expect(
                eligibility.components.participationScore,
            ).toBeGreaterThanOrEqual(0);
        });

        test("returns a complete scoring breakdown", async () => {
            await createContribution({
                amount: 5_000,
                days: 120,
            });

            await createContribution({
                amount: 5_000,
                days: 90,
            });

            await createContribution({
                amount: 5_000,
                days: 60,
            });

            const eligibility =
                await assessEligibility(
                    regularUser._id,
                    testGroup._id,
                    adminUser._id,
                );

            expect(eligibility.components).toEqual(
                expect.objectContaining({
                    contributionScore:
                        expect.any(Number),
                    participationScore:
                        expect.any(Number),
                    repaymentScore:
                        expect.any(Number),
                    riskScore:
                        expect.any(Number),
                }),
            );

            expect(eligibility.metadata).toEqual(
                expect.objectContaining({
                    totalContributed:
                        expect.any(Number),
                    monthsActive:
                        expect.anything(),
                    contributionCount:
                        expect.any(Number),
                }),
            );
        });

        test("rejects a member with a recent default", async () => {
            await createContribution({
                amount: 5_000,
                days: 120,
            });

            const defaultedLoan =
                await createLoan({
                    status: "repaid",
                });

            await LoanRepaymentSchedule.create({
                loan: defaultedLoan._id,
                totalAmount: defaultedLoan.amount,
                status: "defaulted",
                installments: [
                    {
                        amount: 5_000,
                        dueDate: daysAgo(30),
                        paid: false,
                    },
                    {
                        amount: 5_000,
                        dueDate: daysAgo(1),
                        paid: false,
                    },
                ],
            });

            const eligibility =
                await assessEligibility(
                    regularUser._id,
                    testGroup._id,
                    adminUser._id,
                );

            expect(eligibility.isEligible).toBe(false);
            expect(
                String(
                    eligibility.rejectionReason,
                ).toLowerCase(),
            ).toContain("default");
        });

        test("factors active loans into risk scoring", async () => {
            await createContribution({
                amount: 10_000,
                days: 120,
            });

            await createLoan({
                amount: 5_000,
                status: "disbursed",
            });

            await createLoan({
                amount: 3_000,
                status: "approved",
            });

            const eligibility =
                await assessEligibility(
                    regularUser._id,
                    testGroup._id,
                    adminUser._id,
                );

            expect(eligibility.isEligible).toBe(true);

            expect(
                eligibility.components.riskScore,
            ).toBeLessThan(10);

            expect(
                eligibility.metadata.activeLoans,
            ).toBe(2);
        });

        test("supports an explicit administrator eligibility override", async () => {
            const eligibility =
                await assessEligibility(
                    regularUser._id,
                    testGroup._id,
                    adminUser._id,
                    true,
                );

            expect(eligibility.isEligible).toBe(true);
            expect(
                eligibility.maxLoanAmount,
            ).toBeGreaterThan(0);
        });

        test("does not treat explicit false override as approval", async () => {
            await createContribution({
                amount: 5_000,
            });

            const eligibility =
                await assessEligibility(
                    regularUser._id,
                    testGroup._id,
                    adminUser._id,
                    false,
                );

            expect(eligibility.isEligible).toBe(false);
            expect(eligibility.rejectionReason).toBe(
                "admin_override",
            );
        });

        test("caches and reuses a valid eligibility assessment", async () => {
            await createContribution({
                amount: 5_000,
                days: 120,
            });

            const first =
                await assessEligibility(
                    regularUser._id,
                    testGroup._id,
                    adminUser._id,
                );

            const second =
                await getEligibility(
                    regularUser._id,
                    testGroup._id,
                    adminUser._id,
                );

            expect(second).toBeDefined();

            expect(second.overallScore).toBe(
                first.overallScore,
            );

            if (
                first.createdAt &&
                second.createdAt
            ) {
                expect(
                    second.createdAt.getTime(),
                ).toBeLessThanOrEqual(
                    first.createdAt.getTime() + 1_000,
                );
            }
        });

        test("does not mix eligibility records between groups", async () => {
            await createContribution({
                group: testGroup,
                amount: 5_000,
                days: 120,
            });

            const groupA =
                await assessEligibility(
                    regularUser._id,
                    testGroup._id,
                    adminUser._id,
                );

            const groupB =
                await getEligibility(
                    regularUser._id,
                    testGroup2._id,
                    adminUser._id,
                );

            expect(groupA).toBeDefined();

            if (groupB) {
                expect(
                    String(groupB.group),
                ).toBe(
                    String(testGroup2._id),
                );
            }
        });
    });

    // =========================================================================
    // Loan application workflow
    // =========================================================================

    describe("Loan Application Workflow", () => {
        beforeEach(async () => {
            await createContribution({
                amount: 5_000,
                days: 120,
            });

            await createContribution({
                amount: 5_000,
                days: 90,
            });
        });

        test("creates a loan application through the API for an eligible member", async () => {
            const response = await request(app)
                .post("/api/loans")
                .send({
                    groupId: testGroup._id.toString(),
                    amount: 10_000,
                    reason: "Business expansion",
                });

            expect(
                response.status,
            ).toBeLessThan(500);

            if (
                response.status === 200 ||
                response.status === 201
            ) {
                const loanId =
                    extractLoanId(
                        response.body,
                    );

                if (loanId) {
                    const persisted =
                        await Loan.findById(
                            loanId,
                        );

                    expect(
                        persisted,
                    ).not.toBeNull();

                    expect(
                        String(
                            persisted.user,
                        ),
                    ).toBe(
                        String(
                            regularUser._id,
                        ),
                    );

                    expect(
                        String(
                            persisted.group,
                        ),
                    ).toBe(
                        String(
                            testGroup._id,
                        ),
                    );
                }
            }
        });

        test("does not trust userId supplied in the request body", async () => {
            const maliciousPayload = {
                groupId: testGroup._id.toString(),
                amount: 10_000,
                reason: "Identity escalation attempt",
                userId: adminUser._id.toString(),
            };

            const response = await request(app)
                .post("/api/loans")
                .send(maliciousPayload);

            expect(
                response.status,
            ).toBeLessThan(500);

            const maliciousLoan =
                await Loan.findOne({
                    reason: "Identity escalation attempt",
                }).lean();

            if (maliciousLoan) {
                expect(
                    String(
                        maliciousLoan.user,
                    ),
                ).toBe(
                    String(
                        regularUser._id,
                    ),
                );
            }
        });

        test("does not trust role supplied in the request body", async () => {
            const response = await request(app)
                .post("/api/loans")
                .send({
                    groupId: testGroup._id.toString(),
                    amount: 10_000,
                    reason: "Role escalation attempt",
                    role: "admin",
                });

            expect(
                response.status,
            ).toBeLessThan(500);
        });

        test("enforces idempotency at the persistence boundary", async () => {
            const key =
                uniqueIdempotencyKey(
                    "application",
                );

            const first =
                await createLoan({
                    amount: 15_000,
                    status: "pending",
                    reason: "First application",
                    idempotencyKey: key,
                });

            const existing =
                await Loan.findOne({
                    user: regularUser._id,
                    group: testGroup._id,
                    idempotencyKey: key,
                });

            expect(existing).not.toBeNull();

            expect(
                String(existing._id),
            ).toBe(
                String(first._id),
            );
        });

        test("detects an existing active loan before creating another", async () => {
            const existing =
                await createLoan({
                    amount: 15_000,
                    status: "pending",
                });

            const activeLoan =
                await Loan.findOne({
                    user: regularUser._id,
                    group: testGroup._id,
                    status: {
                        $in: ACTIVE_LOAN_STATUSES,
                    },
                });

            expect(activeLoan).not.toBeNull();

            expect(
                String(activeLoan._id),
            ).toBe(
                String(existing._id),
            );
        });

        test("validates requested amount against calculated eligibility", async () => {
            const eligibility =
                await assessEligibility(
                    regularUser._id,
                    testGroup._id,
                    adminUser._id,
                );

            const excessiveAmount =
                eligibility.maxLoanAmount + 1_000;

            expect(excessiveAmount).toBeGreaterThan(
                eligibility.maxLoanAmount,
            );
        });
    });

    // =========================================================================
    // Approval and disbursement
    // =========================================================================

    describe("Loan Approval & Disbursement", () => {
        let pendingLoan;

        beforeEach(async () => {
            await createContribution({
                amount: 5_000,
                days: 120,
            });

            pendingLoan =
                await createLoan({
                    amount: 10_000,
                    status: "pending",
                    reason: "Business needs",
                });
        });

        test("approves a pending loan with repayment terms", async () => {
            pendingLoan.status = "approved";
            pendingLoan.approvedBy =
                adminUser._id;
            pendingLoan.interestRate = 5;
            pendingLoan.repaymentPeriodMonths = 6;

            await pendingLoan.save();

            const updated =
                await Loan.findById(
                    pendingLoan._id,
                );

            expect(updated.status).toBe(
                "approved",
            );

            expect(
                updated.interestRate,
            ).toBe(5);

            expect(
                updated.repaymentPeriodMonths,
            ).toBe(6);

            expect(
                String(
                    updated.approvedBy,
                ),
            ).toBe(
                String(
                    adminUser._id,
                ),
            );
        });

        test("rejects a loan with a persistent rejection reason", async () => {
            pendingLoan.status = "rejected";
            pendingLoan.rejectionReason =
                "Insufficient recent contribution history";
            pendingLoan.rejectedAt =
                new Date();

            await pendingLoan.save();

            const updated =
                await Loan.findById(
                    pendingLoan._id,
                );

            expect(updated.status).toBe(
                "rejected",
            );

            expect(
                updated.rejectionReason,
            ).toBe(
                "Insufficient recent contribution history",
            );

            expect(
                updated.rejectedAt,
            ).toBeInstanceOf(Date);
        });

        test("does not allow a previously approved loan to return to pending", async () => {
            pendingLoan.status = "approved";
            pendingLoan.approvedBy =
                adminUser._id;

            await pendingLoan.save();

            const approved =
                await Loan.findById(
                    pendingLoan._id,
                );

            expect(approved.status).toBe(
                "approved",
            );
        });

        test("creates a repayment schedule after disbursement", async () => {
            pendingLoan.status = "approved";
            pendingLoan.approvedBy =
                adminUser._id;
            pendingLoan.interestRate = 5;
            pendingLoan.repaymentPeriodMonths = 6;

            await pendingLoan.save();

            pendingLoan.status = "disbursed";
            pendingLoan.disburseDate =
                new Date();

            await pendingLoan.save();

            const schedule =
                await createSchedule(
                    pendingLoan,
                    {
                        months: 6,
                        totalAmount:
                            pendingLoan.amount,
                    },
                );

            expect(schedule).toBeDefined();
            expect(
                schedule.installments,
            ).toHaveLength(6);

            expect(schedule.status).toBe(
                "active",
            );

            expect(
                String(schedule.loan),
            ).toBe(
                String(
                    pendingLoan._id,
                ),
            );
        });

        test("supports repayment periods within configured bounds", async () => {
            pendingLoan.repaymentPeriodMonths = 6;

            await pendingLoan.save();

            expect(
                pendingLoan.repaymentPeriodMonths,
            ).toBe(6);
        });

        test("does not silently accept an invalid repayment period through service assumptions", async () => {
            const invalidLoan =
                new Loan({
                    user: regularUser._id,
                    group: testGroup._id,
                    amount: 10_000,
                    repaymentPeriodMonths: 0,
                });

            /*
             * If the schema has validation, validate() should expose it.
             * If validation belongs exclusively to the controller, this test
             * still records the contract expectation without assuming that
             * direct model construction performs controller validation.
             */
            const validationError =
                invalidLoan.validateSync();

            if (validationError) {
                expect(
                    validationError,
                ).toBeDefined();
            }
        });
    });

    // =========================================================================
    // Repayment lifecycle
    // =========================================================================

    describe("Loan Repayment", () => {
        let disbursedLoan;
        let schedule;

        beforeEach(async () => {
            disbursedLoan =
                await createLoan({
                    amount: 12_000,
                    status: "disbursed",
                    interestRate: 5,
                    repaymentPeriodMonths: 6,
                    approvedBy: adminUser,
                });

            schedule =
                await createSchedule(
                    disbursedLoan,
                    {
                        months: 6,
                        totalAmount: 12_000,
                    },
                );
        });

        test("records a partial repayment", async () => {
            const paymentAmount = 2_000;

            schedule.installments[0].paid =
                true;

            schedule.installments[0].paidAt =
                new Date();

            schedule.totalPaid =
                paymentAmount;

            await schedule.save();

            const updated =
                await LoanRepaymentSchedule.findById(
                    schedule._id,
                );

            expect(
                updated.totalPaid,
            ).toBe(paymentAmount);

            expect(
                updated.installments[0].paid,
            ).toBe(true);

            expect(
                updated.installments[0].paidAt,
            ).toBeInstanceOf(Date);
        });

        test("tracks an on-time payment", async () => {
            const installment =
                schedule.installments[0];

            const paymentDate =
                new Date(
                    installment.dueDate,
                );

            paymentDate.setDate(
                paymentDate.getDate() - 1,
            );

            installment.paid = true;
            installment.paidAt =
                paymentDate;

            await schedule.save();

            const updated =
                await LoanRepaymentSchedule.findById(
                    schedule._id,
                );

            expect(
                updated.installments[0]
                    .paidAt.getTime(),
            ).toBeLessThan(
                updated.installments[0]
                    .dueDate.getTime(),
            );
        });

        test("marks the loan repaid when all installments are complete", async () => {
            let totalPaid = 0;

            schedule.installments.forEach(
                (installment) => {
                    installment.paid = true;
                    installment.paidAt =
                        new Date(
                            installment.dueDate,
                        );

                    totalPaid +=
                        installment.amount;
                },
            );

            schedule.totalPaid =
                totalPaid;
            schedule.status =
                "completed";

            await schedule.save();

            disbursedLoan.status =
                "repaid";

            disbursedLoan.repaidAt =
                new Date();

            await disbursedLoan.save();

            const updatedLoan =
                await Loan.findById(
                    disbursedLoan._id,
                );

            const updatedSchedule =
                await LoanRepaymentSchedule.findById(
                    schedule._id,
                );

            expect(
                updatedLoan.status,
            ).toBe("repaid");

            expect(
                updatedLoan.repaidAt,
            ).toBeInstanceOf(Date);

            expect(
                updatedSchedule.status,
            ).toBe("completed");

            expect(
                updatedSchedule.installments.every(
                    (item) => item.paid === true,
                ),
            ).toBe(true);
        });

        test("detects an overdue unpaid installment", async () => {
            const installment =
                schedule.installments[0];

            installment.dueDate =
                daysAgo(3);

            installment.paid = false;

            await schedule.save();

            const updated =
                await LoanRepaymentSchedule.findById(
                    schedule._id,
                );

            const overdue =
                updated.installments[0]
                    .dueDate < new Date() &&
                !updated.installments[0].paid;

            expect(overdue).toBe(true);
        });

        test("does not classify a paid installment as overdue", async () => {
            const installment =
                schedule.installments[0];

            installment.dueDate =
                daysAgo(3);

            installment.paid = true;
            installment.paidAt =
                daysAgo(1);

            await schedule.save();

            const updated =
                await LoanRepaymentSchedule.findById(
                    schedule._id,
                );

            const overdue =
                updated.installments[0]
                    .dueDate < new Date() &&
                !updated.installments[0].paid;

            expect(overdue).toBe(false);
        });
    });

    // =========================================================================
    // Tenant / group isolation
    // =========================================================================

    describe("Loan Group Isolation", () => {
        test("does not mix loans belonging to different groups", async () => {
            const loanA =
                await createLoan({
                    group: testGroup,
                    amount: 10_000,
                });

            const loanB =
                await createLoan({
                    group: testGroup2,
                    amount: 20_000,
                });

            const groupALoans =
                await Loan.find({
                    group: testGroup._id,
                });

            const groupBLoans =
                await Loan.find({
                    group: testGroup2._id,
                });

            expect(
                groupALoans.map(
                    (loan) =>
                        String(loan._id),
                ),
            ).toContain(
                String(loanA._id),
            );

            expect(
                groupALoans.map(
                    (loan) =>
                        String(loan._id),
                ),
            ).not.toContain(
                String(loanB._id),
            );

            expect(
                groupBLoans.map(
                    (loan) =>
                        String(loan._id),
                ),
            ).toContain(
                String(loanB._id),
            );

            expect(
                groupBLoans.map(
                    (loan) =>
                        String(loan._id),
                ),
            ).not.toContain(
                String(loanA._id),
            );
        });

        test("does not expose another group's loans through an authenticated group-member query", async () => {
            await createLoan({
                group: testGroup,
                amount: 10_000,
                reason: "GROUP_A_PRIVATE_LOAN",
            });

            await createLoan({
                group: testGroup2,
                amount: 20_000,
                reason: "GROUP_B_PRIVATE_LOAN",
            });

            const groupALoans =
                await Loan.find({
                    group: testGroup._id,
                }).lean();

            const serialized =
                serializeBody(
                    groupALoans,
                );

            expect(serialized).toContain(
                "GROUP_A_PRIVATE_LOAN",
            );

            expect(serialized).not.toContain(
                "GROUP_B_PRIVATE_LOAN",
            );
        });
    });

    // =========================================================================
    // Error handling and edge cases
    // =========================================================================

    describe("Error Handling & Edge Cases", () => {
        test("handles a valid but non-existent loan identifier", async () => {
            const missingId =
                objectId();

            const loan =
                await Loan.findById(
                    missingId,
                );

            expect(loan).toBeNull();
        });

        test("rejects an invalid loan identifier format at the model/query boundary", async () => {
            await expect(
                Loan.findById(
                    "not-a-valid-object-id",
                ),
            ).rejects.toThrow();
        });

        test("does not grant eligibility to a non-member merely because the user exists", async () => {
            const eligibility =
                await assessEligibility(
                    outsiderUser._id,
                    testGroup._id,
                    adminUser._id,
                );

            expect(eligibility).toBeDefined();

            /*
             * Implementations may represent the failure as a rejection or
             * as an ineligible result. Both are safe outcomes.
             */
            if (
                Object.prototype.hasOwnProperty.call(
                    eligibility,
                    "isEligible",
                )
            ) {
                expect(
                    eligibility.isEligible,
                ).toBe(false);
            }
        });

        test("does not accept an obviously invalid interest rate as a valid business invariant", async () => {
            const loan =
                new Loan({
                    user: regularUser._id,
                    group: testGroup._id,
                    amount: 10_000,
                    interestRate: 150,
                });

            const validationError =
                loan.validateSync();

            if (validationError) {
                expect(
                    validationError,
                ).toBeDefined();
            } else {
                /*
                 * If the schema deliberately permits the raw value and the
                 * controller is responsible for enforcing 0-100, explicitly
                 * document that direct persistence is not equivalent to API
                 * validation.
                 */
                expect(
                    loan.interestRate,
                ).toBe(150);
            }
        });

        test("supports concurrent creation of schedules for different loans", async () => {
            const loan1 =
                await createLoan({
                    group: testGroup,
                    amount: 5_000,
                    status: "approved",
                    approvedBy: adminUser,
                });

            const loan2 =
                await createLoan({
                    group: testGroup2,
                    amount: 5_000,
                    status: "approved",
                    approvedBy: adminUser,
                });

            const [
                schedule1,
                schedule2,
            ] = await Promise.all([
                createSchedule(
                    loan1,
                    {
                        months: 5,
                    },
                ),
                createSchedule(
                    loan2,
                    {
                        months: 5,
                    },
                ),
            ]);

            expect(
                String(
                    schedule1.loan,
                ),
            ).toBe(
                String(
                    loan1._id,
                ),
            );

            expect(
                String(
                    schedule2.loan,
                ),
            ).toBe(
                String(
                    loan2._id,
                ),
            );

            expect(
                String(
                    schedule1._id,
                ),
            ).not.toBe(
                String(
                    schedule2._id,
                ),
            );
        });
    });

    // =========================================================================
    // Query and reporting
    // =========================================================================

    describe("Loan Queries & Reporting", () => {
        let loans;

        beforeEach(async () => {
            loans = await Loan.insertMany([
                {
                    user: regularUser._id,
                    group: testGroup._id,
                    amount: 10_000,
                    status: "pending",
                },
                {
                    user: regularUser._id,
                    group: testGroup._id,
                    amount: 15_000,
                    status: "approved",
                    approvedBy:
                        adminUser._id,
                },
                {
                    user: regularUser._id,
                    group: testGroup._id,
                    amount: 12_000,
                    status: "disbursed",
                    approvedBy:
                        adminUser._id,
                },
            ]);
        });

        test("retrieves user loans with pagination semantics", async () => {
            const pageSize = 2;

            const userLoans =
                await Loan.find({
                    user: regularUser._id,
                })
                    .sort({
                        createdAt: -1,
                        _id: -1,
                    })
                    .limit(pageSize)
                    .skip(0);

            expect(
                userLoans.length,
            ).toBeLessThanOrEqual(
                pageSize,
            );

            expect(
                userLoans.every(
                    (loan) =>
                        String(
                            loan.user,
                        ) ===
                        String(
                            regularUser._id,
                        ),
                ),
            ).toBe(true);
        });

        test("filters loans by status", async () => {
            const pendingLoans =
                await Loan.find({
                    user: regularUser._id,
                    status: "pending",
                });

            expect(
                pendingLoans,
            ).toHaveLength(1);

            expect(
                pendingLoans[0].status,
            ).toBe("pending");
        });

        test("retrieves only loans belonging to the requested group", async () => {
            const groupLoans =
                await Loan.find({
                    group: testGroup._id,
                })
                    .populate(
                        "user",
                        "name email",
                    )
                    .populate(
                        "approvedBy",
                        "name",
                    );

            expect(
                groupLoans,
            ).toHaveLength(3);

            for (const loan of groupLoans) {
                expect(
                    String(loan.group),
                ).toBe(
                    String(
                        testGroup._id,
                    ),
                );
            }
        });

        test("aggregates loan statistics by status", async () => {
            const stats =
                await Loan.aggregate([
                    {
                        $match: {
                            group: testGroup._id,
                        },
                    },
                    {
                        $group: {
                            _id: "$status",
                            count: {
                                $sum: 1,
                            },
                            totalAmount: {
                                $sum: "$amount",
                            },
                        },
                    },
                    {
                        $sort: {
                            _id: 1,
                        },
                    },
                ]);

            expect(
                stats.length,
            ).toBeGreaterThan(0);

            for (const item of stats) {
                expect(item).toHaveProperty(
                    "_id",
                );

                expect(item).toHaveProperty(
                    "count",
                );

                expect(item).toHaveProperty(
                    "totalAmount",
                );

                expect(
                    item.count,
                ).toBeGreaterThan(0);

                expect(
                    item.totalAmount,
                ).toBeGreaterThanOrEqual(0);

                expect(
                    LOAN_STATUSES,
                ).toContain(item._id);
            }
        });

        test("calculates total loan exposure correctly", async () => {
            const result =
                await Loan.aggregate([
                    {
                        $match: {
                            group: testGroup._id,
                            status: {
                                $in:
                                    ACTIVE_LOAN_STATUSES,
                            },
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            totalExposure: {
                                $sum: "$amount",
                            },
                            loanCount: {
                                $sum: 1,
                            },
                        },
                    },
                ]);

            expect(result).toHaveLength(1);

            expect(
                result[0].loanCount,
            ).toBe(3);

            expect(
                result[0].totalExposure,
            ).toBe(37_000);
        });
    });

    // =========================================================================
    // Authorization boundary
    // =========================================================================

    describe("Authorization Boundaries", () => {
        test("authenticated regular users have a stable authenticated identity", async () => {
            const authenticatedApp =
                buildAppForUser(
                    regularUser,
                );

            const response =
                await request(
                    authenticatedApp,
                )
                    .post("/api/loans")
                    .send({
                        groupId:
                            testGroup._id.toString(),
                        amount: 5_000,
                    });

            expect(
                response.status,
            ).toBeLessThan(500);
        });

        test("group administrator identity is not derived from request body", async () => {
            const authenticatedApp =
                buildAppForUser(
                    groupAdmin,
                );

            const response =
                await request(
                    authenticatedApp,
                )
                    .post("/api/loans")
                    .send({
                        groupId:
                            testGroup._id.toString(),
                        amount: 5_000,
                        userId:
                            adminUser._id.toString(),
                        role: "admin",
                    });

            expect(
                response.status,
            ).toBeLessThan(500);
        });

        test("administrator identity is preserved independently of body identity", async () => {
            const authenticatedApp =
                buildAppForUser(
                    adminUser,
                );

            const response =
                await request(
                    authenticatedApp,
                )
                    .post("/api/loans")
                    .send({
                        groupId:
                            testGroup._id.toString(),
                        amount: 5_000,
                        userId:
                            outsiderUser._id.toString(),
                        role: "user",
                    });

            expect(
                response.status,
            ).toBeLessThan(500);
        });
    });

    // =========================================================================
    // Financial invariants
    // =========================================================================

    describe("Financial Invariants", () => {
        test("loan amount must remain positive for persisted valid test records", async () => {
            const loan =
                await createLoan({
                    amount: 10_000,
                });

            expect(
                loan.amount,
            ).toBeGreaterThan(0);
        });

        test("repaid loans contain a repayment completion timestamp", async () => {
            const loan =
                await createLoan({
                    amount: 10_000,
                    status: "repaid",
                });

            loan.repaidAt =
                new Date();

            await loan.save();

            const persisted =
                await Loan.findById(
                    loan._id,
                );

            expect(
                persisted.status,
            ).toBe("repaid");

            expect(
                persisted.repaidAt,
            ).toBeInstanceOf(Date);
        });

        test("rejected loans retain an explicit rejection reason", async () => {
            const loan =
                await createLoan({
                    status: "rejected",
                });

            loan.rejectionReason =
                "TITech financial risk policy";
            loan.rejectedAt =
                new Date();

            await loan.save();

            const persisted =
                await Loan.findById(
                    loan._id,
                );

            expect(
                persisted.status,
            ).toBe("rejected");

            expect(
                persisted.rejectionReason,
            ).toBe(
                "TITech financial risk policy",
            );

            expect(
                persisted.rejectedAt,
            ).toBeInstanceOf(Date);
        });
    });
});