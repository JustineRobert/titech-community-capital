// ============================================================================
// backend/models/GroupWallet.js
// TITech Community Capital LTD
// Enterprise Group Wallet Model
// PostgreSQL / Sequelize
// ============================================================================
//
// Architectural role
//   GroupWallet identifies a group's/SACCO's wallet/account boundary.
//
// IMPORTANT FINANCIAL RULE
//   This model does NOT own the authoritative wallet balance.
//
//   Balance/state should be derived from the canonical financial layer:
//       Transaction
//           +
//       Ledger / Entry
//
//   Never perform:
//       wallet.balance += amount
//
//   as the primary financial mutation.
//
// Responsibilities
//   - Tenant isolation
//   - SACCO/group wallet identity
//   - Currency boundary
//   - Wallet lifecycle
//   - Safe metadata
//   - Ledger relationship
//
// Module format
//   Sequelize model factory.
//
// ============================================================================

'use strict';

module.exports = (sequelize, DataTypes) => {
  const GroupWallet = sequelize.define(
    'GroupWallet',
    {
      // ----------------------------------------------------------------------
      // Primary identity
      // ----------------------------------------------------------------------

      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },

      // ----------------------------------------------------------------------
      // Tenant
      // ----------------------------------------------------------------------

      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        validate: {
          isUUID: 4,
        },
      },

      // ----------------------------------------------------------------------
      // SACCO / Group owner
      // ----------------------------------------------------------------------

      saccoId: {
        type: DataTypes.UUID,
        allowNull: false,
        validate: {
          isUUID: 4,
        },
      },

      // ----------------------------------------------------------------------
      // Wallet identity
      // ----------------------------------------------------------------------

      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
        validate: {
          notEmpty: {
            msg: 'Wallet name is required.',
          },
          len: {
            args: [1, 128],
            msg: 'Wallet name must contain 1 to 128 characters.',
          },
        },
        set(value) {
          if (value === null || value === undefined) {
            this.setDataValue('name', value);
            return;
          }

          this.setDataValue(
            'name',
            String(value).trim()
          );
        },
      },

      /**
       * Stable wallet/account code for operational and accounting references.
       *
       * Do not use the display name as an accounting identifier.
       */
      walletCode: {
        type: DataTypes.STRING(64),
        allowNull: true,
        validate: {
          len: {
            args: [1, 64],
            msg: 'walletCode must contain 1 to 64 characters.',
          },
        },
        set(value) {
          if (value === null || value === undefined) {
            this.setDataValue('walletCode', value);
            return;
          }

          this.setDataValue(
            'walletCode',
            String(value)
              .trim()
              .toUpperCase()
          );
        },
      },

      // ----------------------------------------------------------------------
      // Currency
      // ----------------------------------------------------------------------

      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'UGX',
        set(value) {
          this.setDataValue(
            'currency',
            String(value || 'UGX')
              .trim()
              .toUpperCase()
          );
        },
        validate: {
          is: {
            args: /^[A-Z]{3}$/,
            msg: 'currency must be a valid 3-letter ISO-style currency code.',
          },
        },
      },

      // ----------------------------------------------------------------------
      // Lifecycle
      // ----------------------------------------------------------------------

      status: {
        type: DataTypes.ENUM(
          'ACTIVE',
          'SUSPENDED',
          'CLOSED'
        ),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },

      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      activatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      suspendedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      closedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      closureReason: {
        type: DataTypes.STRING(500),
        allowNull: true,
        set(value) {
          if (value === null || value === undefined) {
            this.setDataValue('closureReason', value);
            return;
          }

          this.setDataValue(
            'closureReason',
            String(value).trim()
          );
        },
      },

      // ----------------------------------------------------------------------
      // Accounting reference
      // ----------------------------------------------------------------------

      /**
       * Optional canonical ledger/accounting account identifier.
       *
       * This should reference the chart-of-accounts layer if the PostgreSQL
       * accounting implementation has a dedicated Account model.
       */
      accountCode: {
        type: DataTypes.STRING(64),
        allowNull: true,
        set(value) {
          if (value === null || value === undefined) {
            this.setDataValue('accountCode', value);
            return;
          }

          this.setDataValue(
            'accountCode',
            String(value)
              .trim()
              .toUpperCase()
          );
        },
      },

      // ----------------------------------------------------------------------
      // Metadata
      // ----------------------------------------------------------------------

      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: () => ({}),
        validate: {
          isObject(value) {
            if (
              value === null ||
              typeof value !== 'object' ||
              Array.isArray(value)
            ) {
              throw new Error(
                'metadata must be a JSON object.'
              );
            }
          },
        },
      },

      // ----------------------------------------------------------------------
      // Audit fields
      // ----------------------------------------------------------------------

      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        validate: {
          isUUID: 4,
        },
      },

      updatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        validate: {
          isUUID: 4,
        },
      },
    },
    {
      timestamps: true,
      tableName: 'group_wallets',

      /**
       * Never silently add unknown attributes through Sequelize model writes.
       */
      underscored: true,

      indexes: [
        {
          name: 'idx_group_wallets_tenant',
          fields: ['tenant_id'],
        },

        {
          name: 'idx_group_wallets_tenant_sacco',
          fields: [
            'tenant_id',
            'sacco_id',
          ],
        },

        {
          name: 'idx_group_wallets_tenant_status',
          fields: [
            'tenant_id',
            'status',
          ],
        },

        {
          name: 'idx_group_wallets_tenant_currency',
          fields: [
            'tenant_id',
            'currency',
          ],
        },

        {
          name: 'idx_group_wallets_account_code',
          fields: [
            'tenant_id',
            'account_code',
          ],
          unique: true,
          where: {
            account_code: {
              [sequelize.Sequelize.Op.ne]: null,
            },
          },
        },

        /**
         * A SACCO/group should not accidentally receive two identical wallet
         * identities for the same tenant/currency.
         *
         * If the business later supports multiple wallets of the same currency
         * per SACCO, replace this with a wallet-type/code uniqueness rule.
         */
        {
          name: 'uq_group_wallets_tenant_sacco_currency_name',
          fields: [
            'tenant_id',
            'sacco_id',
            'currency',
            'name',
          ],
          unique: true,
        },
      ],

      hooks: {
        beforeValidate(wallet) {
          // Keep legacy isActive/status values synchronized on writes.
          if (
            wallet.status === 'ACTIVE'
          ) {
            wallet.isActive = true;

            if (!wallet.activatedAt) {
              wallet.activatedAt = new Date();
            }
          }

          if (
            wallet.status === 'SUSPENDED'
          ) {
            wallet.isActive = false;

            if (!wallet.suspendedAt) {
              wallet.suspendedAt = new Date();
            }
          }

          if (
            wallet.status === 'CLOSED'
          ) {
            wallet.isActive = false;

            if (!wallet.closedAt) {
              wallet.closedAt = new Date();
            }
          }
        },

        beforeUpdate(wallet) {
          /**
           * A closed wallet must never be silently reactivated through an
           * ordinary update. Reopening should be a dedicated workflow.
           */
          const previousStatus =
            wallet._previousDataValues?.status;

          if (
            previousStatus === 'CLOSED' &&
            wallet.status !== 'CLOSED'
          ) {
            throw new Error(
              'A CLOSED wallet cannot be reactivated through an ordinary update.'
            );
          }
        },
      },
    }
  );

  // ==========================================================================
  // Associations
  // ==========================================================================

  GroupWallet.associate = (models) => {
    GroupWallet.belongsTo(
      models.Sacco,
      {
        foreignKey: 'saccoId',
        as: 'sacco',
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      }
    );

    /**
     * If Entry is the canonical PostgreSQL ledger-line model.
     */
    GroupWallet.hasMany(
      models.Entry,
      {
        foreignKey: 'walletId',
        as: 'ledgerEntries',
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      }
    );

    /**
     * Optional if the project has a dedicated User model in this Sequelize
     * boundary.
     */
    if (models.User) {
      GroupWallet.belongsTo(
        models.User,
        {
          foreignKey: 'createdBy',
          as: 'creator',
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        }
      );

      GroupWallet.belongsTo(
        models.User,
        {
          foreignKey: 'updatedBy',
          as: 'updater',
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        }
      );
    }
  };

  // ==========================================================================
  // Instance helpers
  // ==========================================================================

  GroupWallet.prototype.isOperational = function () {
    return (
      this.status === 'ACTIVE' &&
      this.isActive === true
    );
  };

  GroupWallet.prototype.canReceiveFunds = function () {
    return this.isOperational();
  };

  GroupWallet.prototype.canSendFunds = function () {
    return this.isOperational();
  };

  GroupWallet.prototype.suspend = function (
    reason = null
  ) {
    if (this.status === 'CLOSED') {
      throw new Error(
        'A CLOSED wallet cannot be suspended.'
      );
    }

    this.status = 'SUSPENDED';
    this.isActive = false;
    this.suspendedAt =
      this.suspendedAt || new Date();

    if (reason !== null) {
      this.closureReason =
        String(reason).trim();
    }

    return this;
  };

  GroupWallet.prototype.close = function (
    reason = null
  ) {
    this.status = 'CLOSED';
    this.isActive = false;
    this.closedAt =
      this.closedAt || new Date();

    if (reason !== null) {
      this.closureReason =
        String(reason).trim();
    }

    return this;
  };

  GroupWallet.prototype.reactivate =
    function () {
      if (this.status === 'CLOSED') {
        throw new Error(
          'A CLOSED wallet cannot be reactivated.'
        );
      }

      this.status = 'ACTIVE';
      this.isActive = true;

      this.suspendedAt = null;

      if (!this.activatedAt) {
        this.activatedAt = new Date();
      }

      return this;
    };

  // ==========================================================================
  // Static helpers
  // ==========================================================================

  /**
   * Tenant-scoped wallet lookup.
   */
  GroupWallet.findByTenantAndId =
    function (
      tenantId,
      walletId,
      options = {}
    ) {
      return GroupWallet.findOne({
        where: {
          id: walletId,
          tenantId,
        },
        ...options,
      });
    };

  /**
   * Find operational wallet.
   */
  GroupWallet.findOperational =
    function (
      tenantId,
      walletId,
      options = {}
    ) {
      return GroupWallet.findOne({
        where: {
          id: walletId,
          tenantId,
          status: 'ACTIVE',
          isActive: true,
        },
        ...options,
      });
    };

  /**
   * Find wallets belonging to a SACCO within a tenant.
   */
  GroupWallet.findBySacco =
    function (
      tenantId,
      saccoId,
      options = {}
    ) {
      return GroupWallet.findAll({
        where: {
          tenantId,
          saccoId,
        },
        order: [
          ['createdAt', 'ASC'],
        ],
        ...options,
      });
    };

  return GroupWallet;
};