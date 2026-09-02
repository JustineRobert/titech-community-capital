/* global console, FormData */

/**
 * faqService.js
 * Service for managing FAQ items
 */

import axios from 'axios';

const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
  'http://localhost:3001/api';

const faqService = {
  getFAQItems: async (page = 1, limit = 20) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/faq`, {
        params: { page, limit },
      });
      return response.data.items;
    } catch (error) {
      console.error('Error fetching FAQ items:', error);
      throw error;
    }
  },

  searchFAQ: async (query) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/faq/search`, {
        params: { q: query },
      });
      return response.data.results;
    } catch (error) {
      console.error('Error searching FAQ:', error);
      throw error;
    }
  },

  getFAQsByCategory: async (category, page = 1, limit = 20) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/faq/category/${category}`, {
        params: { page, limit },
      });
      return response.data.items;
    } catch (error) {
      console.error('Error fetching FAQ by category:', error);
      throw error;
    }
  },

  getFAQItem: async (faqId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/faq/${faqId}`);
      return response.data.item;
    } catch (error) {
      console.error('Error fetching FAQ item:', error);
      throw error;
    }
  },

  getCategories: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/faq/categories`);
      return response.data.categories;
    } catch (error) {
      console.error('Error fetching FAQ categories:', error);
      throw error;
    }
  },

  getPopularFAQs: async (limit = 5) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/faq/popular`, {
        params: { limit },
      });
      return response.data.items;
    } catch (error) {
      console.error('Error fetching popular FAQs:', error);
      throw error;
    }
  },

  markFAQHelpful: async (faqId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/faq/${faqId}/helpful`);
      return response.data;
    } catch (error) {
      console.error('Error marking FAQ helpful:', error);
      throw error;
    }
  },

  markFAQUnhelpful: async (faqId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/faq/${faqId}/unhelpful`);
      return response.data;
    } catch (error) {
      console.error('Error marking FAQ unhelpful:', error);
      throw error;
    }
  },

  getRelatedFAQs: async (faqId, limit = 5) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/faq/${faqId}/related`, {
        params: { limit },
      });
      return response.data.items;
    } catch (error) {
      console.error('Error fetching related FAQs:', error);
      throw error;
    }
  },

  incrementFAQViews: async (faqId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/faq/${faqId}/views`);
      return response.data;
    } catch (error) {
      console.error('Error incrementing FAQ views:', error);
      throw error;
    }
  },

  getFAQStats: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/faq/stats`);
      return response.data;
    } catch (error) {
      console.error('Error fetching FAQ stats:', error);
      throw error;
    }
  },

  createFAQ: async (faqData) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/faq`, faqData);
      return response.data.item;
    } catch (error) {
      console.error('Error creating FAQ:', error);
      throw error;
    }
  },

  updateFAQ: async (faqId, faqData) => {
    try {
      const response = await axios.put(`${API_BASE_URL}/faq/${faqId}`, faqData);
      return response.data.item;
    } catch (error) {
      console.error('Error updating FAQ:', error);
      throw error;
    }
  },

  deleteFAQ: async (faqId) => {
    try {
      const response = await axios.delete(`${API_BASE_URL}/faq/${faqId}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting FAQ:', error);
      throw error;
    }
  },

  getFAQBySlug: async (slug) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/faq/slug/${slug}`);
      return response.data.item;
    } catch (error) {
      console.error('Error fetching FAQ by slug:', error);
      throw error;
    }
  },

  bulkImportFAQs: async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await axios.post(
        `${API_BASE_URL}/faq/bulk-import`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      return response.data;
    } catch (error) {
      console.error('Error bulk importing FAQs:', error);
      throw error;
    }
  },

  exportFAQsCSV: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/faq/export/csv`, {
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      console.error('Error exporting FAQs:', error);
      throw error;
    }
  },
};

export default faqService;