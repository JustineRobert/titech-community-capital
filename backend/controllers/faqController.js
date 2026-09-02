/**
 * FAQ Controller
 * ============================================================================
 * Handles FAQ endpoints
 */

const faqService = require('../services/faqService');

/**
 * GET /api/faq/categories
 * Get all FAQ categories
 */
exports.getCategories = async (req, res) => {
  try {
    const categories = await faqService.getAllCategories();

    return res.status(200).json({
      success: true,
      message: 'FAQ categories retrieved successfully',
      data: categories,
    });
  } catch (error) {
    console.error('Error retrieving FAQ categories:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve FAQ categories',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/faq/all
 * Get all FAQs
 */
exports.getAllFAQs = async (req, res) => {
  try {
    const faqs = await faqService.getAllFAQs();

    return res.status(200).json({
      success: true,
      message: 'All FAQs retrieved successfully',
      data: faqs,
      count: faqs.length,
    });
  } catch (error) {
    console.error('Error retrieving FAQs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve FAQs',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/faq/category/:slug
 * Get FAQs by category
 */
exports.getFAQsByCategory = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: 'Category slug is required',
      });
    }

    const faqs = await faqService.getFAQsByCategory(slug);

    return res.status(200).json({
      success: true,
      message: 'FAQs retrieved successfully',
      category: slug,
      data: faqs,
      count: faqs.length,
    });
  } catch (error) {
    console.error('Error retrieving FAQs by category:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve FAQs',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/faq/featured
 * Get featured FAQs
 */
exports.getFeaturedFAQs = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;

    const faqs = await faqService.getFeaturedFAQs(limit);

    return res.status(200).json({
      success: true,
      message: 'Featured FAQs retrieved successfully',
      data: faqs,
      count: faqs.length,
    });
  } catch (error) {
    console.error('Error retrieving featured FAQs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve featured FAQs',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/faq/popular
 * Get most viewed FAQs
 */
exports.getPopularFAQs = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;

    const faqs = await faqService.getMostViewedFAQs(limit);

    return res.status(200).json({
      success: true,
      message: 'Popular FAQs retrieved successfully',
      data: faqs,
      count: faqs.length,
    });
  } catch (error) {
    console.error('Error retrieving popular FAQs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve popular FAQs',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/faq/:id
 * Get single FAQ and track view
 */
exports.getFAQ = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'FAQ ID is required',
      });
    }

    const { FAQ } = require('../services/faqService');
    const faq = await FAQ.findById(id);

    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found',
      });
    }

    // Track view
    await faqService.trackView(id);

    // Get related FAQs
    const relatedFAQs = await faqService.getRelatedFAQs(id);

    return res.status(200).json({
      success: true,
      message: 'FAQ retrieved successfully',
      data: faq,
      related: relatedFAQs,
    });
  } catch (error) {
    console.error('Error retrieving FAQ:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve FAQ',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/faq/search
 * Search FAQs
 */
exports.searchFAQs = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters',
      });
    }

    const faqs = await faqService.searchFAQs(q);

    return res.status(200).json({
      success: true,
      message: 'Search results retrieved',
      query: q,
      data: faqs,
      count: faqs.length,
    });
  } catch (error) {
    console.error('Error searching FAQs:', error);
    return res.status(500).json({
      success: false,
      message: 'FAQ search failed',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * POST /api/faq/:id/feedback
 * Record FAQ feedback
 */
exports.submitFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { helpful, comment } = req.body;
    const userId = req.user?.id || null;

    if (typeof helpful !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Helpful flag must be a boolean',
      });
    }

    const feedback = await faqService.recordFeedback(id, userId, helpful, comment || '');

    return res.status(201).json({
      success: true,
      message: 'Thank you for your feedback!',
      data: feedback,
    });
  } catch (error) {
    console.error('Error submitting FAQ feedback:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit feedback',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * POST /api/faq/init
 * Initialize FAQ with seed data (admin only)
 */
exports.initializeFAQ = async (req, res) => {
  try {
    // Check if initialization is allowed
    if (process.env.INIT_ALLOWED !== 'true') {
      return res.status(403).json({
        success: false,
        message: 'Initialization not allowed',
      });
    }

    const result = await faqService.seedInitialData();

    return res.status(200).json({
      success: true,
      message: 'FAQ system initialized',
      data: result,
    });
  } catch (error) {
    console.error('Error initializing FAQ:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initialize FAQ system',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};
