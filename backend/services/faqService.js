/**
 * FAQ Service
 * ============================================================================
 * Manages frequently asked questions and answers
 */

const mongoose = require('mongoose');

// FAQ Schema
const FAQSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer: { type: String, required: true },
  category: { type: String, required: true },
  tags: [String],
  keywords: [String],
  helpful: { type: Number, default: 0 },
  notHelpful: { type: Number, default: 0 },
  views: { type: Number, default: 0 },
  featured: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  relatedFAQs: [String], // questions of related FAQs
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// FAQ Category Schema
const FAQCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, unique: true, required: true },
  description: String,
  icon: String,
  order: { type: Number, default: 0 },
  faqCount: { type: Number, default: 0 },
});

// FAQ Feedback Schema
const FAQFeedbackSchema = new mongoose.Schema({
  faqId: mongoose.Schema.Types.ObjectId,
  userId: mongoose.Schema.Types.ObjectId,
  helpful: Boolean,
  comment: String,
  createdAt: { type: Date, default: Date.now },
});

const FAQ = mongoose.model('FAQ', FAQSchema);
const FAQCategory = mongoose.model('FAQCategory', FAQCategorySchema);
const FAQFeedback = mongoose.model('FAQFeedback', FAQFeedbackSchema);

/**
 * Get all FAQ categories
 */
async function getAllCategories() {
  try {
    const categories = await FAQCategory.find().sort({ order: 1 });
    return categories;
  } catch (error) {
    throw new Error(`Failed to retrieve FAQ categories: ${error.message}`);
  }
}

/**
 * Get FAQs by category
 */
async function getFAQsByCategory(categorySlug) {
  try {
    const faqs = await FAQ.find({ category: categorySlug }).sort({ featured: -1, order: 1 });
    return faqs;
  } catch (error) {
    throw new Error(`Failed to retrieve FAQs: ${error.message}`);
  }
}

/**
 * Get all FAQs
 */
async function getAllFAQs() {
  try {
    const faqs = await FAQ.find().sort({ featured: -1, order: 1 });
    return faqs;
  } catch (error) {
    throw new Error(`Failed to retrieve all FAQs: ${error.message}`);
  }
}

/**
 * Search FAQs
 */
async function searchFAQs(query) {
  try {
    const faqs = await FAQ.find({
      $or: [
        { question: { $regex: query, $options: 'i' } },
        { answer: { $regex: query, $options: 'i' } },
        { keywords: { $regex: query, $options: 'i' } },
        { tags: { $regex: query, $options: 'i' } },
      ],
    })
      .limit(20)
      .sort({ views: -1 });
    return faqs;
  } catch (error) {
    throw new Error(`FAQ search failed: ${error.message}`);
  }
}

/**
 * Get featured FAQs
 */
async function getFeaturedFAQs(limit = 10) {
  try {
    const faqs = await FAQ.find({ featured: true }).limit(limit).sort({ order: 1 });
    return faqs;
  } catch (error) {
    throw new Error(`Failed to retrieve featured FAQs: ${error.message}`);
  }
}

/**
 * Get most viewed FAQs
 */
async function getMostViewedFAQs(limit = 10) {
  try {
    const faqs = await FAQ.find().sort({ views: -1 }).limit(limit);
    return faqs;
  } catch (error) {
    throw new Error(`Failed to retrieve popular FAQs: ${error.message}`);
  }
}

/**
 * Record FAQ feedback
 */
async function recordFeedback(faqId, userId, helpful, comment) {
  try {
    const feedback = new FAQFeedback({
      faqId,
      userId,
      helpful,
      comment,
    });

    await feedback.save();

    // Update FAQ counts
    if (helpful) {
      await FAQ.updateOne({ _id: faqId }, { $inc: { helpful: 1 } });
    } else {
      await FAQ.updateOne({ _id: faqId }, { $inc: { notHelpful: 1 } });
    }

    return feedback;
  } catch (error) {
    throw new Error(`Failed to record FAQ feedback: ${error.message}`);
  }
}

/**
 * Track FAQ view
 */
async function trackView(faqId) {
  try {
    await FAQ.updateOne({ _id: faqId }, { $inc: { views: 1 } });
  } catch (error) {
    console.error('Failed to track FAQ view:', error);
  }
}

/**
 * Get related FAQs
 */
async function getRelatedFAQs(faqId) {
  try {
    const faq = await FAQ.findById(faqId);
    if (!faq || !faq.relatedFAQs.length) {
      return [];
    }

    const related = await FAQ.find({
      _id: { $in: faq.relatedFAQs },
    });
    return related;
  } catch (error) {
    throw new Error(`Failed to retrieve related FAQs: ${error.message}`);
  }
}

/**
 * Seed FAQ with initial data
 */
async function seedInitialData() {
  try {
    // Check if data already exists
    const existingCount = await FAQ.countDocuments();
    if (existingCount > 0) {
      return { message: 'FAQ data already exists' };
    }

    // Create FAQ categories
    const categories = [
      {
        name: 'Account & Security',
        slug: 'account-security',
        description: 'Account and security FAQs',
        icon: 'shield',
        order: 1,
      },
      {
        name: 'Groups',
        slug: 'groups',
        description: 'Savings groups FAQs',
        icon: 'users',
        order: 2,
      },
      {
        name: 'Contributions',
        slug: 'contributions',
        description: 'Contribution FAQs',
        icon: 'wallet',
        order: 3,
      },
      { name: 'Loans', slug: 'loans', description: 'Loan FAQs', icon: 'money-bill', order: 4 },
      {
        name: 'Payments',
        slug: 'payments',
        description: 'Payment FAQs',
        icon: 'credit-card',
        order: 5,
      },
      { name: 'General', slug: 'general', description: 'General FAQs', icon: 'question', order: 6 },
    ];

    await FAQCategory.insertMany(categories);

    // Create initial FAQs
    const faqs = [
      {
        question: 'What is Community Savings App?',
        answer:
          'Community Savings App is a mobile platform that enables communities to save money together, manage group finances, and access microloans. It facilitates peer-to-peer lending and group savings management.',
        category: 'general',
        tags: ['about', 'app'],
        keywords: ['what', 'community', 'savings'],
        featured: true,
        order: 1,
      },
      {
        question: 'How do I create an account?',
        answer:
          'Download the app, click "Sign Up", enter your email, create a password, and verify your phone number. Fill in your profile information and you\'re ready to start.',
        category: 'account-security',
        tags: ['signup', 'account'],
        keywords: ['create', 'account', 'register'],
        featured: true,
        order: 1,
      },
      {
        question: 'Is my information secure?',
        answer:
          'Yes, we use industry-standard encryption (TLS 1.2+), secure servers, and comply with GDPR and Kenya Data Protection Act. Your data is protected with multiple security layers.',
        category: 'account-security',
        tags: ['security', 'privacy'],
        keywords: ['secure', 'safe', 'encryption'],
        featured: true,
        order: 2,
      },
      {
        question: 'How do savings groups work?',
        answer:
          'Groups are communities of 3-50 members who save together. Members contribute regularly, funds are pooled, and members can borrow from the group pool. Each group sets its own rules and contribution amounts.',
        category: 'groups',
        tags: ['groups', 'how-it-works'],
        keywords: ['group', 'savings', 'community'],
        featured: true,
        order: 1,
      },
      {
        question: 'What payment methods do you accept?',
        answer:
          'We accept M-Pesa, Stripe (card payments), MTN MoMo, and Airtel Money. Choose your preferred method during checkout.',
        category: 'payments',
        tags: ['payments', 'methods'],
        keywords: ['payment', 'mpesa', 'card'],
        featured: true,
        order: 1,
      },
      {
        question: 'Can I get a loan?',
        answer:
          "Yes! Once you're part of an active savings group, you can request loans. Loan approval depends on your contribution history and group consensus. Loans range from KES 1,000 to KES 1,000,000.",
        category: 'loans',
        tags: ['loans', 'borrowing'],
        keywords: ['loan', 'borrow', 'request'],
        featured: true,
        order: 1,
      },
      {
        question: 'What are transaction fees?',
        answer:
          'Contribution and withdrawal fees vary by group: standard is 1% per transaction. Premium groups may have lower fees. Loan processing fee is 5% of loan amount.',
        category: 'payments',
        tags: ['fees', 'costs'],
        keywords: ['fee', 'charge', 'cost'],
        featured: false,
        order: 2,
      },
      {
        question: 'How are loan repayments scheduled?',
        answer:
          'Repayment schedules are customized per loan. Typically 3-24 monthly payments. Late payments accrue penalties of 2% per month. Groups can grant extensions by consensus.',
        category: 'loans',
        tags: ['repayment', 'schedule'],
        keywords: ['repay', 'schedule', 'payment'],
        featured: false,
        order: 2,
      },
    ];

    await FAQ.insertMany(faqs);

    return {
      message: 'FAQ system initialized successfully',
      categoriesCreated: categories.length,
      faqsCreated: faqs.length,
    };
  } catch (error) {
    throw new Error(`Failed to seed FAQ data: ${error.message}`);
  }
}

module.exports = {
  getAllCategories,
  getFAQsByCategory,
  getAllFAQs,
  searchFAQs,
  getFeaturedFAQs,
  getMostViewedFAQs,
  recordFeedback,
  trackView,
  getRelatedFAQs,
  seedInitialData,
  FAQ,
  FAQCategory,
  FAQFeedback,
};
