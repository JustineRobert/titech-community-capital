/** Legacy compatibility router; canonical audit routes remain in routes/auditRoutes.js. */
const express = require('express');
const router = express.Router();
router.get('/health', (_req, res) => res.json({ success: true, service: 'audit', canonical: 'routes/auditRoutes.js' }));
module.exports = router;
