/**
 * Community Forums Controller
 * ============================================================================
 * Handles forum endpoints
 */

const forumService = require('../services/forumService');

/**
 * GET /api/forums/categories
 * Get all forum categories
 */
exports.getCategories = async (req, res) => {
  try {
    const categories = await forumService.getAllCategories();

    return res.status(200).json({
      success: true,
      message: 'Forum categories retrieved successfully',
      data: categories,
    });
  } catch (error) {
    console.error('Error retrieving forum categories:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve forum categories',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/forums/category/:slug
 * Get topics by category
 */
exports.getTopicsByCategory = async (req, res) => {
  try {
    const { slug } = req.params;
    const page = req.query.page ? parseInt(req.query.page) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: 'Category slug is required',
      });
    }

    const result = await forumService.getTopicsByCategory(slug, page, limit);

    return res.status(200).json({
      success: true,
      message: 'Topics retrieved successfully',
      category: slug,
      data: result.topics,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Error retrieving forum topics:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve forum topics',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/forums/topic/:slug
 * Get single topic with replies
 */
exports.getTopic = async (req, res) => {
  try {
    const { slug } = req.params;
    const page = req.query.page ? parseInt(req.query.page) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: 'Topic slug is required',
      });
    }

    const result = await forumService.getTopicWithReplies(slug, page, limit);

    return res.status(200).json({
      success: true,
      message: 'Topic retrieved successfully',
      data: result.topic,
      replies: result.replies,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Error retrieving forum topic:', error);

    if (error.message === 'Topic not found') {
      return res.status(404).json({
        success: false,
        message: 'Topic not found',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve forum topic',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * POST /api/forums/topic
 * Create new forum topic
 */
exports.createTopic = async (req, res) => {
  try {
    // Require authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to create topic',
      });
    }

    const { title, content, category } = req.body;

    // Validate input
    if (!title || !content || !category) {
      return res.status(400).json({
        success: false,
        message: 'Title, content, and category are required',
      });
    }

    if (title.trim().length < 5 || content.trim().length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Title must be at least 5 characters, content at least 20 characters',
      });
    }

    const author = {
      userId: req.user.id,
      username: req.user.username || 'Anonymous',
      avatar: req.user.avatar || '',
    };

    const topic = await forumService.createTopic(title, content, category, author);

    return res.status(201).json({
      success: true,
      message: 'Topic created successfully',
      data: topic,
    });
  } catch (error) {
    console.error('Error creating forum topic:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create forum topic',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * POST /api/forums/topic/:topicId/reply
 * Add reply to topic
 */
exports.addReply = async (req, res) => {
  try {
    // Require authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to reply',
      });
    }

    const { topicId } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Reply must be at least 5 characters',
      });
    }

    const author = {
      userId: req.user.id,
      username: req.user.username || 'Anonymous',
      avatar: req.user.avatar || '',
    };

    const reply = await forumService.addReply(topicId, content, author);

    return res.status(201).json({
      success: true,
      message: 'Reply added successfully',
      data: reply,
    });
  } catch (error) {
    console.error('Error adding forum reply:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add reply',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/forums/trending
 * Get trending topics
 */
exports.getTrendingTopics = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;

    const topics = await forumService.getTrendingTopics(limit);

    return res.status(200).json({
      success: true,
      message: 'Trending topics retrieved successfully',
      data: topics,
      count: topics.length,
    });
  } catch (error) {
    console.error('Error retrieving trending topics:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve trending topics',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/forums/latest
 * Get latest topics
 */
exports.getLatestTopics = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;

    const topics = await forumService.getLatestTopics(limit);

    return res.status(200).json({
      success: true,
      message: 'Latest topics retrieved successfully',
      data: topics,
      count: topics.length,
    });
  } catch (error) {
    console.error('Error retrieving latest topics:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve latest topics',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * GET /api/forums/search
 * Search forum topics
 */
exports.searchTopics = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters',
      });
    }

    const topics = await forumService.searchTopics(q);

    return res.status(200).json({
      success: true,
      message: 'Search results retrieved',
      query: q,
      data: topics,
      count: topics.length,
    });
  } catch (error) {
    console.error('Error searching forum:', error);
    return res.status(500).json({
      success: false,
      message: 'Forum search failed',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * POST /api/forums/reply/:replyId/accept
 * Mark reply as accepted answer
 */
exports.acceptAnswer = async (req, res) => {
  try {
    // Require authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const { replyId } = req.params;
    const { topicId } = req.body;

    if (!topicId) {
      return res.status(400).json({
        success: false,
        message: 'Topic ID is required',
      });
    }

    const reply = await forumService.markAsAcceptedAnswer(replyId, topicId);

    return res.status(200).json({
      success: true,
      message: 'Answer marked as accepted',
      data: reply,
    });
  } catch (error) {
    console.error('Error accepting answer:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to accept answer',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * POST /api/forums/:targetId/react
 * Like or dislike topic/reply
 */
exports.reactToContent = async (req, res) => {
  try {
    // Require authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to react',
      });
    }

    const { targetId } = req.params;
    const { targetType, reactionType } = req.body;

    if (!['topic', 'reply'].includes(targetType)) {
      return res.status(400).json({
        success: false,
        message: 'Target type must be "topic" or "reply"',
      });
    }

    if (!['like', 'dislike'].includes(reactionType)) {
      return res.status(400).json({
        success: false,
        message: 'Reaction type must be "like" or "dislike"',
      });
    }

    const result = await forumService.addReaction(targetId, targetType, req.user.id, reactionType);

    return res.status(200).json({
      success: true,
      message: 'Reaction recorded',
      data: result,
    });
  } catch (error) {
    console.error('Error reacting to content:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record reaction',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * POST /api/forums/init
 * Initialize forum with seed data (admin only)
 */
exports.initializeForum = async (req, res) => {
  try {
    // Check if initialization is allowed
    if (process.env.INIT_ALLOWED !== 'true') {
      return res.status(403).json({
        success: false,
        message: 'Initialization not allowed',
      });
    }

    const result = await forumService.seedInitialData();

    return res.status(200).json({
      success: true,
      message: 'Forum initialized successfully',
      data: result,
    });
  } catch (error) {
    console.error('Error initializing forum:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initialize forum',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};
