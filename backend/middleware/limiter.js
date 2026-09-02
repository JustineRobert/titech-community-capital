// middleware/limiter.js
'use strict';

const rateLimit = require('express-rate-limit');

// Configure limiter: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                 // limit each IP to 100 requests per window
  standardHeaders: true,    // return rate limit info in headers
  legacyHeaders: false,     // disable X-RateLimit headers
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests, please try again later.'
    });
  }
});

module.exports = limiter;
