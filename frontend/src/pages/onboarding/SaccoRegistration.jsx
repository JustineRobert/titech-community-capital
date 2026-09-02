import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";

import {
  FormProvider,
  useForm,
} from "react-hook-form";

import { yupResolver } from "@hookform/resolvers/yup";
import * as Yup from "yup";

import { useDispatch } from "react-redux";

import {
  saveDraft,
  clearDraft,
} from "../../features/onboarding/onboardingSlice";

import OnboardingAPI from "../../services/onboardingService";

import "./SaccoRegistration.css";

const STORAGE_KEY =
  "titech_sacco_registration_draft";

const validationSchema = Yup.object({
  saccoName: Yup.string().required(
    "SACCO Name is required"
  ),

  registrationNumber:
    Yup.string().required(
      "Registration Number is required"
    ),

  tinNumber: Yup.string().required(
    "TIN Number is required"
  ),

  email: Yup.string()
    .email("Invalid email")
    .required("Email is required"),

  phone: Yup.string().required(
    "Phone number is required"
  ),

  physicalAddress:
    Yup.string().required(
      "Physical address is required"
    ),
});

const defaultValues = {
  saccoName: "",
  registrationNumber: "",
  tinNumber: "",
  district: "",
  region: "",
  email: "",
  phone: "",
  physicalAddress: "",

  contactPerson: {
    fullName: "",
    designation: "",
    phone: "",
    email: "",
    nationalId: "",
  },

  expectedMembers: "",
  expectedLoanPortfolio: "",
  monthlyRevenueEstimate: "",
  subscriptionPlan: "STARTER",

  certificate: null,
  logo: null,
  kycDocuments: [],
};

function SaccoRegistration() {
  const dispatch =
    useDispatch();

  const [step, setStep] =
    useState(1);

  const [loading, setLoading] =
    useState(false);

  const [paymentLoading,
    setPaymentLoading] =
    useState(false);

  const [success, setSuccess] =
    useState("");

  const [error, setError] =
    useState("");

  const totalSteps = 6;

  const methods = useForm({
    resolver:
      yupResolver(
        validationSchema
      ),
    mode: "onChange",
    defaultValues,
  });

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    reset,
    trigger,
    formState: {
      errors,
    },
  } = methods;

  const progress = useMemo(
    () =>
      Math.round(
        (step / totalSteps) *
          100
      ),
    [step]
  );

  /**
   * ============================================================
   * RESTORE DRAFT
   * ============================================================
   */
  useEffect(() => {
    const draft =
      localStorage.getItem(
        STORAGE_KEY
      );

    if (!draft) return;

    try {
      const parsed =
        JSON.parse(draft);

      reset({
        ...defaultValues,
        ...parsed,
      });
    } catch {
      localStorage.removeItem(
        STORAGE_KEY
      );
    }
  }, [reset]);

  /**
   * ============================================================
   * AUTOSAVE
   * ============================================================
   */
  useEffect(() => {
    const subscription =
      watch((values) => {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(
            values
          )
        );

        dispatch(
          saveDraft(values)
        );
      });

    return () =>
      subscription.unsubscribe();
  }, [watch, dispatch]);

  /**
   * ============================================================
   * STEP VALIDATION
   * ============================================================
   */
  const validateStep =
    useCallback(async () => {
      if (step === 1) {
        return trigger([
          "saccoName",
          "registrationNumber",
          "tinNumber",
          "email",
          "phone",
          "physicalAddress",
        ]);
      }

      return true;
    }, [step, trigger]);

  /**
   * ============================================================
   * NAVIGATION
   * ============================================================
   */
  const nextStep =
    async () => {
      const valid =
        await validateStep();

      if (!valid) {
        setError(
          "Please complete all required fields."
        );
        return;
      }

      setError("");

      setStep((prev) =>
        Math.min(
          prev + 1,
          totalSteps
        )
      );
    };

  const previousStep =
    () => {
      setStep((prev) =>
        Math.max(
          prev - 1,
          1
        )
      );
    };

  /**
   * ============================================================
   * PAYMENT
   * ============================================================
   */
  const payWithMoMo =
    async (provider) => {
      try {
        setPaymentLoading(
          true
        );

        const values =
          getValues();

        await OnboardingAPI.initializePayment(
          {
            provider,
            plan:
              values.subscriptionPlan,
          }
        );

        setSuccess(
          `${provider} payment initialized successfully.`
        );
      } catch (err) {
        setError(
          err?.response?.data
            ?.message ||
            "Payment initialization failed."
        );
      } finally {
        setPaymentLoading(
          false
        );
      }
    };

  /**
   * ============================================================
   * SUBMIT
   * ============================================================
   */
  const onSubmit =
    async (values) => {
      try {
        setLoading(true);
        setError("");
        setSuccess("");

        const formData =
          new FormData();

        Object.entries(
          values
        ).forEach(
          ([key, value]) => {
            if (
              key ===
              "kycDocuments"
            ) {
              value?.forEach(
                (file) =>
                  formData.append(
                    "kycDocuments",
                    file
                  )
              );
            } else if (
              value !==
                undefined &&
              value !== null
            ) {
              formData.append(
                key,
                value
              );
            }
          }
        );

        const response =
          await OnboardingAPI.registerSacco(
            formData
          );

        localStorage.removeItem(
          STORAGE_KEY
        );

        dispatch(
          clearDraft()
        );

        reset(
          defaultValues
        );

        setStep(1);

        setSuccess(
          response?.message ||
            "SACCO registration submitted successfully."
        );
      } catch (err) {
        setError(
          err?.response?.data
            ?.message ||
            "Registration failed."
        );
      } finally {
        setLoading(false);
      }
    };

  return (
    <FormProvider
      {...methods}
    >
      <div className="sacco-registration">
        <div className="registration-card">
          <h1>
            TITech Community
            Capital
          </h1>

          <h2>
            SACCO Onboarding
          </h2>

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
            Step {step} of{" "}
            {totalSteps}
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
            onSubmit={handleSubmit(
              onSubmit
            )}
          >
            {step === 1 && (
              <>
                <h3>
                  SACCO Information
                </h3>

                <input
                  {...register(
                    "saccoName"
                  )}
                  placeholder="SACCO Name"
                />

                <p>
                  {
                    errors
                      .saccoName
                      ?.message
                  }
                </p>

                <input
                  {...register(
                    "registrationNumber"
                  )}
                  placeholder="Registration Number"
                />

                <input
                  {...register(
                    "tinNumber"
                  )}
                  placeholder="TIN Number"
                />

                <input
                  {...register(
                    "district"
                  )}
                  placeholder="District"
                />

                <input
                  {...register(
                    "region"
                  )}
                  placeholder="Region"
                />

                <input
                  {...register(
                    "email"
                  )}
                  placeholder="Email"
                />

                <input
                  {...register(
                    "phone"
                  )}
                  placeholder="Phone"
                />

                <textarea
                  {...register(
                    "physicalAddress"
                  )}
                  placeholder="Physical Address"
                />
              </>
            )}

            {step === 2 && (
              <>
                <h3>
                  Contact Person
                </h3>

                <input
                  {...register(
                    "contactPerson.fullName"
                  )}
                  placeholder="Full Name"
                />

                <input
                  {...register(
                    "contactPerson.designation"
                  )}
                  placeholder="Designation"
                />

                <input
                  {...register(
                    "contactPerson.phone"
                  )}
                  placeholder="Phone"
                />

                <input
                  {...register(
                    "contactPerson.email"
                  )}
                  placeholder="Email"
                />

                <input
                  {...register(
                    "contactPerson.nationalId"
                  )}
                  placeholder="National ID"
                />
              </>
            )}

            {step === 3 && (
              <>
                <h3>
                  Business Information
                </h3>

                <input
                  type="number"
                  {...register(
                    "expectedMembers"
                  )}
                  placeholder="Expected Members"
                />

                <input
                  type="number"
                  {...register(
                    "expectedLoanPortfolio"
                  )}
                  placeholder="Expected Loan Portfolio"
                />

                <input
                  type="number"
                  {...register(
                    "monthlyRevenueEstimate"
                  )}
                  placeholder="Monthly Revenue"
                />

                <select
                  {...register(
                    "subscriptionPlan"
                  )}
                >
                  <option value="STARTER">
                    Starter
                  </option>
                  <option value="GROWTH">
                    Growth
                  </option>
                  <option value="ENTERPRISE">
                    Enterprise
                  </option>
                </select>
              </>
            )}

            {step === 4 && (
              <>
                <h3>
                  Documents
                </h3>

                <input
                  type="file"
                  onChange={(e) =>
                    setValue(
                      "certificate",
                      e.target
                        .files?.[0]
                    )
                  }
                />

                <input
                  type="file"
                  onChange={(e) =>
                    setValue(
                      "logo",
                      e.target
                        .files?.[0]
                    )
                  }
                />

                <input
                  type="file"
                  multiple
                  onChange={(e) =>
                    setValue(
                      "kycDocuments",
                      Array.from(
                        e.target
                          .files
                      )
                    )
                  }
                />
              </>
            )}

            {step === 5 && (
              <>
                <h3>
                  Payment
                </h3>

                <button
                  type="button"
                  disabled={
                    paymentLoading
                  }
                  onClick={() =>
                    payWithMoMo(
                      "MTN"
                    )
                  }
                >
                  Pay with MTN
                  MoMo
                </button>

                <button
                  type="button"
                  disabled={
                    paymentLoading
                  }
                  onClick={() =>
                    payWithMoMo(
                      "AIRTEL"
                    )
                  }
                >
                  Pay with Airtel
                  Money
                </button>
              </>
            )}

            {step === 6 && (
              <>
                <h3>
                  Review &
                  Submit
                </h3>

                <pre>
                  {JSON.stringify(
                    getValues(),
                    null,
                    2
                  )}
                </pre>
              </>
            )}

            <div className="actions">
              {step > 1 && (
                <button
                  type="button"
                  onClick={
                    previousStep
                  }
                >
                  Previous
                </button>
              )}

              {step <
              totalSteps ? (
                <button
                  type="button"
                  onClick={
                    nextStep
                  }
                >
                  Next
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    loading
                  }
                >
                  {loading
                    ? "Submitting..."
                    : "Submit Registration"}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </FormProvider>
  );
}

export default SaccoRegistration;