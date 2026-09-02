'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Artillery Enterprise Load Testing Configuration
 * ============================================================================
 *
 * File:
 *   backend/tests/load-testing/artillery-config.js
 *
 * Purpose:
 *   Production-oriented API performance, resilience and capacity testing.
 *
 * Run examples:
 *
 *   Local:
 *     artillery run backend/tests/load-testing/artillery-config.js
 *
 *   Staging:
 *     TARGET_URL=https://api-staging.example.com \
 *     LOAD_TEST_EMAIL=loadtest@example.com \
 *     LOAD_TEST_PASSWORD='TestPassword123!' \
 *     LOAD_TEST_GROUP_ID='YOUR_GROUP_ID' \
 *     artillery run backend/tests/load-testing/artillery-config.js
 *
 * Notes:
 *   - Keep credentials outside source control.
 *   - LOAD_TEST_GROUP_ID must identify a real load-test group in the target
 *     environment.
 *   - External payment providers should use sandbox/test credentials.
 *   - This configuration deliberately avoids creating uncontrolled financial
 *     side effects under sustained load.
 *
 * ============================================================================
 */

const TARGET_URL =
  process.env.TARGET_URL ||
  process.env.BASE_URL ||
  'http://localhost:5000';

const LOAD_TEST_EMAIL =
  process.env.LOAD_TEST_EMAIL ||
  'loadtest@example.com';

const LOAD_TEST_PASSWORD =
  process.env.LOAD_TEST_PASSWORD ||
  'TestPassword123!';

const LOAD_TEST_GROUP_ID =
  process.env.LOAD_TEST_GROUP_ID ||
  '';

const LOAD_TEST_PHONE =
  process.env.LOAD_TEST_PHONE ||
  '+256782397907';

const LOAD_TEST_CURRENCY =
  process.env.LOAD_TEST_CURRENCY ||
  'USD';

const LOAD_TEST_USER_AGENT =
  process.env.LOAD_TEST_USER_AGENT ||
  'TITech-Community-Capital-Artillery-LoadTest/1.0';

const HTTP_TIMEOUT_MS =
  Number(process.env.LOAD_TEST_HTTP_TIMEOUT_MS) || 10_000;

/**
 * Artillery allows environment-specific configuration. The default profile
 * below is deliberately conservative enough for local execution while
 * staging/production-style profiles can be selected explicitly.
 *
 * Current Artillery documentation supports named environments that override
 * top-level target/phases configuration.
 */
const config = {
  target: TARGET_URL,

  http: {
    timeout: HTTP_TIMEOUT_MS,
  },

  /**
   * Processor is retained because the project already defines a processor
   * alongside this configuration.
   *
   * Ensure the processor exports valid Artillery hook functions if additional
   * metrics, correlation IDs, or request preparation are implemented there.
   */
  processor: './artillery-processor.js',

  /**
   * Shared scenario variables.
   *
   * Environment variables are preferable for secrets and deployment-specific
   * values. Artillery exposes them to scenarios through $env.
   */
  variables: {
    testPhone: LOAD_TEST_PHONE,
    testCurrency: LOAD_TEST_CURRENCY,
    testUserEmail: LOAD_TEST_EMAIL,
    testUserPassword: LOAD_TEST_PASSWORD,
    loadTestGroupId: LOAD_TEST_GROUP_ID,
  },

  defaults: {
    headers: {
      'User-Agent': LOAD_TEST_USER_AGENT,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  },

  /**
   * Expectations are valuable for functional/load assertions. They are
   * configured here and can be tightened further in CI.
   */
  plugins: {
    expect: {
      reportFailuresAsErrors: true,
      outputFormat: 'prettyError',
    },
  },

  /**
   * Profiles:
   *
   * smoke
   *   Small functional/performance sanity check.
   *
   * baseline
   *   Normal operational load.
   *
   * stress
   *   Capacity pressure.
   *
   * soak
   *   Long-running stability test.
   *
   * The phase definitions are arrival rates: new virtual users per second.
   */
  environments: {
    smoke: {
      target: TARGET_URL,
      phases: [
        {
          duration: 30,
          arrivalRate: 1,
          name: 'Smoke warm-up',
        },
        {
          duration: 60,
          arrivalRate: 2,
          rampTo: 5,
          name: 'Smoke ramp',
        },
      ],
    },

    baseline: {
      target: TARGET_URL,
      phases: [
        {
          duration: 60,
          arrivalRate: 5,
          rampTo: 10,
          name: 'Baseline warm-up',
        },
        {
          duration: 180,
          arrivalRate: 10,
          rampTo: 25,
          name: 'Baseline ramp',
        },
        {
          duration: 300,
          arrivalRate: 25,
          name: 'Baseline sustained load',
        },
        {
          duration: 60,
          arrivalRate: 5,
          rampTo: 1,
          name: 'Baseline cool-down',
        },
      ],
    },

    stress: {
      target: TARGET_URL,
      phases: [
        {
          duration: 60,
          arrivalRate: 10,
          rampTo: 25,
          name: 'Stress warm-up',
        },
        {
          duration: 120,
          arrivalRate: 25,
          rampTo: 75,
          name: 'Stress ramp I',
        },
        {
          duration: 180,
          arrivalRate: 75,
          rampTo: 150,
          name: 'Stress ramp II',
        },
        {
          duration: 300,
          arrivalRate: 150,
          name: 'Stress sustained',
        },
        {
          duration: 120,
          arrivalRate: 25,
          rampTo: 5,
          name: 'Stress recovery',
        },
      ],
    },

    soak: {
      target: TARGET_URL,
      phases: [
        {
          duration: 300,
          arrivalRate: 10,
          rampTo: 25,
          name: 'Soak ramp',
        },
        {
          duration: 3 * 60 * 60,
          arrivalRate: 25,
          name: 'Soak sustained',
        },
        {
          duration: 300,
          arrivalRate: 5,
          rampTo: 1,
          name: 'Soak cool-down',
        },
      ],
    },
  },
};

const scenarios = [
  // ===========================================================================
  // 1. Authentication
  // ===========================================================================
  {
    name: 'Authentication Flow',
    weight: 10,

    flow: [
      {
        post: {
          name: 'Authentication - Login',

          url: '/api/auth/login',

          json: {
            email: '{{ $env.LOAD_TEST_EMAIL }}',
            password: '{{ $env.LOAD_TEST_PASSWORD }}',
          },

          capture: [
            {
              json: '$.token',
              as: 'authToken',
              strict: false,
            },
            {
              json: '$.accessToken',
              as: 'accessToken',
              strict: false,
            },
          ],

          expect: [
            {
              statusCode: 200,
            },
            {
              hasProperty: 'token',
            },
          ],
        },
      },

      {
        think: 1,
      },

      {
        get: {
          name: 'Authentication - Authenticated Health Check',

          url: '/api/auth/me',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // 2. Group Operations
  // ===========================================================================
  {
    name: 'Group Operations',
    weight: 15,

    flow: [
      {
        post: {
          name: 'Groups - Login',

          url: '/api/auth/login',

          json: {
            email: '{{ $env.LOAD_TEST_EMAIL }}',
            password: '{{ $env.LOAD_TEST_PASSWORD }}',
          },

          capture: [
            {
              json: '$.token',
              as: 'authToken',
              strict: false,
            },
          ],

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        get: {
          name: 'Groups - List',

          url: '/api/groups',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        get: {
          name: 'Groups - Load Test Group',

          url: '/api/groups/{{ $env.LOAD_TEST_GROUP_ID }}',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // 3. Group Creation / Write Pressure
  // ===========================================================================
  {
    name: 'Group Write Operations',
    weight: 5,

    flow: [
      {
        post: {
          name: 'Groups - Login',

          url: '/api/auth/login',

          json: {
            email: '{{ $env.LOAD_TEST_EMAIL }}',
            password: '{{ $env.LOAD_TEST_PASSWORD }}',
          },

          capture: [
            {
              json: '$.token',
              as: 'authToken',
              strict: false,
            },
          ],

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        post: {
          name: 'Groups - Create',

          url: '/api/groups',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          json: {
            name:
              'TITech Load Test Group {{ $randomString(8) }}',

            description:
              'Synthetic group generated for TITech performance testing.',

            targetAmount:
              '{{ $randomNumber(10000, 100000) }}',

            cycle: 'monthly',
          },

          expect: [
            {
              statusCode: 201,
            },
          ],

          capture: [
            {
              json: '$.group._id',
              as: 'createdGroupId',
              strict: false,
            },
          ],
        },
      },

      {
        get: {
          name: 'Groups - Read Created Group',

          url: '/api/groups/{{ createdGroupId }}',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // 4. Contribution Flow
  // ===========================================================================
  {
    name: 'Contribution Flow',
    weight: 20,

    flow: [
      {
        post: {
          name: 'Contributions - Login',

          url: '/api/auth/login',

          json: {
            email: '{{ $env.LOAD_TEST_EMAIL }}',
            password: '{{ $env.LOAD_TEST_PASSWORD }}',
          },

          capture: [
            {
              json: '$.token',
              as: 'authToken',
              strict: false,
            },
          ],

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        post: {
          name: 'Contributions - Submit',

          url: '/api/contributions/submit',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
            'Idempotency-Key':
              'titech-load-contribution-{{ $randomString(20) }}',
          },

          json: {
            groupId:
              '{{ $env.LOAD_TEST_GROUP_ID }}',

            amount:
              '{{ $randomNumber(100, 5000) }}',

            paymentMethod:
              'mobile_money',

            phone:
              '{{ $env.LOAD_TEST_PHONE }}',
          },

          expect: [
            {
              statusCode: 201,
            },
          ],

          capture: [
            {
              json: '$._id',
              as: 'contributionId',
              strict: false,
            },
            {
              json: '$.contribution._id',
              as: 'contributionWrappedId',
              strict: false,
            },
            {
              json: '$.transactionId',
              as: 'contributionTransactionId',
              strict: false,
            },
          ],
        },
      },

      {
        think: 1,
      },

      {
        get: {
          name: 'Contributions - List',

          url: '/api/contributions?page=1&limit=10',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // 5. Payment Processing
  // ===========================================================================
  {
    name: 'Payment Processing',
    weight: 15,

    flow: [
      {
        post: {
          name: 'Payments - Login',

          url: '/api/auth/login',

          json: {
            email: '{{ $env.LOAD_TEST_EMAIL }}',
            password: '{{ $env.LOAD_TEST_PASSWORD }}',
          },

          capture: [
            {
              json: '$.token',
              as: 'authToken',
              strict: false,
            },
          ],

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        post: {
          name: 'Payments - Initiate Mobile Money',

          url: '/api/payments/initiate',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',

            'Idempotency-Key':
              'titech-load-payment-{{ $randomString(20) }}',
          },

          json: {
            phone:
              '{{ $env.LOAD_TEST_PHONE }}',

            amount:
              '{{ $randomNumber(100, 5000) }}',

            provider: 'mpesa',

            description:
              'TITech sandbox load-test payment',
          },

          expect: [
            {
              statusCode: 200,
            },
            {
              statusCode: 201,
            },
          ],

          capture: [
            {
              json: '$.transactionId',
              as: 'paymentTransactionId',
              strict: false,
            },
          ],
        },
      },

      {
        think: 1,
      },

      {
        get: {
          name: 'Payments - History',

          url: '/api/payments/history?page=1&limit=10',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // 6. Loan Operations
  // ===========================================================================
  {
    name: 'Loan Operations',
    weight: 15,

    flow: [
      {
        post: {
          name: 'Loans - Login',

          url: '/api/auth/login',

          json: {
            email: '{{ $env.LOAD_TEST_EMAIL }}',
            password: '{{ $env.LOAD_TEST_PASSWORD }}',
          },

          capture: [
            {
              json: '$.token',
              as: 'authToken',
              strict: false,
            },
          ],

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        post: {
          name: 'Loans - Create Application',

          url: '/api/loans',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          json: {
            amount:
              '{{ $randomNumber(1000, 10000) }}',

            duration: 12,

            purpose:
              'TITech load-test loan application',
          },

          expect: [
            {
              statusCode: 201,
            },
          ],

          capture: [
            {
              json: '$.data._id',
              as: 'loanId',
              strict: false,
            },
            {
              json: '$.loan._id',
              as: 'wrappedLoanId',
              strict: false,
            },
          ],
        },
      },

      {
        get: {
          name: 'Loans - Read Application',

          url: '/api/loans/{{ loanId }}',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        get: {
          name: 'Loans - List Pending',

          url: '/api/loans?status=pending&page=1',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // 7. Chat Operations
  // ===========================================================================
  {
    name: 'Chat Operations',
    weight: 10,

    flow: [
      {
        post: {
          name: 'Chat - Login',

          url: '/api/auth/login',

          json: {
            email: '{{ $env.LOAD_TEST_EMAIL }}',
            password: '{{ $env.LOAD_TEST_PASSWORD }}',
          },

          capture: [
            {
              json: '$.token',
              as: 'authToken',
              strict: false,
            },
          ],

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        post: {
          name: 'Chat - Send',

          url: '/api/chats/send',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          json: {
            groupId:
              '{{ $env.LOAD_TEST_GROUP_ID }}',

            message:
              'TITech load-test message {{ $randomString(20) }}',
          },

          expect: [
            {
              statusCode: 201,
            },
          ],
        },
      },

      {
        get: {
          name: 'Chat - Group History',

          url:
            '/api/chats/group/{{ $env.LOAD_TEST_GROUP_ID }}?limit=20',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // 8. Dashboard & Analytics
  // ===========================================================================
  {
    name: 'Dashboard and Analytics',
    weight: 15,

    flow: [
      {
        post: {
          name: 'Analytics - Login',

          url: '/api/auth/login',

          json: {
            email: '{{ $env.LOAD_TEST_EMAIL }}',
            password: '{{ $env.LOAD_TEST_PASSWORD }}',
          },

          capture: [
            {
              json: '$.token',
              as: 'authToken',
              strict: false,
            },
          ],

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        get: {
          name: 'Dashboard - Summary',

          url: '/api/dashboard/summary',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        get: {
          name: 'Analytics - Group',

          url:
            '/api/analytics/group/{{ $env.LOAD_TEST_GROUP_ID }}',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        get: {
          name: 'Statistics - User Contributions',

          url:
            '/api/statistics/user/contributions',

          headers: {
            Authorization:
              'Bearer {{ authToken }}',
          },

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // 9. Read-Heavy API Workload
  // ===========================================================================
  {
    name: 'Read Heavy Workload',
    weight: 5,

    flow: [
      {
        post: {
          name: 'Read Workload - Login',

          url: '/api/auth/login',

          json: {
            email: '{{ $env.LOAD_TEST_EMAIL }}',
            password: '{{ $env.LOAD_TEST_PASSWORD }}',
          },

          capture: [
            {
              json: '$.token',
              as: 'authToken',
              strict: false,
            },
          ],

          expect: [
            {
              statusCode: 200,
            },
          ],
        },
      },

      {
        parallel: [
          [
            {
              get: {
                name: 'Read - Groups',

                url: '/api/groups',

                headers: {
                  Authorization:
                    'Bearer {{ authToken }}',
                },

                expect: [
                  {
                    statusCode: 200,
                  },
                ],
              },
            },
          ],

          [
            {
              get: {
                name: 'Read - Contributions',

                url:
                  '/api/contributions?page=1&limit=20',

                headers: {
                  Authorization:
                    'Bearer {{ authToken }}',
                },

                expect: [
                  {
                    statusCode: 200,
                  },
                ],
              },
            },
          ],

          [
            {
              get: {
                name: 'Read - Payments',

                url:
                  '/api/payments/history?page=1&limit=20',

                headers: {
                  Authorization:
                    'Bearer {{ authToken }}',
                },

                expect: [
                  {
                    statusCode: 200,
                  },
                ],
              },
            },
          ],
        ],
      },
    ],
  },
];

module.exports = {
  config,
  scenarios,
};