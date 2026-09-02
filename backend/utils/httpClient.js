// utils/httpClient.js
const axios = require("axios");

/**
 * Create an Axios instance that automatically injects requestId
 */
const httpClient = axios.create({
  timeout: 10000, // 10s timeout for safety
});

/**
 * Attach requestId to every outbound request if available
 */
httpClient.interceptors.request.use((config) => {
  if (config.requestId) {
    config.headers["X-Request-Id"] = config.requestId;
  }
  return config;
});

module.exports = httpClient;
