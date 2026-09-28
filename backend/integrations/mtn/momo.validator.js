function positiveDecimal(value) { return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(value ?? '').trim()) && Number(String(value)) > 0; }
function requireAmount(body) { if (!positiveDecimal(body?.amount)) { const error=new Error('A positive decimal amount is required.'); error.code='INVALID_AMOUNT'; error.statusCode=400; throw error; } }
function requirePhone(body) { if (!String(body?.phoneNumber || '').trim()) { const error=new Error('phoneNumber is required.'); error.code='INVALID_PHONE'; error.statusCode=400; throw error; } }
module.exports = { requireAmount, requirePhone };
