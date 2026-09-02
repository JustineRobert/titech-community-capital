/**
 * Legal Acceptance Middleware
 * ============================================================================
 * Ensures users have accepted the latest Terms of Service and Privacy Policy
 * before accessing protected resources.
 */

const termsAndPrivacy = require('../services/termsAndPrivacy');

/**
 * Middleware to check if user has accepted latest Terms of Service and Privacy Policy
 *
 * Usage:
 *   app.use('/api/protected-route', requireLegalAcceptance, controllerHandler);
 *
 * Returns 403 Forbidden if user has not accepted current versions
 */
const requireLegalAcceptance = async (req, res, next) => {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const userId = req.user.id;

    // Get user's acceptance status
    const status = await termsAndPrivacy.getAcceptanceStatus(userId);

    // Check if both terms and privacy have been accepted with current versions
    if (!status.acceptedTerms || !status.acceptedPrivacy) {
      return res.status(403).json({
        success: false,
        message: 'You must accept the latest Terms of Service and Privacy Policy to continue',
        termsAccepted: status.acceptedTerms,
        privacyAccepted: status.acceptedPrivacy,
        requiredVersions: {
          terms: status.currentTermsVersion,
          privacy: status.currentPrivacyVersion,
        },
        acceptanceLink: '/legal',
      });
    }

    // Store acceptance status in request for downstream handlers
    req.legalAcceptance = status;

    // All checks passed, proceed to next handler
    next();
  } catch (error) {
    console.error('Error in legal acceptance middleware:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying legal acceptance',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * Optional middleware - logs legal acceptance status but doesn't block
 * Useful for analytics and non-critical routes
 */
const logLegalAcceptance = async (req, res, next) => {
  try {
    if (req.user && req.user.id) {
      const status = await termsAndPrivacy.getAcceptanceStatus(req.user.id);
      req.legalAcceptance = status;

      // Log acceptance status
      if (!status.acceptedTerms || !status.acceptedPrivacy) {
        console.warn(`User ${req.user.id} accessing endpoint without full legal acceptance`);
      }
    }
    next();
  } catch (error) {
    // Log but don't block
    console.warn('Error logging legal acceptance:', error.message);
    next();
  }
};

/**
 * Middleware to enforce acceptance for first-time transactions
 * Blocks payment/loan operations if terms not accepted
 */
const requireAcceptanceForTransaction = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const userId = req.user.id;
    const status = await termsAndPrivacy.getAcceptanceStatus(userId);

    if (!status.acceptedTerms || !status.acceptedPrivacy) {
      return res.status(403).json({
        success: false,
        message: 'You must accept Terms of Service and Privacy Policy before making transactions',
        action: 'REQUIRE_LEGAL_ACCEPTANCE',
        acceptanceLink: '/legal',
      });
    }

    req.legalAcceptance = status;
    next();
  } catch (error) {
    console.error('Error in transaction acceptance middleware:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying transaction eligibility',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

module.exports = {
  requireLegalAcceptance,
  logLegalAcceptance,
  requireAcceptanceForTransaction,
};
