const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, error: { code: 'UNAUTH', message: 'Missing token' } });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.sub || payload.id || payload.user?.id || payload.userId;
    const role = payload.role || payload.user?.role;
    const tenantId = payload.tenantId || payload.user?.tenantId;
    req.user = { id: userId, role, tenantId };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
  }
}

module.exports = requireAuth;
