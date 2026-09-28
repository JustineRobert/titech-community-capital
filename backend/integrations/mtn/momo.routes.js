const express = require('express');
const controller = require('./momo.controller.js');
const router = express.Router();
router.get('/health', controller.health);
router.post('/deposit', controller.deposit);
router.post('/withdraw', controller.withdraw);
router.post('/webhook', express.json({ limit:'1mb' }), controller.webhook);
router.get('/reconciliation/:date', controller.getReconciliation);
module.exports = router;
