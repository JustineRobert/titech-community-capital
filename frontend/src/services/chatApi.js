import axios from 'axios';

const API_BASE = '/api/chat';

const chatApi = {
  getConversations: async () => {
    const res = await axios.get(`${API_BASE}/conversations`);
    return res.data.data;
  },
  sendMessage: async (conversationId, body) => {
    const res = await axios.post(`${API_BASE}/message`, { conversationId, body });
    return res.data.data;
  },
  getMessages: async (conversationId) => {
    const res = await axios.get(`${API_BASE}/conversation/${conversationId}/messages`);
    return res.data.data;
  },
};

export default chatApi;
