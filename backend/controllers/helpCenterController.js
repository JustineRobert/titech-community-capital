/**
 * Help Center Controller
 * ============================================================================
 * Handles help center endpoints
 */

const helpCenterService = require('../services/helpCenterService');

/**
 * GET /api/help/categories
 * Get all help categories
 */
exports.getCategories = async (req, res) => {
  try {
    const categories = await helpCenterService.getAllCategories();

    return res.status(200).json({
      success: true,
      message: 'Categories retrieved successfully',
      data: categories,
    });
  } catch (error) {
    console.error('Error retrieving categories:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve categories',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/help/category/:slug
 * Get articles by category
 */
exports.getArticlesByCategory = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: 'Category slug is required',
      });
    }

    const articles = await helpCenterService.getArticlesByCategory(slug);

    return res.status(200).json({
      success: true,
      message: 'Articles retrieved successfully',
      data: articles,
      count: articles.length,
    });
  } catch (error) {
    console.error('Error retrieving articles:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve articles',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/help/article/:slug
 * Get single article
 */
exports.getArticle = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: 'Article slug is required',
      });
    }

    const article = await helpCenterService.getArticleBySlug(slug);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
      });
    }

    // Get related articles
    const relatedArticles = await helpCenterService.getRelatedArticles(slug);

    return res.status(200).json({
      success: true,
      message: 'Article retrieved successfully',
      data: article,
      related: relatedArticles,
    });
  } catch (error) {
    console.error('Error retrieving article:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve article',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/help/search
 * Search articles
 */
exports.searchArticles = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters',
      });
    }

    const articles = await helpCenterService.searchArticles(q);

    return res.status(200).json({
      success: true,
      message: 'Search results retrieved',
      query: q,
      data: articles,
      count: articles.length,
    });
  } catch (error) {
    console.error('Error searching articles:', error);
    return res.status(500).json({
      success: false,
      message: 'Search failed',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/help/featured
 * Get featured articles
 */
exports.getFeaturedArticles = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 5;

    const articles = await helpCenterService.getFeaturedArticles(limit);

    return res.status(200).json({
      success: true,
      message: 'Featured articles retrieved successfully',
      data: articles,
      count: articles.length,
    });
  } catch (error) {
    console.error('Error retrieving featured articles:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve featured articles',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/help/popular
 * Get most viewed articles
 */
exports.getPopularArticles = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;

    const articles = await helpCenterService.getMostViewedArticles(limit);

    return res.status(200).json({
      success: true,
      message: 'Popular articles retrieved successfully',
      data: articles,
      count: articles.length,
    });
  } catch (error) {
    console.error('Error retrieving popular articles:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve popular articles',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * POST /api/help/article/:slug/feedback
 * Record article feedback
 */
exports.submitFeedback = async (req, res) => {
  try {
    const { slug } = req.params;
    const { helpful, feedback } = req.body;
    const userId = req.user?.id || null;

    if (typeof helpful !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Helpful flag must be a boolean',
      });
    }

    const feedbackRecord = await helpCenterService.recordFeedback(
      slug,
      userId,
      helpful,
      feedback || ''
    );

    return res.status(201).json({
      success: true,
      message: 'Thank you for your feedback!',
      data: feedbackRecord,
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit feedback',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * POST /api/help/init
 * Initialize help center with seed data (admin only)
 */
exports.initializeHelpCenter = async (req, res) => {
  try {
    // Check if user is admin (would need admin middleware in real app)
    if (process.env.INIT_ALLOWED !== 'true') {
      return res.status(403).json({
        success: false,
        message: 'Initialization not allowed',
      });
    }

    const result = await helpCenterService.seedInitialData();

    return res.status(200).json({
      success: true,
      message: 'Help center initialized',
      data: result,
    });
  } catch (error) {
    console.error('Error initializing help center:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initialize help center',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};
