import express from 'express';
import authModule from '../middleware/auth.js';
import controller from '../controllers/rbacController.js';
import { param, body, validationResult } from 'express-validator';

const router = express.Router({ strict: false, caseSensitive: false });
const { authenticate, requirePermission } = authModule;
function validate(req, res, next) { const errors = validationResult(req); if (errors.isEmpty()) return next(); return res.status(400).json({ success: false, code: 'RBAC_VALIDATION_FAILED', message: 'Invalid authorization request.', details: errors.array() }); }
router.use(authenticate);
router.get('/policy', requirePermission('ROLE_VIEW'), controller.policy);
router.get('/me', controller.me);
router.post('/tenants', [body('tenantId').isString().isLength({ min: 2, max: 100 }), body('slug').isString().isLength({ min: 2, max: 100 }), body('name').isString().isLength({ min: 2, max: 200 }), body('ownerUserId').optional().isMongoId()], validate, requirePermission('TENANT_CREATE'), controller.createTenantResource);
router.get('/users', requirePermission('USER_VIEW'), controller.listUsers);
router.patch('/users/:userId/role', [param('userId').isMongoId(), body('role').isString().isLength({ min: 2, max: 50 })], validate, requirePermission('ROLE_ASSIGN'), controller.assignRole);
router.patch('/users/:userId/disable', [param('userId').isMongoId()], validate, requirePermission('USER_DISABLE'), controller.disableUser);
router.patch('/groups/:groupId/members/:memberUserId', [param('groupId').isMongoId(), param('memberUserId').isMongoId(), body('action').isIn(['approve','reject','suspend','reinstate','remove','role']), body('role').optional().isString().isLength({ min: 2, max: 50 })], validate, requirePermission('GROUP_MANAGE_MEMBERS'), controller.transitionGroupMembership);
export default router;
