const service = require('./momo.service.js');
module.exports = Object.freeze({ processWebhook: service.webhooks.processWebhook.bind(service.webhooks) });
