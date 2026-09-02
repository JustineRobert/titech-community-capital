/* global console */

/**
 * forumService.js
 * Service for managing community forum functionality
 */

import axios from 'axios';

const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
  'http://localhost:3001/api';

const forumService = {
  /**
   * Get all forum topics with pagination
   */
  getTopics: async (options = {}) => {
    try {
      const { page = 1, limit = 20, sort = 'newest', category, filter } = options;
      const params = { page, limit, sort };

      if (category) params.category = category;
      if (filter) params.filter = filter;

      const response = await axios.get(`${API_BASE_URL}/forum/topics`, { params });
      return response.data.topics;
    } catch (error) {
      console.error('Error fetching topics:', error);
      throw error;
    }
  },

  /**
   * Get specific topic with replies
   */
  getTopic: async (topicId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/forum/topics/${topicId}`);
      return response.data.topic;
    } catch (error) {
      console.error('Error fetching topic:', error);
      throw error;
    }
  },

  /**
   * Get topics by category
   */
  getTopicsByCategory: async (category, page = 1, limit = 20) => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/forum/topics/category/${category}`,
        { params: { page, limit } }
      );
      return response.data.topics;
    } catch (error) {
      console.error('Error fetching topics by category:', error);
      throw error;
    }
  },

  /**
   * Search forum topics
   */
  searchTopics: async (query, page = 1, limit = 20) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/forum/search`, {
        params: { q: query, page, limit },
      });
      return response.data.results;
    } catch (error) {
      console.error('Error searching topics:', error);
      throw error;
    }
  },

  /**
   * Create new forum topic
   */
  createTopic: async (topicData) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/forum/topics`, topicData);
      return response.data.topic;
    } catch (error) {
      console.error('Error creating topic:', error);
      throw error;
    }
  },

  /**
   * Update forum topic
   */
  updateTopic: async (topicId, topicData) => {
    try {
      const response = await axios.put(
        `${API_BASE_URL}/forum/topics/${topicId}`,
        topicData
      );
      return response.data.topic;
    } catch (error) {
      console.error('Error updating topic:', error);
      throw error;
    }
  },

  /**
   * Delete forum topic
   */
  deleteTopic: async (topicId) => {
    try {
      const response = await axios.delete(`${API_BASE_URL}/forum/topics/${topicId}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting topic:', error);
      throw error;
    }
  },

  /**
   * Create reply to topic
   */
  createReply: async (topicId, replyData) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/forum/topics/${topicId}/replies`,
        replyData
      );
      return response.data.reply;
    } catch (error) {
      console.error('Error creating reply:', error);
      throw error;
    }
  },

  /**
   * Get topic replies
   */
  getTopicReplies: async (topicId, page = 1, limit = 20) => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/forum/topics/${topicId}/replies`,
        { params: { page, limit } }
      );
      return response.data.replies;
    } catch (error) {
      console.error('Error fetching replies:', error);
      throw error;
    }
  },

  /**
   * Update reply
   */
  updateReply: async (topicId, replyId, replyData) => {
    try {
      const response = await axios.put(
        `${API_BASE_URL}/forum/topics/${topicId}/replies/${replyId}`,
        replyData
      );
      return response.data.reply;
    } catch (error) {
      console.error('Error updating reply:', error);
      throw error;
    }
  },

  /**
   * Delete reply
   */
  deleteReply: async (topicId, replyId) => {
    try {
      const response = await axios.delete(
        `${API_BASE_URL}/forum/topics/${topicId}/replies/${replyId}`
      );
      return response.data;
    } catch (error) {
      console.error('Error deleting reply:', error);
      throw error;
    }
  },

  /**
   * Get forum categories
   */
  getCategories: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/forum/categories`);
      return response.data.categories;
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }
  },

  /**
   * Get forum statistics
   */
  getForumStats: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/forum/stats`);
      return response.data;
    } catch (error) {
      console.error('Error fetching forum stats:', error);
      throw error;
    }
  },

  /**
   * Get trending topics
   */
  getTrendingTopics: async (limit = 10, timeframe = 'week') => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/forum/topics/trending`,
        { params: { limit, timeframe } }
      );
      return response.data.topics;
    } catch (error) {
      console.error('Error fetching trending topics:', error);
      throw error;
    }
  },
};

// ✅ FIX: Replace CommonJS export
export default forumService;