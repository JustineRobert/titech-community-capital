/**
 * =============================================================================
 * TITech Community Capital LTD
 * Community Forums Service
 * =============================================================================
 *
 * File:
 *   backend/services/forumService.js
 *
 * Purpose:
 *   Backend-native service for community forum categories, topics, replies,
 *   search, reactions, accepted answers, and initial forum seeding.
 *
 * Architecture:
 *   Route/Controller
 *        ↓
 *   forumService
 *        ↓
 *   Mongoose Models
 *        ↓
 *   MongoDB
 *
 * Important:
 *   - No VITE_* environment variables
 *   - No frontend Axios client
 *   - No self-HTTP requests
 *   - No duplicate schemas/models
 *   - Uses MongoDB transactions for related writes where appropriate
 *   - Validates IDs, pagination, reaction types, and text input
 *   - Prevents duplicate reactions through a compound unique index
 *
 * Module:
 *   CommonJS
 * =============================================================================
 */

'use strict';

const mongoose = require('mongoose');

const {
  Schema,
  Types: { ObjectId },
} = mongoose;

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PAGE = 1;
const DEFAULT_TOPIC_LIMIT = 20;
const DEFAULT_REPLY_LIMIT = 10;
const DEFAULT_FEED_LIMIT = 10;
const MAX_TOPIC_LIMIT = 100;
const MAX_REPLY_LIMIT = 100;
const MAX_FEED_LIMIT = 50;

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20_000;
const MAX_CATEGORY_NAME_LENGTH = 100;
const MAX_CATEGORY_DESCRIPTION_LENGTH = 500;
const MAX_USERNAME_LENGTH = 120;
const MAX_TAG_LENGTH = 50;
const MAX_TAGS = 20;
const MAX_SEARCH_LENGTH = 100;

const REACTION_TYPES = Object.freeze({
  LIKE: 'like',
  DISLIKE: 'dislike',
});

const TARGET_TYPES = Object.freeze({
  TOPIC: 'topic',
  REPLY: 'reply',
});

// =============================================================================
// HELPERS
// =============================================================================

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ');
}

function normalizeLongText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeSlug(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function createUniqueSlug(title) {
  const base = normalizeSlug(title).substring(0, 70);
  const suffix = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  return `${base || 'topic'}-${suffix}`;
}

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function normalizePagination(page, limit, defaults) {
  return {
    page: parsePositiveInteger(
      page,
      defaults.page,
      Number.MAX_SAFE_INTEGER,
    ),
    limit: parsePositiveInteger(
      limit,
      defaults.limit,
      defaults.max,
    ),
  };
}

function assertValidObjectId(value, fieldName) {
  if (!ObjectId.isValid(value)) {
    const error = new Error(`${fieldName} must be a valid MongoDB ObjectId`);
    error.code = 'INVALID_ID';
    error.statusCode = 400;
    throw error;
  }
}

function assertRequiredText(value, fieldName, maxLength) {
  const normalized = normalizeText(value);

  if (!normalized) {
    const error = new Error(`${fieldName} is required`);
    error.code = 'VALIDATION_ERROR';
    error.statusCode = 400;
    throw error;
  }

  if (normalized.length > maxLength) {
    const error = new Error(
      `${fieldName} must not exceed ${maxLength} characters`,
    );
    error.code = 'VALIDATION_ERROR';
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(
    tags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => normalizeText(tag).toLowerCase())
      .filter(Boolean)
      .map((tag) => tag.substring(0, MAX_TAG_LENGTH)),
  )].slice(0, MAX_TAGS);
}

function normalizeAuthor(author = {}) {
  const normalized = {
    userId: undefined,
    username: undefined,
    avatar: undefined,
  };

  if (author.userId) {
    if (!ObjectId.isValid(author.userId)) {
      const error = new Error('author.userId must be a valid ObjectId');
      error.code = 'INVALID_ID';
      error.statusCode = 400;
      throw error;
    }

    normalized.userId = author.userId;
  }

  if (author.username) {
    normalized.username = normalizeText(author.username)
      .substring(0, MAX_USERNAME_LENGTH);
  }

  if (author.avatar) {
    normalized.avatar = String(author.avatar).trim();
  }

  return normalized;
}

function buildPagination(page, limit, total) {
  return {
    page,
    limit,
    total,
    pages: total === 0 ? 0 : Math.ceil(total / limit),
    hasNextPage: page * limit < total,
    hasPreviousPage: page > 1,
  };
}

function serviceError(message, cause) {
  const error = new Error(message);

  if (cause) {
    error.cause = cause;
  }

  return error;
}

async function withTransaction(work) {
  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await work(session);
    });

    return result;
  } finally {
    await session.endSession();
  }
}

// =============================================================================
// EMBEDDED SCHEMAS
// =============================================================================

const AuthorSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      index: true,
    },

    username: {
      type: String,
      trim: true,
      maxlength: MAX_USERNAME_LENGTH,
    },

    avatar: {
      type: String,
      trim: true,
      maxlength: 1_000,
    },
  },
  {
    _id: false,
    id: false,
  },
);

// =============================================================================
// FORUM TOPIC
// =============================================================================

const ForumTopicSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_TITLE_LENGTH,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_CONTENT_LENGTH,
    },

    category: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    author: {
      type: AuthorSchema,
      default: undefined,
    },

    tags: {
      type: [String],
      default: [],
      index: true,
    },

    views: {
      type: Number,
      default: 0,
      min: 0,
    },

    replies: {
      type: Number,
      default: 0,
      min: 0,
    },

    likes: {
      type: Number,
      default: 0,
      min: 0,
    },

    dislikes: {
      type: Number,
      default: 0,
      min: 0,
    },

    pinned: {
      type: Boolean,
      default: false,
      index: true,
    },

    locked: {
      type: Boolean,
      default: false,
      index: true,
    },

    solved: {
      type: Boolean,
      default: false,
      index: true,
    },

    lastReplyAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: true,
    strict: true,
  },
);

ForumTopicSchema.index({
  category: 1,
  pinned: -1,
  lastReplyAt: -1,
});

ForumTopicSchema.index({
  createdAt: -1,
});

ForumTopicSchema.index({
  views: -1,
  replies: -1,
});

ForumTopicSchema.index({
  title: 'text',
  content: 'text',
  tags: 'text',
});

// =============================================================================
// FORUM REPLY
// =============================================================================

const ForumReplySchema = new Schema(
  {
    topicId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'ForumTopic',
      index: true,
    },

    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_CONTENT_LENGTH,
    },

    author: {
      type: AuthorSchema,
      default: undefined,
    },

    likes: {
      type: Number,
      default: 0,
      min: 0,
    },

    dislikes: {
      type: Number,
      default: 0,
      min: 0,
    },

    acceptedAnswer: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: true,
    strict: true,
  },
);

ForumReplySchema.index({
  topicId: 1,
  acceptedAnswer: -1,
  likes: -1,
  createdAt: 1,
});

// =============================================================================
// FORUM CATEGORY
// =============================================================================

const ForumCategorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_CATEGORY_NAME_LENGTH,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: MAX_CATEGORY_DESCRIPTION_LENGTH,
    },

    icon: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    topicCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    replyCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastActivityAt: {
      type: Date,
      default: null,
      index: true,
    },

    order: {
      type: Number,
      default: 0,
      index: true,
    },

    private: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: true,
    strict: true,
  },
);

ForumCategorySchema.index({
  order: 1,
  name: 1,
});

// =============================================================================
// FORUM REACTION
// =============================================================================

const ForumReactionSchema = new Schema(
  {
    targetId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    targetType: {
      type: String,
      required: true,
      enum: Object.values(TARGET_TYPES),
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    type: {
      type: String,
      required: true,
      enum: Object.values(REACTION_TYPES),
    },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: true,
  },
);

// One active reaction per user per target.
ForumReactionSchema.index(
  {
    targetId: 1,
    targetType: 1,
    userId: 1,
  },
  {
    unique: true,
    name: 'unique_forum_user_reaction',
  },
);

ForumReactionSchema.index({
  targetId: 1,
  targetType: 1,
  type: 1,
});

// =============================================================================
// MODELS
// =============================================================================
//
// Using mongoose.models prevents OverwriteModelError during hot reloads,
// tests, and development restarts.
//

const ForumTopic =
  mongoose.models.ForumTopic ||
  mongoose.model('ForumTopic', ForumTopicSchema);

const ForumReply =
  mongoose.models.ForumReply ||
  mongoose.model('ForumReply', ForumReplySchema);

const ForumCategory =
  mongoose.models.ForumCategory ||
  mongoose.model('ForumCategory', ForumCategorySchema);

const ForumReaction =
  mongoose.models.ForumReaction ||
  mongoose.model('ForumReaction', ForumReactionSchema);

// =============================================================================
// CATEGORY SERVICES
// =============================================================================

async function getAllCategories(options = {}) {
  try {
    const query = {};

    if (typeof options.includePrivate === 'boolean') {
      if (!options.includePrivate) {
        query.private = false;
      }
    } else {
      query.private = false;
    }

    return await ForumCategory.find(query)
      .sort({ order: 1, name: 1 })
      .lean()
      .exec();
  } catch (error) {
    throw serviceError(
      `Failed to retrieve forum categories: ${error.message}`,
      error,
    );
  }
}

// Backwards-compatible alias.
const getCategories = getAllCategories;

// =============================================================================
// TOPIC SERVICES
// =============================================================================

async function getTopicsByCategory(
  categorySlug,
  page = DEFAULT_PAGE,
  limit = DEFAULT_TOPIC_LIMIT,
) {
  try {
    const category = assertRequiredText(
      categorySlug,
      'category',
      MAX_CATEGORY_NAME_LENGTH,
    ).toLowerCase();

    const pagination = normalizePagination(
      page,
      limit,
      {
        page: DEFAULT_PAGE,
        limit: DEFAULT_TOPIC_LIMIT,
        max: MAX_TOPIC_LIMIT,
      },
    );

    const filter = {
      category,
      locked: false,
    };

    const [topics, total] = await Promise.all([
      ForumTopic.find(filter)
        .sort({
          pinned: -1,
          lastReplyAt: -1,
          createdAt: -1,
        })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .lean()
        .exec(),

      ForumTopic.countDocuments(filter),
    ]);

    return {
      topics,
      pagination: buildPagination(
        pagination.page,
        pagination.limit,
        total,
      ),
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw serviceError(
      `Failed to retrieve topics: ${error.message}`,
      error,
    );
  }
}

async function getTopicWithReplies(
  topicSlug,
  page = DEFAULT_PAGE,
  limit = DEFAULT_REPLY_LIMIT,
) {
  try {
    const slug = assertRequiredText(
      topicSlug,
      'topic slug',
      200,
    ).toLowerCase();

    const pagination = normalizePagination(
      page,
      limit,
      {
        page: DEFAULT_PAGE,
        limit: DEFAULT_REPLY_LIMIT,
        max: MAX_REPLY_LIMIT,
      },
    );

    const topic = await ForumTopic.findOne({ slug }).lean().exec();

    if (!topic) {
      const error = new Error('Topic not found');
      error.code = 'TOPIC_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    // Increment the view count atomically instead of loading/saving
    // the entire topic document.
    await ForumTopic.updateOne(
      { _id: topic._id },
      { $inc: { views: 1 } },
    ).exec();

    const replyFilter = {
      topicId: topic._id,
    };

    const [replies, totalReplies] = await Promise.all([
      ForumReply.find(replyFilter)
        .sort({
          acceptedAnswer: -1,
          likes: -1,
          createdAt: 1,
        })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .lean()
        .exec(),

      ForumReply.countDocuments(replyFilter),
    ]);

    return {
      topic: {
        ...topic,
        views: topic.views + 1,
      },

      replies,

      pagination: buildPagination(
        pagination.page,
        pagination.limit,
        totalReplies,
      ),
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw serviceError(
      `Failed to retrieve topic: ${error.message}`,
      error,
    );
  }
}

// Backwards-compatible alias.
const getTopic = getTopicWithReplies;

async function createTopic(title, content, category, author = {}, options = {}) {
  try {
    const normalizedTitle = assertRequiredText(
      title,
      'title',
      MAX_TITLE_LENGTH,
    );

    const normalizedContent = assertRequiredText(
      content,
      'content',
      MAX_CONTENT_LENGTH,
    );

    const normalizedCategory = assertRequiredText(
      category,
      'category',
      MAX_CATEGORY_NAME_LENGTH,
    ).toLowerCase();

    const normalizedAuthor = normalizeAuthor(author);
    const tags = normalizeTags(options.tags);

    const categoryExists = await ForumCategory.exists({
      slug: normalizedCategory,
      private: false,
    });

    if (!categoryExists) {
      const error = new Error('Forum category not found');
      error.code = 'CATEGORY_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    return await withTransaction(async (session) => {
      const topic = new ForumTopic({
        title: normalizedTitle,
        slug: createUniqueSlug(normalizedTitle),
        content: normalizedContent,
        category: normalizedCategory,
        author: normalizedAuthor,
        tags,
        pinned: Boolean(options.pinned),
      });

      await topic.save({ session });

      await ForumCategory.updateOne(
        { slug: normalizedCategory },
        {
          $inc: {
            topicCount: 1,
          },
          $set: {
            lastActivityAt: new Date(),
          },
        },
        { session },
      ).exec();

      return topic;
    });
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw serviceError(
      `Failed to create topic: ${error.message}`,
      error,
    );
  }
}

async function addReply(topicId, content, author = {}) {
  try {
    assertValidObjectId(topicId, 'topicId');

    const normalizedContent = assertRequiredText(
      content,
      'content',
      MAX_CONTENT_LENGTH,
    );

    const normalizedAuthor = normalizeAuthor(author);

    return await withTransaction(async (session) => {
      const topic = await ForumTopic.findById(topicId)
        .session(session)
        .exec();

      if (!topic) {
        const error = new Error('Topic not found');
        error.code = 'TOPIC_NOT_FOUND';
        error.statusCode = 404;
        throw error;
      }

      if (topic.locked) {
        const error = new Error('Topic is locked');
        error.code = 'TOPIC_LOCKED';
        error.statusCode = 409;
        throw error;
      }

      const reply = new ForumReply({
        topicId: topic._id,
        content: normalizedContent,
        author: normalizedAuthor,
      });

      await reply.save({ session });

      const now = new Date();

      await ForumTopic.updateOne(
        { _id: topic._id },
        {
          $inc: {
            replies: 1,
          },
          $set: {
            lastReplyAt: now,
          },
        },
        { session },
      ).exec();

      await ForumCategory.updateOne(
        { slug: topic.category },
        {
          $inc: {
            replyCount: 1,
          },
          $set: {
            lastActivityAt: now,
          },
        },
        { session },
      ).exec();

      return reply;
    });
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw serviceError(
      `Failed to add reply: ${error.message}`,
      error,
    );
  }
}

// =============================================================================
// SEARCH
// =============================================================================

async function searchTopics(query, options = {}) {
  try {
    const normalizedQuery = normalizeText(query).substring(
      0,
      MAX_SEARCH_LENGTH,
    );

    if (!normalizedQuery) {
      return [];
    }

    const limit = parsePositiveInteger(
      options.limit,
      DEFAULT_FEED_LIMIT,
      MAX_FEED_LIMIT,
    );

    const escapedQuery = normalizedQuery.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );

    return await ForumTopic.find({
      $or: [
        {
          title: {
            $regex: escapedQuery,
            $options: 'i',
          },
        },
        {
          content: {
            $regex: escapedQuery,
            $options: 'i',
          },
        },
        {
          tags: {
            $regex: escapedQuery,
            $options: 'i',
          },
        },
      ],
      locked: false,
    })
      .sort({
        pinned: -1,
        views: -1,
        replies: -1,
        createdAt: -1,
      })
      .limit(limit)
      .lean()
      .exec();
  } catch (error) {
    throw serviceError(
      `Forum search failed: ${error.message}`,
      error,
    );
  }
}

// =============================================================================
// FEEDS
// =============================================================================

async function getTrendingTopics(limit = DEFAULT_FEED_LIMIT) {
  try {
    const normalizedLimit = parsePositiveInteger(
      limit,
      DEFAULT_FEED_LIMIT,
      MAX_FEED_LIMIT,
    );

    return await ForumTopic.find({
      locked: false,
    })
      .sort({
        views: -1,
        replies: -1,
        lastReplyAt: -1,
      })
      .limit(normalizedLimit)
      .lean()
      .exec();
  } catch (error) {
    throw serviceError(
      `Failed to retrieve trending topics: ${error.message}`,
      error,
    );
  }
}

async function getLatestTopics(limit = DEFAULT_FEED_LIMIT) {
  try {
    const normalizedLimit = parsePositiveInteger(
      limit,
      DEFAULT_FEED_LIMIT,
      MAX_FEED_LIMIT,
    );

    return await ForumTopic.find({
      locked: false,
    })
      .sort({
        createdAt: -1,
      })
      .limit(normalizedLimit)
      .lean()
      .exec();
  } catch (error) {
    throw serviceError(
      `Failed to retrieve latest topics: ${error.message}`,
      error,
    );
  }
}

// =============================================================================
// ACCEPTED ANSWER
// =============================================================================

async function markAsAcceptedAnswer(replyId, topicId) {
  try {
    assertValidObjectId(replyId, 'replyId');
    assertValidObjectId(topicId, 'topicId');

    return await withTransaction(async (session) => {
      const reply = await ForumReply.findOne({
        _id: replyId,
        topicId,
      })
        .session(session)
        .exec();

      if (!reply) {
        const error = new Error(
          'Reply not found for the specified topic',
        );
        error.code = 'REPLY_NOT_FOUND';
        error.statusCode = 404;
        throw error;
      }

      await ForumReply.updateMany(
        {
          topicId,
          _id: {
            $ne: replyId,
          },
        },
        {
          $set: {
            acceptedAnswer: false,
          },
        },
        {
          session,
        },
      ).exec();

      reply.acceptedAnswer = true;

      await reply.save({ session });

      await ForumTopic.updateOne(
        {
          _id: topicId,
        },
        {
          $set: {
            solved: true,
          },
        },
        {
          session,
        },
      ).exec();

      return reply;
    });
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw serviceError(
      `Failed to mark accepted answer: ${error.message}`,
      error,
    );
  }
}

// =============================================================================
// REACTIONS
// =============================================================================

async function addReaction(
  targetId,
  targetType,
  userId,
  reactionType,
) {
  try {
    assertValidObjectId(targetId, 'targetId');
    assertValidObjectId(userId, 'userId');

    if (!Object.values(TARGET_TYPES).includes(targetType)) {
      const error = new Error(
        'targetType must be either "topic" or "reply"',
      );
      error.code = 'VALIDATION_ERROR';
      error.statusCode = 400;
      throw error;
    }

    if (!Object.values(REACTION_TYPES).includes(reactionType)) {
      const error = new Error(
        'reactionType must be either "like" or "dislike"',
      );
      error.code = 'VALIDATION_ERROR';
      error.statusCode = 400;
      throw error;
    }

    return await withTransaction(async (session) => {
      const TargetModel =
        targetType === TARGET_TYPES.TOPIC
          ? ForumTopic
          : ForumReply;

      const target = await TargetModel.findById(targetId)
        .session(session)
        .exec();

      if (!target) {
        const error = new Error(
          `${targetType} not found`,
        );
        error.code = 'TARGET_NOT_FOUND';
        error.statusCode = 404;
        throw error;
      }

      const existing = await ForumReaction.findOne({
        targetId,
        targetType,
        userId,
      })
        .session(session)
        .exec();

      if (existing && existing.type === reactionType) {
        await ForumReaction.deleteOne({
          _id: existing._id,
        })
          .session(session)
          .exec();
      } else if (existing) {
        existing.type = reactionType;

        await existing.save({
          session,
        });
      } else {
        try {
          await ForumReaction.create(
            [
              {
                targetId,
                targetType,
                userId,
                type: reactionType,
              },
            ],
            {
              session,
            },
          );
        } catch (error) {
          // A concurrent request can win the unique index race.
          if (error?.code !== 11000) {
            throw error;
          }

          const concurrent = await ForumReaction.findOne({
            targetId,
            targetType,
            userId,
          })
            .session(session)
            .exec();

          if (!concurrent) {
            throw error;
          }

          concurrent.type = reactionType;

          await concurrent.save({
            session,
          });
        }
      }

      const [likes, dislikes] = await Promise.all([
        ForumReaction.countDocuments({
          targetId,
          targetType,
          type: REACTION_TYPES.LIKE,
        })
          .session(session)
          .exec(),

        ForumReaction.countDocuments({
          targetId,
          targetType,
          type: REACTION_TYPES.DISLIKE,
        })
          .session(session)
          .exec(),
      ]);

      await TargetModel.updateOne(
        {
          _id: targetId,
        },
        {
          $set: {
            likes,
            dislikes,
          },
        },
        {
          session,
        },
      ).exec();

      return {
        targetId,
        targetType,
        likes,
        dislikes,
        userReaction:
          await ForumReaction.findOne({
            targetId,
            targetType,
            userId,
          })
            .session(session)
            .lean()
            .exec(),
      };
    });
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw serviceError(
      `Failed to add reaction: ${error.message}`,
      error,
    );
  }
}

// =============================================================================
// SEEDING
// =============================================================================

async function seedInitialData() {
  try {
    const existingCount = await ForumCategory.countDocuments();

    if (existingCount > 0) {
      return {
        message: 'Forum data already exists',
        seeded: false,
      };
    }

    const categories = [
      {
        name: 'General Discussion',
        slug: 'general',
        description: 'General Community Capital discussions',
        icon: 'comments',
        order: 1,
      },
      {
        name: 'Groups',
        slug: 'groups',
        description: 'Discuss savings and community groups',
        icon: 'users',
        order: 2,
      },
      {
        name: 'Loans',
        slug: 'loans',
        description: 'Loan-related discussions and questions',
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
        description: 'Request new features and improvements',
        icon: 'lightbulb',
        order: 5,
      },
      {
        name: 'Bug Reports',
        slug: 'bugs',
        description: 'Report issues and platform bugs',
        icon: 'bug',
        order: 6,
      },
      {
        name: 'Success Stories',
        slug: 'stories',
        description: 'Share community and savings success stories',
        icon: 'star',
        order: 7,
      },
    ];

    const topics = [
      {
        title: 'Welcome to the Community Capital Forum',
        slug: `welcome-forum-${Date.now()}`,
        content:
          'Welcome to our community forum. This is a space for members to discuss ideas, ask questions, share experiences, and help one another. Please remain respectful and follow the community guidelines.',
        category: 'general',
        author: {
          username: 'Admin',
          avatar: 'admin.jpg',
        },
        tags: ['welcome', 'community', 'forum'],
        pinned: true,
      },
      {
        title: 'Tips for Starting Your First Savings Group',
        slug: `starting-group-${Date.now()}`,
        content:
          'Here are some practical tips for starting your first savings group: choose trusted members, establish clear rules, agree on contribution amounts, define meeting schedules, and document decisions.',
        category: 'groups',
        author: {
          username: 'Moderator',
          avatar: 'mod.jpg',
        },
        tags: ['groups', 'savings', 'beginners'],
      },
    ];

    return await withTransaction(async (session) => {
      const createdCategories = await ForumCategory.insertMany(
        categories,
        {
          session,
          ordered: true,
        },
      );

      const createdTopics = await ForumTopic.insertMany(
        topics,
        {
          session,
          ordered: true,
        },
      );

      // Keep category counters consistent with seeded topics.
      await ForumCategory.updateOne(
        { slug: 'general' },
        {
          $inc: {
            topicCount: 1,
          },
          $set: {
            lastActivityAt: new Date(),
          },
        },
        { session },
      ).exec();

      await ForumCategory.updateOne(
        { slug: 'groups' },
        {
          $inc: {
            topicCount: 1,
          },
          $set: {
            lastActivityAt: new Date(),
          },
        },
        { session },
      ).exec();

      return {
        message: 'Forum initialized successfully',
        seeded: true,
        categoriesCreated: createdCategories.length,
        topicsCreated: createdTopics.length,
      };
    });
  } catch (error) {
    throw serviceError(
      `Failed to seed forum data: ${error.message}`,
      error,
    );
  }
}

// =============================================================================
// OPTIONAL ADMIN/MAINTENANCE HELPERS
// =============================================================================

async function recalculateTopicReactionCounts(targetId, targetType) {
  assertValidObjectId(targetId, 'targetId');

  if (!Object.values(TARGET_TYPES).includes(targetType)) {
    const error = new Error('Invalid targetType');
    error.code = 'VALIDATION_ERROR';
    error.statusCode = 400;
    throw error;
  }

  const TargetModel =
    targetType === TARGET_TYPES.TOPIC
      ? ForumTopic
      : ForumReply;

  const [likes, dislikes] = await Promise.all([
    ForumReaction.countDocuments({
      targetId,
      targetType,
      type: REACTION_TYPES.LIKE,
    }),

    ForumReaction.countDocuments({
      targetId,
      targetType,
      type: REACTION_TYPES.DISLIKE,
    }),
  ]);

  const target = await TargetModel.findByIdAndUpdate(
    targetId,
    {
      $set: {
        likes,
        dislikes,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  )
    .lean()
    .exec();

  return {
    targetId,
    targetType,
    likes,
    dislikes,
    target,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Services
  getAllCategories,
  getCategories,

  getTopicsByCategory,

  getTopicWithReplies,
  getTopic,

  createTopic,
  addReply,

  searchTopics,

  getTrendingTopics,
  getLatestTopics,

  markAsAcceptedAnswer,

  addReaction,

  seedInitialData,

  recalculateTopicReactionCounts,

  // Models
  ForumTopic,
  ForumReply,
  ForumCategory,
  ForumReaction,

  // Constants
  REACTION_TYPES,
  TARGET_TYPES,
};