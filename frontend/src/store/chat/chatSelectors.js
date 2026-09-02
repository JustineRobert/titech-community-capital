// ============================================================================
// TITech Community Capital
// frontend/src/store/chat/chatSelectors.js
// ============================================================================
//
// Enterprise Chat Selectors
// Production Grade
//
// Responsibilities
// - Centralized chat-state access
// - Defensive selectors
// - Memoized derived data
// - Conversation lookup
// - Active conversation lookup
// - Message lookup
// - Unread counts
// - Search/filter support
// - Loading/error state access
// - Pagination metadata
// - Safe compatibility with normalized and legacy state shapes
//
// IMPORTANT
// -----------------------------------------------------------------------------
// Selectors MUST remain pure.
//
// They:
// - MUST NOT perform API requests.
// - MUST NOT mutate Redux state.
// - MUST NOT dispatch actions.
// - MUST NOT access localStorage/sessionStorage.
// - MUST NOT expose authentication secrets.
//
// The chat reducer/store remains the source of truth.
// ============================================================================

"use strict";

import {
  createSelector,
} from "reselect";

// ============================================================================
// Constants
// ============================================================================

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_STRING = "";

const DEFAULT_CHAT_STATE = Object.freeze({
  conversations: EMPTY_ARRAY,
  messages: EMPTY_ARRAY,
  activeConversationId: null,
  loading: false,
  error: null,
  conversationsLoading: false,
  conversationLoading: false,
  messagesLoading: false,
  sendingMessage: false,
  markingRead: false,
  archivingConversation: false,
  creatingConversation: false,
});

// ============================================================================
// Internal State Resolution
// ============================================================================
//
// Supports both:
//
// state.chat
//
// and, defensively:
//
// state.chatState
// state.conversations
//
// The preferred architecture remains:
//
// state.chat
//
// ============================================================================

function selectChatState(state) {
  if (!state || typeof state !== "object") {
    return DEFAULT_CHAT_STATE;
  }

  if (
    state.chat &&
    typeof state.chat === "object"
  ) {
    return state.chat;
  }

  if (
    state.chatState &&
    typeof state.chatState === "object"
  ) {
    return state.chatState;
  }

  return DEFAULT_CHAT_STATE;
}

// ============================================================================
// Primitive State Selectors
// ============================================================================

export const selectChat = selectChatState;

export const selectConversationsState =
  createSelector(
    [selectChatState],
    (chat) => {
      if (
        Array.isArray(chat.conversations)
      ) {
        return chat.conversations;
      }

      if (
        chat.conversations &&
        Array.isArray(
          chat.conversations.items
        )
      ) {
        return chat.conversations.items;
      }

      return EMPTY_ARRAY;
    }
  );

export const selectMessagesState =
  createSelector(
    [selectChatState],
    (chat) => {
      if (
        Array.isArray(chat.messages)
      ) {
        return chat.messages;
      }

      if (
        chat.messages &&
        Array.isArray(
          chat.messages.items
        )
      ) {
        return chat.messages.items;
      }

      return EMPTY_ARRAY;
    }
  );

// ============================================================================
// Active Conversation ID
// ============================================================================

export const selectActiveConversationId =
  createSelector(
    [selectChatState],
    (chat) =>
      normalizeId(
        chat.activeConversationId ??
          chat.selectedConversationId ??
          chat.currentConversationId ??
          null
      )
  );

// ============================================================================
// Active Conversation
// ============================================================================

export const selectActiveConversation =
  createSelector(
    [
      selectConversationsState,
      selectActiveConversationId,
    ],
    (
      conversations,
      activeConversationId
    ) => {
      if (!activeConversationId) {
        return null;
      }

      return (
        conversations.find(
          (conversation) =>
            getConversationId(
              conversation
            ) ===
            activeConversationId
        ) || null
      );
    }
  );

// ============================================================================
// Conversation Lookup Factory
// ============================================================================
//
// Usage:
//
// const conversation = useSelector(
//   (state) =>
//     selectConversationById(
//       state,
//       conversationId
//     )
// );
//
// This preserves the selector API expected by ConversationDetail.
//

export function selectConversationById(
  state,
  conversationId
) {
  const id =
    normalizeId(
      conversationId
    );

  if (!id) {
    return null;
  }

  const conversations =
    selectConversationsState(state);

  return (
    conversations.find(
      (conversation) =>
        getConversationId(
          conversation
        ) === id
    ) || null
  );
}

// ============================================================================
// Memoized Conversation Selector
// ============================================================================
//
// Useful where the same conversation ID is repeatedly selected by a component.
//

export const makeSelectConversationById =
  () =>
  (state, conversationId) =>
    selectConversationById(
      state,
      conversationId
    );

// ============================================================================
// Conversation IDs
// ============================================================================

export const selectConversationIds =
  createSelector(
    [selectConversationsState],
    (conversations) =>
      conversations
        .map(getConversationId)
        .filter(Boolean)
  );

// ============================================================================
// Conversation Count
// ============================================================================

export const selectConversationCount =
  createSelector(
    [selectConversationsState],
    (conversations) =>
      conversations.length
  );

// ============================================================================
// Unread Conversations
// ============================================================================

export const selectUnreadConversations =
  createSelector(
    [selectConversationsState],
    (conversations) =>
      conversations.filter(
        (conversation) =>
          getUnreadCount(
            conversation
          ) > 0
      )
  );

// ============================================================================
// Unread Conversation Count
// ============================================================================

export const selectUnreadConversationCount =
  createSelector(
    [selectUnreadConversations],
    (conversations) =>
      conversations.length
  );

// ============================================================================
// Total Unread Messages
// ============================================================================

export const selectTotalUnreadCount =
  createSelector(
    [selectConversationsState],
    (conversations) =>
      conversations.reduce(
        (total, conversation) =>
          total +
          getUnreadCount(
            conversation
          ),
        0
      )
  );

// ============================================================================
// Conversation Loading
// ============================================================================

export const selectConversationsLoading =
  createSelector(
    [selectChatState],
    (chat) =>
      Boolean(
        chat.conversationsLoading ??
          chat.loadingConversations ??
          false
      )
  );

export const selectConversationLoading =
  createSelector(
    [selectChatState],
    (chat) =>
      Boolean(
        chat.conversationLoading ??
          chat.loadingConversation ??
          false
      )
  );

export const selectMessagesLoading =
  createSelector(
    [selectChatState],
    (chat) =>
      Boolean(
        chat.messagesLoading ??
          chat.loadingMessages ??
          false
      )
  );

export const selectSendingMessage =
  createSelector(
    [selectChatState],
    (chat) =>
      Boolean(
        chat.sendingMessage ??
          chat.sending ??
          false
      )
  );

export const selectMarkingConversationRead =
  createSelector(
    [selectChatState],
    (chat) =>
      Boolean(
        chat.markingRead ??
          chat.markingConversationRead ??
          false
      )
  );

export const selectArchivingConversation =
  createSelector(
    [selectChatState],
    (chat) =>
      Boolean(
        chat.archivingConversation ??
          chat.archiving ??
          false
      )
  );

export const selectCreatingConversation =
  createSelector(
    [selectChatState],
    (chat) =>
      Boolean(
        chat.creatingConversation ??
          chat.creating ??
          false
      )
  );

// ============================================================================
// Global Chat Loading
// ============================================================================

export const selectChatLoading =
  createSelector(
    [
      selectConversationsLoading,
      selectConversationLoading,
      selectMessagesLoading,
      selectSendingMessage,
      selectMarkingConversationRead,
      selectArchivingConversation,
      selectCreatingConversation,
    ],
    (
      conversationsLoading,
      conversationLoading,
      messagesLoading,
      sendingMessage,
      markingRead,
      archiving,
      creating
    ) =>
      Boolean(
        conversationsLoading ||
          conversationLoading ||
          messagesLoading ||
          sendingMessage ||
          markingRead ||
          archiving ||
          creating
      )
  );

// ============================================================================
// Error Selectors
// ============================================================================

export const selectChatError =
  createSelector(
    [selectChatState],
    (chat) =>
      normalizeError(
        chat.error ??
          chat.chatError ??
          null
      )
  );

export const selectConversationsError =
  createSelector(
    [selectChatState],
    (chat) =>
      normalizeError(
        chat.conversationsError ??
          null
      )
  );

export const selectConversationError =
  createSelector(
    [selectChatState],
    (chat) =>
      normalizeError(
        chat.conversationError ??
          null
      )
  );

export const selectMessagesError =
  createSelector(
    [selectChatState],
    (chat) =>
      normalizeError(
        chat.messagesError ??
          null
      )
  );

export const selectSendMessageError =
  createSelector(
    [selectChatState],
    (chat) =>
      normalizeError(
        chat.sendMessageError ??
          null
      )
  );

// ============================================================================
// Messages
// ============================================================================

export const selectAllMessages =
  createSelector(
    [selectMessagesState],
    (messages) =>
      Array.isArray(messages)
        ? messages
        : EMPTY_ARRAY
  );

// ============================================================================
// Messages By Conversation
// ============================================================================
//
// Supports normalized messages such as:
//
// {
//   conversationId,
//   id,
//   content
// }
//
// and nested conversation structures.
//

export function selectMessagesByConversationId(
  state,
  conversationId
) {
  const id =
    normalizeId(
      conversationId
    );

  if (!id) {
    return EMPTY_ARRAY;
  }

  const messages =
    selectMessagesState(state);

  return messages.filter(
    (message) =>
      getMessageConversationId(
        message
      ) === id
  );
}

// ============================================================================
// Memoized Messages Selector Factory
// ============================================================================

export const makeSelectMessagesByConversationId =
  () => {
    return createSelector(
      [
        selectMessagesState,
        (_state, conversationId) =>
          normalizeId(
            conversationId
          ),
      ],
      (
        messages,
        conversationId
      ) => {
        if (!conversationId) {
          return EMPTY_ARRAY;
        }

        return messages.filter(
          (message) =>
            getMessageConversationId(
              message
            ) === conversationId
        );
      }
    );
  };

// ============================================================================
// Message Count
// ============================================================================

export function selectMessageCount(
  state,
  conversationId
) {
  return selectMessagesByConversationId(
    state,
    conversationId
  ).length;
}

// ============================================================================
// Latest Message
// ============================================================================

export function selectLatestMessage(
  state,
  conversationId
) {
  const messages =
    selectMessagesByConversationId(
      state,
      conversationId
    );

  if (!messages.length) {
    return null;
  }

  return [...messages].sort(
    compareMessagesByDateDesc
  )[0];
}

// ============================================================================
// First Message
// ============================================================================

export function selectFirstMessage(
  state,
  conversationId
) {
  const messages =
    selectMessagesByConversationId(
      state,
      conversationId
    );

  if (!messages.length) {
    return null;
  }

  return [...messages].sort(
    compareMessagesByDateAsc
  )[0];
}

// ============================================================================
// Active Conversation Messages
// ============================================================================

export const selectActiveConversationMessages =
  createSelector(
    [
      selectMessagesState,
      selectActiveConversationId,
    ],
    (
      messages,
      conversationId
    ) => {
      if (!conversationId) {
        return EMPTY_ARRAY;
      }

      return messages.filter(
        (message) =>
          getMessageConversationId(
            message
          ) === conversationId
      );
    }
  );

// ============================================================================
// Latest Message Per Conversation
// ============================================================================

export const selectConversationPreviews =
  createSelector(
    [selectConversationsState],
    (conversations) =>
      conversations.map(
        (conversation) => ({
          conversation,
          id:
            getConversationId(
              conversation
            ),
          title:
            getConversationTitle(
              conversation
            ),
          unreadCount:
            getUnreadCount(
              conversation
            ),
          lastMessage:
            getConversationLastMessage(
              conversation
            ),
          updatedAt:
            getConversationUpdatedAt(
              conversation
            ),
        })
      )
  );

// ============================================================================
// Search
// ============================================================================

export function selectConversationsByQuery(
  state,
  query
) {
  const conversations =
    selectConversationsState(
      state
    );

  const normalizedQuery =
    String(
      query || ""
    )
      .trim()
      .toLowerCase();

  if (!normalizedQuery) {
    return conversations;
  }

  return conversations.filter(
    (conversation) => {
      const haystack = [
        getConversationTitle(
          conversation
        ),
        getConversationSubject(
          conversation
        ),
        getConversationLastMessage(
          conversation
        ),
        getParticipantSearchText(
          conversation
        ),
        getConversationId(
          conversation
        ),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(
        normalizedQuery
      );
    }
  );
}

// ============================================================================
// Memoized Search Selector Factory
// ============================================================================

export const makeSelectConversationsByQuery =
  () =>
    createSelector(
      [
        selectConversationsState,
        (_state, query) =>
          String(
            query || ""
          )
            .trim()
            .toLowerCase(),
      ],
      (
        conversations,
        query
      ) => {
        if (!query) {
          return conversations;
        }

        return conversations.filter(
          (conversation) => {
            const haystack = [
              getConversationTitle(
                conversation
              ),
              getConversationSubject(
                conversation
              ),
              getConversationLastMessage(
                conversation
              ),
              getParticipantSearchText(
                conversation
              ),
              getConversationId(
                conversation
              ),
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();

            return haystack.includes(
              query
            );
          }
        );
      }
    );

// ============================================================================
// Conversation Status
// ============================================================================

export function selectConversationStatus(
  state,
  conversationId
) {
  const conversation =
    selectConversationById(
      state,
      conversationId
    );

  return (
    conversation?.status ||
    "active"
  );
}

// ============================================================================
// Conversation Participants
// ============================================================================

export function selectConversationParticipants(
  state,
  conversationId
) {
  const conversation =
    selectConversationById(
      state,
      conversationId
    );

  return getParticipants(
    conversation
  );
}

// ============================================================================
// Participant Label
// ============================================================================

export function selectConversationParticipantsLabel(
  state,
  conversationId
) {
  const participants =
    selectConversationParticipants(
      state,
      conversationId
    );

  return formatParticipantsLabel(
    participants
  );
}

// ============================================================================
// Conversation Title
// ============================================================================

export function selectConversationTitle(
  state,
  conversationId
) {
  const conversation =
    selectConversationById(
      state,
      conversationId
    );

  return getConversationTitle(
    conversation
  );
}

// ============================================================================
// Conversation Unread Count
// ============================================================================

export function selectConversationUnreadCount(
  state,
  conversationId
) {
  const conversation =
    selectConversationById(
      state,
      conversationId
    );

  return getUnreadCount(
    conversation
  );
}

// ============================================================================
// Conversation Exists
// ============================================================================

export function selectConversationExists(
  state,
  conversationId
) {
  return Boolean(
    selectConversationById(
      state,
      conversationId
    )
  );
}

// ============================================================================
// Message Lookup
// ============================================================================

export function selectMessageById(
  state,
  messageId
) {
  const id =
    normalizeId(messageId);

  if (!id) {
    return null;
  }

  return (
    selectMessagesState(
      state
    ).find(
      (message) =>
        getMessageId(message) === id
    ) || null
  );
}

// ============================================================================
// Message Sending Status
// ============================================================================

export function selectMessageSendState(
  state,
  messageId
) {
  const message =
    selectMessageById(
      state,
      messageId
    );

  if (!message) {
    return {
      status: "unknown",
      pending: false,
      failed: false,
      sent: false,
    };
  }

  const status =
    String(
      message.status ||
        message.deliveryStatus ||
        ""
    ).toLowerCase();

  return {
    status,

    pending: [
      "pending",
      "sending",
      "queued",
    ].includes(status),

    failed: [
      "failed",
      "error",
    ].includes(status),

    sent: [
      "sent",
      "delivered",
      "read",
    ].includes(status),
  };
}

// ============================================================================
// Pagination
// ============================================================================

export const selectConversationsPagination =
  createSelector(
    [selectChatState],
    (chat) =>
      normalizePagination(
        chat.conversationsPagination ||
          chat.pagination ||
          null
      )
  );

export const selectMessagesPagination =
  createSelector(
    [selectChatState],
    (chat) =>
      normalizePagination(
        chat.messagesPagination ||
          null
      )
  );

// ============================================================================
// Pagination Helpers
// ============================================================================

export function selectConversationPage(
  state
) {
  return selectConversationsPagination(
    state
  ).page;
}

export function selectConversationPageSize(
  state
) {
  return selectConversationsPagination(
    state
  ).limit;
}

export function selectConversationTotal(
  state
) {
  return selectConversationsPagination(
    state
  ).total;
}

export function selectConversationTotalPages(
  state
) {
  return selectConversationsPagination(
    state
  ).totalPages;
}

// ============================================================================
// Connection / Synchronization State
// ============================================================================

export const selectChatConnected =
  createSelector(
    [selectChatState],
    (chat) =>
      Boolean(
        chat.connected ??
          chat.isConnected ??
          false
      )
  );

export const selectChatSyncing =
  createSelector(
    [selectChatState],
    (chat) =>
      Boolean(
        chat.syncing ??
          chat.isSyncing ??
          false
      )
  );

export const selectChatLastSyncedAt =
  createSelector(
    [selectChatState],
    (chat) =>
      chat.lastSyncedAt ??
      chat.lastSyncAt ??
      null
  );

// ============================================================================
// Permission Helpers
// ============================================================================
//
// These selectors do not replace backend authorization.
// They only support frontend UX decisions.
//

export function selectCanSendMessage(
  state,
  conversationId
) {
  const conversation =
    selectConversationById(
      state,
      conversationId
    );

  if (!conversation) {
    return false;
  }

  if (
    conversation.archived ||
    conversation.status ===
      "archived"
  ) {
    return false;
  }

  if (
    conversation.canSend === false
  ) {
    return false;
  }

  return true;
}

export function selectCanArchiveConversation(
  state,
  conversationId
) {
  const conversation =
    selectConversationById(
      state,
      conversationId
    );

  if (!conversation) {
    return false;
  }

  if (
    conversation.archived ||
    conversation.status ===
      "archived"
  ) {
    return false;
  }

  if (
    conversation.canArchive ===
    false
  ) {
    return false;
  }

  return true;
}

// ============================================================================
// Derived Dashboard Statistics
// ============================================================================

export const selectChatStatistics =
  createSelector(
    [
      selectConversationsState,
      selectTotalUnreadCount,
      selectUnreadConversationCount,
    ],
    (
      conversations,
      totalUnread,
      unreadConversations
    ) => {
      let archived = 0;
      let active = 0;

      for (
        const conversation of conversations
      ) {
        const status =
          String(
            conversation?.status ||
              "active"
          ).toLowerCase();

        if (
          status === "archived" ||
          conversation?.archived ===
            true
        ) {
          archived += 1;
        } else {
          active += 1;
        }
      }

      return {
        total:
          conversations.length,

        active,

        archived,

        unreadConversations,

        totalUnreadMessages:
          totalUnread,
      };
    }
  );

// ============================================================================
// Internal Normalization Helpers
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
    const valueString =
      String(value).trim();

    return valueString ||
      null;
  }

  if (
    typeof value === "object" &&
    typeof value.toString ===
      "function"
  ) {
    const valueString =
      value
        .toString()
        .trim();

    return valueString ||
      null;
  }

  return null;
}

// ============================================================================
// Conversation Helpers
// ============================================================================

function getConversationId(
  conversation
) {
  if (!conversation) {
    return null;
  }

  return normalizeId(
    conversation.id ??
      conversation._id ??
      conversation.conversationId
  );
}

function getConversationTitle(
  conversation
) {
  if (!conversation) {
    return "Conversation";
  }

  return (
    conversation.title ||
    conversation.subject ||
    conversation.name ||
    "Conversation"
  );
}

function getConversationSubject(
  conversation
) {
  if (!conversation) {
    return EMPTY_STRING;
  }

  return (
    conversation.subject ||
    EMPTY_STRING
  );
}

function getConversationLastMessage(
  conversation
) {
  if (!conversation) {
    return EMPTY_STRING;
  }

  const lastMessage =
    conversation.lastMessage;

  if (
    typeof lastMessage ===
    "string"
  ) {
    return lastMessage;
  }

  if (
    lastMessage &&
    typeof lastMessage ===
      "object"
  ) {
    return (
      lastMessage.content ||
      lastMessage.text ||
      lastMessage.body ||
      EMPTY_STRING
    );
  }

  return (
    conversation.preview ||
    EMPTY_STRING
  );
}

function getConversationUpdatedAt(
  conversation
) {
  if (!conversation) {
    return null;
  }

  return (
    conversation.updatedAt ||
    conversation.lastUpdated ||
    conversation.modifiedAt ||
    conversation.lastMessageAt ||
    conversation.createdAt ||
    null
  );
}

function getUnreadCount(
  conversation
) {
  if (!conversation) {
    return 0;
  }

  const count =
    Number(
      conversation.unreadCount ??
        conversation.unread ??
        0
    );

  if (
    !Number.isFinite(count) ||
    count < 0
  ) {
    return 0;
  }

  return Math.floor(count);
}

function getParticipants(
  conversation
) {
  if (!conversation) {
    return EMPTY_ARRAY;
  }

  if (
    Array.isArray(
      conversation.participants
    )
  ) {
    return conversation.participants;
  }

  if (
    Array.isArray(
      conversation.members
    )
  ) {
    return conversation.members;
  }

  return EMPTY_ARRAY;
}

function getParticipantSearchText(
  conversation
) {
  return getParticipants(
    conversation
  )
    .map(
      (participant) => {
        if (
          typeof participant ===
          "string"
        ) {
          return participant;
        }

        return [
          participant?.name,
          participant?.email,
          participant?.username,
          participant?.id,
        ]
          .filter(Boolean)
          .join(" ");
      }
    )
    .filter(Boolean)
    .join(" ");
}

function formatParticipantsLabel(
  participants
) {
  if (
    !Array.isArray(participants) ||
    participants.length === 0
  ) {
    return "No participants";
  }

  const names =
    participants
      .map(
        (participant) => {
          if (
            typeof participant ===
            "string"
          ) {
            return participant;
          }

          return (
            participant?.name ||
            participant?.email ||
            participant?.username ||
            participant?.id ||
            "Participant"
          );
        }
      )
      .filter(Boolean);

  if (names.length === 0) {
    return "No participants";
  }

  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names[0]} and ${
    names.length - 1
  } others`;
}

// ============================================================================
// Message Helpers
// ============================================================================

function getMessageId(message) {
  if (!message) {
    return null;
  }

  return normalizeId(
    message.id ??
      message._id ??
      message.messageId ??
      message.clientMessageId
  );
}

function getMessageConversationId(
  message
) {
  if (!message) {
    return null;
  }

  const conversationId =
    message.conversationId ??
    message.conversation?.id ??
    message.conversation?._id;

  return normalizeId(
    conversationId
  );
}

function getMessageDate(
  message
) {
  if (!message) {
    return 0;
  }

  const value =
    message.createdAt ??
    message.sentAt ??
    message.timestamp ??
    message.updatedAt;

  if (!value) {
    return 0;
  }

  const time =
    new Date(value).getTime();

  return Number.isFinite(time)
    ? time
    : 0;
}

function compareMessagesByDateDesc(
  a,
  b
) {
  return (
    getMessageDate(b) -
    getMessageDate(a)
  );
}

function compareMessagesByDateAsc(
  a,
  b
) {
  return (
    getMessageDate(a) -
    getMessageDate(b)
  );
}

// ============================================================================
// Error Helpers
// ============================================================================

function normalizeError(error) {
  if (!error) {
    return null;
  }

  if (
    typeof error === "string"
  ) {
    return error;
  }

  if (
    error.message
  ) {
    return String(
      error.message
    );
  }

  return String(error);
}

// ============================================================================
// Pagination Helpers
// ============================================================================

function normalizePagination(
  pagination
) {
  if (
    !pagination ||
    typeof pagination !==
      "object"
  ) {
    return {
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    };
  }

  const page =
    normalizePositiveInteger(
      pagination.page ??
        pagination.currentPage ??
        1
    );

  const limit =
    normalizePositiveInteger(
      pagination.limit ??
        pagination.pageSize ??
        pagination.perPage ??
        25
    );

  const total =
    normalizeNonNegativeInteger(
      pagination.total ??
        pagination.count ??
        0
    );

  const totalPages =
    normalizePositiveInteger(
      pagination.totalPages ??
        Math.max(
          1,
          Math.ceil(
            total / limit
          )
        )
    );

  return {
    page,

    limit,

    total,

    totalPages,

    hasNextPage:
      pagination.hasNextPage ??
      page < totalPages,

    hasPreviousPage:
      pagination.hasPreviousPage ??
      page > 1,
  };
}

function normalizePositiveInteger(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number) ||
    number < 1
  ) {
    return 1;
  }

  return Math.floor(number);
}

function normalizeNonNegativeInteger(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return 0;
  }

  return Math.floor(number);
}

// ============================================================================
// Default Export
// ============================================================================

const chatSelectors = Object.freeze({
  selectChat,
  selectConversationsState,
  selectMessagesState,
  selectActiveConversationId,
  selectActiveConversation,
  selectConversationById,
  makeSelectConversationById,
  selectConversationIds,
  selectConversationCount,
  selectUnreadConversations,
  selectUnreadConversationCount,
  selectTotalUnreadCount,
  selectConversationsLoading,
  selectConversationLoading,
  selectMessagesLoading,
  selectSendingMessage,
  selectMarkingConversationRead,
  selectArchivingConversation,
  selectCreatingConversation,
  selectChatLoading,
  selectChatError,
  selectConversationsError,
  selectConversationError,
  selectMessagesError,
  selectSendMessageError,
  selectAllMessages,
  selectMessagesByConversationId,
  makeSelectMessagesByConversationId,
  selectMessageCount,
  selectLatestMessage,
  selectFirstMessage,
  selectActiveConversationMessages,
  selectConversationPreviews,
  selectConversationsByQuery,
  makeSelectConversationsByQuery,
  selectConversationStatus,
  selectConversationParticipants,
  selectConversationParticipantsLabel,
  selectConversationTitle,
  selectConversationUnreadCount,
  selectConversationExists,
  selectMessageById,
  selectMessageSendState,
  selectConversationsPagination,
  selectMessagesPagination,
  selectConversationPage,
  selectConversationPageSize,
  selectConversationTotal,
  selectConversationTotalPages,
  selectChatConnected,
  selectChatSyncing,
  selectChatLastSyncedAt,
  selectCanSendMessage,
  selectCanArchiveConversation,
  selectChatStatistics,
});

export default chatSelectors;