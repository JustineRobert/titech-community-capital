// backend/modules/auth/controllers/AuthController.js
'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');

class AuthController {
  static async register(req, res, next) {
    try {
      const user = await User.create(req.body);
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  }

  static async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({ email });

      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        {
          userId: user._id,
          tenantId: user.tenantId,
          role: user.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );

      res.json({ token });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = AuthController;