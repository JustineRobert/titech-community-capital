// ============================================================================
// TITech Community Capital
// frontend/src/store/chat/chatOperations.js
// ============================================================================
//
// Enterprise Chat Operations
// Production Grade
//
// Responsibilities
// - Conversation loading
// - Conversation detail loading
// - Message loading
// - Message sending
// - Conversation read state
// - Conversation archive state
// - Conversation creation
// - Defensive API response normalization
// - Abort/cancellation support
// - Request deduplication
// - Error normalization
// - Redux-compatible operation creators
// - Authentication-aware API usage
// - Financial-platform-safe idempotency support
// - No raw token handling
// - No sensitive payload logging
//
// IMPORTANT
// -----------------------------------------------------------------------------
// This module contains async Redux operations only.
//
// State mutations remain in the chat reducer/slice.
//
// The API client remains the authoritative transport/security layer.
//
// Do NOT:
// - store JWTs here
// - store refresh tokens here
// - log message contents
// - log authentication credentials
// - bypass frontend/services/api.js
// - perform direct axios/fetch calls
//
// ============================================================================

"use strict";

import api from "../../services/api";

// ============================================================================
// Optional logger
// ============================================================================
//
// The logger is intentionally defensive so this module does not fail if the
// project does not currently expose a logger implementation.
//

let logger = null;

try {
  // eslint-disable-next-line global-require
  logger = require("../../../utils/logger").default;
} catch {
  logger = null;
}

// ============================================================================
// Constants
// ============================================================================

export const CHAT_OPERATION_TYPES = Object.freeze({
  FETCH_CONVERSATIONS_REQUEST:
    "chat/fetchConversationsRequest",

  FETCH_CONVERSATIONS_SUCCESS:
    "chat/fetchConversationsSuccess",

  FETCH_CONVERSATIONS_FAILURE:
    "chat/fetchConversationsFailure",

  FETCH_CONVERSATION_REQUEST:
    "chat/fetchConversationRequest",

  FETCH_CONVERSATION_SUCCESS:
    "chat/fetchConversationSuccess",

  FETCH_CONVERSATION_FAILURE:
    "chat/fetchConversationFailure",

  FETCH_MESSAGES_REQUEST:
    "chat/fetchMessagesRequest",

  FETCH_MESSAGES_SUCCESS:
    "chat/fetchMessagesSuccess",

  FETCH_MESSAGES_FAILURE:
    "chat/fetchMessagesFailure",

  SEND_MESSAGE_REQUEST:
    "chat/sendMessageRequest",

  SEND_MESSAGE_SUCCESS:
    "chat/sendMessageSuccess",

  SEND_MESSAGE_FAILURE:
    "chat/sendMessageFailure",

  MARK_CONVERSATION_READ_REQUEST:
    "chat/markConversationReadRequest",

  MARK_CONVERSATION_READ_SUCCESS:
    "chat/markConversationReadSuccess",

  MARK_CONVERSATION_READ_FAILURE:
    "chat/markConversationReadFailure",

  ARCHIVE_CONVERSATION_REQUEST:
    "chat/archiveConversationRequest",

  ARCHIVE_CONVERSATION_SUCCESS:
    "chat/archiveConversationSuccess",

  ARCHIVE_CONVERSATION_FAILURE:
    "chat/archiveConversationFailure",

  CREATE_CONVERSATION_REQUEST:
    "chat/createConversationRequest",

  CREATE_CONVERSATION_SUCCESS:
    "chat/createConversationSuccess",

  CREATE_CONVERSATION_FAILURE:
    "chat/createConversationFailure",

  CLEAR_ACTIVE_CONVERSATION:
    "chat/clearActiveConversation",
});

const ENDPOINTS = Object.freeze({
  conversations:
    "/api/chat/conversations",

  conversation: (conversationId) =>
    `/api/chat/conversations/${encodeURIComponent(
      conversationId
    )}`,

  messages: (conversationId) =>
    `/api/chat/conversations/${encodeURIComponent(
      conversationId
    )}/messages`,

  read: (conversationId) =>
    `/api/chat/conversations/${encodeURIComponent(
      conversationId
    )}/read`,

  archive: (conversationId) =>
    `/api/chat/conversations/${encodeURIComponent(
      conversationId
    )}/archive`,
});

// ============================================================================
// Internal request registry
// ============================================================================
//
// Prevents duplicate concurrent GET requests caused by React StrictMode,
// route transitions, repeated renders, or multiple components requesting the
// same resource simultaneously.
//

const inFlightRequests = new Map();

const REQUEST_TTL_MS = 15_000;

// ============================================================================
// Utility: safe logger
// ============================================================================

function logDebug(message, metadata = {}) {
  try {
    logger?.debug?.(message, sanitizeLogMetadata(metadata));
  } catch {
    // Logging must never break application behavior.
  }
}

function logWarn(message, metadata = {}) {
  try {
    logger?.warn?.(message, sanitizeLogMetadata(metadata));
  } catch {
    // Logging must never break application behavior.
  }
}

function logError(message, metadata = {}) {
  try {
    logger?.error?.(message, sanitizeLogMetadata(metadata));
  } catch {
    // Logging must never break application behavior.
  }
}

// ============================================================================
// Utility: logging sanitization
// ============================================================================
//
// Chat payloads may contain PII and confidential information.
// Never log message bodies or complete API responses.
//

function sanitizeLogMetadata(metadata = {}) {
  const safe = {};

  const allowedKeys = [
    "conversationId",
    "messageId",
    "requestId",
    "operation",
    "status",
    "count",
    "page",
    "limit",
    "reason",
    "error",
  ];

  for (const key of allowedKeys) {
    if (
      Object.prototype.hasOwnProperty.call(
        metadata,
        key
      )
    ) {
      safe[key] = metadata[key];
    }
  }

  return safe;
}

// ============================================================================
// Utility: ID normalization
// ============================================================================

function normalizeId(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    const normalized = String(value).trim();

    return normalized || null;
  }

  if (
    typeof value === "object" &&
    value.toString
  ) {
    const normalized =
      value.toString().trim();

    return normalized || null;
  }

  return null;
}

// ============================================================================
// Utility: API response extraction
// ============================================================================

function extractResponseData(response) {
  if (!response) {
    return null;
  }

  const payload = response.data;

  if (
    payload &&
    typeof payload === "object" &&
    Object.prototype.hasOwnProperty.call(
      payload,
      "data"
    )
  ) {
    return payload.data;
  }

  return payload;
}

// ============================================================================
// Utility: array normalization
// ============================================================================

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    value &&
    Array.isArray(value.items)
  ) {
    return value.items;
  }

  if (
    value &&
    Array.isArray(value.results)
  ) {
    return value.results;
  }

  if (
    value &&
    Array.isArray(value.conversations)
  ) {
    return value.conversations;
  }

  if (
    value &&
    Array.isArray(value.messages)
  ) {
    return value.messages;
  }

  return [];
}

// ============================================================================
// Utility: error normalization
// ============================================================================

export function normalizeChatError(
  error,
  fallbackMessage = "Chat operation failed"
) {
  if (
    error?.name === "AbortError" ||
    error?.code === "ERR_CANCELED" ||
    error?.code === "ECONNABORTED"
  ) {
    return {
      name: "AbortError",
      message: "Request cancelled",
      code: "REQUEST_CANCELLED",
      status: null,
      originalError: error,
    };
  }

  const status =
    error?.response?.status ??
    error?.status ??
    null;

  const responseData =
    error?.response?.data;

  const message =
    responseData?.message ||
    responseData?.error?.message ||
    error?.message ||
    fallbackMessage;

  const code =
    responseData?.code ||
    responseData?.error?.code ||
    error?.code ||
    null;

  return {
    name:
      error?.name ||
      "ChatOperationError",

    message: String(message),

    code,

    status,

    requestId:
      error?.response?.headers?.[
        "x-request-id"
      ] ||
      error?.response?.headers?.[
        "x-correlation-id"
      ] ||
      null,

    originalError: error,
  };
}

// ============================================================================
// Utility: validation
// ============================================================================

function requireConversationId(
  conversationId
) {
  const id = normalizeId(conversationId);

  if (!id) {
    throw new TypeError(
      "A valid conversationId is required."
    );
  }

  return id;
}

function requireMessageText(text) {
  if (
    typeof text !== "string"
  ) {
    throw new TypeError(
      "Message content must be a string."
    );
  }

  const normalized =
    text.trim();

  if (!normalized) {
    throw new TypeError(
      "Message content cannot be empty."
    );
  }

  return normalized;
}

// ============================================================================
// Utility: request deduplication
// ============================================================================

function createRequestKey(
  operation,
  identifier = ""
) {
  return `${operation}:${identifier}`;
}

async function dedupeRequest(
  key,
  requestFactory
) {
  const existing =
    inFlightRequests.get(key);

  if (
    existing &&
    Date.now() - existing.startedAt <
      REQUEST_TTL_MS
  ) {
    return existing.promise;
  }

  const promise = Promise.resolve()
    .then(requestFactory)
    .finally(() => {
      const current =
        inFlightRequests.get(key);

      if (
        current?.promise === promise
      ) {
        inFlightRequests.delete(key);
      }
    });

  inFlightRequests.set(key, {
    startedAt: Date.now(),
    promise,
  });

  return promise;
}

// ============================================================================
// Utility: AbortController
// ============================================================================

export function createChatAbortController() {
  if (
    typeof AbortController ===
    "undefined"
  ) {
    return null;
  }

  return new AbortController();
}

// ============================================================================
// Utility: request config
// ============================================================================

function buildRequestConfig(options = {}) {
  const config = {};

  if (
    options.signal
  ) {
    config.signal =
      options.signal;
  }

  if (
    options.params &&
    typeof options.params ===
      "object"
  ) {
    config.params =
      options.params;
  }

  if (
    options.headers &&
    typeof options.headers ===
      "object"
  ) {
    config.headers =
      options.headers;
  }

  return config;
}

// ============================================================================
// FETCH CONVERSATIONS
// ============================================================================

export function fetchConversations(
  options = {}
) {
  return async (dispatch) => {
    const {
      signal,
      params = {},
    } = options;

    dispatch({
      type:
        CHAT_OPERATION_TYPES
          .FETCH_CONVERSATIONS_REQUEST,
    });

    const requestKey =
      createRequestKey(
        "fetchConversations",
        JSON.stringify(params)
      );

    try {
      const response =
        await dedupeRequest(
          requestKey,
          () =>
            api.get(
              ENDPOINTS.conversations,
              buildRequestConfig({
                signal,
                params,
              })
            )
        );

      const data =
        extractResponseData(
          response
        );

      const conversations =
        normalizeArray(data);

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .FETCH_CONVERSATIONS_SUCCESS,

        payload: conversations,

        meta: {
          count:
            conversations.length,
        },
      });

      logDebug(
        "Chat conversations loaded",
        {
          operation:
            "fetchConversations",
          count:
            conversations.length,
        }
      );

      return conversations;
    } catch (error) {
      const normalized =
        normalizeChatError(
          error,
          "Failed to load conversations"
        );

      if (
        normalized.code ===
        "REQUEST_CANCELLED"
      ) {
        return [];
      }

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .FETCH_CONVERSATIONS_FAILURE,

        error: normalized,
      });

      logWarn(
        "Failed to load chat conversations",
        {
          operation:
            "fetchConversations",
          error:
            normalized.message,
        }
      );

      throw normalized;
    }
  };
}

// ============================================================================
// FETCH CONVERSATION BY ID
// ============================================================================

export function fetchConversationById(
  conversationId,
  options = {}
) {
  return async (dispatch) => {
    const id =
      requireConversationId(
        conversationId
      );

    const {
      signal,
    } = options;

    dispatch({
      type:
        CHAT_OPERATION_TYPES
          .FETCH_CONVERSATION_REQUEST,

      meta: {
        conversationId: id,
      },
    });

    const requestKey =
      createRequestKey(
        "fetchConversation",
        id
      );

    try {
      const response =
        await dedupeRequest(
          requestKey,
          () =>
            api.get(
              ENDPOINTS.conversation(
                id
              ),
              buildRequestConfig({
                signal,
              })
            )
        );

      const conversation =
        extractResponseData(
          response
        );

      if (
        !conversation ||
        typeof conversation !==
          "object"
      ) {
        throw new Error(
          "Conversation response was invalid."
        );
      }

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .FETCH_CONVERSATION_SUCCESS,

        payload: conversation,

        meta: {
          conversationId: id,
        },
      });

      logDebug(
        "Chat conversation loaded",
        {
          operation:
            "fetchConversationById",
          conversationId: id,
        }
      );

      return conversation;
    } catch (error) {
      const normalized =
        normalizeChatError(
          error,
          "Failed to load conversation"
        );

      if (
        normalized.code ===
        "REQUEST_CANCELLED"
      ) {
        return null;
      }

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .FETCH_CONVERSATION_FAILURE,

        error: normalized,

        meta: {
          conversationId: id,
        },
      });

      logWarn(
        "Failed to load conversation",
        {
          operation:
            "fetchConversationById",
          conversationId: id,
          error:
            normalized.message,
        }
      );

      throw normalized;
    }
  };
}

// ============================================================================
// FETCH MESSAGES
// ============================================================================

export function fetchMessages(
  conversationId,
  options = {}
) {
  return async (dispatch) => {
    const id =
      requireConversationId(
        conversationId
      );

    const {
      signal,
      params = {},
    } = options;

    dispatch({
      type:
        CHAT_OPERATION_TYPES
          .FETCH_MESSAGES_REQUEST,

      meta: {
        conversationId: id,
      },
    });

    const requestKey =
      createRequestKey(
        "fetchMessages",
        `${id}:${JSON.stringify(
          params
        )}`
      );

    try {
      const response =
        await dedupeRequest(
          requestKey,
          () =>
            api.get(
              ENDPOINTS.messages(
                id
              ),
              buildRequestConfig({
                signal,
                params,
              })
            )
        );

      const data =
        extractResponseData(
          response
        );

      const messages =
        normalizeArray(data);

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .FETCH_MESSAGES_SUCCESS,

        payload: {
          conversationId: id,
          messages,
        },

        meta: {
          conversationId: id,
          count:
            messages.length,
        },
      });

      logDebug(
        "Chat messages loaded",
        {
          operation:
            "fetchMessages",
          conversationId: id,
          count:
            messages.length,
        }
      );

      return messages;
    } catch (error) {
      const normalized =
        normalizeChatError(
          error,
          "Failed to load messages"
        );

      if (
        normalized.code ===
        "REQUEST_CANCELLED"
      ) {
        return [];
      }

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .FETCH_MESSAGES_FAILURE,

        error: normalized,

        meta: {
          conversationId: id,
        },
      });

      logWarn(
        "Failed to load chat messages",
        {
          operation:
            "fetchMessages",
          conversationId: id,
          error:
            normalized.message,
        }
      );

      throw normalized;
    }
  };
}

// ============================================================================
// SEND MESSAGE
// ============================================================================
//
// Supports:
// - text
// - attachments
// - replyTo
// - client-generated id
// - idempotency key
//
// The API client remains responsible for authentication and transport policy.
//

export function sendMessage(
  conversationId,
  message,
  options = {}
) {
  return async (dispatch) => {
    const id =
      requireConversationId(
        conversationId
      );

    if (
      !message ||
      typeof message !==
        "object"
    ) {
      throw new TypeError(
        "A message object is required."
      );
    }

    const content =
      requireMessageText(
        message.content ??
          message.text ??
          ""
      );

    const clientMessageId =
      normalizeId(
        message.clientMessageId
      ) ||
      normalizeId(
        message.clientId
      ) ||
      null;

    const idempotencyKey =
      options.idempotencyKey ||
      clientMessageId ||
      null;

    const payload = {
      ...message,
      content,
    };

    if (
      clientMessageId
    ) {
      payload.clientMessageId =
        clientMessageId;
    }

    const requestConfig =
      buildRequestConfig({
        signal:
          options.signal,
        headers:
          idempotencyKey
            ? {
                "Idempotency-Key":
                  idempotencyKey,
              }
            : undefined,
      });

    dispatch({
      type:
        CHAT_OPERATION_TYPES
          .SEND_MESSAGE_REQUEST,

      meta: {
        conversationId: id,
        clientMessageId,
      },
    });

    try {
      const response =
        await api.post(
          ENDPOINTS.messages(
            id
          ),
          payload,
          requestConfig
        );

      const createdMessage =
        extractResponseData(
          response
        );

      if (
        !createdMessage ||
        typeof createdMessage !==
          "object"
      ) {
        throw new Error(
          "Message response was invalid."
        );
      }

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .SEND_MESSAGE_SUCCESS,

        payload: {
          conversationId: id,
          message:
            createdMessage,
        },

        meta: {
          conversationId: id,
          clientMessageId,
        },
      });

      logDebug(
        "Chat message sent",
        {
          operation:
            "sendMessage",
          conversationId: id,
        }
      );

      return createdMessage;
    } catch (error) {
      const normalized =
        normalizeChatError(
          error,
          "Failed to send message"
        );

      if (
        normalized.code ===
        "REQUEST_CANCELLED"
      ) {
        return null;
      }

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .SEND_MESSAGE_FAILURE,

        error: normalized,

        meta: {
          conversationId: id,
          clientMessageId,
        },
      });

      logWarn(
        "Failed to send chat message",
        {
          operation:
            "sendMessage",
          conversationId: id,
          error:
            normalized.message,
        }
      );

      throw normalized;
    }
  };
}

// ============================================================================
// MARK CONVERSATION READ
// ============================================================================

export function markConversationRead(
  conversationId,
  options = {}
) {
  return async (dispatch) => {
    const id =
      requireConversationId(
        conversationId
      );

    dispatch({
      type:
        CHAT_OPERATION_TYPES
          .MARK_CONVERSATION_READ_REQUEST,

      meta: {
        conversationId: id,
      },
    });

    try {
      const response =
        await api.post(
          ENDPOINTS.read(id),
          {},
          buildRequestConfig({
            signal:
              options.signal,
          })
        );

      const data =
        extractResponseData(
          response
        );

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .MARK_CONVERSATION_READ_SUCCESS,

        payload: {
          conversationId: id,
          data,
        },

        meta: {
          conversationId: id,
        },
      });

      return data;
    } catch (error) {
      const normalized =
        normalizeChatError(
          error,
          "Failed to mark conversation as read"
        );

      if (
        normalized.code ===
        "REQUEST_CANCELLED"
      ) {
        return null;
      }

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .MARK_CONVERSATION_READ_FAILURE,

        error: normalized,

        meta: {
          conversationId: id,
        },
      });

      logWarn(
        "Failed to mark conversation as read",
        {
          operation:
            "markConversationRead",
          conversationId: id,
          error:
            normalized.message,
        }
      );

      throw normalized;
    }
  };
}

// ============================================================================
// ARCHIVE CONVERSATION
// ============================================================================

export function archiveConversation(
  conversationId,
  options = {}
) {
  return async (dispatch) => {
    const id =
      requireConversationId(
        conversationId
      );

    dispatch({
      type:
        CHAT_OPERATION_TYPES
          .ARCHIVE_CONVERSATION_REQUEST,

      meta: {
        conversationId: id,
      },
    });

    try {
      const response =
        await api.post(
          ENDPOINTS.archive(id),
          {},
          buildRequestConfig({
            signal:
              options.signal,
          })
        );

      const data =
        extractResponseData(
          response
        );

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .ARCHIVE_CONVERSATION_SUCCESS,

        payload: {
          conversationId: id,
          data,
        },

        meta: {
          conversationId: id,
        },
      });

      logDebug(
        "Conversation archived",
        {
          operation:
            "archiveConversation",
          conversationId: id,
        }
      );

      return data;
    } catch (error) {
      const normalized =
        normalizeChatError(
          error,
          "Failed to archive conversation"
        );

      if (
        normalized.code ===
        "REQUEST_CANCELLED"
      ) {
        return null;
      }

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .ARCHIVE_CONVERSATION_FAILURE,

        error: normalized,

        meta: {
          conversationId: id,
        },
      });

      logWarn(
        "Failed to archive conversation",
        {
          operation:
            "archiveConversation",
          conversationId: id,
          error:
            normalized.message,
        }
      );

      throw normalized;
    }
  };
}

// ============================================================================
// CREATE CONVERSATION
// ============================================================================

export function createConversation(
  conversation,
  options = {}
) {
  return async (dispatch) => {
    if (
      !conversation ||
      typeof conversation !==
        "object"
    ) {
      throw new TypeError(
        "Conversation data is required."
      );
    }

    dispatch({
      type:
        CHAT_OPERATION_TYPES
          .CREATE_CONVERSATION_REQUEST,
    });

    try {
      const response =
        await api.post(
          ENDPOINTS.conversations,
          conversation,
          buildRequestConfig({
            signal:
              options.signal,
            headers:
              options.idempotencyKey
                ? {
                    "Idempotency-Key":
                      options.idempotencyKey,
                  }
                : undefined,
          })
        );

      const createdConversation =
        extractResponseData(
          response
        );

      if (
        !createdConversation ||
        typeof createdConversation !==
          "object"
      ) {
        throw new Error(
          "Conversation response was invalid."
        );
      }

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .CREATE_CONVERSATION_SUCCESS,

        payload:
          createdConversation,
      });

      return createdConversation;
    } catch (error) {
      const normalized =
        normalizeChatError(
          error,
          "Failed to create conversation"
        );

      if (
        normalized.code ===
        "REQUEST_CANCELLED"
      ) {
        return null;
      }

      dispatch({
        type:
          CHAT_OPERATION_TYPES
            .CREATE_CONVERSATION_FAILURE,

        error: normalized,
      });

      logWarn(
        "Failed to create conversation",
        {
          operation:
            "createConversation",
          error:
            normalized.message,
        }
      );

      throw normalized;
    }
  };
}

// ============================================================================
// CLEAR ACTIVE CONVERSATION
// ============================================================================

export function clearActiveConversation() {
  return {
    type:
      CHAT_OPERATION_TYPES
        .CLEAR_ACTIVE_CONVERSATION,
  };
}

// ============================================================================
// REFRESH CONVERSATION
// ============================================================================
//
// Convenience operation for ConversationDetail/MessagePanel.
//

export function refreshConversation(
  conversationId,
  options = {}
) {
  return async (dispatch) => {
    const id =
      requireConversationId(
        conversationId
      );

    const conversation =
      await dispatch(
        fetchConversationById(
          id,
          options
        )
      );

    if (
      options.loadMessages !== false
    ) {
      await dispatch(
        fetchMessages(
          id,
          options
        )
      );
    }

    return conversation;
  };
}

// ============================================================================
// LOAD CONVERSATION + MARK READ
// ============================================================================
//
// Useful when opening a conversation route.
//

export function openConversation(
  conversationId,
  options = {}
) {
  return async (dispatch) => {
    const id =
      requireConversationId(
        conversationId
      );

    const conversation =
      await dispatch(
        fetchConversationById(
          id,
          options
        )
      );

    if (
      options.loadMessages !== false
    ) {
      await dispatch(
        fetchMessages(
          id,
          options
        )
      );
    }

    if (
      options.markRead !== false
    ) {
      try {
        await dispatch(
          markConversationRead(
            id,
            options
          )
        );
      } catch (error) {
        // Mark-read failure should not make an otherwise successfully loaded
        // conversation unusable.
        logWarn(
          "Conversation loaded but mark-read failed",
          {
            operation:
              "openConversation",
            conversationId: id,
            error:
              error?.message,
          }
        );
      }
    }

    return conversation;
  };
}

// ============================================================================
// SELECTIVE REFRESH HELPERS
// ============================================================================

export function refreshConversations(
  options = {}
) {
  return fetchConversations(
    options
  );
}

export function refreshMessages(
  conversationId,
  options = {}
) {
  return fetchMessages(
    conversationId,
    options
  );
}

// ============================================================================
// REQUEST REGISTRY MANAGEMENT
// ============================================================================

export function clearChatRequestRegistry() {
  inFlightRequests.clear();
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

const chatOperations = Object.freeze({
  fetchConversations,
  fetchConversationById,
  fetchMessages,
  sendMessage,
  markConversationRead,
  archiveConversation,
  createConversation,
  refreshConversation,
  openConversation,
  refreshConversations,
  refreshMessages,
  clearActiveConversation,
  clearChatRequestRegistry,
  createChatAbortController,
  normalizeChatError,
});

export default chatOperations;