import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import PropTypes from "prop-types";

import "./KYCVerification.css";

import OnboardingAPI from "../../services/onboardingService";

const STORAGE_KEY =
  "titech-kyc-draft";

const INITIAL_STATE = {
  directorNames: [""],
  boardChairperson: "",
  registrationCertificate: "",
  taxComplianceCertificate: "",
  proofOfAddress: "",
  notes: "",
};

function KYCVerification({
  saccoId,
  onSuccess,
}) {
  const [form, setForm] =
    useState(() => {
      try {
        const saved =
          localStorage.getItem(
            STORAGE_KEY
          );

        return saved
          ? JSON.parse(saved)
          : INITIAL_STATE;
      } catch {
        return INITIAL_STATE;
      }
    });

  const [files, setFiles] =
    useState([]);

  const [loading, setLoading] =
    useState(false);

  const [
    uploadLoading,
    setUploadLoading,
  ] = useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  /*
  |--------------------------------------------------------------------------
  | Autosave Draft
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(form)
    );
  }, [form]);

  /*
  |--------------------------------------------------------------------------
  | Progress
  |--------------------------------------------------------------------------
  */

  const progress = useMemo(() => {
    const fields = [
      form.boardChairperson,
      form.registrationCertificate,
      form.taxComplianceCertificate,
      form.proofOfAddress,
      form.directorNames.filter(
        Boolean
      ).length,
    ];

    const completed =
      fields.filter(Boolean)
        .length;

    return Math.round(
      (completed / 5) * 100
    );
  }, [form]);

  /*
  |--------------------------------------------------------------------------
  | Form Helpers
  |--------------------------------------------------------------------------
  */

  const updateField = (
    name,
    value
  ) => {
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const updateDirector = (
    index,
    value
  ) => {
    const directors = [
      ...form.directorNames,
    ];

    directors[index] = value;

    setForm((prev) => ({
      ...prev,
      directorNames:
        directors,
    }));
  };

  const addDirector = () => {
    setForm((prev) => ({
      ...prev,
      directorNames: [
        ...prev.directorNames,
        "",
      ],
    }));
  };

  const removeDirector = (
    index
  ) => {
    setForm((prev) => ({
      ...prev,
      directorNames:
        prev.directorNames.filter(
          (_, i) =>
            i !== index
        ),
    }));
  };

  /*
  |--------------------------------------------------------------------------
  | File Handling
  |--------------------------------------------------------------------------
  */

  const handleFiles = (
    selected
  ) => {
    setFiles((prev) => [
      ...prev,
      ...Array.from(selected),
    ]);
  };

  const handleDrop = (
    e
  ) => {
    e.preventDefault();

    handleFiles(
      e.dataTransfer.files
    );
  };

  const removeFile = (
    index
  ) => {
    setFiles((prev) =>
      prev.filter(
        (_, i) =>
          i !== index
      )
    );
  };

  /*
  |--------------------------------------------------------------------------
  | Validation
  |--------------------------------------------------------------------------
  */

  const validate = () => {
    if (
      !form.boardChairperson.trim()
    ) {
      setError(
        "Board chairperson is required."
      );

      return false;
    }

    if (
      !form.registrationCertificate.trim()
    ) {
      setError(
        "Registration certificate is required."
      );

      return false;
    }

    if (
      !form.taxComplianceCertificate.trim()
    ) {
      setError(
        "Tax compliance certificate is required."
      );

      return false;
    }

    if (
      !form.proofOfAddress.trim()
    ) {
      setError(
        "Proof of address is required."
      );

      return false;
    }

    return true;
  };

  /*
  |--------------------------------------------------------------------------
  | Upload Documents
  |--------------------------------------------------------------------------
  */

  const uploadDocuments =
    async () => {
      if (!files.length) {
        return [];
      }

      setUploadLoading(true);

      try {
        const formData =
          new FormData();

        files.forEach(
          (file) =>
            formData.append(
              "documents",
              file
            )
        );

        const response =
          await OnboardingAPI.uploadKYCDocuments(
            saccoId,
            formData
          );

        return (
          response?.data || []
        );
      } finally {
        setUploadLoading(
          false
        );
      }
    };

  /*
  |--------------------------------------------------------------------------
  | Submit
  |--------------------------------------------------------------------------
  */

  const handleSubmit =
    async (e) => {
      e.preventDefault();

      setError("");
      setSuccess("");

      if (!validate()) {
        return;
      }

      setLoading(true);

      try {
        const uploadedDocs =
          await uploadDocuments();

        const payload = {
          ...form,
          documents:
            uploadedDocs,
        };

        await OnboardingAPI.verifyKYC(
          saccoId,
          payload
        );

        setSuccess(
          "KYC verification submitted successfully."
        );

        localStorage.removeItem(
          STORAGE_KEY
        );

        if (onSuccess) {
          onSuccess(payload);
        }
      } catch (err) {
        setError(
          err?.response?.data
            ?.message ||
            err.message ||
            "Failed to verify KYC."
        );
      } finally {
        setLoading(false);
      }
    };

  return (
    <div className="kyc-page">
      <div className="kyc-card">
        <h1>
          KYC Verification
        </h1>

        <p>
          Verify SACCO
          compliance and
          onboarding
          readiness.
        </p>

        <div className="progress">
          <div
            className="progress-bar"
            style={{
              width:
                `${progress}%`,
            }}
          />
        </div>

        <p>
          Completion:
          {progress}%
        </p>

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        {success && (
          <div className="success">
            {success}
          </div>
        )}

        <form
          onSubmit={
            handleSubmit
          }
        >
          <h3>
            Board &
            Management
          </h3>

          <input
            placeholder="Board Chairperson"
            value={
              form.boardChairperson
            }
            onChange={(e) =>
              updateField(
                "boardChairperson",
                e.target.value
              )
            }
          />

          <h3>
            Directors
          </h3>

          {form.directorNames.map(
            (
              director,
              index
            ) => (
              <div
                key={
                  index
                }
                className="director-row"
              >
                <input
                  placeholder={`Director ${
                    index + 1
                  }`}
                  value={
                    director
                  }
                  onChange={(
                    e
                  ) =>
                    updateDirector(
                      index,
                      e.target
                        .value
                    )
                  }
                />

                {index >
                  0 && (
                  <button
                    type="button"
                    onClick={() =>
                      removeDirector(
                        index
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            )
          )}

          <button
            type="button"
            onClick={
              addDirector
            }
          >
            Add Director
          </button>

          <h3>
            Compliance
            Documents
          </h3>

          <input
            placeholder="Registration Certificate"
            value={
              form.registrationCertificate
            }
            onChange={(e) =>
              updateField(
                "registrationCertificate",
                e.target.value
              )
            }
          />

          <input
            placeholder="Tax Compliance Certificate"
            value={
              form.taxComplianceCertificate
            }
            onChange={(e) =>
              updateField(
                "taxComplianceCertificate",
                e.target.value
              )
            }
          />

          <input
            placeholder="Proof of Address"
            value={
              form.proofOfAddress
            }
            onChange={(e) =>
              updateField(
                "proofOfAddress",
                e.target.value
              )
            }
          />

          <div
            className="dropzone"
            onDrop={
              handleDrop
            }
            onDragOver={(e) =>
              e.preventDefault()
            }
          >
            <p>
              Drag &
              drop KYC
              documents
              here
            </p>

            <input
              type="file"
              multiple
              onChange={(
                e
              ) =>
                handleFiles(
                  e.target
                    .files
                )
              }
            />
          </div>

          {files.length >
            0 && (
            <ul className="file-list">
              {files.map(
                (
                  file,
                  index
                ) => (
                  <li
                    key={
                      index
                    }
                  >
                    {
                      file.name
                    }

                    <button
                      type="button"
                      onClick={() =>
                        removeFile(
                          index
                        )
                      }
                    >
                      Remove
                    </button>
                  </li>
                )
              )}
            </ul>
          )}

          <textarea
            rows="5"
            placeholder="Review notes"
            value={
              form.notes
            }
            onChange={(e) =>
              updateField(
                "notes",
                e.target.value
              )
            }
          />

          <button
            type="submit"
            disabled={
              loading ||
              uploadLoading
            }
          >
            {loading
              ? "Processing..."
              : "Approve KYC"}
          </button>
        </form>
      </div>
    </div>
  );
}

KYCVerification.propTypes =
  {
    saccoId:
      PropTypes.string
        .isRequired,
    onSuccess:
      PropTypes.func,
  };

export default KYCVerification;