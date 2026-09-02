//  backend/modules/finance/middleware/loanWorkflowGuard.js
'use strict';

const AppError = require('../../../shared/utils/AppError');

/**

* Production Loan Lifecycle
  */
  const LOAN_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  DISBURSED: 'DISBURSED',
  ACTIVE: 'ACTIVE',
  OVERDUE: 'OVERDUE',
  DEFAULTED: 'DEFAULTED',
  COLLECTIONS: 'COLLECTIONS',
  WRITTEN_OFF: 'WRITTEN_OFF',
  CLOSED: 'CLOSED'
  };

/**

* Allowed state transitions
  */
  const ALLOWED_TRANSITIONS = {
  DRAFT: ['SUBMITTED'],

SUBMITTED: [
'UNDER_REVIEW',
'REJECTED'
],

UNDER_REVIEW: [
'APPROVED',
'REJECTED'
],

APPROVED: [
'DISBURSED'
],

DISBURSED: [
'ACTIVE'
],

ACTIVE: [
'OVERDUE',
'CLOSED'
],

OVERDUE: [
'ACTIVE',
'DEFAULTED',
'COLLECTIONS'
],

DEFAULTED: [
'COLLECTIONS',
'WRITTEN_OFF'
],

COLLECTIONS: [
'ACTIVE',
'WRITTEN_OFF',
'CLOSED'
],

WRITTEN_OFF: [],

REJECTED: [],

CLOSED: []
};

/**

* Statuses requiring elevated permissions
  */
  const RESTRICTED_TRANSITIONS = {
  APPROVED: [
  'loan_manager',
  'credit_manager',
  'admin',
  'super_admin'
  ],

DISBURSED: [
'finance_officer',
'loan_manager',
'admin',
'super_admin'
],

WRITTEN_OFF: [
'credit_manager',
'admin',
'super_admin'
]
};

/**

* Loan Workflow Middleware
  */
  module.exports = function loanWorkflowGuard(
  targetStatus
  ) {
  return async (
  req,
  res,
  next
  ) => {
  try {
  const loan = req.loan;

  if (!loan) {
  return next(
  new AppError(
  'Loan not found',
  404
  )
  );
  }

  /**
  * Tenant Isolation
  */
  if (
  req.user?.tenantId &&
  loan.tenantId?.toString() !==
  req.user.tenantId.toString()
  ) {
  return next(
  new AppError(
  'Access denied',
  403
  )
  );
  }

  const currentStatus =
  loan.status;

  /**
  * Validate workflow transition
  */
  const allowedStatuses =
  ALLOWED_TRANSITIONS[
  currentStatus
  ] || [];

  if (
  !allowedStatuses.includes(
  targetStatus
  )
  ) {
  return next(
  new AppError(
  `Invalid loan transition: ${currentStatus} → ${targetStatus}`,
  400
  )
  );
  }

  /**
  * Validate role permissions
  */
  const requiredRoles =
  RESTRICTED_TRANSITIONS[
  targetStatus
  ];

  if (
  requiredRoles &&
  !requiredRoles.includes(
  req.user?.role
  )
  ) {
  return next(
  new AppError(
  `Role '${req.user?.role}' cannot transition loan to '${targetStatus}'`,
  403
  )
  );
  }

  /**
  * KYC validation before approval
  */
  if (
  targetStatus ===
  LOAN_STATUS.APPROVED &&
  !loan.borrowerKycVerified
  ) {
  return next(
  new AppError(
  'Borrower KYC verification required',
  400
  )
  );
  }

  /**
  * Credit score validation
  */
  if (
  targetStatus ===
  LOAN_STATUS.APPROVED &&
  typeof loan.creditScore ===
  'number' &&
  loan.creditScore < 500
  ) {
  return next(
  new AppError(
  'Credit score below approval threshold',
  400
  )
  );
  }

  /**
  * Disbursement validation
  */
  if (
  targetStatus ===
  LOAN_STATUS.DISBURSED
  ) {
  if (
  !loan.approvedAmount ||
  loan.approvedAmount <= 0
  ) {
  return next(
  new AppError(
  'Loan amount not approved',
  400
  )
  );
  }

  ```
   if (
     !loan.disbursementMethod
   ) {
     return next(
       new AppError(
         'Disbursement method missing',
         400
       )
     );
   }
  ```

  }

  /**
  * Store transition metadata
  */
  req.loanTransition = {
  from: currentStatus,
  to: targetStatus,
  actorId:
  req.user?.id ||
  req.user?._id,
  actorRole:
  req.user?.role,
  timestamp:
  new Date()
  };

  next();
  } catch (error) {
  next(error);
  }
  };
  };
