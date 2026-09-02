'use strict';

/**
 * ============================================================================
 * CHAT SERVICE (FRONTEND - ACFOS ENTERPRISE EDITION)
 * ============================================================================
 * TITech Community Capital LTD
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Central API client for TITechChat frontend module.
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Conversation management APIs
 * ✅ Message sending
 * ✅ Export & compliance operations
 * ✅ Consistent Axios instance with interceptors support
 * ✅ Error normalization for UI layer
 *
 * ARCHITECTURE NOTE
 * ----------------------------------------------------------------------------
 * This service is intentionally thin:
 * - No business logic here
 * - Only API communication
 *
 * ============================================================================
 */

import axios from 'axios';

/*
|--------------------------------------------------------------------------
| Axios Instance
|--------------------------------------------------------------------------
*/

const api = axios.create({
  baseURL: '/api/chat',
  timeout: 30000,
});

/*
|--------------------------------------------------------------------------
| Request Interceptor (Auth injection placeholder)
|--------------------------------------------------------------------------
*/

api.interceptors.request.use(
  (config) => {
    const token =
      localStorage.getItem('token');

    if (token) {
      config.headers.Authorization =
        `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

/*
|--------------------------------------------------------------------------
| Response Interceptor (Normalize Errors)
|--------------------------------------------------------------------------
*/

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalizedError = {
      message:
        error?.response?.data?.message ||
        error.message ||
        'Chat service error',
      status:
        error?.response?.status,
      data:
        error?.response?.data,
    };

    return Promise.reject(
      normalizedError
    );
  }
);

/*
|--------------------------------------------------------------------------
| CONVERSATIONS
|--------------------------------------------------------------------------
*/

/**
 * Fetch all user conversations
 */
export async function fetchConversations() {
  const res = await api.get(
    '/conversations'
  );
  return res.data;
}

/**
 * Fetch single conversation
 */
export async function fetchConversation(
  conversationId
) {
  const res = await api.get(
    `/conversations/${conversationId}`
  );
  return res.data;
}

/*
|--------------------------------------------------------------------------
| MESSAGES
|--------------------------------------------------------------------------
*/

/**
 * Send message to conversation
 */
export async function postMessage(
  payload
) {
  const res = await api.post(
    `/conversations/${payload.conversationId}/messages`,
    payload
  );
  return res.data;
}

/**
 * Edit message
 */
export async function editMessage(
  messageId,
  body
) {
  const res = await api.patch(
    `/messages/${messageId}`,
    { body }
  );
  return res.data;
}

/**
 * Delete message
 */
export async function deleteMessage(
  messageId
) {
  const res = await api.delete(
    `/messages/${messageId}`
  );
  return res.data;
}

/*
|--------------------------------------------------------------------------
| EXPORT / COMPLIANCE
|--------------------------------------------------------------------------
*/

/**
 * Export full conversation history
 */
export async function exportConversation(
  conversationId
) {
  const res = await api.post(
    `/conversations/${conversationId}/export`
  );
  return res.data;
}

/**
 * Get export status/file
 */
export async function getExport(
  exportId
) {
  const res = await api.get(
    `/exports/${exportId}`
  );
  return res.data;
}

/*
|--------------------------------------------------------------------------
| SEARCH
|--------------------------------------------------------------------------
*/

/**
 * Search messages in conversation
 */
export async function searchMessages(
  conversationId,
  query
) {
  const res = await api.get(
    `/conversations/${conversationId}/search`,
    {
      params: { q: query },
    }
  );

  return res.data;
}

/*
|--------------------------------------------------------------------------
| THREAD HELPERS
|--------------------------------------------------------------------------
*/

/**
 * Create support thread
 */
export async function createSupportThread(
  payload
) {
  const res = await api.post(
    '/support/threads',
    payload
  );
  return res.data;
}

/*
|--------------------------------------------------------------------------
| EXPORT
|--------------------------------------------------------------------------
*/

export default {
  fetchConversations,
  fetchConversation,
  postMessage,
  editMessage,
  deleteMessage,
  exportConversation,
  getExport,
  searchMessages,
  createSupportThread,
};