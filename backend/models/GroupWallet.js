// models/GroupWallet.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const GroupWallet = sequelize.define(
    'GroupWallet',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      saccoId: {
        type: DataTypes.UUID,
        allowNull: false,
        index: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: true,
        index: true,
      },
      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
        trim: true,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'UGX',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    { timestamps: true, tableName: 'group_wallets' }
  );

  GroupWallet.associate = (models) => {
    GroupWallet.belongsTo(models.Sacco, { foreignKey: 'saccoId' });
    GroupWallet.hasMany(models.Entry, { foreignKey: 'walletId' });
  };

  return GroupWallet;
};
