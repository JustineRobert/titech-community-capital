//  backend/modules/auth/middleware/authMiddleware.js
'use strict';

const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token.split(' ')[1], process.env.JWT_SECRET);

    req.user = decoded;
    req.tenantId = decoded.tenantId;

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};