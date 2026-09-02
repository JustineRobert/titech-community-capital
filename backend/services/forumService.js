/**
 * Community Forums Service (BACKEND SAFE VERSION)
 * ============================================================================
 * NOTE:
 * ✅ Removed VITE env usage (not allowed in Node)
 * ✅ Removed frontend axios service (belongs in React only)
 * ✅ Fixed mongoose import
 */
/**
 * Community Forums Service
 * ============================================================================
 * Manages community discussions, topics, and replies
 */
const mongoose = require('mongoose');
const axios = require('axios'); // ✅ FIX

const API_BASE_URL =
  process.env.API_URL ||
  process.env.BASE_URL ||
  'http://localhost:5000/api';

// ================= MODELS =================

// Forum Topic Schema
const ForumTopicSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, unique: true, required: true },
  content: { type: String, required: true },
  category: { type: String, required: true },
  author: {
    userId: mongoose.Schema.Types.ObjectId,
    username: String,
    avatar: String,
  },
  tags: [String],
  views: { type: Number, default: 0 },
  replies: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  dislikes: { type: Number, default: 0 },
  pinned: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  solved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastReplyAt: { type: Date, default: Date.now },
});

// Forum Reply Schema
const ForumReplySchema = new mongoose.Schema({
  topicId: mongoose.Schema.Types.ObjectId,
  content: { type: String, required: true },
  author: {
    userId: mongoose.Schema.Types.ObjectId,
    username: String,
    avatar: String,
  },
  likes: { type: Number, default: 0 },
  dislikes: { type: Number, default: 0 },
  acceptedAnswer: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Forum Category Schema
const ForumCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, unique: true, required: true },
  description: String,
  icon: String,
});

// Forum Reaction Schema
const ForumReactionSchema = new mongoose.Schema({
  targetId: mongoose.Schema.Types.ObjectId,
  targetType: { type: String, enum: ['topic', 'reply'] },
  userId: mongoose.Schema.Types.ObjectId,
  type: { type: String, enum: ['like', 'dislike'] },
});

// ================= MODELS =================

const ForumTopic = mongoose.model('ForumTopic', ForumTopicSchema);
const ForumReply = mongoose.model('ForumReply', ForumReplySchema);
const ForumCategory = mongoose.model('ForumCategory', ForumCategorySchema);
const ForumReaction = mongoose.model('ForumReaction', ForumReactionSchema);

// ================= SERVICES =================
const forumService = {

  getCategories: async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/forum/categories`);
      return res.data;
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }
  },

  getTopics: async (category, page = 1) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/forum/topics`, {
        params: { category, page },
      });
      return res.data;
    } catch (error) {
      console.error('Error fetching topics:', error);
      throw error;
    }
  },

  getTopic: async (slug) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/forum/topic/${slug}`);
      return res.data;
    } catch (error) {
      console.error('Error fetching topic:', error);
      throw error;
    }
  },

  createTopic: async (data) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/forum/topics`, data);
      return res.data;
    } catch (error) {
      console.error('Error creating topic:', error);
      throw error;
    }
  },

  addReply: async (topicId, data) => {
    try {
      const res = await axios.post(
        `${API_BASE_URL}/forum/topics/${topicId}/replies`,
        data
      );
      return res.data;
    } catch (error) {
      console.error('Error adding reply:', error);
      throw error;
    }
  },

  addReaction: async (targetId, type) => {
    try {
      const res = await axios.post(
        `${API_BASE_URL}/forum/react/${targetId}`,
        { type }
      );
      return res.data;
    } catch (error) {
      console.error('Error reacting:', error);
      throw error;
    }
  }
};

module.exports = forumService;
// const mongoose = require('mongoose');

// Forum Topic Schema
const ForumTopicSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, unique: true, required: true },
  content: { type: String, required: true },
  category: { type: String, required: true },
  author: {
    userId: mongoose.Schema.Types.ObjectId,
    username: String,
    avatar: String,
  },
  tags: [String],
  views: { type: Number, default: 0 },
  replies: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  dislikes: { type: Number, default: 0 },
  pinned: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  solved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastReplyAt: { type: Date, default: Date.now },
});

// Forum Reply Schema
const ForumReplySchema = new mongoose.Schema({
  topicId: mongoose.Schema.Types.ObjectId,
  content: { type: String, required: true },
  author: {
    userId: mongoose.Schema.Types.ObjectId,
    username: String,
    avatar: String,
  },
  likes: { type: Number, default: 0 },
  dislikes: { type: Number, default: 0 },
  acceptedAnswer: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Forum Category Schema
const ForumCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, unique: true, required: true },
  description: String,
  icon: String,
  topicCount: { type: Number, default: 0 },
  replyCount: { type: Number, default: 0 },
  lastActivityAt: Date,
  order: { type: Number, default: 0 },
  private: { type: Boolean, default: false },
});

// Forum Reaction Schema (likes/dislikes)
const ForumReactionSchema = new mongoose.Schema({
  targetId: mongoose.Schema.Types.ObjectId, // topic or reply ID
  targetType: { type: String, enum: ['topic', 'reply'] },
  userId: mongoose.Schema.Types.ObjectId,
  type: { type: String, enum: ['like', 'dislike'] },
  createdAt: { type: Date, default: Date.now },
});

const ForumTopic = mongoose.model('ForumTopic', ForumTopicSchema);
const ForumReply = mongoose.model('ForumReply', ForumReplySchema);
const ForumCategory = mongoose.model('ForumCategory', ForumCategorySchema);
const ForumReaction = mongoose.model('ForumReaction', ForumReactionSchema);

/**
 * Get all forum categories
 */
async function getAllCategories() {
  try {
    const categories = await ForumCategory.find().sort({ order: 1 });
    return categories;
  } catch (error) {
    throw new Error(`Failed to retrieve forum categories: ${error.message}`);
  }
}

/**
 * Get topics by category
 */
async function getTopicsByCategory(categorySlug, page = 1, limit = 20) {
  try {
    const skip = (page - 1) * limit;
    const topics = await ForumTopic.find({ category: categorySlug, locked: false })
      .sort({ pinned: -1, lastReplyAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await ForumTopic.countDocuments({ category: categorySlug });

    return {
      topics,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    throw new Error(`Failed to retrieve topics: ${error.message}`);
  }
}

/**
 * Get single topic with replies
 */
async function getTopicWithReplies(topicSlug, page = 1, limit = 10) {
  try {
    // Get topic
    const topic = await ForumTopic.findOne({ slug: topicSlug });
    if (!topic) {
      throw new Error('Topic not found');
    }

    // Increment views
    topic.views += 1;
    await topic.save();

    // Get replies
    const skip = (page - 1) * limit;
    const replies = await ForumReply.find({ topicId: topic._id })
      .sort({ acceptedAnswer: -1, likes: -1, createdAt: 1 })
      .skip(skip)
      .limit(limit);

    const totalReplies = await ForumReply.countDocuments({ topicId: topic._id });

    return {
      topic,
      replies,
      pagination: {
        page,
        limit,
        total: totalReplies,
        pages: Math.ceil(totalReplies / limit),
      },
    };
  } catch (error) {
    throw new Error(`Failed to retrieve topic: ${error.message}`);
  }
}

/**
 * Create new forum topic
 */
async function createTopic(title, content, category, author) {
  try {
    // Generate slug
    const slug = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);

    const topic = new ForumTopic({
      title,
      slug: `${slug}-${Date.now()}`,
      content,
      category,
      author,
    });

    await topic.save();

    // Update category
    await ForumCategory.updateOne(
      { slug: category },
      { $inc: { topicCount: 1 }, lastActivityAt: new Date() }
    );

    return topic;
  } catch (error) {
    throw new Error(`Failed to create topic: ${error.message}`);
  }
}

/**
 * Add reply to topic
 */
async function addReply(topicId, content, author) {
  try {
    const reply = new ForumReply({
      topicId,
      content,
      author,
    });

    await reply.save();

    // Update topic
    const topic = await ForumTopic.findByIdAndUpdate(
      topicId,
      { lastReplyAt: new Date(), $inc: { replies: 1 } },
      { new: true }
    );

    // Update category stats
    if (topic && topic.category) {
      await ForumCategory.updateOne(
        { slug: topic.category },
        { lastActivityAt: new Date(), $inc: { replyCount: 1 } }
      );
    }

    return reply;
  } catch (error) {
    throw new Error(`Failed to add reply: ${error.message}`);
  }
}

/**
 * Search forum topics
 */
async function searchTopics(query) {
  try {
    const topics = await ForumTopic.find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { content: { $regex: query, $options: 'i' } },
        { tags: { $regex: query, $options: 'i' } },
      ],
    })
      .sort({ views: -1 })
      .limit(20);

    return topics;
  } catch (error) {
    throw new Error(`Forum search failed: ${error.message}`);
  }
}

/**
 * Get trending topics
 */
async function getTrendingTopics(limit = 10) {
  try {
    const topics = await ForumTopic.find().sort({ views: -1, replies: -1 }).limit(limit);

    return topics;
  } catch (error) {
    throw new Error(`Failed to retrieve trending topics: ${error.message}`);
  }
}

/**
 * Get latest topics
 */
async function getLatestTopics(limit = 10) {
  try {
    const topics = await ForumTopic.find().sort({ createdAt: -1 }).limit(limit);

    return topics;
  } catch (error) {
    throw new Error(`Failed to retrieve latest topics: ${error.message}`);
  }
}

/**
 * Mark reply as accepted answer
 */
async function markAsAcceptedAnswer(replyId, topicId) {
  try {
    // Clear other accepted answers
    await ForumReply.updateMany({ topicId, _id: { $ne: replyId } }, { acceptedAnswer: false });

    // Mark this reply as accepted
    const reply = await ForumReply.findByIdAndUpdate(
      replyId,
      { acceptedAnswer: true },
      { new: true }
    );

    // Mark topic as solved
    await ForumTopic.findByIdAndUpdate(topicId, { solved: true });

    return reply;
  } catch (error) {
    throw new Error(`Failed to mark accepted answer: ${error.message}`);
  }
}

/**
 * React to topic or reply (like/dislike)
 */
async function addReaction(targetId, targetType, userId, reactionType) {
  try {
    // Check if user already reacted
    const existing = await ForumReaction.findOne({
      targetId,
      targetType,
      userId,
    });

    if (existing) {
      // Remove existing reaction if same type, update if different
      if (existing.type === reactionType) {
        await ForumReaction.deleteOne({ _id: existing._id });
      } else {
        existing.type = reactionType;
        await existing.save();
      }
    } else {
      // Add new reaction
      const reaction = new ForumReaction({
        targetId,
        targetType,
        userId,
        type: reactionType,
      });
      await reaction.save();
    }

    // Recalculate likes/dislikes
    const likes = await ForumReaction.countDocuments({
      targetId,
      targetType,
      type: 'like',
    });

    const dislikes = await ForumReaction.countDocuments({
      targetId,
      targetType,
      type: 'dislike',
    });

    // Update target
    if (targetType === 'topic') {
      await ForumTopic.findByIdAndUpdate(targetId, { likes, dislikes });
    } else {
      await ForumReply.findByIdAndUpdate(targetId, { likes, dislikes });
    }

    return { likes, dislikes };
  } catch (error) {
    throw new Error(`Failed to add reaction: ${error.message}`);
  }
}

/**
 * Seed forum with initial data
 */
async function seedInitialData() {
  try {
    // Check if data already exists
    const existingCount = await ForumCategory.countDocuments();
    if (existingCount > 0) {
      return { message: 'Forum data already exists' };
    }

    // Create categories
    const categories = [
      {
        name: 'General Discussion',
        slug: 'general',
        description: 'General app discussions',
        icon: 'comments',
        order: 1,
      },
      {
        name: 'Groups',
        slug: 'groups',
        description: 'Discuss savings groups',
        icon: 'users',
        order: 2,
      },
      {
        name: 'Loans',
        slug: 'loans',
        description: 'Loan-related discussions',
        icon: 'money-bill',
        order: 3,
      },
      {
        name: 'Payments',
        slug: 'payments',
        description: 'Payment and transaction help',
        icon: 'credit-card',
        order: 4,
      },
      {
        name: 'Feature Requests',
        slug: 'features',
        description: 'Request new features',
        icon: 'lightbulb',
        order: 5,
      },
      {
        name: 'Bug Reports',
        slug: 'bugs',
        description: 'Report issues and bugs',
        icon: 'bug',
        order: 6,
      },
      {
        name: 'Success Stories',
        slug: 'stories',
        description: 'Share your success stories',
        icon: 'star',
        order: 7,
      },
    ];

    await ForumCategory.insertMany(categories);

    // Create sample topics
    const topics = [
      {
        title: 'Welcome to Community Savings Forum!',
        slug: 'welcome-forum-' + Date.now(),
        content:
          'Welcome to our community forum! This is a space for members to discuss, ask questions, and share experiences. Please be respectful and follow community guidelines.',
        category: 'general',
        author: { username: 'Admin', avatar: 'admin.jpg' },
        tags: ['welcome', 'community'],
        pinned: true,
      },
      {
        title: 'Tips for Starting Your First Savings Group',
        slug: 'starting-group-' + Date.now(),
        content:
          'Here are some tips for starting your first savings group: 1. Find 3-5 trusted members, 2. Set clear rules, 3. Choose contribution amounts, 4. Regular meetings...',
        category: 'groups',
        author: { username: 'Moderator', avatar: 'mod.jpg' },
        tags: ['groups', 'tips', 'beginners'],
      },
    ];

    await ForumTopic.insertMany(topics);

    return {
      message: 'Forum initialized successfully',
      categoriesCreated: categories.length,
      topicsCreated: topics.length,
    };
  } catch (error) {
    throw new Error(`Failed to seed forum data: ${error.message}`);
  }
}

module.exports = {
  getAllCategories,
  getTopicsByCategory,
  getTopicWithReplies,
  createTopic,
  addReply,
  searchTopics,
  getTrendingTopics,
  getLatestTopics,
  markAsAcceptedAnswer,
  addReaction,
  seedInitialData,
  ForumTopic,
  ForumReply,
  ForumCategory,
  ForumReaction,
};
