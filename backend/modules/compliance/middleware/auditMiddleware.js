'use strict';

const AuditService = require('../services/AuditService');

module.exports = function (action, entity) {
  return async (req, res, next) => {
    res.on('finish', async () => {
      try {
        await AuditService.log({
          tenantId: req.tenantId,
          userId: req.user?.userId,
          action,
          entity,
          entityId: req.params.id || null,
          data: {
            method: req.method,
            statusCode: res.statusCode,
            body: req.body,
          },
        });
      } catch (err) {
        console.error('Audit logging failed:', err.message);
      }
    });

    next();
  };
};