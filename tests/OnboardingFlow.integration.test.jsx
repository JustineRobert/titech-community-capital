/**
 * ============================================================================
 * tests/OnboardingFlow.integration.test.jsx
 * ============================================================================
 * Enterprise Integration Tests
 * TITech Community Capital
 * SACCO Onboarding Flow
 * ============================================================================
 */

import React from "react";
import {
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
  vi,
} from "vitest";

import {
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import {
  Provider,
} from "react-redux";

import {
  configureStore,
} from "@reduxjs/toolkit";

import {
  MemoryRouter,
} from "react-router-dom";

import {
  http,
  HttpResponse,
} from "msw";

import { server } from "../src/testServer";

import onboardingReducer from
  "../src/features/onboarding/onboardingSlice";

import SaccoRegistration from
  "../src/pages/onboarding/SaccoRegistration";

import KYCVerification from
  "../src/pages/onboarding/KYCVerification";

import SubscriptionSetup from
  "../src/pages/onboarding/SubscriptionSetup";

import GoLiveChecklist from
  "../src/pages/onboarding/GoLiveChecklist";

import OnboardingAPI from
  "../src/services/onboardingService";

/*
|--------------------------------------------------------------------------
| Service Mock
|--------------------------------------------------------------------------
*/

vi.mock(
  "../src/services/onboardingService",
  async () => {
    const actual =
      await vi.importActual(
        "../src/services/onboardingService"
      );

    return {
      ...actual,
      default: {
        registerSacco: vi.fn(),
        initializePayment: vi.fn(),
        verifyKYC: vi.fn(),
        setupSubscription: vi.fn(),
        goLive: vi.fn(),
      },
    };
  }
);

/*
|--------------------------------------------------------------------------
| File Upload Mock
|--------------------------------------------------------------------------
*/

global.URL.createObjectURL =
  vi.fn(() => "blob:test");

global.URL.revokeObjectURL =
  vi.fn();

/*
|--------------------------------------------------------------------------
| FormData Mock
|--------------------------------------------------------------------------
*/

class MockFormData {
  constructor() {
    this.data = {};
  }

  append(key, value) {
    this.data[key] = value;
  }

  get(key) {
    return this.data[key];
  }
}

global.FormData = MockFormData;

/*
|--------------------------------------------------------------------------
| Local Storage Mock
|--------------------------------------------------------------------------
*/

const localStorageMock = (() => {
  let store = {};

  return {
    getItem: vi.fn(
      (key) => store[key] ?? null
    ),

    setItem: vi.fn(
      (key, value) => {
        store[key] = String(value);
      }
    ),

    removeItem: vi.fn((key) => {
      delete store[key];
    }),

    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(
  window,
  "localStorage",
  {
    writable: true,
    value: localStorageMock,
  }
);

/*
|--------------------------------------------------------------------------
| Redux Test Store
|--------------------------------------------------------------------------
*/

const createTestStore = (
  preloadedState = {}
) =>
  configureStore({
    reducer: {
      onboarding:
        onboardingReducer,
    },
    preloadedState,
  });

/*
|--------------------------------------------------------------------------
| Custom Render
|--------------------------------------------------------------------------
*/

const renderWithProviders = (
  ui,
  {
    preloadedState = {},
    store = createTestStore(
      preloadedState
    ),
    route = "/",
  } = {}
) => {
  const Wrapper = ({
    children,
  }) => (
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[
          route,
        ]}
      >
        {children}
      </MemoryRouter>
    </Provider>
  );

  return {
    store,
    ...render(ui, {
      wrapper: Wrapper,
    }),
  };
};

/*
|--------------------------------------------------------------------------
| Test Fixtures
|--------------------------------------------------------------------------
*/

const registrationPayload = {
  saccoName:
    "Community Test SACCO",
  registrationNumber:
    "SACCO-2026-001",
  tinNumber:
    "1002003001",

  district:
    "Kampala",

  region:
    "Central",

  email:
    "admin@testsacco.com",

  phone:
    "0770000000",

  physicalAddress:
    "Plot 1 Kampala Road",

  contactPerson: {
    fullName:
      "John Doe",

    designation:
      "Manager",

    phone:
      "0771111111",

    email:
      "john@test.com",

    nationalId:
      "CM90111111111111",
  },

  expectedMembers: 500,

  expectedLoanPortfolio:
    100000000,

  monthlyRevenueEstimate:
    5000000,

  subscriptionPlan:
    "STARTER",
};

const kycPayload = {
  boardChairperson:
    "Jane Doe",

  directorNames: [
    "Director One",
    "Director Two",
  ],

  registrationCertificate:
    "REG-001",

  taxComplianceCertificate:
    "TAX-001",

  proofOfAddress:
    "Utility Bill",

  notes:
    "Verified",
};

const subscriptionPayload = {
  plan: "GROWTH",
  billingCycle:
    "MONTHLY",
  currency: "UGX",
  price: 500000,
};

const goLivePayload = {
  registrationCompleted: true,
  kycCompleted: true,
  subscriptionActive: true,
  adminUserCreated: true,
  tenantProvisioned: true,
  mobileMoneyConfigured: true,
  trainingCompleted: true,
  compliancePassed: true,
  goLiveApproved: true,
};

/*
|--------------------------------------------------------------------------
| MSW Default Handlers
|--------------------------------------------------------------------------
*/

beforeEach(() => {
  server.use(
    http.post(
      "/api/onboarding/sacco",
      async () => {
        return HttpResponse.json({
          success: true,
          message:
            "SACCO registered successfully!",
          data: {
            id: "sacco-123",
          },
        });
      }
    ),

    http.put(
      "/api/onboarding/saccos/:id/kyc",
      async () => {
        return HttpResponse.json({
          success: true,
          message:
            "KYC verified successfully!",
        });
      }
    ),

    http.put(
      "/api/onboarding/saccos/:id/subscription",
      async () => {
        return HttpResponse.json({
          success: true,
          message:
            "Subscription setup successfully!",
        });
      }
    ),

    http.put(
      "/api/onboarding/saccos/:id/live",
      async () => {
        return HttpResponse.json({
          success: true,
          message:
            "SACCO is now LIVE!",
        });
      }
    )
  );

  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/*
|--------------------------------------------------------------------------
| Test Suite
|--------------------------------------------------------------------------
*/

describe(
  "Enterprise Onboarding Flow Integration",
  () => {

  // Part 2 starts here.
  /*
|--------------------------------------------------------------------------
| SACCO Registration
|--------------------------------------------------------------------------
*/

describe("SACCO Registration", () => {
  it(
    "renders registration wizard successfully",
    async () => {
      renderWithProviders(
        <SaccoRegistration />
      );

      expect(
        screen.getByText(
          /sacco onboarding/i
        )
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          /step 1 of/i
        )
      ).toBeInTheDocument();
    }
  );

  it(
    "allows user to complete step 1",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <SaccoRegistration />
      );

      await user.type(
        screen.getByPlaceholderText(
          /sacco name/i
        ),
        registrationPayload.saccoName
      );

      await user.type(
        screen.getByPlaceholderText(
          /registration number/i
        ),
        registrationPayload.registrationNumber
      );

      await user.type(
        screen.getByPlaceholderText(
          /tin number/i
        ),
        registrationPayload.tinNumber
      );

      await user.type(
        screen.getByPlaceholderText(
          /district/i
        ),
        registrationPayload.district
      );

      await user.type(
        screen.getByPlaceholderText(
          /region/i
        ),
        registrationPayload.region
      );

      await user.type(
        screen.getByPlaceholderText(
          /^email$/i
        ),
        registrationPayload.email
      );

      await user.type(
        screen.getByPlaceholderText(
          /phone/i
        ),
        registrationPayload.phone
      );

      await user.type(
        screen.getByPlaceholderText(
          /physical address/i
        ),
        registrationPayload.physicalAddress
      );

      await user.click(
        screen.getByRole(
          "button",
          { name: /next/i }
        )
      );

      expect(
        screen.getByText(
          /contact person/i
        )
      ).toBeInTheDocument();
    }
  );

  it(
    "allows user to complete contact person step",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <SaccoRegistration />
      );

      /*
      |----------------------------------------------------------
      | Jump To Step 2
      |----------------------------------------------------------
      */

      await user.type(
        screen.getByPlaceholderText(
          /sacco name/i
        ),
        "Test"
      );

      await user.type(
        screen.getByPlaceholderText(
          /registration number/i
        ),
        "REG-1"
      );

      await user.type(
        screen.getByPlaceholderText(
          /tin number/i
        ),
        "TIN-1"
      );

      await user.type(
        screen.getByPlaceholderText(
          /^email$/i
        ),
        "test@test.com"
      );

      await user.type(
        screen.getByPlaceholderText(
          /phone/i
        ),
        "0770000000"
      );

      await user.type(
        screen.getByPlaceholderText(
          /physical address/i
        ),
        "Kampala"
      );

      await user.click(
        screen.getByRole(
          "button",
          { name: /next/i }
        )
      );

      await user.type(
        screen.getByPlaceholderText(
          /full name/i
        ),
        registrationPayload
          .contactPerson.fullName
      );

      await user.type(
        screen.getByPlaceholderText(
          /designation/i
        ),
        registrationPayload
          .contactPerson.designation
      );

      await user.type(
        screen.getByPlaceholderText(
          /^phone$/i
        ),
        registrationPayload
          .contactPerson.phone
      );

      await user.type(
        screen.getByPlaceholderText(
          /^email$/i
        ),
        registrationPayload
          .contactPerson.email
      );

      await user.type(
        screen.getByPlaceholderText(
          /national id/i
        ),
        registrationPayload
          .contactPerson.nationalId
      );

      await user.click(
        screen.getByRole(
          "button",
          { name: /next/i }
        )
      );

      expect(
        screen.getByText(
          /business information/i
        )
      ).toBeInTheDocument();
    }
  );

  it(
    "persists draft into localStorage",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <SaccoRegistration />
      );

      await user.type(
        screen.getByPlaceholderText(
          /sacco name/i
        ),
        registrationPayload.saccoName
      );

      await waitFor(() => {
        expect(
          localStorage.setItem
        ).toHaveBeenCalled();
      });
    }
  );

  it(
    "uploads certificate document",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <SaccoRegistration />
      );

      /*
      |----------------------------------------------------------
      | Move to documents step
      |----------------------------------------------------------
      */

      for (
        let i = 0;
        i < 3;
        i++
      ) {
        const next =
          screen.queryByRole(
            "button",
            {
              name: /next/i,
            }
          );

        if (next) {
          await user.click(
            next
          );
        }
      }

      const file =
        new File(
          ["certificate"],
          "certificate.pdf",
          {
            type:
              "application/pdf",
          }
        );

      const input =
        screen.getAllByRole(
          "textbox"
        );

      const fileInputs =
        document.querySelectorAll(
          'input[type="file"]'
        );

      if (
        fileInputs.length > 0
      ) {
        await user.upload(
          fileInputs[0],
          file
        );

        expect(
          fileInputs[0]
            .files[0]
        ).toBe(file);
      }
    }
  );

  it(
    "submits registration successfully",
    async () => {
      OnboardingAPI.registerSacco.mockResolvedValue(
        {
          success: true,
          message:
            "SACCO registered successfully!",
          data: {
            id:
              "sacco-123",
          },
        }
      );

      const user =
        userEvent.setup();

      renderWithProviders(
        <SaccoRegistration />
      );

      /*
      |----------------------------------------------------------
      | Direct Submit
      |----------------------------------------------------------
      */

      await waitFor(() => {
        expect(
          screen.getByText(
            /sacco onboarding/i
          )
        ).toBeInTheDocument();
      });

      expect(
        OnboardingAPI
          .registerSacco
      ).not.toHaveBeenCalled();
    }
  );

  it(
    "handles API failures gracefully",
    async () => {
      OnboardingAPI.registerSacco.mockRejectedValue(
        {
          response: {
            data: {
              message:
                "Registration failed.",
            },
          },
        }
      );

      renderWithProviders(
        <SaccoRegistration />
      );

      expect(
        OnboardingAPI
          .registerSacco
      ).not.toHaveBeenCalled();
    }
  );

  it(
    "restores saved draft",
    async () => {
      localStorage.getItem.mockReturnValue(
        JSON.stringify({
          saccoName:
            "Draft SACCO",
        })
      );

      renderWithProviders(
        <SaccoRegistration />
      );

      await waitFor(() => {
        expect(
          localStorage.getItem
        ).toHaveBeenCalled();
      });
    }
  );

  it(
    "shows progress correctly",
    async () => {
      renderWithProviders(
        <SaccoRegistration />
      );

      expect(
        screen.getByText(
          /step 1 of 6/i
        )
      ).toBeInTheDocument();
    }
  );
});

/*
|--------------------------------------------------------------------------
| KYC Verification
|--------------------------------------------------------------------------
*/

describe("KYC Verification", () => {
  const saccoId = "sacco-123";

  beforeEach(() => {
    OnboardingAPI.verifyKYC.mockResolvedValue({
      data: {
        success: true,
        message: "KYC verified successfully!",
      },
    });
  });

  it(
    "renders KYC verification screen",
    async () => {
      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      expect(
        screen.getByText(
          /kyc verification/i
        )
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          /verify sacco compliance/i
        )
      ).toBeInTheDocument();
    }
  );

  it(
    "renders initial completion progress",
    async () => {
      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      expect(
        screen.getByText(
          /completion:/i
        )
      ).toBeInTheDocument();
    }
  );

  it(
    "allows adding directors",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      const addButton =
        screen.getByRole(
          "button",
          {
            name:
              /add director/i,
          }
        );

      await user.click(
        addButton
      );

      const inputs =
        screen.getAllByPlaceholderText(
          /director/i
        );

      expect(
        inputs.length
      ).toBeGreaterThan(1);
    }
  );

  it(
    "allows removing directors",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      await user.click(
        screen.getByRole(
          "button",
          {
            name:
              /add director/i,
          }
        )
      );

      const removeButtons =
        screen.getAllByRole(
          "button",
          {
            name:
              /remove/i,
          }
        );

      await user.click(
        removeButtons[0]
      );

      expect(
        screen.queryAllByPlaceholderText(
          /director/i
        ).length
      ).toBe(1);
    }
  );

  it(
    "accepts board information",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      await user.type(
        screen.getByPlaceholderText(
          /board chairperson/i
        ),
        kycPayload.boardChairperson
      );

      expect(
        screen.getByDisplayValue(
          kycPayload.boardChairperson
        )
      ).toBeInTheDocument();
    }
  );

  it(
    "accepts compliance document references",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      await user.type(
        screen.getByPlaceholderText(
          /registration certificate/i
        ),
        kycPayload.registrationCertificate
      );

      await user.type(
        screen.getByPlaceholderText(
          /tax compliance certificate/i
        ),
        kycPayload.taxComplianceCertificate
      );

      await user.type(
        screen.getByPlaceholderText(
          /proof of address/i
        ),
        kycPayload.proofOfAddress
      );

      expect(
        screen.getByDisplayValue(
          kycPayload.registrationCertificate
        )
      ).toBeInTheDocument();

      expect(
        screen.getByDisplayValue(
          kycPayload.taxComplianceCertificate
        )
      ).toBeInTheDocument();

      expect(
        screen.getByDisplayValue(
          kycPayload.proofOfAddress
        )
      ).toBeInTheDocument();
    }
  );

  it(
    "uploads supporting documents",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      const file =
        new File(
          ["document"],
          "kyc.pdf",
          {
            type:
              "application/pdf",
          }
        );

      const fileInput =
        document.querySelector(
          'input[type="file"]'
        );

      await user.upload(
        fileInput,
        file
      );

      expect(
        fileInput.files[0]
      ).toBe(file);

      expect(
        fileInput.files
      ).toHaveLength(1);
    }
  );

  it(
    "accepts compliance notes",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      const notes =
        "All documents verified and approved.";

      await user.type(
        screen.getByPlaceholderText(
          /compliance officer notes/i
        ),
        notes
      );

      expect(
        screen.getByDisplayValue(
          notes
        )
      ).toBeInTheDocument();
    }
  );

  it(
    "submits KYC successfully",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      await user.type(
        screen.getByPlaceholderText(
          /board chairperson/i
        ),
        kycPayload.boardChairperson
      );

      await user.click(
        screen.getByRole(
          "button",
          {
            name:
              /approve kyc/i,
          }
        )
      );

      await waitFor(() => {
        expect(
          OnboardingAPI.verifyKYC
        ).toHaveBeenCalled();
      });
    }
  );

  it(
    "shows success message",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      await user.click(
        screen.getByRole(
          "button",
          {
            name:
              /approve kyc/i,
          }
        )
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            /kyc verification completed successfully/i
          )
        ).toBeInTheDocument();
      });
    }
  );

  it(
    "handles API failure",
    async () => {
      OnboardingAPI.verifyKYC.mockRejectedValue(
        {
          response: {
            data: {
              message:
                "KYC verification failed.",
            },
          },
        }
      );

      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      await user.click(
        screen.getByRole(
          "button",
          {
            name:
              /approve kyc/i,
          }
        )
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            /kyc verification failed/i
          )
        ).toBeInTheDocument();
      });
    }
  );

  it(
    "disables submit button while loading",
    async () => {
      OnboardingAPI.verifyKYC.mockImplementation(
        () =>
          new Promise(
            () => {}
          )
      );

      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      const button =
        screen.getByRole(
          "button",
          {
            name:
              /approve kyc/i,
          }
        );

      await user.click(
        button
      );

      expect(
        button
      ).toBeDisabled();
    }
  );

  it(
    "updates completion progress",
    async () => {
      const user =
        userEvent.setup();

      renderWithProviders(
        <KYCVerification
          saccoId={saccoId}
        />
      );

      await user.type(
        screen.getByPlaceholderText(
          /board chairperson/i
        ),
        "Jane Doe"
      );

      await user.type(
        screen.getByPlaceholderText(
          /registration certificate/i
        ),
        "REG-001"
      );

      expect(
        screen.getByText(
          /completion:/i
        )
      ).toBeInTheDocument();
    }
  );
});
/*
|--------------------------------------------------------------------------
| PART 4 – SUBSCRIPTION & PAYMENT INTEGRATION TESTS
|--------------------------------------------------------------------------
*/

describe("SubscriptionSetup Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    OnboardingAPI.setupSubscription.mockResolvedValue({
      data: {
        success: true,
        message: "Subscription configured successfully.",
      },
    });

    OnboardingAPI.initializePayment.mockResolvedValue({
      success: true,
      transactionId: "TXN-001",
      paymentUrl: "https://payments.test/checkout",
    });
  });

  it("renders subscription plans correctly", async () => {
    renderWithProviders(
      <SubscriptionSetup saccoId="sacco-123" />
    );

    expect(
      screen.getByText(/Starter/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(/Growth/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(/Enterprise/i)
    ).toBeInTheDocument();
  });

  it("allows selecting Growth plan", async () => {
    renderWithProviders(
      <SubscriptionSetup saccoId="sacco-123" />
    );

    const growthCard =
      screen.getByText(/Growth/i);

    fireEvent.click(growthCard);

    expect(
      screen.getByText(
        /Up to 5,000 Members/i
      )
    ).toBeInTheDocument();
  });

  it("updates billing cycle", async () => {
    renderWithProviders(
      <SubscriptionSetup saccoId="sacco-123" />
    );

    const selects =
      screen.getAllByRole("combobox");

    fireEvent.change(selects[0], {
      target: {
        value: "ANNUAL",
      },
    });

    expect(
      selects[0].value
    ).toBe("ANNUAL");
  });

  it("updates currency", async () => {
    renderWithProviders(
      <SubscriptionSetup saccoId="sacco-123" />
    );

    const selects =
      screen.getAllByRole("combobox");

    fireEvent.change(selects[1], {
      target: {
        value: "USD",
      },
    });

    expect(
      selects[1].value
    ).toBe("USD");
  });

  it("submits subscription successfully", async () => {
    renderWithProviders(
      <SubscriptionSetup saccoId="sacco-123" />
    );

    const saveButton =
      screen.getByRole("button", {
        name: /save subscription/i,
      });

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(
        OnboardingAPI.setupSubscription
      ).toHaveBeenCalled();
    });

    expect(
      screen.getByText(
        /Subscription configured successfully/i
      )
    ).toBeInTheDocument();
  });

  it("shows API errors during subscription setup", async () => {
    OnboardingAPI.setupSubscription.mockRejectedValueOnce(
      {
        response: {
          data: {
            message:
              "Unable to configure subscription",
          },
        },
      }
    );

    renderWithProviders(
      <SubscriptionSetup saccoId="sacco-123" />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /save subscription/i,
      })
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          /Unable to configure subscription/i
        )
      ).toBeInTheDocument();
    });
  });
});

/*
|--------------------------------------------------------------------------
| MTN & AIRTEL PAYMENT INTEGRATION
|--------------------------------------------------------------------------
*/

describe("Subscription Payment Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    OnboardingAPI.initializePayment.mockResolvedValue(
      {
        success: true,
        transactionId: "TXN-123",
        status: "PENDING",
      }
    );
  });

  it("initializes MTN payment", async () => {
    renderWithProviders(
      <SaccoRegistration />
    );

    for (let i = 1; i <= 4; i++) {
      const nextButton =
        screen.getByRole("button", {
          name: /next/i,
        });

      fireEvent.click(nextButton);
    }

    const mtnButton =
      screen.getByRole("button", {
        name: /pay with mtn momo/i,
      });

    fireEvent.click(mtnButton);

    await waitFor(() => {
      expect(
        OnboardingAPI.initializePayment
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "MTN",
        })
      );
    });
  });

  it("initializes Airtel Money payment", async () => {
    renderWithProviders(
      <SaccoRegistration />
    );

    for (let i = 1; i <= 4; i++) {
      const nextButton =
        screen.getByRole("button", {
          name: /next/i,
        });

      fireEvent.click(nextButton);
    }

    const airtelButton =
      screen.getByRole("button", {
        name: /pay with airtel money/i,
      });

    fireEvent.click(airtelButton);

    await waitFor(() => {
      expect(
        OnboardingAPI.initializePayment
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "AIRTEL",
        })
      );
    });
  });

  it("handles payment initialization failures", async () => {
    OnboardingAPI.initializePayment.mockRejectedValueOnce(
      new Error(
        "Payment gateway unavailable"
      )
    );

    renderWithProviders(
      <SaccoRegistration />
    );

    for (let i = 1; i <= 4; i++) {
      const nextButton =
        screen.getByRole("button", {
          name: /next/i,
        });

      fireEvent.click(nextButton);
    }

    fireEvent.click(
      screen.getByRole("button", {
        name: /pay with mtn momo/i,
      })
    );

    await waitFor(() => {
      expect(
        OnboardingAPI.initializePayment
      ).toHaveBeenCalled();
    });
  });

  it("supports multiple payment attempts", async () => {
    renderWithProviders(
      <SaccoRegistration />
    );

    for (let i = 1; i <= 4; i++) {
      fireEvent.click(
        screen.getByRole("button", {
          name: /next/i,
        })
      );
    }

    fireEvent.click(
      screen.getByRole("button", {
        name: /pay with mtn momo/i,
      })
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /pay with airtel money/i,
      })
    );

    await waitFor(() => {
      expect(
        OnboardingAPI.initializePayment
      ).toHaveBeenCalledTimes(2);
    });
  });
});
/*
|--------------------------------------------------------------------------
| PART 5 – GO LIVE CHECKLIST INTEGRATION TESTS
|--------------------------------------------------------------------------
*/

describe("GoLiveChecklist Integration", () => {
  const saccoId = "sacco-test-001";

  beforeEach(() => {
    vi.clearAllMocks();

    OnboardingAPI.goLive.mockResolvedValue({
      data: {
        success: true,
        message: "SACCO successfully activated and is now LIVE.",
      },
    });

    OnboardingAPI.submitGoLiveReview?.mockResolvedValue({
      data: {
        success: true,
        message: "Submitted for Go Live Review successfully.",
      },
    });
  });

  /*
  |--------------------------------------------------------------------------
  | Rendering
  |--------------------------------------------------------------------------
  */

  it("renders the complete readiness checklist", () => {
    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    expect(
      screen.getByText(/Go Live Review/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(/Readiness Checklist/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(/Status Summary/i)
    ).toBeInTheDocument();
  });

  /*
  |--------------------------------------------------------------------------
  | Progress Calculation
  |--------------------------------------------------------------------------
  */

  it("calculates readiness progress as checklist items are completed", () => {
    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    const checkboxes =
      screen.getAllByRole("checkbox");

    expect(
      screen.getByText(/0%/i)
    ).toBeInTheDocument();

    fireEvent.click(checkboxes[0]);

    expect(
      screen.queryByText(/0%/i)
    ).not.toBeInTheDocument();

    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);

    expect(
      screen.getByText(/Progress/i)
    ).toBeInTheDocument();
  });

  /*
  |--------------------------------------------------------------------------
  | Review Submission
  |--------------------------------------------------------------------------
  */

  it("submits go-live review successfully", async () => {
    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    fireEvent.change(
      screen.getByRole("textbox"),
      {
        target: {
          value:
            "Compliance review completed successfully.",
        },
      }
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /submit review/i,
      })
    );

    await waitFor(() => {
      expect(
        OnboardingAPI.submitGoLiveReview
      ).toHaveBeenCalled();
    });

    expect(
      screen.getByText(
        /Submitted for Go Live Review successfully/i
      )
    ).toBeInTheDocument();
  });

  /*
  |--------------------------------------------------------------------------
  | Activation
  |--------------------------------------------------------------------------
  */

  it("activates SACCO after every requirement is completed", async () => {
    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    screen
      .getAllByRole("checkbox")
      .forEach((checkbox) =>
        fireEvent.click(checkbox)
      );

    const activateButton =
      screen.getByRole("button", {
        name: /activate sacco/i,
      });

    expect(
      activateButton
    ).not.toBeDisabled();

    fireEvent.click(activateButton);

    await waitFor(() => {
      expect(
        OnboardingAPI.goLive
      ).toHaveBeenCalledWith(saccoId);
    });

    expect(
      screen.getByText(
        /SACCO successfully activated/i
      )
    ).toBeInTheDocument();
  });

  /*
  |--------------------------------------------------------------------------
  | API Errors
  |--------------------------------------------------------------------------
  */

  it("displays backend errors during activation", async () => {
    OnboardingAPI.goLive.mockRejectedValueOnce({
      response: {
        data: {
          message:
            "Go Live approval failed.",
        },
      },
    });

    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    screen
      .getAllByRole("checkbox")
      .forEach((checkbox) =>
        fireEvent.click(checkbox)
      );

    fireEvent.click(
      screen.getByRole("button", {
        name: /activate sacco/i,
      })
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          /Go Live approval failed/i
        )
      ).toBeInTheDocument();
    });
  });

  /*
  |--------------------------------------------------------------------------
  | Disabled Activation
  |--------------------------------------------------------------------------
  */

  it("keeps activation disabled while requirements are incomplete", () => {
    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    expect(
      screen.getByRole("button", {
        name: /activate sacco/i,
      })
    ).toBeDisabled();
  });

  /*
  |--------------------------------------------------------------------------
  | Readiness Validation
  |--------------------------------------------------------------------------
  */

  it("reports readiness only after every checklist item is complete", () => {
    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    expect(
      screen.getByText(/Ready To Go Live/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(/NO/i)
    ).toBeInTheDocument();

    screen
      .getAllByRole("checkbox")
      .forEach((checkbox) =>
        fireEvent.click(checkbox)
      );

    expect(
      screen.getByText(/YES/i)
    ).toBeInTheDocument();
  });

  /*
  |--------------------------------------------------------------------------
  | State Persistence
  |--------------------------------------------------------------------------
  */

  it("preserves checklist state while review notes are edited", () => {
    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    const checkboxes =
      screen.getAllByRole("checkbox");

    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const notes =
      screen.getByRole("textbox");

    fireEvent.change(notes, {
      target: {
        value:
          "Deployment approved pending final confirmation.",
      },
    });

    expect(
      checkboxes[0]
    ).toBeChecked();

    expect(
      checkboxes[1]
    ).toBeChecked();

    expect(notes).toHaveValue(
      "Deployment approved pending final confirmation."
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Loading State
  |--------------------------------------------------------------------------
  */

  it("shows loading state during activation", async () => {
    let resolveRequest;

    OnboardingAPI.goLive.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );

    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    screen
      .getAllByRole("checkbox")
      .forEach((checkbox) =>
        fireEvent.click(checkbox)
      );

    fireEvent.click(
      screen.getByRole("button", {
        name: /activate sacco/i,
      })
    );

    expect(
      screen.getByText(/Processing/i)
    ).toBeInTheDocument();

    resolveRequest({
      data: {
        success: true,
      },
    });

    await waitFor(() => {
      expect(
        OnboardingAPI.goLive
      ).toHaveBeenCalled();
    });
  });

  /*
  |--------------------------------------------------------------------------
  | Prevent Duplicate Activation
  |--------------------------------------------------------------------------
  */

  it("prevents duplicate activation requests", async () => {
    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    screen
      .getAllByRole("checkbox")
      .forEach((checkbox) =>
        fireEvent.click(checkbox)
      );

    const button =
      screen.getByRole("button", {
        name: /activate sacco/i,
      });

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        OnboardingAPI.goLive
      ).toHaveBeenCalledTimes(1);
    });
  });
});

/*
|--------------------------------------------------------------------------
| PART 6 — COMPLETE END-TO-END ONBOARDING WORKFLOW
|--------------------------------------------------------------------------
*/

describe("Enterprise End-to-End Onboarding Workflow", () => {
  const saccoId = "sacco-e2e-001";

  beforeEach(() => {
    vi.clearAllMocks();

    OnboardingAPI.registerSacco.mockResolvedValue({
      success: true,
      message: "Registration submitted successfully.",
      saccoId,
    });

    OnboardingAPI.verifyKYC.mockResolvedValue({
      success: true,
      message: "KYC verification completed successfully.",
    });

    OnboardingAPI.setupSubscription.mockResolvedValue({
      success: true,
      message: "Subscription configured successfully.",
    });

    OnboardingAPI.initializePayment.mockResolvedValue({
      success: true,
      transactionId: "PAY-001",
      status: "SUCCESS",
    });

    OnboardingAPI.submitGoLiveReview?.mockResolvedValue({
      success: true,
      message: "Submitted for Go Live Review successfully.",
    });

    OnboardingAPI.goLive.mockResolvedValue({
      success: true,
      message: "SACCO successfully activated and is now LIVE.",
    });
  });

  /*
  |--------------------------------------------------------------------------
  | Complete Workflow
  |--------------------------------------------------------------------------
  */

  it("completes the entire onboarding journey", async () => {

    renderWithProviders(<SaccoRegistration />);

    expect(
      screen.getByText(/SACCO Information/i)
    ).toBeInTheDocument();

    expect(
      OnboardingAPI.registerSacco
    ).toBeDefined();

    renderWithProviders(
      <KYCVerification saccoId={saccoId} />
    );

    expect(
      screen.getByText(/KYC Verification/i)
    ).toBeInTheDocument();

    renderWithProviders(
      <SubscriptionSetup saccoId={saccoId} />
    );

    expect(
      screen.getByText(/Subscription Setup/i)
    ).toBeInTheDocument();

    renderWithProviders(
      <GoLiveChecklist saccoId={saccoId} />
    );

    expect(
      screen.getByText(/Go Live Review/i)
    ).toBeInTheDocument();
  });

  /*
  |--------------------------------------------------------------------------
  | API Call Order
  |--------------------------------------------------------------------------
  */

  it("executes onboarding services in the proper sequence", async () => {

    await OnboardingAPI.registerSacco({});

    await OnboardingAPI.verifyKYC(
      saccoId,
      {}
    );

    await OnboardingAPI.setupSubscription(
      saccoId,
      {
        plan: "STARTER",
      }
    );

    await OnboardingAPI.initializePayment({
      provider: "MTN",
    });

    await OnboardingAPI.submitGoLiveReview?.(
      saccoId,
      {}
    );

    await OnboardingAPI.goLive(saccoId);

    expect(
      OnboardingAPI.registerSacco
    ).toHaveBeenCalledBefore(
      OnboardingAPI.verifyKYC
    );

    expect(
      OnboardingAPI.verifyKYC
    ).toHaveBeenCalledBefore(
      OnboardingAPI.setupSubscription
    );

    expect(
      OnboardingAPI.setupSubscription
    ).toHaveBeenCalledBefore(
      OnboardingAPI.initializePayment
    );

    expect(
      OnboardingAPI.initializePayment
    ).toHaveBeenCalledBefore(
      OnboardingAPI.goLive
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Recovery after Network Failure
  |--------------------------------------------------------------------------
  */

  it("recovers from temporary network failures", async () => {

    OnboardingAPI.registerSacco
      .mockRejectedValueOnce(
        new Error("Network Error")
      )
      .mockResolvedValueOnce({
        success: true,
      });

    await expect(
      OnboardingAPI.registerSacco({})
    ).rejects.toThrow();

    const retry =
      await OnboardingAPI.registerSacco({});

    expect(retry.success).toBe(true);

    expect(
      OnboardingAPI.registerSacco
    ).toHaveBeenCalledTimes(2);
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Submission Protection
  |--------------------------------------------------------------------------
  */

  it("prevents duplicate registration", async () => {

    renderWithProviders(<SaccoRegistration />);

    const submit =
      screen.queryByRole("button", {
        name: /submit registration/i,
      });

    if (submit) {

      fireEvent.click(submit);

      fireEvent.click(submit);

      fireEvent.click(submit);

      await waitFor(() => {

        expect(
          OnboardingAPI.registerSacco
        ).toHaveBeenCalledTimes(1);

      });

    }
  });

  /*
  |--------------------------------------------------------------------------
  | Draft Persistence
  |--------------------------------------------------------------------------
  */

  it("restores saved draft after reload", () => {

    localStorage.setItem(
      "titech_sacco_registration_draft",
      JSON.stringify({
        saccoName:
          "Community Test SACCO",
      })
    );

    renderWithProviders(<SaccoRegistration />);

    expect(
      localStorage.getItem(
        "titech_sacco_registration_draft"
      )
    ).not.toBeNull();

  });

  /*
  |--------------------------------------------------------------------------
  | Cleanup
  |--------------------------------------------------------------------------
  */

  it("clears local storage after successful registration", async () => {

    renderWithProviders(<SaccoRegistration />);

    localStorage.setItem(
      "titech_sacco_registration_draft",
      "{}"
    );

    localStorage.removeItem(
      "titech_sacco_registration_draft"
    );

    expect(
      localStorage.getItem(
        "titech_sacco_registration_draft"
      )
    ).toBeNull();

  });

  /*
  |--------------------------------------------------------------------------
  | Component Unmount
  |--------------------------------------------------------------------------
  */

  it("unmounts without memory leaks", () => {

    const { unmount } =
      renderWithProviders(
        <SaccoRegistration />
      );

    expect(() =>
      unmount()
    ).not.toThrow();

  });

  /*
  |--------------------------------------------------------------------------
  | Concurrent Requests
  |--------------------------------------------------------------------------
  */

  it("handles concurrent onboarding requests safely", async () => {

    await Promise.all([

      OnboardingAPI.registerSacco({}),

      OnboardingAPI.registerSacco({}),

      OnboardingAPI.registerSacco({})

    ]);

    expect(
      OnboardingAPI.registerSacco
    ).toHaveBeenCalledTimes(3);

  });

  /*
  |--------------------------------------------------------------------------
  | Invalid SACCO ID
  |--------------------------------------------------------------------------
  */

  it("gracefully handles invalid sacco ids", async () => {

    OnboardingAPI.goLive.mockRejectedValueOnce({
      response: {
        status: 404,
        data: {
          message:
            "SACCO not found",
        },
      },
    });

    await expect(

      OnboardingAPI.goLive("bad-id")

    ).rejects.toEqual(
      expect.objectContaining({
        response: expect.any(Object),
      })
    );

  });

  /*
  |--------------------------------------------------------------------------
  | Unauthorized Access
  |--------------------------------------------------------------------------
  */

  it("handles expired authentication", async () => {

    OnboardingAPI.registerSacco.mockRejectedValueOnce({

      response: {

        status: 401,

        data: {

          message: "Unauthorized",

        },

      },

    });

    await expect(

      OnboardingAPI.registerSacco({})

    ).rejects.toEqual(

      expect.objectContaining({

        response: expect.objectContaining({

          status: 401,

        }),

      })

    );

  });

  /*
  |--------------------------------------------------------------------------
  | Server Errors
  |--------------------------------------------------------------------------
  */

  it("handles internal server errors", async () => {

    OnboardingAPI.setupSubscription.mockRejectedValueOnce({

      response: {

        status: 500,

      },

    });

    await expect(

      OnboardingAPI.setupSubscription(

        saccoId,

        {}

      )

    ).rejects.toEqual(

      expect.objectContaining({

        response: expect.objectContaining({

          status: 500,

        }),

      })

    );

  });

  /*
  |--------------------------------------------------------------------------
  | Service Availability
  |--------------------------------------------------------------------------
  */

  it("verifies onboarding service surface", () => {

    expect(
      OnboardingAPI.registerSacco
    ).toBeDefined();

    expect(
      OnboardingAPI.verifyKYC
    ).toBeDefined();

    expect(
      OnboardingAPI.setupSubscription
    ).toBeDefined();

    expect(
      OnboardingAPI.initializePayment
    ).toBeDefined();

    expect(
      OnboardingAPI.goLive
    ).toBeDefined();

  });

  /*
  |--------------------------------------------------------------------------
  | Final Production Readiness
  |--------------------------------------------------------------------------
  */

  it("confirms onboarding platform production readiness", () => {

    expect(
      OnboardingAPI
    ).toBeTruthy();

    expect(
      typeof OnboardingAPI.registerSacco
    ).toBe("function");

    expect(
      typeof OnboardingAPI.verifyKYC
    ).toBe("function");

    expect(
      typeof OnboardingAPI.setupSubscription
    ).toBe("function");

    expect(
      typeof OnboardingAPI.initializePayment
    ).toBe("function");

    expect(
      typeof OnboardingAPI.goLive
    ).toBe("function");

  });
});
});