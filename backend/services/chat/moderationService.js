'use strict';

/**
 * ============================================================================
 * MODERATION SERVICE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Provides message moderation, compliance filtering, and abuse detection
 * for all TITechChat communications.
 *
 * This service is a core compliance layer for SACCO governance:
 *
 * ✅ Fraud Prevention
 * ✅ AML Compliance Support
 * ✅ Abuse Detection
 * ✅ Content Filtering
 * ✅ Regulatory Safety Layer
 * ✅ Audit Logging Support
 *
 * ============================================================================
 */

const MessageAudit =
  require('../../models/MessageAudit');

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const BLOCKED_WORDS = [
  'malicious',
  'forbidden',
  'scam',
  'fraud',
  'hack',
  'exploit',
  'phishing',
];

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function normalizeText(text = '') {
  return String(text).toLowerCase();
}

function containsBlockedWord(text) {
  return BLOCKED_WORDS.find(word =>
    text.includes(word)
  );
}

/*
|--------------------------------------------------------------------------
| Service
|--------------------------------------------------------------------------
*/

class ModerationService {
  /*
  |--------------------------------------------------------------------------
  | Moderate Message
  |--------------------------------------------------------------------------
  */

  async moderateMessage(
    body,
    context = {}
  ) {
    const text =
      normalizeText(
        body
      );

    if (!text) {
      return {
        blocked: false,
        riskScore: 0,
        reason: null,
      };
    }

    const detected =
      containsBlockedWord(
        text
      );

    /*
    |--------------------------------------------------------------------------
    | Rule-Based Detection (Phase 1)
    |--------------------------------------------------------------------------
    */

    if (detected) {
      await MessageAudit.create(
        {
          action:
            'MESSAGE_BLOCKED',
          conversationId:
            context.conversationId,
          userId:
            context.userId,
          metadata: {
            reason:
              'BLOCKED_WORD_DETECTED',
            word:
              detected,
            original:
              body,
          },
        }
      );

      return {
        blocked: true,
        riskScore: 100,
        reason:
          'Contains prohibited or high-risk content.',
        flaggedWord:
          detected,
      };
    }

    /*
    |--------------------------------------------------------------------------
    | Basic Heuristics (Phase 1.1)
    |--------------------------------------------------------------------------
    */

    let riskScore = 0;

    if (text.length > 1000) {
      riskScore += 10;
    }

    if (
      /(http|https):\/\//i.test(
        text
      )
    ) {
      riskScore += 15;
    }

    if (
      /[A-Z]{10,}/.test(
        body
      )
    ) {
      riskScore += 10;
    }

    /*
    |--------------------------------------------------------------------------
    | Safe Result
    |--------------------------------------------------------------------------
    */

    return {
      blocked: false,
      riskScore,
      reason: null,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Pre-Moderation Hook (Future AI Integration)
  |--------------------------------------------------------------------------
  */

  async preModerate(payload) {
    return this.moderateMessage(
      payload.body,
      payload
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Post-Moderation Audit
  |--------------------------------------------------------------------------
  */

  async auditAction(
    action,
    context = {}
  ) {
    return MessageAudit.create({
      action,
      conversationId:
        context.conversationId,
      userId:
        context.userId,
      metadata:
        context.metadata || {},
    });
  }
}

module.exports =
  new ModerationService();