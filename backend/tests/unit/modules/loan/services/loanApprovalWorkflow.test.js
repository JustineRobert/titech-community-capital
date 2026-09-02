"use strict";

jest.mock(
    "../../../../../modules/loan/repositories/loanRepository"
);

jest.mock(
    "../../../../../modules/loan/repositories/loanAuditRepository"
);

const LoanWorkflowService =
    require("../../../../../modules/loan/services/loanWorkflowService");

const LoanRepository =
    require("../../../../../modules/loan/repositories/loanRepository");

const LoanAuditRepository =
    require("../../../../../modules/loan/repositories/loanAuditRepository");

describe(
    "Loan Approval Workflow",
    () => {

        test(
            "should approve pending loan",
            async () => {

                LoanRepository
                    .findById
                    .mockResolvedValue({

                        _id: "loan1",

                        status:
                            "PENDING"
                    });

                LoanRepository
                    .updateStatus
                    .mockResolvedValue(
                        true
                    );

                await LoanWorkflowService
                    .approveLoan(

                        "loan1",

                        {},

                        {
                            _id:
                                "admin1"
                        },

                        "tenant1"
                    );

                expect(

                    LoanRepository
                        .updateStatus

                ).toHaveBeenCalled();

            }
        );

        test(
            "should reject approved loan",
            async () => {

                LoanRepository
                    .findById
                    .mockResolvedValue({

                        _id: "loan1",

                        status:
                            "APPROVED"
                    });

                await expect(

                    LoanWorkflowService
                        .approveLoan(

                            "loan1",

                            {},

                            {
                                _id:
                                    "admin1"
                            },

                            "tenant1"
                        )

                ).rejects.toThrow();

            }
        );

        test(
            "should create approval audit trail",
            async () => {

                LoanRepository
                    .findById
                    .mockResolvedValue({

                        _id:
                            "loan1",

                        status:
                            "PENDING"
                    });

                LoanRepository
                    .updateStatus
                    .mockResolvedValue(
                        true
                    );

                await LoanWorkflowService
                    .approveLoan(

                        "loan1",

                        {},

                        {
                            _id:
                                "admin1"
                        },

                        "tenant1"
                    );

                expect(

                    LoanAuditRepository
                        .logApproval

                ).toHaveBeenCalled();

            }
        );

    test(
    "should throw when loan does not exist",
    async () => {

        LoanRepository
            .findById
            .mockResolvedValue(null);

        await expect(

            LoanWorkflowService
                .approveLoan(

                    "loan-x",

                    {},

                    {
                        _id:
                            "admin1"
                    },

                    "tenant1"
                )

        ).rejects.toThrow();

    }
);

test(
    "should pass tenant id to repository",
    async () => {

        LoanRepository
            .findById
            .mockResolvedValue({

                _id: "loan1",

                status:
                    "PENDING"
            });

        LoanRepository
            .updateStatus
            .mockResolvedValue(
                true
            );

        await LoanWorkflowService
            .approveLoan(

                "loan1",

                {},

                {
                    _id:
                        "admin1"
                },

                "tenantABC"
            );

        expect(
            LoanRepository.findById
        ).toHaveBeenCalledWith(
            "loan1",
            "tenantABC"
        );

    }
);

test(
    "should create audit log with approver",
    async () => {

        LoanRepository
            .findById
            .mockResolvedValue({

                _id: "loan1",

                status:
                    "PENDING"
            });

        LoanRepository
            .updateStatus
            .mockResolvedValue(
                true
            );

        await LoanWorkflowService
            .approveLoan(

                "loan1",

                {
                    remarks:
                        "Approved"
                },

                {
                    _id:
                        "admin1"
                },

                "tenant1"
            );

        expect(

            LoanAuditRepository
                .logApproval

        ).toHaveBeenCalled();

    }
);

test(
    "should propagate repository failure",
    async () => {

        LoanRepository
            .findById
            .mockRejectedValue(
                new Error(
                    "Database error"
                )
            );

        await expect(

            LoanWorkflowService
                .approveLoan(

                    "loan1",

                    {},

                    {
                        _id:
                            "admin1"
                    },

                    "tenant1"
                )

        ).rejects.toThrow(
            "Database error"
        );

    }
);
});

}); // end describe("Loan Approval Workflow")