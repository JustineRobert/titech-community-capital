/**
 * Terms of Service & Privacy Policy Controller
 * ============================================================================
 * Handles serving legal documents and terms acceptance tracking
 */

const termsAndPrivacy = require('../services/termsAndPrivacy');

/**
 * GET /api/legal/terms-of-service
 * Retrieve full Terms of Service
 */
exports.getTermsOfService = async (req, res) => {
  try {
    const terms = termsAndPrivacy.getTermsOfService();
    res.status(200).json({
      document: terms,
      lastUpdated: termsAndPrivacy.getLastUpdated('terms'),
      version: termsAndPrivacy.getVersion('terms'),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve terms of service', error: error.message });
  }
};

/**
 * GET /api/legal/privacy-policy
 * Retrieve full Privacy Policy
 */
exports.getPrivacyPolicy = async (req, res) => {
  try {
    const policy = termsAndPrivacy.getPrivacyPolicy();
    res.status(200).json({
      document: policy,
      lastUpdated: termsAndPrivacy.getLastUpdated('privacy'),
      version: termsAndPrivacy.getVersion('privacy'),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve privacy policy', error: error.message });
  }
};

/**
 * POST /api/legal/accept-terms
 * Record user's acceptance of terms and privacy policy
 */
exports.acceptTermsAndPrivacy = async (req, res) => {
  try {
    const { userId } = req.user;
    const { termsVersion, privacyVersion, ipAddress, userAgent } = req.body;

    if (!termsVersion || !privacyVersion) {
      return res.status(400).json({
        message: 'Terms and privacy policy versions are required',
      });
    }

    const result = await termsAndPrivacy.recordAcceptance(
      userId,
      termsVersion,
      privacyVersion,
      ipAddress || req.ip,
      userAgent || req.headers['user-agent']
    );

    res.status(201).json({
      message: 'Terms and privacy policy acceptance recorded',
      acceptance: result,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to record acceptance',
      error: error.message,
    });
  }
};

/**
 * GET /api/legal/acceptance-status
 * Check if current user has accepted latest terms
 */
exports.getAcceptanceStatus = async (req, res) => {
  try {
    const { userId } = req.user;

    const status = await termsAndPrivacy.getAcceptanceStatus(userId);

    res.status(200).json(status);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to retrieve acceptance status',
      error: error.message,
    });
  }
};

/**
 * GET /api/legal/changelog
 * Get changelog of legal document updates
 */
exports.getChangelog = async (req, res) => {
  try {
    const changelog = termsAndPrivacy.getChangelog();
    res.status(200).json({ changelog });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to retrieve changelog',
      error: error.message,
    });
  }
};

module.exports = exports;
