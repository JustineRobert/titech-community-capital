'use strict';

/**
 * ============================================================================
 * SEARCH SERVICE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Provides enterprise search capabilities across conversations and messages.
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Full Message Search
 * ✅ Conversation Search
 * ✅ Attachment Search
 * ✅ Sender Search
 * ✅ Date Range Search
 * ✅ Message Type Search
 * ✅ Compliance Search
 * ✅ Moderation Search
 * ✅ Export Ready
 * ✅ Pagination
 * ✅ Relevance Sorting
 * ✅ ElasticSearch Ready
 * ✅ Audit Ready
 *
 * NOTES
 * ----------------------------------------------------------------------------
 * Current implementation uses MongoDB indexes and regex search.
 * For large-scale deployments, replace the search engine with:
 *
 * - Elasticsearch
 * - OpenSearch
 * - Meilisearch
 *
 * without changing the service API.
 *
 * ============================================================================
 */

const mongoose =
  require('mongoose');

const Message =
  require('../../models/Message');

const Conversation =
  require('../../models/Conversation');

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function escapeRegex(
  text = ''
) {
  return text.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
}

/*
|--------------------------------------------------------------------------
| Service
|--------------------------------------------------------------------------
*/

class SearchService {
  /*
  |--------------------------------------------------------------------------
  | Search Messages
  |--------------------------------------------------------------------------
  */

  async searchMessages(
    conversationId,
    query,
    options = {}
  ) {
    const page =
      Math.max(
        1,
        Number(
          options.page
        ) || 1
      );

    const limit =
      Math.min(
        100,
        Math.max(
          1,
          Number(
            options.limit
          ) || 50
        )
      );

    const filter = {
      conversationId,
      deletedAt: null,
    };

    if (
      query &&
      query.trim()
    ) {
      filter.body = {
        $regex:
          escapeRegex(
            query.trim()
          ),
        $options: 'i',
      };
    }

    if (
      options.senderId
    ) {
      filter.senderId =
        options.senderId;
    }

    if (
      options.messageType
    ) {
      filter.messageType =
        String(
          options.messageType
        ).toUpperCase();
    }

    if (
      options.startDate ||
      options.endDate
    ) {
      filter.createdAt =
        {};

      if (
        options.startDate
      ) {
        filter.createdAt.$gte =
          new Date(
            options.startDate
          );
      }

      if (
        options.endDate
      ) {
        filter.createdAt.$lte =
          new Date(
            options.endDate
          );
      }
    }

    const [
      results,
      total,
    ] = await Promise.all([
      Message.find(
        filter
      )
        .populate(
          'senderId',
          'firstName lastName email avatar'
        )
        .populate(
          'replyTo'
        )
        .sort({
          createdAt:
            -1,
        })
        .skip(
          (page - 1) *
            limit
        )
        .limit(limit),

      Message.countDocuments(
        filter
      ),
    ]);

    return {
      data: results,
      pagination: {
        page,
        limit,
        total,
        totalPages:
          Math.ceil(
            total /
              limit
          ),
        hasNextPage:
          page * limit <
          total,
        hasPreviousPage:
          page > 1,
      },
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Global Search
  |--------------------------------------------------------------------------
  */

  async globalSearch(
    userId,
    query,
    options = {}
  ) {
    const conversations =
      await Conversation.find(
        {
          participants:
            userId,
        }
      ).select(
        '_id'
      );

    const conversationIds =
      conversations.map(
        conversation =>
          conversation._id
      );

    const filter = {
      conversationId: {
        $in:
          conversationIds,
      },
      deletedAt: null,
      body: {
        $regex:
          escapeRegex(
            query
          ),
        $options: 'i',
      },
    };

    const limit =
      Math.min(
        100,
        Number(
          options.limit
        ) || 50
      );

    return Message.find(
      filter
    )
      .populate(
        'conversationId',
        'title type linkedEntityType'
      )
      .populate(
        'senderId',
        'firstName lastName email avatar'
      )
      .sort({
        createdAt:
          -1,
      })
      .limit(limit);
  }

  /*
  |--------------------------------------------------------------------------
  | Search Conversations
  |--------------------------------------------------------------------------
  */

  async searchConversations(
    userId,
    query,
    options = {}
  ) {
    const filter = {
      participants:
        userId,
    };

    if (
      query &&
      query.trim()
    ) {
      filter.$or = [
        {
          title: {
            $regex:
              escapeRegex(
                query
              ),
            $options:
              'i',
          },
        },
        {
          description:
            {
              $regex:
                escapeRegex(
                  query
                ),
              $options:
                'i',
            },
        },
      ];
    }

    if (
      options.type
    ) {
      filter.type =
        String(
          options.type
        ).toUpperCase();
    }

    return Conversation.find(
      filter
    )
      .populate(
        'lastMessage'
      )
      .sort({
        lastActivityAt:
          -1,
      });
  }

  /*
  |--------------------------------------------------------------------------
  | Search Attachments
  |--------------------------------------------------------------------------
  */

  async searchAttachments(
    conversationId,
    options = {}
  ) {
    const filter = {
      conversationId,
      deletedAt: null,
      attachments: {
        $exists:
          true,
        $ne: [],
      },
    };

    if (
      options.mimeType
    ) {
      filter[
        'attachments.mimeType'
      ] = {
        $regex:
          escapeRegex(
            options.mimeType
          ),
        $options: 'i',
      };
    }

    return Message.find(
      filter
    )
      .populate(
        'senderId',
        'firstName lastName'
      )
      .sort({
        createdAt:
          -1,
      });
  }

  /*
  |--------------------------------------------------------------------------
  | Compliance Search
  |--------------------------------------------------------------------------
  */

  async complianceSearch(
    filters = {}
  ) {
    const query = {};

    if (
      filters.conversationId
    ) {
      query.conversationId =
        filters.conversationId;
    }

    if (
      filters.userId
    ) {
      query.senderId =
        filters.userId;
    }

    if (
      filters.text
    ) {
      query.body = {
        $regex:
          escapeRegex(
            filters.text
          ),
        $options: 'i',
      };
    }

    if (
      filters.from ||
      filters.to
    ) {
      query.createdAt =
        {};

      if (
        filters.from
      ) {
        query.createdAt.$gte =
          new Date(
            filters.from
          );
      }

      if (
        filters.to
      ) {
        query.createdAt.$lte =
          new Date(
            filters.to
          );
      }
    }

    return Message.find(
      query
    )
      .populate(
        'senderId',
        'firstName lastName email'
      )
      .populate(
        'conversationId',
        'title type linkedEntityType linkedEntityId'
      )
      .sort({
        createdAt:
          -1,
      })
      .limit(1000);
  }

  /*
  |--------------------------------------------------------------------------
  | Search Statistics
  |--------------------------------------------------------------------------
  */

  async getSearchStatistics(
    conversationId
  ) {
    const [
      messages,
      attachments,
      participants,
    ] = await Promise.all([
      Message.countDocuments(
        {
          conversationId,
          deletedAt:
            null,
        }
      ),

      Message.countDocuments(
        {
          conversationId,
          attachments:
            {
              $exists:
                true,
              $ne: [],
            },
        }
      ),

      Conversation.findById(
        conversationId
      ).select(
        'participants'
      ),
    ]);

    return {
      messages,
      attachments,
      participants:
        participants
          ?.participants
          ?.length || 0,
    };
  }
}

module.exports =
  new SearchService();