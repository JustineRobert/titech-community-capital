"use strict";

/**
 * ============================================================
 * TITech Community Capital LTD
 * Validation Utility Tests
 * ============================================================
 *
 * Enterprise Test Coverage
 * - Required Input Validation
 * - String Validation
 * - Number Validation
 * - Date Validation
 * - Email Validation
 * - Phone Validation
 * - ObjectId Validation
 * - Loan Validation
 *
 * ============================================================
 */

const mongoose = require("mongoose");

const {
    validateInput,
    validateString,
    validateNumber,
    validateBoolean,
    validateDate,
    validateEnum,
    validateEmail,
    validatePhoneNumber,
    validateObjectId,
    validateLoanAmount,
    validateInterestRate,
    validateLoanApplication
} = require(
    "../../../utils/validateInput"
);

describe(
    "Validation Utility",
    () => {

        /**
         * =====================================================
         * REQUIRED INPUT
         * =====================================================
         */
        describe(
            "validateInput",
            () => {

                test(
                    "should validate valid input",
                    () => {

                        expect(
                            validateInput("Igune")
                        ).toBe(true);

                    }
                );

                test(
                    "should reject undefined",
                    () => {

                        expect(() =>
                            validateInput(
                                undefined,
                                "Name"
                            )
                        ).toThrow(
                            "Name is required"
                        );

                    }
                );

                test(
                    "should reject null",
                    () => {

                        expect(() =>
                            validateInput(
                                null,
                                "Name"
                            )
                        ).toThrow();

                    }
                );

                test(
                    "should reject empty string",
                    () => {

                        expect(() =>
                            validateInput(
                                "",
                                "Name"
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * STRING VALIDATION
         * =====================================================
         */
        describe(
            "validateString",
            () => {

                test(
                    "should validate string",
                    () => {

                        expect(
                            validateString(
                                "Igune",
                                "Name"
                            )
                        ).toBe(true);

                    }
                );

                test(
                    "should reject short string",
                    () => {

                        expect(() =>
                            validateString(
                                "A",
                                "Name",
                                {
                                    minLength: 3
                                }
                            )
                        ).toThrow();

                    }
                );

                test(
                    "should reject non string",
                    () => {

                        expect(() =>
                            validateString(
                                123,
                                "Name"
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * NUMBER VALIDATION
         * =====================================================
         */
        describe(
            "validateNumber",
            () => {

                test(
                    "should validate number",
                    () => {

                        expect(
                            validateNumber(
                                100,
                                "Amount"
                            )
                        ).toBe(true);

                    }
                );

                test(
                    "should reject negative amount",
                    () => {

                        expect(() =>
                            validateNumber(
                                -1,
                                "Amount",
                                {
                                    min: 0
                                }
                            )
                        ).toThrow();

                    }
                );

                test(
                    "should reject invalid number",
                    () => {

                        expect(() =>
                            validateNumber(
                                "abc",
                                "Amount"
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * BOOLEAN VALIDATION
         * =====================================================
         */
        describe(
            "validateBoolean",
            () => {

                test(
                    "should validate true",
                    () => {

                        expect(
                            validateBoolean(
                                true,
                                "IsActive"
                            )
                        ).toBe(true);

                    }
                );

                test(
                    "should reject non boolean",
                    () => {

                        expect(() =>
                            validateBoolean(
                                "true",
                                "IsActive"
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * DATE VALIDATION
         * =====================================================
         */
        describe(
            "validateDate",
            () => {

                test(
                    "should validate date",
                    () => {

                        expect(
                            validateDate(
                                "2027-01-01",
                                "Date"
                            )
                        ).toBe(true);

                    }
                );

                test(
                    "should reject invalid date",
                    () => {

                        expect(() =>
                            validateDate(
                                "invalid-date",
                                "Date"
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * ENUM VALIDATION
         * =====================================================
         */
        describe(
            "validateEnum",
            () => {

                test(
                    "should validate enum",
                    () => {

                        expect(
                            validateEnum(
                                "ACTIVE",
                                "Status",
                                [
                                    "ACTIVE",
                                    "INACTIVE"
                                ]
                            )
                        ).toBe(true);

                    }
                );

                test(
                    "should reject invalid enum",
                    () => {

                        expect(() =>
                            validateEnum(
                                "PENDING",
                                "Status",
                                [
                                    "ACTIVE",
                                    "INACTIVE"
                                ]
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * EMAIL
         * =====================================================
         */
        describe(
            "validateEmail",
            () => {

                test(
                    "should validate email",
                    () => {

                        expect(
                            validateEmail(
                                "igune@test.com"
                            )
                        ).toBe(true);

                    }
                );

                test(
                    "should reject invalid email",
                    () => {

                        expect(() =>
                            validateEmail(
                                "invalid-email"
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * PHONE
         * =====================================================
         */
        describe(
            "validatePhoneNumber",
            () => {

                test(
                    "should validate phone",
                    () => {

                        expect(
                            validatePhoneNumber(
                                "+256772123546"
                            )
                        ).toBe(true);

                    }
                );

                test(
                    "should reject malformed phone",
                    () => {

                        expect(() =>
                            validatePhoneNumber(
                                "123"
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * OBJECT ID
         * =====================================================
         */
        describe(
            "validateObjectId",
            () => {

                test(
                    "should validate object id",
                    () => {

                        const id =
                            new mongoose.Types.ObjectId();

                        expect(
                            validateObjectId(id)
                        ).toBe(true);

                    }
                );

                test(
                    "should reject invalid id",
                    () => {

                        expect(() =>
                            validateObjectId(
                                "invalid-id"
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * LOAN AMOUNT
         * =====================================================
         */
        describe(
            "validateLoanAmount",
            () => {

                test(
                    "should validate amount",
                    () => {

                        expect(
                            validateLoanAmount(
                                500000
                            )
                        ).toBe(true);

                    }
                );

                test(
                    "should reject zero amount",
                    () => {

                        expect(() =>
                            validateLoanAmount(
                                0
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * INTEREST RATE
         * =====================================================
         */
        describe(
            "validateInterestRate",
            () => {

                test(
                    "should validate interest rate",
                    () => {

                        expect(
                            validateInterestRate(
                                15
                            )
                        ).toBe(true);

                    }
                );

                test(
                    "should reject rate above 100",
                    () => {

                        expect(() =>
                            validateInterestRate(
                                150
                            )
                        ).toThrow();

                    }
                );

            }
        );

        /**
         * =====================================================
         * LOAN APPLICATION
         * =====================================================
         */
        describe(
            "validateLoanApplication",
            () => {

                test(
                    "should validate application",
                    () => {

                        const payload = {

                            memberId:
                                new mongoose.Types.ObjectId(),

                            groupId:
                                new mongoose.Types.ObjectId(),

                            amount:
                                1000000,

                            interestRate:
                                12,

                            repaymentPeriod:
                                12
                        };

                        expect(
                            validateLoanApplication(
                                payload
                            )
                        ).toBe(true);

                    }
                );

                test(
                    "should reject invalid amount",
                    () => {

                        const payload = {

                            memberId:
                                new mongoose.Types.ObjectId(),

                            groupId:
                                new mongoose.Types.ObjectId(),

                            amount:
                                0,

                            interestRate:
                                12,

                            repaymentPeriod:
                                12
                        };

                        expect(() =>
                            validateLoanApplication(
                                payload
                            )
                        ).toThrow();

                    }
                );

            }
        );
    }
);