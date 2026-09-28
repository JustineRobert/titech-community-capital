const service = require('./momo.service.js');
function ok(res, data, status=200) { return res.status(status).json({ success:true, data, timestamp:new Date().toISOString() }); }
function fail(res, error, status=500) { return res.status(status).json({ success:false, code:error?.code || 'MTN_ERROR', message:'MTN Mobile Money request could not be completed.', requestId: res.req?.requestId || null, timestamp:new Date().toISOString() }); }
exports.health = async (_req, res) => ok(res, { provider:'MTN_MOMO', configured: Boolean(service.auth), timestamp:new Date().toISOString() });
exports.deposit = async (req, res) => { try { return ok(res, await service.collections.deposit(req.body), 201); } catch (error) { return fail(res,error,400); } };
exports.withdraw = async (req, res) => { try { return ok(res, await service.disbursements.withdraw(req.body), 201); } catch (error) { return fail(res,error,400); } };
exports.webhook = async (req, res) => { try { const data=await service.webhooks.processWebhook({payload:req.body,rawBody:req.rawBody || JSON.stringify(req.body),signature:req.headers['x-mtn-signature'] || req.headers['x-signature'],sourceIP:req.ip}); return ok(res,{acknowledged:true,data}); } catch (error) { return fail(res,error,400); } };
exports.getReconciliation = async (req,res) => { try { return ok(res, await service.reconciliation.reconcile({ date:req.params.date, tenantId:req.tenantId || req.context?.tenantId })); } catch (error) { return fail(res,error,400); } };
