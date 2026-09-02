import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import PropTypes from "prop-types";
import "./SubscriptionSetup.css";

import OnboardingAPI from "../../services/onboardingService";

const STORAGE_KEY =
  "titech-subscription-draft";

const PLANS = [
  {
    code: "STARTER",
    name: "Starter",
    monthlyPrice: 150000,
    members: "Up to 500 Members",
    branches: "1 Branch",
    features: [
      "Savings Management",
      "Loan Management",
      "Member Portal",
    ],
  },
  {
    code: "GROWTH",
    name: "Growth",
    monthlyPrice: 500000,
    members: "Up to 5,000 Members",
    branches: "5 Branches",
    features: [
      "Everything in Starter",
      "Accounting",
      "USSD",
      "SMS Notifications",
    ],
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    monthlyPrice: 1500000,
    members: "Unlimited Members",
    branches: "Unlimited Branches",
    features: [
      "Everything in Growth",
      "API Access",
      "Multi-Tenant",
      "Custom Integrations",
      "Dedicated Support",
    ],
  },
];

const INITIAL_FORM = {
  plan: "STARTER",
  billingCycle: "MONTHLY",
  currency: "UGX",
  price: 150000,
  paymentMethod: "MTN_MOMO",
  phoneNumber: "",
  notes: "",
};

function SubscriptionSetup({
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
          : INITIAL_FORM;
      } catch {
        return INITIAL_FORM;
      }
    });

  const [loading, setLoading] =
    useState(false);

  const [success, setSuccess] =
    useState("");

  const [error, setError] =
    useState("");

  /*
  |--------------------------------------------------------------------------
  | Autosave
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
  | Selected Plan
  |--------------------------------------------------------------------------
  */

  const selectedPlan =
    useMemo(
      () =>
        PLANS.find(
          (p) =>
            p.code ===
            form.plan
        ) || PLANS[0],
      [form.plan]
    );

  /*
  |--------------------------------------------------------------------------
  | Price Calculation
  |--------------------------------------------------------------------------
  */

  const calculatedPrice =
    useMemo(() => {
      let price =
        selectedPlan.monthlyPrice;

      switch (
        form.billingCycle
      ) {
        case "QUARTERLY":
          return price * 3;

        case "ANNUAL":
          return Math.floor(
            price * 12 * 0.9
          );

        default:
          return price;
      }
    }, [
      selectedPlan,
      form.billingCycle,
    ]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      price:
        calculatedPrice,
    }));
  }, [calculatedPrice]);

  /*
  |--------------------------------------------------------------------------
  | Helpers
  |--------------------------------------------------------------------------
  */

  const updateField = (
    field,
    value
  ) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  /*
  |--------------------------------------------------------------------------
  | Validation
  |--------------------------------------------------------------------------
  */

  const validate = () => {
    if (
      !form.plan
    ) {
      setError(
        "Subscription plan is required."
      );

      return false;
    }

    if (
      [
        "MTN_MOMO",
        "AIRTEL_MONEY",
      ].includes(
        form.paymentMethod
      ) &&
      !form.phoneNumber.trim()
    ) {
      setError(
        "Phone number is required."
      );

      return false;
    }

    return true;
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
        const payload = {
          plan: form.plan,
          billingCycle:
            form.billingCycle,
          currency:
            form.currency,
          price:
            form.price,
          paymentMethod:
            form.paymentMethod,
          phoneNumber:
            form.phoneNumber,
          notes: form.notes,
        };

        await OnboardingAPI.setupSubscription(
          saccoId,
          payload
        );

        setSuccess(
          "Subscription configured successfully."
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
            "Failed to setup subscription."
        );
      } finally {
        setLoading(false);
      }
    };

  return (
    <div className="subscription-page">
      <div className="subscription-card">
        <h1>
          Subscription Setup
        </h1>

        <p>
          Configure your
          subscription and
          proceed to payment.
        </p>

        {error && (
          <div className="error-box">
            {error}
          </div>
        )}

        {success && (
          <div className="success-box">
            {success}
          </div>
        )}

        <div className="plan-grid">
          {PLANS.map(
            (plan) => (
              <div
                key={
                  plan.code
                }
                className={`plan-card ${
                  form.plan ===
                  plan.code
                    ? "active"
                    : ""
                }`}
                onClick={() =>
                  updateField(
                    "plan",
                    plan.code
                  )
                }
              >
                <h3>
                  {
                    plan.name
                  }
                </h3>

                <h2>
                  UGX{" "}
                  {plan.monthlyPrice.toLocaleString()}
                </h2>

                <p>
                  {
                    plan.members
                  }
                </p>

                <p>
                  {
                    plan.branches
                  }
                </p>

                <ul>
                  {plan.features.map(
                    (
                      feature
                    ) => (
                      <li
                        key={
                          feature
                        }
                      >
                        {
                          feature
                        }
                      </li>
                    )
                  )}
                </ul>
              </div>
            )
          )}
        </div>

        <form
          onSubmit={
            handleSubmit
          }
        >
          <div className="form-group">
            <label>
              Billing
              Cycle
            </label>

            <select
              value={
                form.billingCycle
              }
              onChange={(
                e
              ) =>
                updateField(
                  "billingCycle",
                  e.target
                    .value
                )
              }
            >
              <option value="MONTHLY">
                Monthly
              </option>

              <option value="QUARTERLY">
                Quarterly
              </option>

              <option value="ANNUAL">
                Annual
              </option>
            </select>
          </div>

          <div className="form-group">
            <label>
              Payment
              Method
            </label>

            <select
              value={
                form.paymentMethod
              }
              onChange={(
                e
              ) =>
                updateField(
                  "paymentMethod",
                  e.target
                    .value
                )
              }
            >
              <option value="MTN_MOMO">
                MTN MoMo
              </option>

              <option value="AIRTEL_MONEY">
                Airtel Money
              </option>

              <option value="BANK_TRANSFER">
                Bank Transfer
              </option>
            </select>
          </div>

          {[
            "MTN_MOMO",
            "AIRTEL_MONEY",
          ].includes(
            form.paymentMethod
          ) && (
            <div className="form-group">
              <label>
                Phone
                Number
              </label>

              <input
                value={
                  form.phoneNumber
                }
                onChange={(
                  e
                ) =>
                  updateField(
                    "phoneNumber",
                    e.target
                      .value
                  )
                }
                placeholder="256782397907"
              />
            </div>
          )}

          <div className="summary-card">
            <h3>
              Subscription
              Summary
            </h3>

            <p>
              <strong>
                Plan:
              </strong>{" "}
              {
                selectedPlan.name
              }
            </p>

            <p>
              <strong>
                Members:
              </strong>{" "}
              {
                selectedPlan.members
              }
            </p>

            <p>
              <strong>
                Branches:
              </strong>{" "}
              {
                selectedPlan.branches
              }
            </p>

            <p>
              <strong>
                Total:
              </strong>{" "}
              UGX{" "}
              {form.price.toLocaleString()}
            </p>
          </div>

          <div className="form-group">
            <label>
              Notes
            </label>

            <textarea
              rows={5}
              value={
                form.notes
              }
              onChange={(
                e
              ) =>
                updateField(
                  "notes",
                  e.target
                    .value
                )
              }
            />
          </div>

          <button
            type="submit"
            disabled={
              loading
            }
            className="submit-btn"
          >
            {loading
              ? "Processing..."
              : "Save Subscription"}
          </button>
        </form>
      </div>
    </div>
  );
}

SubscriptionSetup.propTypes =
  {
    saccoId:
      PropTypes.string
        .isRequired,
    onSuccess:
      PropTypes.func,
  };

export default SubscriptionSetup;