'use strict';

/**
 * ============================================================================
 * EXPORT CONTROLLER
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Handles secure export requests for conversation data.
 *
 * EXPORTS ARE USED FOR:
 * ----------------------------------------------------------------------------
 * ✅ SACCO Audit Compliance
 * ✅ Regulatory (BoU) Reporting
 * ✅ Fraud Investigations
 * ✅ Legal Discovery Requests
 * ✅ Member Dispute Resolution
 *
 * SECURITY MODEL
 * ----------------------------------------------------------------------------
 * - Strict RBAC enforcement
 * - Full audit logging via ExportService
 * - Asynchronous processing (future-ready)
 *
 * ============================================================================
 */

const exportService =
  require('../../services/chat/exportService');

/*
|--------------------------------------------------------------------------
| Request Export
|--------------------------------------------------------------------------
*/

exports.requestExport = async (
  req,
  res,
  next
) => {
  try {
    const role =
      String(req.user.role || '').toLowerCase();

    /*
    |--------------------------------------------------------------------------
    | RBAC ENFORCEMENT
    |--------------------------------------------------------------------------
    | Only ADMIN and SUPPORT roles can initiate exports
    |--------------------------------------------------------------------------
    */

    const allowedRoles = [
      'admin',
      'support',
    ];

    if (
      !allowedRoles.includes(role)
    ) {
      return res.status(403).json({
        error:
          'You are not authorized to export conversation data',
      });
    }

    const conversationId =
      req.params.conversationId;

    if (!conversationId) {
      return res.status(400).json({
        error:
          'conversationId is required',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | EXPORT REQUEST
    |--------------------------------------------------------------------------
    */

    const exportDoc =
      await exportService.requestExport(
        conversationId,
        req.user._id
      );

    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    | 202 Accepted → async processing initiated
    |--------------------------------------------------------------------------
    */

    res.status(202).json({
      success: true,
      export: exportDoc,
      message:
        'Export request accepted and is being processed',
    });
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| Get Export Status
|--------------------------------------------------------------------------
*/

exports.getExport = async (
  req,
  res,
  next
) => {
  try {
    const exportDoc =
      await exportService.getExport(
        req.params.exportId
      );

    if (!exportDoc) {
      return res.status(404).json({
        error:
          'Export not found',
      });
    }

    res.json(exportDoc);
  } catch (err) {
    next(err);
  }
};

/*
|--------------------------------------------------------------------------
| List User Exports
|--------------------------------------------------------------------------
*/

exports.listExports = async (
  req,
  res,
  next
) => {
  try {
    const exports =
      await exportService.listExports(
        req.user._id
      );

    res.json(exports);
  } catch (err) {
    next(err);
  }
};