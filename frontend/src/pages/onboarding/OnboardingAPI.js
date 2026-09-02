/**
 * ============================================================
 * TITech Community Capital LTD
 * Enterprise SACCO Onboarding API
 * ============================================================
 */

import axios from "axios";

/**
 * ============================================================
 * AXIOS INSTANCE
 * ============================================================
 */
const api = axios.create({
  baseURL:
    process.env.REACT_APP_API_URL ||
    "/api/v1",

  timeout: 30000,

  headers: {
    "Content-Type":
      "application/json"
  }
});

/**
 * ============================================================
 * REQUEST INTERCEPTOR
 * ============================================================
 */
api.interceptors.request.use(
  (config) => {
    const token =
      localStorage.getItem(
        "accessToken"
      );

    const tenantId =
      localStorage.getItem(
        "tenantId"
      );

    const correlationId =
      crypto.randomUUID();

    if (token) {
      config.headers.Authorization =
        `Bearer ${token}`;
    }

    if (tenantId) {
      config.headers[
        "x-tenant-id"
      ] = tenantId;
    }

    config.headers[
      "x-correlation-id"
    ] = correlationId;

    return config;
  },

  (error) =>
    Promise.reject(error)
);

/**
 * ============================================================
 * RESPONSE INTERCEPTOR
 * ============================================================
 */
api.interceptors.response.use(
  (response) =>
    response,

  (error) => {

    if (
      error.response?.status ===
      401
    ) {
      localStorage.removeItem(
        "accessToken"
      );

      window.location.href =
        "/login";
    }

    return Promise.reject(
      error
    );
  }
);

/**
 * ============================================================
 * SACCO REGISTRATION
 * ============================================================
 */
export const registerSacco =
  async (payload) => {

    const response =
      await api.post(
        "/onboarding/saccos",
        payload
      );

    return response.data;
  };

/**
 * ============================================================
 * GET ALL SACCOS
 * ============================================================
 */
export const getSaccos =
  async (
    params = {}
  ) => {

    const response =
      await api.get(
        "/onboarding/saccos",
        {
          params
        }
      );

    return response.data;
  };

/**
 * ============================================================
 * GET SACCO
 * ============================================================
 */
export const getSaccoById =
  async (saccoId) => {

    const response =
      await api.get(
        `/onboarding/saccos/${saccoId}`
      );

    return response.data;
  };

/**
 * ============================================================
 * KYC APPROVAL
 * ============================================================
 */
export const verifyKYC =
  async (
    saccoId,
    payload
  ) => {

    const response =
      await api.put(
        `/onboarding/saccos/${saccoId}/kyc`,
        payload
      );

    return response.data;
  };

/**
 * ============================================================
 * DOCUMENT UPLOAD
 * ============================================================
 */
export const uploadDocuments =
  async (
    saccoId,
    files
  ) => {

    const formData =
      new FormData();

    files.forEach((file) => {
      formData.append(
        "documents",
        file
      );
    });

    const response =
      await api.post(
        `/onboarding/saccos/${saccoId}/documents`,
        formData,
        {
          headers: {
            "Content-Type":
              "multipart/form-data"
          }
        }
      );

    return response.data;
  };

/**
 * ============================================================
 * SETUP SUBSCRIPTION
 * ============================================================
 */
export const setupSubscription =
  async (
    saccoId,
    payload
  ) => {

    const response =
      await api.put(
        `/onboarding/saccos/${saccoId}/subscription`,
        payload
      );

    return response.data;
  };

/**
 * ============================================================
 * SUBMIT GO LIVE REVIEW
 * ============================================================
 */
export const submitGoLiveReview =
  async (
    saccoId,
    payload
  ) => {

    const response =
      await api.put(
        `/onboarding/saccos/${saccoId}/go-live-review`,
        payload
      );

    return response.data;
  };

/**
 * ============================================================
 * ACTIVATE SACCO
 * ============================================================
 */
export const activateSacco =
  async (
    saccoId,
    payload
  ) => {

    const response =
      await api.put(
        `/onboarding/saccos/${saccoId}/live`,
        payload
      );

    return response.data;
  };

/**
 * ============================================================
 * REJECT APPLICATION
 * ============================================================
 */
export const rejectApplication =
  async (
    saccoId,
    reason
  ) => {

    const response =
      await api.put(
        `/onboarding/saccos/${saccoId}/reject`,
        {
          reason
        }
      );

    return response.data;
  };

/**
 * ============================================================
 * PROGRESS
 * ============================================================
 */
export const getProgress =
  async (
    saccoId
  ) => {

    const response =
      await api.get(
        `/onboarding/saccos/${saccoId}/progress`
      );

    return response.data;
  };

/**
 * ============================================================
 * DASHBOARD METRICS
 * ============================================================
 */
export const getMetrics =
  async () => {

    const response =
      await api.get(
        "/onboarding/metrics"
      );

    return response.data;
  };

/**
 * ============================================================
 * MTN MOMO SETUP
 * ============================================================
 */
export const setupMTNMoMo =
  async (
    saccoId,
    payload
  ) => {

    const response =
      await api.post(
        `/onboarding/saccos/${saccoId}/mtn/setup`,
        payload
      );

    return response.data;
  };

/**
 * ============================================================
 * AIRTEL MONEY SETUP
 * ============================================================
 */
export const setupAirtelMoney =
  async (
    saccoId,
    payload
  ) => {

    const response =
      await api.post(
        `/onboarding/saccos/${saccoId}/airtel/setup`,
        payload
      );

    return response.data;
  };

/**
 * ============================================================
 * ONBOARDING DASHBOARD
 * ============================================================
 */
export const getDashboard =
  async () => {

    const response =
      await api.get(
        "/onboarding/dashboard"
      );

    return response.data;
  };

/**
 * ============================================================
 * EXPORTS
 * ============================================================
 */
const OnboardingAPI = {
  registerSacco,
  getSaccos,
  getSaccoById,
  verifyKYC,
  uploadDocuments,
  setupSubscription,
  submitGoLiveReview,
  activateSacco,
  rejectApplication,
  getProgress,
  getMetrics,
  setupMTNMoMo,
  setupAirtelMoney,
  getDashboard
};

export default OnboardingAPI;