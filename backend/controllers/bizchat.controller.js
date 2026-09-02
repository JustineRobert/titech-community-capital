const bizchat = require('../services/bizchatService');
const logger = require('../utils/logger') || console;

exports.execute = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, error: { code: 'INVALID', message: 'text is required' } });
    const user = req.user || {};
    const result = await bizchat.executeCommand({ text, user });
    return res.json({ success: true, data: result, traceId: req.requestId });
  } catch (err) {
    logger.error('BizChat execution error', { err: err.message });
    return res.status(500).json({ success: false, error: { code: 'BIZCHAT_ERROR', message: err.message }, traceId: req.requestId });
  }
};
