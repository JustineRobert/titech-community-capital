// ============================================================================
// File: frontend/src/services/onboardingService.js
// TITech Community Capital
// Enterprise Onboarding Service
// ============================================================================

import api from "./api";

/**
 * ============================================================================
 * Default Request Wrapper
 * ============================================================================
 */

async function request(config) {
  try {
    const response = await api(config);

    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * ============================================================================
 * Normalize API Errors
 * ============================================================================
 */

function normalizeError(error) {
  return {
    status:
      error?.response?.status || 500,

    message:
      error?.response?.data?.message ||
      error.message ||
      "Unexpected server error.",

    errors:
      error?.response?.data?.errors || [],

    data:
      error?.response?.data || null,
  };
}

/**
 * ============================================================================
 * Upload Progress Helper
 * ============================================================================
 */

function uploadConfig(onProgress) {
  return {
    headers: {
      "Content-Type":
        "multipart/form-data",
    },

    onUploadProgress(event) {
      if (!onProgress) return;

      const percent = Math.round(
        (event.loaded * 100) /
          event.total
      );

      onProgress(percent);
    },
  };
}

/**
 * ============================================================================
 * Onboarding API
 * ============================================================================
 */

const OnboardingAPI = {
  // =========================================================================
  // SACCO REGISTRATION
  // =========================================================================

  registerSacco(
    formData,
    onProgress
  ) {
    return request({
      method: "POST",

      url:
        "/onboarding/sacco",

      data: formData,

      ...uploadConfig(
        onProgress
      ),
    });
  },

  updateRegistration(
    saccoId,
    payload
  ) {
    return request({
      method: "PUT",

      url:
        `/onboarding/saccos/${saccoId}`,

      data: payload,
    });
  },

  getRegistration(
    saccoId
  ) {
    return request({
      method: "GET",

      url:
        `/onboarding/saccos/${saccoId}`,
    });
  },

  listRegistrations(
    params = {}
  ) {
    return request({
      method: "GET",

      url:
        "/onboarding/saccos",

      params,
    });
  },

  // =========================================================================
  // DOCUMENTS
  // =========================================================================

  uploadDocuments(
    saccoId,
    formData,
    onProgress
  ) {
    return request({
      method: "POST",

      url:
        `/onboarding/saccos/${saccoId}/documents`,

      data: formData,

      ...uploadConfig(
        onProgress
      ),
    });
  },

  deleteDocument(
    saccoId,
    documentId
  ) {
    return request({
      method: "DELETE",

      url:
        `/onboarding/saccos/${saccoId}/documents/${documentId}`,
    });
  },

  downloadDocument(
    saccoId,
    documentId
  ) {
    return api.get(
      `/onboarding/saccos/${saccoId}/documents/${documentId}`,
      {
        responseType:
          "blob",
      }
    );
  },

  // =========================================================================
  // KYC
  // =========================================================================

  verifyKYC(
    saccoId,
    payload
  ) {
    return request({
      method: "PUT",

      url:
        `/onboarding/saccos/${saccoId}/kyc`,

      data: payload,
    });
  },

  getKYCStatus(
    saccoId
  ) {
    return request({
      method: "GET",

      url:
        `/onboarding/saccos/${saccoId}/kyc`,
    });
  },

  approveKYC(
    saccoId
  ) {
    return request({
      method: "POST",

      url:
        `/onboarding/saccos/${saccoId}/kyc/approve`,
    });
  },

  rejectKYC(
    saccoId,
    payload
  ) {
    return request({
      method: "POST",

      url:
        `/onboarding/saccos/${saccoId}/kyc/reject`,

      data: payload,
    });
  },

  // =========================================================================
  // SUBSCRIPTION
  // =========================================================================

  setupSubscription(
    saccoId,
    payload
  ) {
    return request({
      method: "PUT",

      url:
        `/onboarding/saccos/${saccoId}/subscription`,

      data: payload,
    });
  },

  getSubscription(
    saccoId
  ) {
    return request({
      method: "GET",

      url:
        `/onboarding/saccos/${saccoId}/subscription`,
    });
  },

  // =========================================================================
  // MOBILE MONEY
  // =========================================================================

  initializePayment(
    payload
  ) {
    return request({
      method: "POST",

      url:
        "/onboarding/payment",

      data: payload,
    });
  },

  checkPaymentStatus(
    transactionId
  ) {
    return request({
      method: "GET",

      url:
        `/payments/${transactionId}`,
    });
  },

  retryPayment(
    transactionId
  ) {
    return request({
      method: "POST",

      url:
        `/payments/${transactionId}/retry`,
    });
  },

  // =========================================================================
  // DRAFTS
  // =========================================================================

  saveDraft(
    payload
  ) {
    return request({
      method: "POST",

      url:
        "/onboarding/draft",

      data: payload,
    });
  },

  loadDraft() {
    return request({
      method: "GET",

      url:
        "/onboarding/draft",
    });
  },

  deleteDraft() {
    return request({
      method: "DELETE",

      url:
        "/onboarding/draft",
    });
  },

  // =========================================================================
  // APPROVALS
  // =========================================================================

  submitForReview(
    saccoId,
    payload
  ) {
    return request({
      method: "PUT",

      url:
        `/onboarding/saccos/${saccoId}/review`,

      data: payload,
    });
  },

  approveRegistration(
    saccoId
  ) {
    return request({
      method: "POST",

      url:
        `/onboarding/saccos/${saccoId}/approve`,
    });
  },

  rejectRegistration(
    saccoId,
    payload
  ) {
    return request({
      method: "POST",

      url:
        `/onboarding/saccos/${saccoId}/reject`,

      data: payload,
    });
  },

  // =========================================================================
  // GO LIVE
  // =========================================================================

  goLive(
    saccoId
  ) {
    return request({
      method: "PUT",

      url:
        `/onboarding/saccos/${saccoId}/live`,
    });
  },

  rollbackGoLive(
    saccoId
  ) {
    return request({
      method: "PUT",

      url:
        `/onboarding/saccos/${saccoId}/rollback`,
    });
  },

  // =========================================================================
  // TENANT PROVISIONING
  // =========================================================================

  provisionTenant(
    saccoId
  ) {
    return request({
      method: "POST",

      url:
        `/onboarding/saccos/${saccoId}/provision`,
    });
  },

  tenantStatus(
    saccoId
  ) {
    return request({
      method: "GET",

      url:
        `/onboarding/saccos/${saccoId}/tenant-status`,
    });
  },

  // =========================================================================
  // DASHBOARD
  // =========================================================================

  dashboard() {
    return request({
      method: "GET",

      url:
        "/onboarding/dashboard",
    });
  },

  statistics() {
    return request({
      method: "GET",

      url:
        "/onboarding/statistics",
    });
  },

  // =========================================================================
  // AUDIT
  // =========================================================================

  auditTrail(
    saccoId
  ) {
    return request({
      method: "GET",

      url:
        `/onboarding/saccos/${saccoId}/audit`,
    });
  },
};

export default OnboardingAPI;