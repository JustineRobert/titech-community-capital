// ============================================================================
// TITech Community Capital
// Enterprise Chat Redux Slice
//
// File:
// frontend/src/store/chatSlice.js
//
// Production Grade
// ============================================================================
//
// Responsibilities
// - Conversation state management
// - Message state management
// - Async chat operations
// - Request lifecycle tracking
// - Active conversation management
// - Read/unread state
// - Conversation archiving
// - Defensive API normalization
// - Duplicate prevention
// - Stale-request protection
// - Error recovery
// - Redux Toolkit compatibility
//
// SECURITY
// - Never log message bodies, tokens, credentials, or private metadata.
// - Backend remains authoritative for authorization.
// - Client state must never be treated as an authorization boundary.
// - Server-generated identifiers remain authoritative.
// ============================================================================

import {
  createAsyncThunk,
  createSlice,
} from '@reduxjs/toolkit';

import chatApi from '../services/chatApi';

// ============================================================================
// CONSTANTS
// ============================================================================

const SLICE_NAME = 'chat';

const DEFAULT_PAGE_SIZE = 25;

const MAX_STORED_MESSAGES_PER_CONVERSATION = 500;

const DEFAULT_ERROR_MESSAGE =
  'Unable to complete the chat operation. Please try again.';

// ============================================================================
// SAFE HELPERS
// ============================================================================

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function getEntityId(entity) {
  if (!entity) {
    return null;
  }

  const value =
    entity.id ??
    entity._id ??
    entity.conversationId ??
    entity.messageId ??
    null;

  return value == null
    ? null
    : String(value);
}

function normalizeId(value) {
  if (value == null) {
    return null;
  }

  return String(value);
}

function extractPayload(response) {
  if (response == null) {
    return null;
  }

  if (
    isObject(response) &&
    Object.prototype.hasOwnProperty.call(
      response,
      'data'
    )
  ) {
    return response.data;
  }

  return response;
}

function extractCollection(response, keys = []) {
  const payload =
    extractPayload(response);

  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isObject(payload)) {
    return [];
  }

  for (const key of keys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  return [];
}

function extractErrorMessage(
  error,
  fallback = DEFAULT_ERROR_MESSAGE
) {
  if (!error) {
    return fallback;
  }

  if (
    typeof error === 'string' &&
    error.trim()
  ) {
    return error.trim();
  }

  const responseData =
    error?.response?.data;

  return (
    responseData?.message ||
    responseData?.error?.message ||
    error?.message ||
    fallback
  );
}

function normalizeConversation(
  conversation,
  fallbackId = null
) {
  if (!isObject(conversation)) {
    return null;
  }

  const id =
    getEntityId(conversation) ||
    normalizeId(fallbackId);

  if (!id) {
    return null;
  }

  return {
    ...conversation,

    id,

    _id:
      conversation._id ??
      conversation.id ??
      id,

    title:
      conversation.title ??
      conversation.subject ??
      conversation.name ??
      'Conversation',

    participants:
      Array.isArray(
        conversation.participants
      )
        ? conversation.participants
        : Array.isArray(
            conversation.members
          )
          ? conversation.members
          : [],

    messages:
      Array.isArray(conversation.messages)
        ? conversation.messages
        : undefined,

    unreadCount: Math.max(
      0,
      Number(
        conversation.unreadCount ??
          conversation.unread ??
          0
      ) || 0
    ),

    status:
      conversation.status ??
      'active',
  };
}

function normalizeMessage(
  message,
  fallbackConversationId = null
) {
  if (!isObject(message)) {
    return null;
  }

  const id =
    getEntityId(message);

  const conversationId =
    normalizeId(
      message.conversationId ??
        message.conversation?._id ??
        message.conversation?.id ??
        fallbackConversationId
    );

  if (!id || !conversationId) {
    return null;
  }

  return {
    ...message,

    id,

    _id:
      message._id ??
      message.id ??
      id,

    conversationId,

    body:
      message.body ??
      message.content ??
      message.text ??
      '',

    createdAt:
      message.createdAt ??
      message.timestamp ??
      null,

    status:
      message.status ??
      'sent',
  };
}

function mergeById(
  existing = [],
  incoming = []
) {
  const map = new Map();

  for (const item of existing) {
    const id = getEntityId(item);

    if (id) {
      map.set(id, item);
    }
  }

  for (const item of incoming) {
    const id = getEntityId(item);

    if (id) {
      map.set(id, {
        ...map.get(id),
        ...item,
      });
    }
  }

  return Array.from(map.values());
}

function sortMessages(messages) {
  return [...messages].sort(
    (a, b) => {
      const aTime =
        new Date(
          a?.createdAt || 0
        ).getTime();

      const bTime =
        new Date(
          b?.createdAt || 0
        ).getTime();

      return aTime - bTime;
    }
  );
}

function trimMessages(messages) {
  if (
    messages.length <=
    MAX_STORED_MESSAGES_PER_CONVERSATION
  ) {
    return messages;
  }

  return messages.slice(
    messages.length -
      MAX_STORED_MESSAGES_PER_CONVERSATION
  );
}

function normalizeConversationCollection(
  response
) {
  return extractCollection(
    response,
    [
      'conversations',
      'items',
      'results',
      'data',
    ]
  )
    .map((conversation) =>
      normalizeConversation(
        conversation
      )
    )
    .filter(Boolean);
}

function normalizeMessageCollection(
  response,
  conversationId
) {
  return extractCollection(
    response,
    [
      'messages',
      'items',
      'results',
      'data',
    ]
  )
    .map((message) =>
      normalizeMessage(
        message,
        conversationId
      )
    )
    .filter(Boolean);
}

// ============================================================================
// STATE HELPERS
// ============================================================================

const createOperationState = () => ({
  status: 'idle',
  error: null,
  requestId: null,
});

const initialState = {
  // --------------------------------------------------------------------------
  // Conversations
  // --------------------------------------------------------------------------

  conversations: [],

  conversationsStatus: 'idle',

  conversationsError: null,

  conversationsRequestId: null,

  conversationsPagination: {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },

  // --------------------------------------------------------------------------
  // Active conversation
  // --------------------------------------------------------------------------

  activeConversation: null,

  activeConversationId: null,

  activeConversationStatus: 'idle',

  activeConversationError: null,

  activeConversationRequestId: null,

  // --------------------------------------------------------------------------
  // Messages
  // --------------------------------------------------------------------------

  messages: {},

  messagesStatus: {},

  messagesError: {},

  messagesRequestId: {},

  messagesPagination: {},

  // --------------------------------------------------------------------------
  // Individual operations
  // --------------------------------------------------------------------------

  fetchConversationOperation:
    createOperationState(),

  sendMessageOperation:
    createOperationState(),

  markReadOperation:
    createOperationState(),

  archiveOperation:
    createOperationState(),

  // --------------------------------------------------------------------------
  // Global state
  // --------------------------------------------------------------------------

  status: 'idle',

  error: null,

  lastUpdatedAt: null,
};

// ============================================================================
// ASYNC THUNKS
// ============================================================================

/**
 * Fetch conversations.
 *
 * Compatible with:
 * ConversationList
 */
export const fetchConversations =
  createAsyncThunk(
    `${SLICE_NAME}/fetchConversations`,
    async (
      params = {},
      { rejectWithValue, signal }
    ) => {
      try {
        const response =
          await chatApi.getConversations(
            params,
            { signal }
          );

        const conversations =
          normalizeConversationCollection(
            response
          );

        const payload =
          extractPayload(response);

        return {
          conversations,

          pagination:
            payload?.pagination ||
            payload?.meta ||
            null,
        };
      } catch (error) {
        return rejectWithValue({
          message:
            extractErrorMessage(error),
          status:
            error?.response?.status ??
            null,
        });
      }
    }
  );

/**
 * Fetch one conversation.
 *
 * Compatible with:
 * ConversationDetail
 */
export const fetchConversationById =
  createAsyncThunk(
    `${SLICE_NAME}/fetchConversationById`,
    async (
      conversationId,
      { rejectWithValue, signal }
    ) => {
      const id =
        normalizeId(conversationId);

      if (!id) {
        return rejectWithValue({
          message:
            'Conversation ID is required.',
          status: 400,
        });
      }

      try {
        const response =
          await chatApi.getConversationById(
            id,
            { signal }
          );

        const payload =
          extractPayload(response);

        const conversation =
          normalizeConversation(
            payload?.conversation ??
              payload?.data ??
              payload,
            id
          );

        if (!conversation) {
          throw new Error(
            'Invalid conversation response.'
          );
        }

        const messages =
          normalizeMessageCollection(
            payload,
            id
          );

        return {
          conversation,
          messages,
        };
      } catch (error) {
        return rejectWithValue({
          message:
            extractErrorMessage(
              error,
              'Failed to load conversation.'
            ),
          status:
            error?.response?.status ??
            null,
          conversationId: id,
        });
      }
    }
  );

/**
 * Fetch messages for a conversation.
 */
export const fetchMessages =
  createAsyncThunk(
    `${SLICE_NAME}/fetchMessages`,
    async (
      {
        conversationId,
        ...params
      } = {},
      { rejectWithValue, signal }
    ) => {
      const id =
        normalizeId(conversationId);

      if (!id) {
        return rejectWithValue({
          message:
            'Conversation ID is required.',
          status: 400,
        });
      }

      try {
        const response =
          await chatApi.getMessages(
            id,
            params,
            { signal }
          );

        const messages =
          normalizeMessageCollection(
            response,
            id
          );

        const payload =
          extractPayload(response);

        return {
          conversationId: id,
          messages,

          pagination:
            payload?.pagination ||
            payload?.meta ||
            null,
        };
      } catch (error) {
        return rejectWithValue({
          message:
            extractErrorMessage(
              error,
              'Failed to load messages.'
            ),
          status:
            error?.response?.status ??
            null,
          conversationId: id,
        });
      }
    }
  );

/**
 * Send a message.
 */
export const sendMessage =
  createAsyncThunk(
    `${SLICE_NAME}/sendMessage`,
    async (
      {
        conversationId,
        body,
        ...metadata
      } = {},
      { rejectWithValue, signal }
    ) => {
      const id =
        normalizeId(conversationId);

      if (!id) {
        return rejectWithValue({
          message:
            'Conversation ID is required.',
          status: 400,
        });
      }

      if (
        typeof body !== 'string' ||
        !body.trim()
      ) {
        return rejectWithValue({
          message:
            'Message cannot be empty.',
          status: 400,
        });
      }

      try {
        const response =
          await chatApi.sendMessage(
            id,
            body,
            metadata,
            { signal }
          );

        const payload =
          extractPayload(response);

        const message =
          normalizeMessage(
            payload?.message ??
              payload?.data ??
              payload,
            id
          );

        if (!message) {
          throw new Error(
            'Invalid message response.'
          );
        }

        return {
          message,
          conversationId: id,
        };
      } catch (error) {
        return rejectWithValue({
          message:
            extractErrorMessage(
              error,
              'Failed to send message.'
            ),
          status:
            error?.response?.status ??
            null,
          conversationId: id,
        });
      }
    }
  );

/**
 * Mark a conversation as read.
 */
export const markConversationRead =
  createAsyncThunk(
    `${SLICE_NAME}/markConversationRead`,
    async (
      conversationId,
      { rejectWithValue, signal }
    ) => {
      const id =
        normalizeId(conversationId);

      if (!id) {
        return rejectWithValue({
          message:
            'Conversation ID is required.',
          status: 400,
        });
      }

      try {
        if (
          typeof chatApi.markConversationRead !==
          'function'
        ) {
          throw new Error(
            'Chat API does not implement markConversationRead.'
          );
        }

        await chatApi.markConversationRead(
          id,
          { signal }
        );

        return {
          conversationId: id,
        };
      } catch (error) {
        return rejectWithValue({
          message:
            extractErrorMessage(
              error,
              'Failed to mark conversation as read.'
            ),
          status:
            error?.response?.status ??
            null,
          conversationId: id,
        });
      }
    }
  );

/**
 * Archive a conversation.
 */
export const archiveConversation =
  createAsyncThunk(
    `${SLICE_NAME}/archiveConversation`,
    async (
      conversationId,
      { rejectWithValue, signal }
    ) => {
      const id =
        normalizeId(conversationId);

      if (!id) {
        return rejectWithValue({
          message:
            'Conversation ID is required.',
          status: 400,
        });
      }

      try {
        if (
          typeof chatApi.archiveConversation !==
          'function'
        ) {
          throw new Error(
            'Chat API does not implement archiveConversation.'
          );
        }

        const response =
          await chatApi.archiveConversation(
            id,
            { signal }
          );

        const payload =
          extractPayload(response);

        return {
          conversationId: id,
          conversation:
            normalizeConversation(
              payload?.conversation ??
                payload?.data ??
                payload
            ),
        };
      } catch (error) {
        return rejectWithValue({
          message:
            extractErrorMessage(
              error,
              'Failed to archive conversation.'
            ),
          status:
            error?.response?.status ??
            null,
          conversationId: id,
        });
      }
    }
  );

// ============================================================================
// SLICE
// ============================================================================

const chatSlice = createSlice({
  name: SLICE_NAME,

  initialState,

  reducers: {
    // ------------------------------------------------------------------------
    // Active conversation
    // ------------------------------------------------------------------------

    setActiveConversation(
      state,
      action
    ) {
      const conversation =
        normalizeConversation(
          action.payload
        );

      state.activeConversation =
        conversation;

      state.activeConversationId =
        conversation?.id ?? null;
    },

    setActiveConversationId(
      state,
      action
    ) {
      const id =
        normalizeId(
          action.payload
        );

      state.activeConversationId =
        id;

      state.activeConversation =
        state.conversations.find(
          (conversation) =>
            getEntityId(
              conversation
            ) === id
        ) || null;
    },

    clearActiveConversation(
      state
    ) {
      state.activeConversation =
        null;

      state.activeConversationId =
        null;

      state.activeConversationStatus =
        'idle';

      state.activeConversationError =
        null;
    },

    // ------------------------------------------------------------------------
    // Conversation updates
    // ------------------------------------------------------------------------

    upsertConversation(
      state,
      action
    ) {
      const conversation =
        normalizeConversation(
          action.payload
        );

      if (!conversation) {
        return;
      }

      const index =
        state.conversations.findIndex(
          (item) =>
            getEntityId(item) ===
            conversation.id
        );

      if (index === -1) {
        state.conversations.unshift(
          conversation
        );
      } else {
        state.conversations[index] = {
          ...state.conversations[index],
          ...conversation,
        };
      }

      if (
        state.activeConversationId ===
        conversation.id
      ) {
        state.activeConversation = {
          ...state.activeConversation,
          ...conversation,
        };
      }

      state.lastUpdatedAt =
        new Date().toISOString();
    },

    removeConversation(
      state,
      action
    ) {
      const id =
        normalizeId(
          action.payload
        );

      if (!id) {
        return;
      }

      state.conversations =
        state.conversations.filter(
          (conversation) =>
            getEntityId(conversation) !==
            id
        );

      delete state.messages[id];

      delete state.messagesStatus[id];

      delete state.messagesError[id];

      delete state.messagesRequestId[id];

      delete state.messagesPagination[id];

      if (
        state.activeConversationId === id
      ) {
        state.activeConversation =
          null;

        state.activeConversationId =
          null;
      }
    },

    // ------------------------------------------------------------------------
    // Messages
    // ------------------------------------------------------------------------

    upsertMessage(
      state,
      action
    ) {
      const message =
        normalizeMessage(
          action.payload
        );

      if (!message) {
        return;
      }

      const conversationId =
        message.conversationId;

      const existing =
        state.messages[
          conversationId
        ] || [];

      state.messages[
        conversationId
      ] = trimMessages(
        sortMessages(
          mergeById(
            existing,
            [message]
          )
        )
      );

      state.lastUpdatedAt =
        new Date().toISOString();
    },

    addMessage(
      state,
      action
    ) {
      const message =
        normalizeMessage(
          action.payload
        );

      if (!message) {
        return;
      }

      const conversationId =
        message.conversationId;

      const existing =
        state.messages[
          conversationId
        ] || [];

      const messageId =
        message.id;

      const exists =
        existing.some(
          (item) =>
            getEntityId(item) ===
            messageId
        );

      if (!exists) {
        state.messages[
          conversationId
        ] = trimMessages([
          ...existing,
          message,
        ]);
      }
    },

    updateMessage(
      state,
      action
    ) {
      const message =
        normalizeMessage(
          action.payload
        );

      if (!message) {
        return;
      }

      const conversationId =
        message.conversationId;

      const existing =
        state.messages[
          conversationId
        ] || [];

      const index =
        existing.findIndex(
          (item) =>
            getEntityId(item) ===
            message.id
        );

      if (index === -1) {
        existing.push(message);
      } else {
        existing[index] = {
          ...existing[index],
          ...message,
        };
      }

      state.messages[
        conversationId
      ] = sortMessages(
        existing
      );
    },

    removeMessage(
      state,
      action
    ) {
      const {
        conversationId,
        messageId,
      } =
        action.payload || {};

      const conversationKey =
        normalizeId(
          conversationId
        );

      const id =
        normalizeId(
          messageId
        );

      if (
        !conversationKey ||
        !id
      ) {
        return;
      }

      state.messages[
        conversationKey
      ] = (
        state.messages[
          conversationKey
        ] || []
      ).filter(
        (message) =>
          getEntityId(message) !==
          id
      );
    },

    clearMessages(
      state,
      action
    ) {
      const id =
        normalizeId(
          action.payload
        );

      if (!id) {
        return;
      }

      state.messages[id] = [];

      state.messagesStatus[id] =
        'idle';

      state.messagesError[id] =
        null;
    },

    // ------------------------------------------------------------------------
    // Read state
    // ------------------------------------------------------------------------

    setConversationUnreadCount(
      state,
      action
    ) {
      const {
        conversationId,
        unreadCount,
      } =
        action.payload || {};

      const id =
        normalizeId(
          conversationId
        );

      if (!id) {
        return;
      }

      const conversation =
        state.conversations.find(
          (item) =>
            getEntityId(item) ===
            id
        );

      if (conversation) {
        conversation.unreadCount =
          Math.max(
            0,
            Number(
              unreadCount
            ) || 0
          );
      }

      if (
        state.activeConversationId ===
        id &&
        state.activeConversation
      ) {
        state.activeConversation.unreadCount =
          Math.max(
            0,
            Number(
              unreadCount
            ) || 0
          );
      }
    },

    // ------------------------------------------------------------------------
    // Error management
    // ------------------------------------------------------------------------

    clearChatError(
      state
    ) {
      state.error = null;

      state.conversationsError =
        null;

      state.activeConversationError =
        null;

      state.fetchConversationOperation.error =
        null;

      state.sendMessageOperation.error =
        null;

      state.markReadOperation.error =
        null;

      state.archiveOperation.error =
        null;

      Object.keys(
        state.messagesError
      ).forEach((key) => {
        state.messagesError[key] =
          null;
      });
    },

    resetChatState() {
      return initialState;
    },
  },

  extraReducers: (
    builder
  ) => {
    // ========================================================================
    // FETCH CONVERSATIONS
    // ========================================================================

    builder
      .addCase(
        fetchConversations.pending,
        (state, action) => {
          state.status =
            'loading';

          state.conversationsStatus =
            'loading';

          state.conversationsError =
            null;

          state.conversationsRequestId =
            action.meta.requestId;
        }
      )

      .addCase(
        fetchConversations.fulfilled,
        (state, action) => {
          if (
            state.conversationsRequestId &&
            state.conversationsRequestId !==
              action.meta.requestId
          ) {
            return;
          }

          const incoming =
            action.payload
              ?.conversations || [];

          state.conversations =
            mergeById(
              state.conversations,
              incoming
            );

          state.conversationsStatus =
            'succeeded';

          state.status =
            'succeeded';

          state.conversationsError =
            null;

          const pagination =
            action.payload
              ?.pagination;

          if (
            isObject(pagination)
          ) {
            state.conversationsPagination =
              {
                ...state.conversationsPagination,
                ...pagination,
              };
          } else {
            state.conversationsPagination =
              {
                ...state.conversationsPagination,
                total:
                  state.conversations.length,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              };
          }

          state.lastUpdatedAt =
            new Date().toISOString();
        }
      )

      .addCase(
        fetchConversations.rejected,
        (state, action) => {
          if (
            action.meta.aborted
          ) {
            return;
          }

          state.conversationsStatus =
            'failed';

          state.status =
            'failed';

          state.conversationsError =
            action.payload?.message ||
            action.error?.message ||
            DEFAULT_ERROR_MESSAGE;

          state.error =
            state.conversationsError;
        }
      );

    // ========================================================================
    // FETCH CONVERSATION
    // ========================================================================

    builder
      .addCase(
        fetchConversationById.pending,
        (state, action) => {
          state.activeConversationStatus =
            'loading';

          state.activeConversationError =
            null;

          state.activeConversationRequestId =
            action.meta.requestId;

          state.fetchConversationOperation =
            {
              status: 'loading',
              error: null,
              requestId:
                action.meta.requestId,
            };
        }
      )

      .addCase(
        fetchConversationById.fulfilled,
        (state, action) => {
          if (
            state.activeConversationRequestId &&
            state.activeConversationRequestId !==
              action.meta.requestId
          ) {
            return;
          }

          const conversation =
            action.payload
              ?.conversation;

          if (!conversation) {
            return;
          }

          const id =
            conversation.id;

          const index =
            state.conversations.findIndex(
              (item) =>
                getEntityId(item) ===
                id
            );

          if (index === -1) {
            state.conversations.unshift(
              conversation
            );
          } else {
            state.conversations[index] =
              {
                ...state.conversations[
                  index
                ],
                ...conversation,
              };
          }

          state.activeConversation =
            conversation;

          state.activeConversationId =
            id;

          state.activeConversationStatus =
            'succeeded';

          state.activeConversationError =
            null;

          state.fetchConversationOperation =
            {
              status: 'succeeded',
              error: null,
              requestId:
                action.meta.requestId,
            };

          const messages =
            action.payload?.messages ||
            [];

          if (
            messages.length > 0
          ) {
            state.messages[id] =
              trimMessages(
                sortMessages(
                  mergeById(
                    state.messages[id] ||
                      [],
                    messages
                  )
                )
              );
          }

          state.lastUpdatedAt =
            new Date().toISOString();
        }
      )

      .addCase(
        fetchConversationById.rejected,
        (state, action) => {
          if (
            action.meta.aborted
          ) {
            return;
          }

          state.activeConversationStatus =
            'failed';

          state.activeConversationError =
            action.payload?.message ||
            action.error?.message ||
            'Failed to load conversation.';

          state.fetchConversationOperation =
            {
              status: 'failed',
              error:
                state.activeConversationError,
              requestId:
                action.meta.requestId,
            };

          state.error =
            state.activeConversationError;
        }
      );

    // ========================================================================
    // FETCH MESSAGES
    // ========================================================================

    builder
      .addCase(
        fetchMessages.pending,
        (state, action) => {
          const id =
            normalizeId(
              action.meta.arg
                ?.conversationId
            );

          if (!id) {
            return;
          }

          state.messagesStatus[id] =
            'loading';

          state.messagesError[id] =
            null;

          state.messagesRequestId[id] =
            action.meta.requestId;
        }
      )

      .addCase(
        fetchMessages.fulfilled,
        (state, action) => {
          const id =
            action.payload
              ?.conversationId;

          if (!id) {
            return;
          }

          if (
            state.messagesRequestId[id] &&
            state.messagesRequestId[id] !==
              action.meta.requestId
          ) {
            return;
          }

          const incoming =
            action.payload
              ?.messages || [];

          state.messages[id] =
            trimMessages(
              sortMessages(
                mergeById(
                  state.messages[id] ||
                    [],
                  incoming
                )
              )
            );

          state.messagesStatus[id] =
            'succeeded';

          state.messagesError[id] =
            null;

          if (
            isObject(
              action.payload
                ?.pagination
            )
          ) {
            state.messagesPagination[
              id
            ] = {
              ...(
                state.messagesPagination[
                  id
                ] || {}
              ),
              ...action.payload
                .pagination,
            };
          }

          state.lastUpdatedAt =
            new Date().toISOString();
        }
      )

      .addCase(
        fetchMessages.rejected,
        (state, action) => {
          if (
            action.meta.aborted
          ) {
            return;
          }

          const id =
            normalizeId(
              action.meta.arg
                ?.conversationId
            );

          if (!id) {
            return;
          }

          state.messagesStatus[id] =
            'failed';

          state.messagesError[id] =
            action.payload?.message ||
            action.error?.message ||
            'Failed to load messages.';

          state.error =
            state.messagesError[id];
        }
      );

    // ========================================================================
    // SEND MESSAGE
    // ========================================================================

    builder
      .addCase(
        sendMessage.pending,
        (state, action) => {
          state.sendMessageOperation =
            {
              status: 'loading',
              error: null,
              requestId:
                action.meta.requestId,
            };
        }
      )

      .addCase(
        sendMessage.fulfilled,
        (state, action) => {
          const message =
            action.payload
              ?.message;

          const conversationId =
            action.payload
              ?.conversationId;

          if (
            !message ||
            !conversationId
          ) {
            return;
          }

          const existing =
            state.messages[
              conversationId
            ] || [];

          state.messages[
            conversationId
          ] = trimMessages(
            sortMessages(
              mergeById(
                existing,
                [message]
              )
            )
          );

          state.sendMessageOperation =
            {
              status: 'succeeded',
              error: null,
              requestId:
                action.meta.requestId,
            };

          const conversation =
            state.conversations.find(
              (item) =>
                getEntityId(item) ===
                conversationId
            );

          if (conversation) {
            conversation.lastMessage =
              message;

            conversation.updatedAt =
              message.createdAt ??
              conversation.updatedAt;

            conversation.unreadCount =
              0;
          }

          if (
            state.activeConversationId ===
              conversationId &&
            state.activeConversation
          ) {
            state.activeConversation.lastMessage =
              message;

            state.activeConversation.unreadCount =
              0;
          }

          state.lastUpdatedAt =
            new Date().toISOString();
        }
      )

      .addCase(
        sendMessage.rejected,
        (state, action) => {
          if (
            action.meta.aborted
          ) {
            return;
          }

          state.sendMessageOperation =
            {
              status: 'failed',
              error:
                action.payload?.message ||
                action.error?.message ||
                'Failed to send message.',
              requestId:
                action.meta.requestId,
            };

          state.error =
            state.sendMessageOperation.error;
        }
      );

    // ========================================================================
    // MARK READ
    // ========================================================================

    builder
      .addCase(
        markConversationRead.pending,
        (state, action) => {
          state.markReadOperation =
            {
              status: 'loading',
              error: null,
              requestId:
                action.meta.requestId,
            };
        }
      )

      .addCase(
        markConversationRead.fulfilled,
        (state, action) => {
          const id =
            action.payload
              ?.conversationId;

          if (id) {
            const conversation =
              state.conversations.find(
                (item) =>
                  getEntityId(item) ===
                  id
              );

            if (conversation) {
              conversation.unreadCount =
                0;
            }

            if (
              state.activeConversationId ===
                id &&
              state.activeConversation
            ) {
              state.activeConversation.unreadCount =
                0;
            }
          }

          state.markReadOperation =
            {
              status: 'succeeded',
              error: null,
              requestId:
                action.meta.requestId,
            };
        }
      )

      .addCase(
        markConversationRead.rejected,
        (state, action) => {
          if (
            action.meta.aborted
          ) {
            return;
          }

          state.markReadOperation =
            {
              status: 'failed',
              error:
                action.payload?.message ||
                action.error?.message ||
                'Failed to mark conversation as read.',
              requestId:
                action.meta.requestId,
            };
        }
      );

    // ========================================================================
    // ARCHIVE
    // ========================================================================

    builder
      .addCase(
        archiveConversation.pending,
        (state, action) => {
          state.archiveOperation =
            {
              status: 'loading',
              error: null,
              requestId:
                action.meta.requestId,
            };
        }
      )

      .addCase(
        archiveConversation.fulfilled,
        (state, action) => {
          const id =
            action.payload
              ?.conversationId;

          if (id) {
            const conversation =
              state.conversations.find(
                (item) =>
                  getEntityId(item) ===
                  id
              );

            if (conversation) {
              conversation.status =
                'archived';
            }

            if (
              state.activeConversationId ===
                id &&
              state.activeConversation
            ) {
              state.activeConversation.status =
                'archived';
            }
          }

          state.archiveOperation =
            {
              status: 'succeeded',
              error: null,
              requestId:
                action.meta.requestId,
            };

          state.lastUpdatedAt =
            new Date().toISOString();
        }
      )

      .addCase(
        archiveConversation.rejected,
        (state, action) => {
          if (
            action.meta.aborted
          ) {
            return;
          }

          state.archiveOperation =
            {
              status: 'failed',
              error:
                action.payload?.message ||
                action.error?.message ||
                'Failed to archive conversation.',
              requestId:
                action.meta.requestId,
            };

          state.error =
            state.archiveOperation.error;
        }
      );
  },
});

// ============================================================================
// ACTIONS
// ============================================================================

export const {
  setActiveConversation,
  setActiveConversationId,
  clearActiveConversation,

  upsertConversation,
  removeConversation,

  upsertMessage,
  addMessage,
  updateMessage,
  removeMessage,
  clearMessages,

  setConversationUnreadCount,

  clearChatError,

  resetChatState,
} = chatSlice.actions;

// ============================================================================
// SELECTORS
// ============================================================================

export const selectChatState =
  (state) =>
    state?.chat || initialState;

export const selectConversations =
  (state) =>
    selectChatState(
      state
    ).conversations;

export const selectActiveConversation =
  (state) =>
    selectChatState(
      state
    ).activeConversation;

export const selectActiveConversationId =
  (state) =>
    selectChatState(
      state
    ).activeConversationId;

export const selectMessagesByConversationId =
  (
    state,
    conversationId
  ) =>
    selectChatState(
      state
    ).messages[
      normalizeId(
        conversationId
      )
    ] || [];

export const selectConversationById =
  (
    state,
    conversationId
  ) => {
    const id =
      normalizeId(
        conversationId
      );

    if (!id) {
      return null;
    }

    return (
      selectChatState(
        state
      ).conversations.find(
        (conversation) =>
          getEntityId(
            conversation
          ) === id
      ) || null
    );
  };

export const selectChatStatus =
  (state) =>
    selectChatState(
      state
    ).status;

export const selectChatError =
  (state) =>
    selectChatState(
      state
    ).error;

export const selectConversationsLoading =
  (state) =>
    selectChatState(
      state
    ).conversationsStatus ===
    'loading';

export const selectConversationLoading =
  (
    state,
    conversationId
  ) => {
    const chat =
      selectChatState(
        state
      );

    const id =
      normalizeId(
        conversationId
      );

    if (
      id &&
      chat.messagesStatus[id] ===
        'loading'
    ) {
      return true;
    }

    return (
      chat.activeConversationStatus ===
        'loading' &&
      chat.activeConversationId === id
    );
  };

export const selectMessagesLoading =
  (
    state,
    conversationId
  ) =>
    selectChatState(
      state
    ).messagesStatus[
      normalizeId(
        conversationId
      )
    ] === 'loading';

export const selectUnreadCount =
  (
    state,
    conversationId
  ) => {
    const conversation =
      selectConversationById(
        state,
        conversationId
      );

    return Math.max(
      0,
      Number(
        conversation?.unreadCount ||
          0
      )
    );
  };

// ============================================================================
// EXPORT
// ============================================================================

export default chatSlice.reducer;