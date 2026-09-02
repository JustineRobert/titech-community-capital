const jwt = require('jsonwebtoken');
const User = require('../models/User');

const verifyAccessToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers['x-auth-token'];
  let token = null;

  if (authHeader && authHeader.startsWith && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (typeof authHeader === 'string' && authHeader.length > 0) {
    token = authHeader;
  }

  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded?.user?.id) return res.status(401).json({ message: 'Invalid token' });
    const user = await User.findById(decoded.user.id);
    if (!user) return res.status(401).json({ message: 'User not found' });
    if (!user.isActive) return res.status(403).json({ message: 'User inactive' });
    req.user = { id: user._id.toString(), role: user.role };
    next();
  } catch (err) {
    console.error('[AuthMiddleware] token verify error', err.message);
    if (err.name === 'TokenExpiredError') return res.status(401).json({ message: 'Token expired' });
    return res.status(401).json({ message: 'Token invalid' });
  }
};

const requireRole =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
    const userRole = (req.user.role || '').toString();
    if (allowedRoles.length === 0) return next();
    if (!allowedRoles.includes(userRole))
      return res.status(403).json({ message: 'Insufficient role' });
    return next();
  };

module.exports = { verifyAccessToken, requireRole };
