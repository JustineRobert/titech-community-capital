/**
 * Help Center Service
 * ============================================================================
 * Manages help articles, categories, and user interactions
 */

const mongoose = require('mongoose');

// Help Article Schema
const HelpArticleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, unique: true, required: true },
  category: { type: String, required: true },
  subcategory: String,
  content: { type: String, required: true },
  summary: String,
  keywords: [String],
  tags: [String],
  publishedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  author: String,
  views: { type: Number, default: 0 },
  helpful: { type: Number, default: 0 },
  notHelpful: { type: Number, default: 0 },
  featured: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  relatedArticles: [String], // slugs of related articles
});

// Help Category Schema
const HelpCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, unique: true, required: true },
  description: String,
  icon: String,
  order: { type: Number, default: 0 },
  articleCount: { type: Number, default: 0 },
});

// Help Feedback Schema (for tracking article helpfulness)
const HelpFeedbackSchema = new mongoose.Schema({
  articleSlug: String,
  userId: mongoose.Schema.Types.ObjectId,
  helpful: Boolean,
  feedback: String,
  createdAt: { type: Date, default: Date.now },
});

const HelpArticle = mongoose.model('HelpArticle', HelpArticleSchema);
const HelpCategory = mongoose.model('HelpCategory', HelpCategorySchema);
const HelpFeedback = mongoose.model('HelpFeedback', HelpFeedbackSchema);

/**
 * Get all help categories with article counts
 */
async function getAllCategories() {
  try {
    const categories = await HelpCategory.find().sort({ order: 1 });
    return categories;
  } catch (error) {
    throw new Error(`Failed to retrieve categories: ${error.message}`);
  }
}

/**
 * Get articles by category
 */
async function getArticlesByCategory(categorySlug) {
  try {
    const articles = await HelpArticle.find({ category: categorySlug }).sort({
      featured: -1,
      order: 1,
    });
    return articles;
  } catch (error) {
    throw new Error(`Failed to retrieve articles: ${error.message}`);
  }
}

/**
 * Get single article by slug
 */
async function getArticleBySlug(slug) {
  try {
    const article = await HelpArticle.findOne({ slug });
    if (article) {
      // Increment view count
      article.views += 1;
      await article.save();
    }
    return article;
  } catch (error) {
    throw new Error(`Failed to retrieve article: ${error.message}`);
  }
}

/**
 * Search articles by keywords
 */
async function searchArticles(query) {
  try {
    const articles = await HelpArticle.find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { content: { $regex: query, $options: 'i' } },
        { keywords: { $regex: query, $options: 'i' } },
        { tags: { $regex: query, $options: 'i' } },
      ],
    }).limit(20);
    return articles;
  } catch (error) {
    throw new Error(`Search failed: ${error.message}`);
  }
}

/**
 * Get featured articles
 */
async function getFeaturedArticles(limit = 5) {
  try {
    const articles = await HelpArticle.find({ featured: true }).limit(limit).sort({ order: 1 });
    return articles;
  } catch (error) {
    throw new Error(`Failed to retrieve featured articles: ${error.message}`);
  }
}

/**
 * Get most viewed articles
 */
async function getMostViewedArticles(limit = 10) {
  try {
    const articles = await HelpArticle.find().sort({ views: -1 }).limit(limit);
    return articles;
  } catch (error) {
    throw new Error(`Failed to retrieve popular articles: ${error.message}`);
  }
}

/**
 * Record article feedback
 */
async function recordFeedback(articleSlug, userId, helpful, feedback) {
  try {
    const feedbackRecord = new HelpFeedback({
      articleSlug,
      userId,
      helpful,
      feedback,
    });

    await feedbackRecord.save();

    // Update article helpful counts
    if (helpful) {
      await HelpArticle.updateOne({ slug: articleSlug }, { $inc: { helpful: 1 } });
    } else {
      await HelpArticle.updateOne({ slug: articleSlug }, { $inc: { notHelpful: 1 } });
    }

    return feedbackRecord;
  } catch (error) {
    throw new Error(`Failed to record feedback: ${error.message}`);
  }
}

/**
 * Get related articles
 */
async function getRelatedArticles(slug) {
  try {
    const article = await HelpArticle.findOne({ slug });
    if (!article || !article.relatedArticles.length) {
      return [];
    }

    const related = await HelpArticle.find({
      slug: { $in: article.relatedArticles },
    });
    return related;
  } catch (error) {
    throw new Error(`Failed to retrieve related articles: ${error.message}`);
  }
}

/**
 * Seed help center with initial data
 */
async function seedInitialData() {
  try {
    // Check if data already exists
    const existingCount = await HelpArticle.countDocuments();
    if (existingCount > 0) {
      return { message: 'Help center data already exists' };
    }

    // Create categories
    const categories = [
      {
        name: 'Getting Started',
        slug: 'getting-started',
        description: 'Learn the basics',
        icon: 'rocket',
        order: 1,
      },
      {
        name: 'Account Management',
        slug: 'account-management',
        description: 'Manage your account',
        icon: 'user',
        order: 2,
      },
      {
        name: 'Groups & Contributions',
        slug: 'groups-contributions',
        description: 'Savings groups and contributions',
        icon: 'users',
        order: 3,
      },
      {
        name: 'Loans',
        slug: 'loans',
        description: 'Loan management and repayment',
        icon: 'money',
        order: 4,
      },
      {
        name: 'Payments',
        slug: 'payments',
        description: 'Payment methods and transactions',
        icon: 'credit-card',
        order: 5,
      },
      {
        name: 'Security',
        slug: 'security',
        description: 'Protect your account',
        icon: 'lock',
        order: 6,
      },
      {
        name: 'Troubleshooting',
        slug: 'troubleshooting',
        description: 'Common issues and solutions',
        icon: 'tools',
        order: 7,
      },
    ];

    await HelpCategory.insertMany(categories);

    // Create initial articles
    const articles = [
      {
        title: 'Getting Started with Community Savings App',
        slug: 'getting-started-guide',
        category: 'getting-started',
        content: 'Welcome to Community Savings App! This guide will help you get started...',
        summary: 'A comprehensive guide to get you started with the app',
        keywords: ['start', 'begin', 'tutorial'],
        tags: ['beginner', 'tutorial'],
        featured: true,
        order: 1,
        author: 'Support Team',
      },
      {
        title: 'How to Create Your Profile',
        slug: 'create-profile',
        category: 'account-management',
        content: 'To create your profile, follow these steps...',
        summary: 'Learn how to set up your profile',
        keywords: ['profile', 'setup', 'account'],
        tags: ['account', 'setup'],
        featured: true,
        order: 1,
        author: 'Support Team',
      },
      {
        title: 'Understanding Savings Groups',
        slug: 'understanding-groups',
        category: 'groups-contributions',
        content: 'Savings groups are community-based financial networks...',
        summary: 'Learn how savings groups work',
        keywords: ['group', 'savings', 'community'],
        tags: ['groups', 'savings'],
        featured: true,
        order: 1,
        author: 'Support Team',
      },
      {
        title: 'How to Request a Loan',
        slug: 'request-loan',
        category: 'loans',
        content: 'To request a loan from your group...',
        summary: 'Step-by-step guide to request a loan',
        keywords: ['loan', 'request', 'borrow'],
        tags: ['loans', 'borrowing'],
        featured: true,
        order: 1,
        author: 'Support Team',
      },
      {
        title: 'Payment Methods Available',
        slug: 'payment-methods',
        category: 'payments',
        content:
          'We support multiple payment methods including M-Pesa, Stripe, MTN MoMo, and Airtel Money...',
        summary: 'Learn about available payment options',
        keywords: ['payment', 'methods', 'mpesa', 'stripe'],
        tags: ['payments', 'methods'],
        featured: true,
        order: 1,
        author: 'Support Team',
      },
      {
        title: 'Keeping Your Account Secure',
        slug: 'account-security',
        category: 'security',
        content: 'Follow these security best practices to keep your account safe...',
        summary: 'Tips to secure your account',
        keywords: ['security', 'safe', 'password'],
        tags: ['security', 'safety'],
        featured: true,
        order: 1,
        author: 'Support Team',
      },
    ];

    await HelpArticle.insertMany(articles);

    return {
      message: 'Help center initialized successfully',
      categoriesCreated: categories.length,
      articlesCreated: articles.length,
    };
  } catch (error) {
    throw new Error(`Failed to seed initial data: ${error.message}`);
  }
}

module.exports = {
  getAllCategories,
  getArticlesByCategory,
  getArticleBySlug,
  searchArticles,
  getFeaturedArticles,
  getMostViewedArticles,
  recordFeedback,
  getRelatedArticles,
  seedInitialData,
  HelpArticle,
  HelpCategory,
  HelpFeedback,
};
