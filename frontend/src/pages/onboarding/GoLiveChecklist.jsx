import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";

import PropTypes from "prop-types";

import OnboardingAPI from "../../services/onboardingService";

import "./GoLiveChecklist.css";

const DEFAULT_CHECKLIST = {
  registrationCompleted: false,
  kycCompleted: false,
  subscriptionActive: false,
  adminUserCreated: false,
  tenantProvisioned: false,
  mobileMoneyConfigured: false,
  trainingCompleted: false,
  compliancePassed: false,
  goLiveApproved: false,
};

function formatLabel(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase());
}

const GoLiveChecklist = ({ saccoId }) => {
  const [checklist, setChecklist] = useState(
    DEFAULT_CHECKLIST
  );

  const [notes, setNotes] = useState("");

  const [loading, setLoading] =
    useState(false);

  const [initialLoading, setInitialLoading] =
    useState(true);

  const [success, setSuccess] =
    useState("");

  const [error, setError] =
    useState("");

  /**
   * =====================================================
   * LOAD CURRENT STATUS
   * =====================================================
   */
  const loadChecklist =
    useCallback(async () => {
      try {
        setInitialLoading(true);

        const response =
          await OnboardingAPI.getGoLiveStatus(
            saccoId
          );

        if (response?.data) {
          setChecklist({
            ...DEFAULT_CHECKLIST,
            ...(response.data
              .checklist || {}),
          });

          setNotes(
            response.data.notes || ""
          );
        }
      } catch (err) {
        console.error(err);
      } finally {
        setInitialLoading(false);
      }
    }, [saccoId]);

  useEffect(() => {
    if (saccoId) {
      loadChecklist();
    }
  }, [saccoId, loadChecklist]);

  /**
   * =====================================================
   * PROGRESS
   * =====================================================
   */
  const progress = useMemo(() => {
    const total =
      Object.keys(checklist).length;

    const completed =
      Object.values(checklist).filter(
        Boolean
      ).length;

    return Math.round(
      (completed / total) * 100
    );
  }, [checklist]);

  const completedCount =
    useMemo(
      () =>
        Object.values(
          checklist
        ).filter(Boolean).length,
      [checklist]
    );

  const allCompleted =
    useMemo(
      () =>
        Object.values(
          checklist
        ).every(Boolean),
      [checklist]
    );

  /**
   * =====================================================
   * TOGGLE
   * =====================================================
   */
  const toggleItem = (key) => {
    setChecklist((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  /**
   * =====================================================
   * SUBMIT REVIEW
   * =====================================================
   */
  const submitForReview =
    async () => {
      try {
        setLoading(true);
        setError("");
        setSuccess("");

        await OnboardingAPI.submitGoLiveReview(
          saccoId,
          {
            checklist,
            notes,
          }
        );

        setSuccess(
          "Go-Live review submitted successfully."
        );
      } catch (err) {
        setError(
          err?.response?.data
            ?.message ||
            "Failed to submit review."
        );
      } finally {
        setLoading(false);
      }
    };

  /**
   * =====================================================
   * ACTIVATE
   * =====================================================
   */
  const activateGoLive =
    async () => {
      try {
        setLoading(true);
        setError("");
        setSuccess("");

        await OnboardingAPI.goLive(
          saccoId
        );

        setSuccess(
          "SACCO successfully activated."
        );

        setChecklist((prev) => ({
          ...prev,
          goLiveApproved: true,
        }));
      } catch (err) {
        setError(
          err?.response?.data
            ?.message ||
            "Failed to activate SACCO."
        );
      } finally {
        setLoading(false);
      }
    };

  if (initialLoading) {
    return (
      <div className="golive-loading">
        Loading Go-Live Checklist...
      </div>
    );
  }

  return (
    <div className="golive-container">
      <div className="golive-header">
        <h1>Go-Live Review</h1>

        <p>
          Validate operational,
          compliance and deployment
          readiness before activating
          the SACCO.
        </p>
      </div>

      {error && (
        <div className="golive-error">
          {error}
        </div>
      )}

      {success && (
        <div className="golive-success">
          {success}
        </div>
      )}

      {/* Progress */}
      <div className="golive-progress-card">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{
              width: `${progress}%`,
            }}
          />
        </div>

        <p>
          Readiness Progress:
          <strong>
            {" "}
            {progress}%
          </strong>
        </p>
      </div>

      {/* Checklist */}
      <div className="golive-card">
        <h2>
          Readiness Checklist
        </h2>

        <div className="checklist-grid">
          {Object.entries(
            checklist
          ).map(
            ([key, value]) => (
              <label
                key={key}
                className="checklist-item"
              >
                <input
                  type="checkbox"
                  checked={value}
                  onChange={() =>
                    toggleItem(
                      key
                    )
                  }
                />

                <span>
                  {formatLabel(
                    key
                  )}
                </span>
              </label>
            )
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="golive-card">
        <h3>
          Review Notes
        </h3>

        <textarea
          rows={6}
          value={notes}
          onChange={(e) =>
            setNotes(
              e.target.value
            )
          }
          placeholder="Deployment notes, compliance observations, implementation comments..."
        />
      </div>

      {/* Summary */}
      <div className="golive-summary">
        <h3>
          Status Summary
        </h3>

        <p>
          Completed:
          {" "}
          {completedCount}/
          {
            Object.keys(
              checklist
            ).length
          }
        </p>

        <p>
          Progress:
          {" "}
          {progress}%
        </p>

        <p>
          Ready:
          {" "}
          <strong>
            {allCompleted
              ? "YES"
              : "NO"}
          </strong>
        </p>
      </div>

      {/* Actions */}
      <div className="golive-actions">
        <button
          type="button"
          onClick={
            submitForReview
          }
          disabled={loading}
          className="secondary-btn"
        >
          {loading
            ? "Submitting..."
            : "Submit Review"}
        </button>

        <button
          type="button"
          onClick={
            activateGoLive
          }
          disabled={
            !allCompleted ||
            loading
          }
          className="primary-btn"
        >
          {loading
            ? "Activating..."
            : "Activate SACCO"}
        </button>
      </div>
    </div>
  );
};

GoLiveChecklist.propTypes = {
  saccoId: PropTypes.string
    .isRequired,
};

export default GoLiveChecklist;