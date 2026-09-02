import React, {
  useEffect,
  useState
} from "react";

import {
  getSaccoById,
  getProgress,
  submitGoLiveReview
} from "./OnboardingAPI";

const GoLiveReview = ({
  saccoId
}) => {

  const [loading,
    setLoading] =
    useState(true);

  const [saving,
    setSaving] =
    useState(false);

  const [sacco,
    setSacco] =
    useState(null);

  const [progress,
    setProgress] =
    useState(null);

  const [notes,
    setNotes] =
    useState("");

  const [approval,
    setApproval] =
    useState({
      complianceApproved: false,
      onboardingApproved: false,
      mobileMoneyVerified: false,
      trainingVerified: false,
      tenantValidated: false
    });

  const [success,
    setSuccess] =
    useState("");

  const [error,
    setError] =
    useState("");

  useEffect(() => {
    loadData();
  }, [saccoId]);

  const loadData =
    async () => {

      try {

        setLoading(true);

        const [
          saccoResponse,
          progressResponse
        ] = await Promise.all([
          getSaccoById(
            saccoId
          ),
          getProgress(
            saccoId
          )
        ]);

        setSacco(
          saccoResponse?.data
        );

        setProgress(
          progressResponse?.data
        );

      } catch (err) {

        setError(
          "Failed to load onboarding review data."
        );

      } finally {
        setLoading(false);
      }
    };

  const toggleApproval =
    (field) => {

      setApproval(
        (prev) => ({
          ...prev,
          [field]:
            !prev[field]
        })
      );
    };

  const reviewReady =
    Object.values(
      approval
    ).every(Boolean);

  const submitReview =
    async () => {

      try {

        setSaving(true);

        setError("");

        setSuccess("");

        await submitGoLiveReview(
          saccoId,
          {
            notes,
            approval
          }
        );

        setSuccess(
          "Go Live Review submitted successfully."
        );

      } catch (err) {

        setError(
          err?.response?.data
            ?.message ||
          "Failed to submit review."
        );

      } finally {
        setSaving(false);
      }
    };

  if (loading) {
    return (
      <div>
        Loading review...
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth:
          "1200px",
        margin:
          "0 auto",
        padding:
          "30px"
      }}
    >
      <h1>
        SACCO Go Live Review
      </h1>

      <p>
        Final operational,
        compliance, and
        deployment approval
        before activating
        this SACCO.
      </p>

      {error &&     style={{
            background:
              "#fee2e2",
            color:
              "#991b1b",
            padding:
              "12px",
            marginBottom:
              "20px",
            borderRadius:
              "8px"
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            background:
              "#dcfce7",
            color:
              "#166534",
            padding:
              "12px",
            marginBottom:
              "20px",
            borderRadius:
              "8px"
          }}
        >
          {success}
        </div>
      )}

      {/* SACCO INFORMATION */}

      <section
        style={{
          background:
            "#ffffff",
          border:
            "1px solid #e5e7eb",
          borderRadius:
            "12px",
          padding:
            "20px",
          marginBottom:
            "20px"
        }}
      >
        <h2>
          SACCO Information
        </h2>

        <p>
          <strong>
            Name:
          </strong>{" "}
          {sacco?.saccoName}
        </p>

        <p>
          <strong>
            Registration:
          </strong>{" "}
          {
            sacco?.registrationNumber
          }
        </p>

        <p>
          <strong>
            Tenant:
          </strong>{" "}
          {sacco?.tenantId}
        </p>

        <p>
          <strong>
            Status:
          </strong>{" "}
          {sacco?.status}
        </p>

        <p>
          <strong>
            Progress:
          </strong>{" "}
          {
            progress?.progressPercentage
          }
          %
        </p>
      </section>

      {/* READINESS REVIEW */}

      <section
        style={{
          background:
            "#ffffff",
          border:
            "1px solid #e5e7eb",
          borderRadius:
            "12px",
          padding:
            "20px",
          marginBottom:
            "20px"
        }}
      >
        <h2>
          Approval Checklist
        </h2>

        {[
          {
            key:
              "complianceApproved",
            label:
              "Compliance Approved"
          },
          {
            key:
              "onboardingApproved",
            label:
              "Onboarding Approved"
          },
          {
            key:
              "mobileMoneyVerified",
            label:
              "MTN/Airtel Verified"
          },
          {
            key:
              "trainingVerified",
            label:
              "Training Complete"
          },
          {
            key:
              "tenantValidated",
            label:
              "Tenant Provisioned"
          }
        ].map((item) => (
          <div
            key={
              item.key
            }
            style={{
              marginBottom:
                "10px"
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={
                  approval[
                    item.key
                  ]
                }
                onChange={() =>
                  toggleApproval(
                    item.key
                  )
                }
              />

              <span
                style={{
                  marginLeft:
                    "10px"
                }}
              >
                {
                  item.label
                }
              </span>
            </label>
          </div>
        ))}
      </section>

      {/* REVIEW NOTES */}

      <section
        style={{
          background:
            "#ffffff",
          border:
            "1px solid #e5e7eb",
          borderRadius:
            "12px",
          padding:
            "20px",
          marginBottom:
            "20px"
        }}
      >
        <h2>
          Review Notes
        </h2>

        <textarea
          rows="8"
          value={notes}
          onChange={(e) =>
            setNotes(
              e.target
                .value
            )
          }
          placeholder="Compliance notes, deployment observations, tenant setup remarks, MoMo activation notes..."
          style={{
            width:
              "100%"
          }}
        />
      </section>

      {/* READINESS SUMMARY */}

      <section
        style={{
          background:
            reviewReady
              ? "#ecfdf5"
              : "#fef2f2",

          padding:
            "20px",

          borderRadius:
            "12px",

          marginBottom:
            "20px"
        }}
      >
        <h2>
          Go Live Review Status
        </h2>

        <h3>
          {reviewReady
            ? "READY FOR PRODUCTION"
            : "NOT READY"}
        </h3>
      </section>

      {/* ACTION */}

      <button
        disabled={
          !reviewReady ||
          saving
        }
        onClick={
          submitReview
        }
        style={{
          background:
            reviewReady
              ? "#2563eb"
              : "#9ca3af",

          color:
            "#ffffff",

          padding:
            "12px 24px",

          border:
            "none",

          borderRadius:
            "8px",

          cursor:
            reviewReady
              ? "pointer"
              : "not-allowed"
        }}
      >
        {saving
          ? "Submitting..."
          : "Approve Go Live Review"}
      </button>
    </div>
  );
};

export default GoLiveReview;