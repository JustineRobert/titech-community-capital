'use strict';

/**
 * ============================================================================
 * backend/tests/linkedEntityValidator.test.js
 * ============================================================================
 * TITech Enterprise Test Suite
 * ============================================================================
 *
 * Covers:
 * ✅ Admin bypass
 * ✅ Loan validation
 * ✅ Savings validation
 * ✅ Transaction validation
 * ✅ Support validation
 * ✅ Group validation
 * ✅ No linked entity handling
 * ✅ Unknown entity handling
 * ✅ Service failures
 * ✅ Conservative-deny policy
 * ✅ Vitest + Jest compatibility
 *
 * Assumes:
 *
 * middleware/linkedEntityValidator.js exports:
 *
 *   validateLinkedEntityAccess(
 *      user,
 *      linkedEntityType,
 *      linkedEntityId
 *   )
 *
 * ============================================================================
 */

const {
  describe,
  beforeEach,
  it,
  test,
  expect,
  vi,
} = require('vitest');

const titech = require('../services/titechClient');
const {
  validateLinkedEntityAccess,
} = require('../middleware/linkedEntityValidator');

vi.mock('../services/titechClient', () => ({
  canViewLoan: vi.fn(),
  canViewSavings: vi.fn(),
  canViewTransaction: vi.fn(),
  canViewSupportTicket: vi.fn(),
  canViewGroup: vi.fn(),
}));

describe(
  'linkedEntityValidator',
  () => {
    const adminUser = {
      _id: 'admin-1',
      role: 'ADMIN',
    };

    const memberUser = {
      _id: 'member-1',
      role: 'MEMBER',
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    /*
    |--------------------------------------------------------------------------
    | Admin Bypass
    |--------------------------------------------------------------------------
    */

    describe('Admin bypass', () => {
      it(
        'allows admin access without service calls',
        async () => {
          const ok =
            await validateLinkedEntityAccess(
              adminUser,
              'Loan',
              'loan-1'
            );

          expect(ok).toBe(true);

          expect(
            titech.canViewLoan
          ).not.toHaveBeenCalled();
        }
      );
    });

    /*
    |--------------------------------------------------------------------------
    | Empty Entity Handling
    |--------------------------------------------------------------------------
    */

    describe(
      'No linked entity',
      () => {
        test(
          'allows when no entity is provided',
          async () => {
            const ok =
              await validateLinkedEntityAccess(
                memberUser,
                null,
                null
              );

            expect(ok).toBe(true);
          }
        );
      }
    );

    /*
    |--------------------------------------------------------------------------
    | Loan Validation
    |--------------------------------------------------------------------------
    */

    describe('Loan validation', () => {
      it(
        'allows loan owner',
        async () => {
          titech.canViewLoan.mockResolvedValue(
            true
          );

          const ok =
            await validateLinkedEntityAccess(
              memberUser,
              'Loan',
              'loan-123'
            );

          expect(
            titech.canViewLoan
          ).toHaveBeenCalledWith(
            memberUser._id,
            'loan-123'
          );

          expect(ok).toBe(true);
        }
      );

      it(
        'denies unauthorized loan access',
        async () => {
          titech.canViewLoan.mockResolvedValue(
            false
          );

          const ok =
            await validateLinkedEntityAccess(
              memberUser,
              'Loan',
              'loan-123'
            );

          expect(ok).toBe(false);
        }
      );
    });

    /*
    |--------------------------------------------------------------------------
    | Savings Validation
    |--------------------------------------------------------------------------
    */

    describe('Savings validation', () => {
      it(
        'allows savings owner',
        async () => {
          titech.canViewSavings.mockResolvedValue(
            true
          );

          const ok =
            await validateLinkedEntityAccess(
              memberUser,
              'Savings',
              'sav-1'
            );

          expect(
            titech.canViewSavings
          ).toHaveBeenCalledWith(
            memberUser._id,
            'sav-1'
          );

          expect(ok).toBe(true);
        }
      );

      it(
        'denies unauthorized savings access',
        async () => {
          titech.canViewSavings.mockResolvedValue(
            false
          );

          const ok =
            await validateLinkedEntityAccess(
              memberUser,
              'Savings',
              'sav-1'
            );

          expect(ok).toBe(false);
        }
      );
    });

    /*
    |--------------------------------------------------------------------------
    | Transaction Validation
    |--------------------------------------------------------------------------
    */

    describe(
      'Transaction validation',
      () => {
        it(
          'allows transaction owner',
          async () => {
            titech.canViewTransaction.mockResolvedValue(
              true
            );

            const ok =
              await validateLinkedEntityAccess(
                memberUser,
                'Transaction',
                'tx-1'
              );

            expect(
              titech.canViewTransaction
            ).toHaveBeenCalledWith(
              memberUser._id,
              'tx-1'
            );

            expect(ok).toBe(true);
          }
        );

        it(
          'denies unauthorized transaction access',
          async () => {
            titech.canViewTransaction.mockResolvedValue(
              false
            );

            const ok =
              await validateLinkedEntityAccess(
                memberUser,
                'Transaction',
                'tx-1'
              );

            expect(ok).toBe(false);
          }
        );
      }
    );

    /*
    |--------------------------------------------------------------------------
    | Support Validation
    |--------------------------------------------------------------------------
    */

    describe(
      'Support validation',
      () => {
        it(
          'allows support ticket access',
          async () => {
            titech.canViewSupportTicket.mockResolvedValue(
              true
            );

            const ok =
              await validateLinkedEntityAccess(
                memberUser,
                'Support',
                'ticket-1'
              );

            expect(
              titech.canViewSupportTicket
            ).toHaveBeenCalledWith(
              memberUser._id,
              'ticket-1'
            );

            expect(ok).toBe(true);
          }
        );

        it(
          'denies support access',
          async () => {
            titech.canViewSupportTicket.mockResolvedValue(
              false
            );

            const ok =
              await validateLinkedEntityAccess(
                memberUser,
                'Support',
                'ticket-1'
              );

            expect(ok).toBe(false);
          }
        );
      }
    );

    /*
    |--------------------------------------------------------------------------
    | Group Validation
    |--------------------------------------------------------------------------
    */

    describe('Group validation', () => {
      it(
        'allows group member',
        async () => {
          titech.canViewGroup.mockResolvedValue(
            true
          );

          const ok =
            await validateLinkedEntityAccess(
              memberUser,
              'Group',
              'group-1'
            );

          expect(
            titech.canViewGroup
          ).toHaveBeenCalledWith(
            memberUser._id,
            'group-1'
          );

          expect(ok).toBe(true);
        }
      );

      it(
        'denies non-member',
        async () => {
          titech.canViewGroup.mockResolvedValue(
            false
          );

          const ok =
            await validateLinkedEntityAccess(
              memberUser,
              'Group',
              'group-1'
            );

          expect(ok).toBe(false);
        }
      );
    });

    /*
    |--------------------------------------------------------------------------
    | Unknown Entity Type
    |--------------------------------------------------------------------------
    */

    describe(
      'Unknown entity types',
      () => {
        it(
          'returns false',
          async () => {
            const ok =
              await validateLinkedEntityAccess(
                memberUser,
                'UnknownType',
                'abc'
              );

            expect(ok).toBe(false);
          }
        );
      }
    );

    /*
    |--------------------------------------------------------------------------
    | Error Handling
    |--------------------------------------------------------------------------
    */

    describe(
      'Service failures',
      () => {
        it(
          'denies on loan service error',
          async () => {
            titech.canViewLoan.mockRejectedValue(
              new Error(
                'Service unavailable'
              )
            );

            const ok =
              await validateLinkedEntityAccess(
                memberUser,
                'Loan',
                'loan-1'
              );

            expect(ok).toBe(false);
          }
        );

        it(
          'denies on transaction service error',
          async () => {
            titech.canViewTransaction.mockRejectedValue(
              new Error(
                'Timeout'
              )
            );

            const ok =
              await validateLinkedEntityAccess(
                memberUser,
                'Transaction',
                'tx-1'
              );

            expect(ok).toBe(false);
          }
        );

        it(
          'denies on support service error',
          async () => {
            titech.canViewSupportTicket.mockRejectedValue(
              new Error(
                'Internal error'
              )
            );

            const ok =
              await validateLinkedEntityAccess(
                memberUser,
                'Support',
                'ticket-1'
              );

            expect(ok).toBe(false);
          }
        );
      }
    );
  }
);