const canonical = () => import('../services/rbacService.js');
exports.assignRole = async (req, res, next) => {
  try { const { assignUserRole } = await canonical(); const actor = req.user; const data = await assignUserRole({ actor, targetUserId: req.params.userId || req.body?.userId, role: req.body?.role, groupId: req.body?.groupId || null, req }); return res.json({ success: true, data }); } catch (error) { return next(error); }
};
