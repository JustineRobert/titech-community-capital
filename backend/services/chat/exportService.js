'use strict';

/**
 * ============================================================================
 * EXPORT SERVICE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Handles secure export of conversation history for compliance, audit,
 * regulatory review, and dispute resolution.
 *
 * This module is critical for:
 *
 * ✅ BoU Regulatory Reporting
 * ✅ SACCO Audit Trails
 * ✅ Fraud Investigation Evidence
 * ✅ Loan Dispute Resolution
 * ✅ Member Complaint Handling
 * ✅ Legal Discovery Requests
 *
 * ============================================================================
 */

const ConversationExport =
  require('../../models/ConversationExport');

const MessageAudit =
  require('../../models/MessageAudit');

const Message =
  require('../../models/Message');

/*
|--------------------------------------------------------------------------
| Builder (inline lightweight replacement for utils/chat/exportBuilder)
|--------------------------------------------------------------------------
*/

async function buildConversationExport(
  conversationId
) {
  const messages =
    await Message.find({
      conversationId,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

  return {
    format: 'json',
    payload: JSON.stringify(
      messages,
      null,
      2
    ),
    count: messages.length,
  };
}

/*
|--------------------------------------------------------------------------
| Service
|--------------------------------------------------------------------------
*/

class ExportService {
  /*
  |--------------------------------------------------------------------------
  | Request Export
  |--------------------------------------------------------------------------
  */

  async requestExport(
    conversationId,
    requestedBy
  ) {
    const exportDoc =
      await ConversationExport.create(
        {
          conversationId,
          requestedBy,
          status: 'PENDING',
          metadata: {
            requestedAt:
              new Date(),
          },
        }
      );

    /*
    |--------------------------------------------------------------------------
    | Processing State
    |--------------------------------------------------------------------------
    */

    exportDoc.status =
      'PROCESSING';

    await exportDoc.save();

    try {
      const built =
        await buildConversationExport(
          conversationId
        );

      /*
      |--------------------------------------------------------------------------
      | Storage Layer (Placeholder)
      |--------------------------------------------------------------------------
      | In production:
      | - Upload to S3 / Azure Blob / GCP Storage
      | - Encrypt at rest
      | - Generate signed URL
      |--------------------------------------------------------------------------
      */

      const fileUrl =
        `data:application/json;base64,${Buffer.from(
          built.payload
        ).toString('base64')}`;

      exportDoc.fileUrl =
        fileUrl;

      exportDoc.status =
        'READY';

      exportDoc.completedAt =
        new Date();

      await exportDoc.save();

      /*
      |--------------------------------------------------------------------------
      | Audit Log
      |--------------------------------------------------------------------------
      */

      await MessageAudit.create(
        {
          action:
            'EXPORT_PERFORMED',
          conversationId,
          userId:
            requestedBy,
          metadata: {
            exportId:
              exportDoc._id,
            messageCount:
              built.count,
          },
        }
      );

      return exportDoc;
    } catch (error) {
      exportDoc.status =
        'FAILED';

      exportDoc.metadata =
        {
          ...(exportDoc.metadata ||
            {}),
          error:
            error.message,
        };

      await exportDoc.save();

      /*
      |--------------------------------------------------------------------------
      | Audit Failure
      |--------------------------------------------------------------------------
      */

      await MessageAudit.create(
        {
          action:
            'EXPORT_FAILED',
          conversationId,
          userId:
            requestedBy,
          metadata: {
            error:
              error.message,
          },
        }
      );

      throw error;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Get Export Status
  |--------------------------------------------------------------------------
  */

  async getExport(
    exportId
  ) {
    return ConversationExport.findById(
      exportId
    ).populate(
      'conversationId requestedBy'
    );
  }

  /*
  |--------------------------------------------------------------------------
  | List Exports
  |--------------------------------------------------------------------------
  */

  async listExports(
    userId
  ) {
    return ConversationExport.find(
      {
        requestedBy:
          userId,
      }
    )
      .sort({
        createdAt:
          -1,
      })
      .limit(50);
  }
}

module.exports =
  new ExportService();