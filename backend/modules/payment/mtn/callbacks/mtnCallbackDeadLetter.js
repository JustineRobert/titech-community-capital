'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Dead Letter Adapter
 * ============================================================================
 *
 * DLQ is deliberately an adapter.
 *
 * It can use:
 *
 *   - existing queueService
 *   - BullMQ
 *   - another queue implementation
 *
 * The callback processor never needs to know which queue technology is used.
 *
 * ============================================================================
 */

class MTNCallbackDeadLetter {
  constructor(options = {}) {
    this.queueService =
      options.queueService ||
      null;

    this.queueName =
      options.queueName ||
      'mtn-momo-callback-dlq';

    this.maxAttempts =
      Number(
        options.maxAttempts ||
          5
      );
  }

  async enqueue(
    callback,
    error,
    metadata = {}
  ) {
    const payload = {
      provider:
        'MTN_MOMO',

      callback,

      error: {
        message:
          error?.message ||
          String(error),

        code:
          error?.code ||
          'MTN_CALLBACK_ERROR',

        retryable:
          Boolean(
            error?.retryable
          ),
      },

      metadata,

      queuedAt:
        new Date().toISOString(),
    };

    if (
      this.queueService?.enqueue
    ) {
      await this.queueService.enqueue(
        this.queueName,
        payload
      );

      return {
        queued: true,
        queue:
          this.queueName,
        payload,
      };
    }

    return {
      queued: false,
      queue:
        this.queueName,
      payload,
      reason:
        'Queue service unavailable',
    };
  }
}

module.exports =
  MTNCallbackDeadLetter;