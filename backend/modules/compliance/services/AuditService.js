//  backend/modules/compliance/services/AuditService.js
'use strict';

const AuditLog = require('../models/AuditLog');

class AuditService {
  static async log({
    tenantId,
    userId,
    action,
    entity,
    entityId,
    data,
  }) {
    return AuditLog.create({
      tenantId,
      userId,
      action,
      entity,
      entityId,
      data,
    });
  }
}

module.exports = AuditService;