/* global console */

/**
 * helpService.js
 * Service for managing help center articles
 */


/**
 * helpService.js
 * Service for managing help center articles
 */

import axios from 'axios';

const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
  'http://localhost:3001/api';

const helpService = {
  /**
   * Get all help articles
   */
  getArticles: async (page = 1, limit = 10) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/help/articles`, {
        params: { page, limit },
      });
      return response.data.articles;
    } catch (error) {
      console.error('Error fetching articles:', error);
      throw error;
    }
  },

  /**
   * Search help articles
   */
  searchArticles: async (query) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/help/search`, {
        params: { q: query },
      });
      return response.data.results;
    } catch (error) {
      console.error('Error searching articles:', error);
      throw error;
    }
  },

  /**
   * Get articles by category
   */
  getArticlesByCategory: async (category, page = 1, limit = 10) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/help/articles/category/${category}`, {
        params: { page, limit },
      });
      return response.data.articles;
    } catch (error) {
      console.error('Error fetching articles by category:', error);
      throw error;
    }
  },

  /**
   * Get specific article details
   */
  getArticle: async (articleId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/help/articles/${articleId}`);
      return response.data.article;
    } catch (error) {
      console.error('Error fetching article:', error);
      throw error;
    }
  },

  /**
   * Get all help categories
   */
  getCategories: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/help/categories`);
      return response.data.categories;
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }
  },

  /**
   * Get featured articles
   */
  getFeaturedArticles: async (limit = 6) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/help/articles/featured`, {
        params: { limit },
      });
      return response.data.articles;
    } catch (error) {
      console.error('Error fetching featured articles:', error);
      throw error;
    }
  },

  /**
   * Mark article as helpful
   */
  markArticleHelpful: async (articleId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/help/articles/${articleId}/helpful`);
      return response.data;
    } catch (error) {
      console.error('Error marking article helpful:', error);
      throw error;
    }
  },

  /**
   * Mark article as not helpful
   */
  markArticleUnhelpful: async (articleId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/help/articles/${articleId}/unhelpful`);
      return response.data;
    } catch (error) {
      console.error('Error marking article unhelpful:', error);
      throw error;
    }
  },

  /**
   * Get related articles
   */
  getRelatedArticles: async (articleId, limit = 5) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/help/articles/${articleId}/related`, {
        params: { limit },
      });
      return response.data.articles;
    } catch (error) {
      console.error('Error fetching related articles:', error);
      throw error;
    }
  },

  /**
   * Increment article view count
   */
  incrementArticleViews: async (articleId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/help/articles/${articleId}/views`);
      return response.data;
    } catch (error) {
      console.error('Error incrementing views:', error);
      throw error;
    }
  },

  /**
   * Get article statistics
   */
  getArticleStats: async (articleId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/help/articles/${articleId}/stats`);
      return response.data;
    } catch (error) {
      console.error('Error fetching article stats:', error);
      throw error;
    }
  },

  /**
   * Create help article (admin only)
   */
  createArticle: async (articleData) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/help/articles`, articleData);
      return response.data.article;
    } catch (error) {
      console.error('Error creating article:', error);
      throw error;
    }
  },

  /**
   * Update help article (admin only)
   */
  updateArticle: async (articleId, articleData) => {
    try {
      const response = await axios.put(`${API_BASE_URL}/help/articles/${articleId}`, articleData);
      return response.data.article;
    } catch (error) {
      console.error('Error updating article:', error);
      throw error;
    }
  },

  /**
   * Delete help article (admin only)
   */
  deleteArticle: async (articleId) => {
    try {
      const response = await axios.delete(`${API_BASE_URL}/help/articles/${articleId}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting article:', error);
      throw error;
    }
  },

  /**
   * Get help statistics
   */
  getHelpStats: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/help/stats`);
      return response.data;
    } catch (error) {
      console.error('Error fetching help stats:', error);
      throw error;
    }
  },
};

export default helpService;
