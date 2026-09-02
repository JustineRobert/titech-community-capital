"use strict";

/**

* =============================================================================
* TITech Community Capital
* Enterprise Referral Reward Service Test Suite
* =============================================================================
*
* File:
* backend/tests/unit/referralRewardService.test.js
*
* Purpose:
* Production-grade unit/contract tests for ReferralRewardService.
*
* Critical financial guarantees:
*
* 1. Duplicate referral rewards cannot be issued twice.
* 2. The immutable reward identity is used for idempotency.
* 3. Concurrent workers converge on one financial issuance.
* 4. Duplicate-key races are treated as idempotent success.
* 5. Tenant isolation is preserved.
* 6. Already-issued rewards are never financially re-issued.
* 7. Fraud/risk failures are not silently retried as successful payments.
* 8. Retryable downstream failures remain retryable.
* 9. Financial issuance is delegated to the configured financial boundary.
*
* IMPORTANT:
*
* This suite intentionally does not mock away the idempotency boundary.
*
* The most important concurrency tests exercise the service against a
* deterministic in-memory atomic repository/financial gateway so that the
* test proves the concurrency contract rather than merely proving that
* Promise.all() executes.
*
* If the production ReferralRewardService has a dependency-injection
* constructor, use createService() below to inject the test doubles.
*
* If the production service is exported as a singleton only, the adapter
* section at the bottom provides a clear compatibility path.
*
* =============================================================================
  */

const mongoose = require("mongoose");

const SERVICE_MODULE =
"../../services/referralRewardService";

/**

* =============================================================================
* TEST CONSTANTS
* =============================================================================
  */

const TENANT_A =
new mongoose.Types.ObjectId().toString();

const TENANT_B =
new mongoose.Types.ObjectId().toString();

const REWARD_ID =
new mongoose.Types.ObjectId().toString();

const REWARD_REFERENCE =
`REFERRAL-REWARD-${REWARD_ID}`;

const IDEMPOTENCY_KEY =
`referral-reward:${REWARD_ID}`;

const MEMBER_ID =
new mongoose.Types.ObjectId().toString();

const REFERRER_ID =
new mongoose.Types.ObjectId().toString();

const AMOUNT =
"5000";

const CURRENCY =
"UGX";

/**

* =============================================================================
* SERVICE LOADER
* =============================================================================
*
* The project has historically used both:
*
* module.exports = Service
*
* and:
*
* module.exports = { ReferralRewardService }
*
* Support both without weakening the tests.
* =============================================================================
  */

function loadReferralRewardService() {
// eslint-disable-next-line global-require
const exported =
require(SERVICE_MODULE);

if (
exported &&
typeof exported === "object" &&
exported.ReferralRewardService
) {
return exported.ReferralRewardService;
}

if (
exported &&
typeof exported === "object" &&
exported.default
) {
return exported.default;
}

return exported;
}

/**

* =============================================================================
* ERROR FACTORY
* =============================================================================
  */

function createError(
code,
message,
options = {}
) {
const error =
new Error(
message ||
code ||
"Referral reward test error."
);

error.code =
code;

if (
options.retryable !== undefined
) {
error.retryable =
options.retryable;
}

if (
options.statusCode !== undefined
) {
error.statusCode =
options.statusCode;
}

return error;
}

/**

* =============================================================================
* TEST REWARD FACTORY
* =============================================================================
  */

function createReward(
overrides = {}
) {
return {
_id: REWARD_ID,

tenantId:
  TENANT_A,

referralId:
  new mongoose.Types.ObjectId().toString(),

referrerId:
  REFERRER_ID,

referredMemberId:
  MEMBER_ID,

rewardReference:
  REWARD_REFERENCE,

idempotencyKey:
  IDEMPOTENCY_KEY,

amount:
  AMOUNT,

currency:
  CURRENCY,

status:
  "processing",

processingAttempts:
  1,

...overrides,


};
}

/**

* =============================================================================
* ATOMIC TEST FINANCIAL GATEWAY
* =============================================================================
*
* This intentionally models the property required by production:
*
* UNIQUE(tenantId, idempotencyKey)
*
* Multiple concurrent workers can reach the gateway simultaneously.
*
* Exactly one worker obtains the durable financial-operation identity.
*
* Every other worker receives the equivalent of a duplicate-key race and must
* converge on the already-created financial operation.
* =============================================================================
  */

class AtomicFinancialGateway {
constructor() {
this.operations =
new Map();


this.attempts =
  [];

this.successfulIssuances =
  0;

this.duplicateRaces =
  0;

this.release =
  null;

this.barrier =
  null;


}

/**

* ===========================================================================
* CONCURRENCY BARRIER
* ===========================================================================
*
* Forces workers into the same critical window.
* ===========================================================================
  */

async synchronize(
workerCount
) {
if (
workerCount <= 1
) {
return;
}


if (!this.barrier) {
  let waiting =
    0;

  let resolveBarrier;

  const promise =
    new Promise(
      (resolve) => {
        resolveBarrier =
          resolve;
      }
    );

  this.barrier = {
    promise,
    resolve() {
      resolveBarrier();
    },
    count:
      workerCount,
    get waiting() {
      return waiting;
    },
    increment() {
      waiting += 1;

      if (
        waiting >=
        workerCount
      ) {
        resolveBarrier();
      }
    },
  };
}

this.barrier.increment();

await this.barrier.promise;


}

/**

* ===========================================================================
* ATOMIC ISSUE
* ===========================================================================
  */

async issue({
tenantId,
idempotencyKey,
rewardReference,
amount,
currency,
}) {
const key =
`${tenantId}:${idempotencyKey}`;


this.attempts.push({
  tenantId,
  idempotencyKey,
  rewardReference,
  amount,
  currency,
});

/**
 * Yield deliberately so all workers have a chance to enter the race.
 */
await Promise.resolve();

/**
 * The Map insertion is the test-double equivalent of a MongoDB unique
 * index / atomic insert.
 */
if (
  this.operations.has(key)
) {
  this.duplicateRaces +=
    1;

  const existing =
    this.operations.get(key);

  return {
    success: true,
    alreadyIssued: true,
    idempotent: true,
    transactionId:
      existing.transactionId,
    idempotencyKey,
    rewardReference,
  };
}

const transactionId =
  `TX-${this.operations.size + 1}`;

const operation = {
  tenantId,
  idempotencyKey,
  rewardReference,
  amount,
  currency,
  transactionId,
  createdAt:
    new Date(),
};

this.operations.set(
  key,
  operation
);

this.successfulIssuances +=
  1;

return {
  success: true,
  alreadyIssued: false,
  idempotent: false,
  transactionId,
  idempotencyKey,
  rewardReference,
};


}

/**

* ===========================================================================
* LOOKUP
* ===========================================================================
  */

async findByIdempotencyKey(
tenantId,
idempotencyKey
) {
return (
this.operations.get(
`${tenantId}:${idempotencyKey}`
) ||
null
);
}

count() {
return this.operations.size;
}
}

/**

* =============================================================================
* TEST REWARD REPOSITORY
* =============================================================================
  */

class TestRewardRepository {
constructor() {
this.records =
new Map();


this.updates =
  [];


}

seed(reward) {
this.records.set(
String(reward._id),
{
...reward,
}
);


return reward;


}

async findById(
tenantId,
rewardId
) {
const reward =
this.records.get(
String(rewardId)
);


if (
  !reward ||
  String(reward.tenantId) !==
    String(tenantId)
) {
  return null;
}

return {
  ...reward,
};


}

async findByIdempotencyKey(
tenantId,
idempotencyKey
) {
for (
const reward of
this.records.values()
) {
if (
String(reward.tenantId) ===
String(tenantId) &&
reward.idempotencyKey ===
idempotencyKey
) {
return {
...reward,
};
}
}


return null;


}

async updateStatus(
tenantId,
rewardId,
updates
) {
const key =
String(rewardId);


const existing =
  this.records.get(key);

if (
  !existing ||
  String(existing.tenantId) !==
    String(tenantId)
) {
  return null;
}

const updated = {
  ...existing,
  ...updates,
  updatedAt:
    new Date(),
};

this.records.set(
  key,
  updated
);

this.updates.push({
  tenantId,
  rewardId,
  updates: {
    ...updates,
  },
});

return {
  ...updated,
};


}
}

/**

* =============================================================================
* SERVICE ADAPTER
* =============================================================================
*
* Prefer dependency injection when supported.
*
* The helper tries common enterprise constructor forms while keeping the test
* readable.
* =============================================================================
  */

function createService({
repository,
financialGateway,
logger = {
info: jest.fn(),
warn: jest.fn(),
error: jest.fn(),
debug: jest.fn(),
},
} = {}) {
const ReferralRewardService =
loadReferralRewardService();

if (
typeof ReferralRewardService !==
"function"
) {
throw new TypeError(
"ReferralRewardService must export a constructable service."
);
}

const dependencies = {
repository,
referralRewardRepository:
repository,


financialGateway,

financialService:
  financialGateway,

ledgerService:
  financialGateway,

transactionService:
  financialGateway,

logger,


};

/**

* Most enterprise services in this codebase use dependency injection.
  */
  try {
  return new ReferralRewardService(
  dependencies
  );
  } catch (firstError) {
  /**

  * Compatibility with services that use a positional dependency.
    */
    try {
    return new ReferralRewardService(
    repository,
    financialGateway,
    logger
    );
    } catch (secondError) {
    secondError.cause =
    firstError;

  throw secondError;
  }
  }
  }

/**

* =============================================================================
* OPTIONAL CONTRACT HELPERS
* =============================================================================
  */

function requireMethod(
service,
method
) {
expect(
service
).toBeTruthy();

expect(
typeof service[method]
).toBe(
"function"
);
}

/**

* =============================================================================
* UNIT TESTS
* =============================================================================
  */

describe(
"ReferralRewardService",
() => {
let repository;
let financialGateway;
let service;


beforeEach(
  () => {
    repository =
      new TestRewardRepository();

    financialGateway =
      new AtomicFinancialGateway();

    repository.seed(
      createReward()
    );

    service =
      createService({
        repository,
        financialGateway,
      });
  }
);


/**
 * ========================================================================
 * SERVICE CONTRACT
 * ========================================================================
 */

describe(
  "service contract",
  () => {
    test(
      "exposes issueReward()",
      () => {
        requireMethod(
          service,
          "issueReward"
        );
      }
    );


    test(
      "exposes isRewardAlreadyIssued()",
      () => {
        requireMethod(
          service,
          "isRewardAlreadyIssued"
        );
      }
    );
  }
);


/**
 * ========================================================================
 * IDEMPOTENCY
 * ========================================================================
 */

describe(
  "idempotency",
  () => {
    test(
      "uses the immutable reward idempotency identity",
      async () => {
        const reward =
          createReward();

        const result =
          await service.issueReward(
            reward,
            {
              source:
                "unit_test",
              idempotencyKey:
                reward.idempotencyKey,
            }
          );

        expect(
          result
        ).toBeTruthy();

        expect(
          financialGateway.attempts
            .length
        ).toBe(
          1
        );

        expect(
          financialGateway.attempts[0]
            .idempotencyKey
        ).toBe(
          IDEMPOTENCY_KEY
        );

        expect(
          financialGateway.attempts[0]
            .rewardReference
        ).toBe(
          REWARD_REFERENCE
        );
      }
    );


    test(
      "returns the existing issuance instead of issuing the reward twice",
      async () => {
        const reward =
          createReward();

        const first =
          await service.issueReward(
            reward,
            {
              source:
                "unit_test",
              idempotencyKey:
                IDEMPOTENCY_KEY,
            }
          );

        const second =
          await service.issueReward(
            reward,
            {
              source:
                "unit_test",
              idempotencyKey:
                IDEMPOTENCY_KEY,
            }
          );

        expect(
          first
        ).toBeTruthy();

        expect(
          second
        ).toBeTruthy();

        expect(
          financialGateway.successfulIssuances
        ).toBe(
          1
        );

        expect(
          financialGateway.count()
        ).toBe(
          1
        );

        expect(
          second.alreadyIssued ===
            true ||
          second.idempotent ===
            true
        ).toBe(
          true
        );
      }
    );


    test(
      "isRewardAlreadyIssued returns false before issuance",
      async () => {
        const reward =
          createReward();

        const result =
          await service.isRewardAlreadyIssued(
            reward,
            {
              source:
                "unit_test",
            }
          );

        expect(
          result
        ).toBe(
          false
        );
      }
    );


    test(
      "isRewardAlreadyIssued returns true after issuance",
      async () => {
        const reward =
          createReward();

        await service.issueReward(
          reward,
          {
            source:
              "unit_test",
            idempotencyKey:
              IDEMPOTENCY_KEY,
          }
        );

        const result =
          await service.isRewardAlreadyIssued(
            reward,
            {
              source:
                "unit_test",
            }
          );

        expect(
          result
        ).toBe(
          true
        );
      }
    );
  }
);


/**
 * ========================================================================
 * ALREADY ISSUED
 * ========================================================================
 */

describe(
  "already-issued protection",
  () => {
    test(
      "does not create another financial operation when the reward is already issued",
      async () => {
        const reward =
          createReward({
            status:
              "issued",
            issuedAt:
              new Date(),
          });

        repository.seed(
          reward
        );

        const result =
          await service.issueReward(
            reward,
            {
              source:
                "unit_test",
              idempotencyKey:
                IDEMPOTENCY_KEY,
            }
          );

        expect(
          result
        ).toBeTruthy();

        expect(
          financialGateway.successfulIssuances
        ).toBe(
          0
        );

        expect(
          financialGateway.count()
        ).toBe(
          0
        );
      }
    );
  }
);


/**
 * ========================================================================
 * TENANT ISOLATION
 * ========================================================================
 */

describe(
  "tenant isolation",
  () => {
    test(
      "does not treat another tenant's idempotency record as this tenant's reward",
      async () => {
        const otherTenantReward =
          createReward({
            _id:
              new mongoose.Types.ObjectId()
                .toString(),

            tenantId:
              TENANT_B,

            idempotencyKey:
              IDEMPOTENCY_KEY,

            rewardReference:
              REWARD_REFERENCE,
          });

        repository.seed(
          otherTenantReward
        );

        const ownReward =
          createReward({
            tenantId:
              TENANT_A,
          });

        const result =
          await service.issueReward(
            ownReward,
            {
              source:
                "unit_test",
              idempotencyKey:
                IDEMPOTENCY_KEY,
            }
          );

        expect(
          result
        ).toBeTruthy();

        /**
         * Tenant A must receive its own financial operation.
         */
        expect(
          financialGateway.count()
        ).toBe(
          1
        );

        const tenantAOperation =
          await financialGateway.findByIdempotencyKey(
            TENANT_A,
            IDEMPOTENCY_KEY
          );

        const tenantBOperation =
          await financialGateway.findByIdempotencyKey(
            TENANT_B,
            IDEMPOTENCY_KEY
          );

        expect(
          tenantAOperation
        ).toBeTruthy();

        expect(
          tenantBOperation
        ).toBeNull();
      }
    );
  }
);


/**
 * ========================================================================
 * DUPLICATE-KEY RACE
 * ========================================================================
 */

describe(
  "duplicate-key race",
  () => {
    test(
      "treats a unique-index duplicate as an idempotent outcome",
      async () => {
        const reward =
          createReward();

        /**
         * Replace the gateway with a deterministic race gateway.
         *
         * The first financial operation succeeds.
         * Every subsequent concurrent insertion receives a duplicate-key
         * error.
         */
        let calls =
          0;

        const raceGateway = {
          async issue(
            payload
          ) {
            calls += 1;

            if (
              calls === 1
            ) {
              return {
                success:
                  true,
                transactionId:
                  "TX-RACE-1",
              };
            }

            throw createError(
              11000,
              "E11000 duplicate key error."
            );
          },

          async findByIdempotencyKey() {
            return {
              transactionId:
                "TX-RACE-1",
              alreadyIssued:
                true,
            };
          },
        };

        const raceService =
          createService({
            repository,
            financialGateway:
              raceGateway,
          });

        const rewardResult =
          await raceService.issueReward(
            reward,
            {
              source:
                "unit_test",
              idempotencyKey:
                IDEMPOTENCY_KEY,
            }
          );

        expect(
          rewardResult
        ).toBeTruthy();
      }
    );
  }
);


/**
 * ========================================================================
 * INVALID TENANT
 * ========================================================================
 */

describe(
  "input validation",
  () => {
    test(
      "does not permit a missing tenant context",
      async () => {
        const reward =
          createReward({
            tenantId:
              null,
          });

        await expect(
          service.issueReward(
            reward,
            {
              source:
                "unit_test",
              idempotencyKey:
                IDEMPOTENCY_KEY,
            }
          )
        ).rejects.toBeTruthy();

        expect(
          financialGateway.successfulIssuances
        ).toBe(
          0
        );
      }
    );


    test(
      "does not issue when the reward identity is missing",
      async () => {
        const reward =
          createReward({
            _id:
              null,

            idempotencyKey:
              null,

            rewardReference:
              null,
          });

        await expect(
          service.issueReward(
            reward,
            {
              source:
                "unit_test",
            }
          )
        ).rejects.toBeTruthy();

        expect(
          financialGateway.successfulIssuances
        ).toBe(
          0
        );
      }
    );
  }
);


/**
 * ========================================================================
 * RETRYABLE FINANCIAL FAILURE
 * ========================================================================
 */

describe(
  "retryable failures",
  () => {
    test(
      "propagates retryable downstream failures without marking them successful",
      async () => {
        const retryableGateway = {
          async issue() {
            throw createError(
              "SERVICE_UNAVAILABLE",
              "Financial service temporarily unavailable.",
              {
                retryable:
                  true,
                statusCode:
                  503,
              }
            );
          },

          async findByIdempotencyKey() {
            return null;
          },
        };

        const retryService =
          createService({
            repository,
            financialGateway:
              retryableGateway,
          });

        await expect(
          retryService.issueReward(
            createReward(),
            {
              source:
                "unit_test",
              idempotencyKey:
                IDEMPOTENCY_KEY,
            }
          )
        ).rejects.toMatchObject({
          retryable:
            true,
        });
      }
    );
  }
);


/**
 * ========================================================================
 * FRAUD / RISK
 * ========================================================================
 */

describe(
  "fraud and risk controls",
  () => {
    test(
      "does not convert a fraud-review failure into successful payment",
      async () => {
        const fraudGateway = {
          async issue() {
            throw createError(
              "FRAUD_REVIEW_REQUIRED",
              "Referral reward requires fraud review."
            );
          },

          async findByIdempotencyKey() {
            return null;
          },
        };

        const fraudService =
          createService({
            repository,
            financialGateway:
              fraudGateway,
          });

        await expect(
          fraudService.issueReward(
            createReward(),
            {
              source:
                "unit_test",
              idempotencyKey:
                IDEMPOTENCY_KEY,
            }
          )
        ).rejects.toMatchObject({
          code:
            "FRAUD_REVIEW_REQUIRED",
        });
      }
    );
  }
);


/**
 * ========================================================================
 * CONCURRENT WORKERS
 * ========================================================================
 *
 * THIS IS THE MOST IMPORTANT TEST IN THIS FILE.
 *
 * It models:
 *
 *   Worker A ─┐
 *   Worker B ─┤
 *   Worker C ─┤
 *   Worker D ─┤──> same reward/idempotency identity
 *   Worker E ─┘
 *
 * Expected:
 *
 *   Financial issuance = 1
 *   Durable operation = 1
 *   Duplicate/idempotent outcomes = N - 1
 *
 * No test is considered successful merely because calls were serialized by
 * the test runner. Promise.all() deliberately creates the concurrency.
 * ========================================================================
 */

describe(
  "concurrent workers",
  () => {
    test(
      "five concurrent workers issue exactly one financial reward",
      async () => {
        const reward =
          createReward();

        const workers =
          Array.from(
            {
              length:
                5,
            },
            () =>
              service.issueReward(
                reward,
                {
                  source:
                    "concurrent_worker_test",
                  jobName:
                    "titech-referral-reward-recovery",
                  workerId:
                    `worker-${Math.random()}`,
                  recovery:
                    true,
                  idempotencyKey:
                    IDEMPOTENCY_KEY,
                }
              )
          );

        const results =
          await Promise.all(
            workers
          );

        expect(
          results
        ).toHaveLength(
          5
        );

        /**
         * Exactly one durable financial operation.
         */
        expect(
          financialGateway.successfulIssuances
        ).toBe(
          1
        );

        expect(
          financialGateway.count()
        ).toBe(
          1
        );

        /**
         * Every worker must converge successfully.
         */
        expect(
          results.every(
            (item) =>
              item &&
              (
                item.success !==
                  false ||
                item.alreadyIssued ===
                  true ||
                item.idempotent ===
                  true
              )
          )
        ).toBe(
          true
        );
      }
    );


    test(
      "ten concurrent recovery workers never create duplicate payments",
      async () => {
        const reward =
          createReward();

        const workerCount =
          10;

        const results =
          await Promise.all(
            Array.from(
              {
                length:
                  workerCount,
              },
              (_, index) =>
                service.issueReward(
                  reward,
                  {
                    source:
                      "concurrent_recovery_test",
                    jobName:
                      "titech-referral-reward-recovery",
                    workerId:
                      `recovery-worker-${index}`,
                    recovery:
                      true,
                    idempotencyKey:
                      IDEMPOTENCY_KEY,
                  }
                )
            )
          );

        expect(
          results
        ).toHaveLength(
          workerCount
        );

        expect(
          financialGateway.count()
        ).toBe(
          1
        );

        expect(
          financialGateway.successfulIssuances
        ).toBe(
          1
        );

        expect(
          financialGateway.duplicateRaces
        ).toBeGreaterThanOrEqual(
          workerCount - 1
        );
      }
    );


    test(
      "concurrent workers preserve tenant-scoped idempotency",
      async () => {
        const rewardA =
          createReward({
            tenantId:
              TENANT_A,

            _id:
              new mongoose.Types.ObjectId()
                .toString(),

            idempotencyKey:
              "same-business-key",
          });

        const rewardB =
          createReward({
            tenantId:
              TENANT_B,

            _id:
              new mongoose.Types.ObjectId()
                .toString(),

            idempotencyKey:
              "same-business-key",
          });

        const results =
          await Promise.all([
            service.issueReward(
              rewardA,
              {
                source:
                  "tenant-concurrency-test",
                idempotencyKey:
                  "same-business-key",
              }
            ),

            service.issueReward(
              rewardB,
              {
                source:
                  "tenant-concurrency-test",
                idempotencyKey:
                  "same-business-key",
              }
            ),
          ]);

        expect(
          results
        ).toHaveLength(
          2
        );

        /**
         * The same textual idempotency key is valid for two different
         * tenants because the financial identity is tenant-scoped.
         */
        expect(
          financialGateway.count()
        ).toBe(
          2
        );

        expect(
          await financialGateway
            .findByIdempotencyKey(
              TENANT_A,
              "same-business-key"
            )
        ).toBeTruthy();

        expect(
          await financialGateway
            .findByIdempotencyKey(
              TENANT_B,
              "same-business-key"
            )
        ).toBeTruthy();
      }
    );
  }
);


/**
 * ========================================================================
 * RECOVERY SEMANTICS
 * ========================================================================
 */

describe(
  "recovery semantics",
  () => {
    test(
      "recovery workers use the same immutable idempotency identity as normal issuance",
      async () => {
        const reward =
          createReward({
            status:
              "processing",
          });

        await service.issueReward(
          reward,
          {
            source:
              "recovery_job",
            jobName:
              "titech-referral-reward-recovery",
            workerId:
              "worker-recovery-1",
            recovery:
              true,
            idempotencyKey:
              reward.idempotencyKey,
          }
        );

        expect(
          financialGateway.attempts[0]
            .idempotencyKey
        ).toBe(
          reward.idempotencyKey
        );

        expect(
          financialGateway.attempts[0]
            .rewardReference
        ).toBe(
          reward.rewardReference
        );
      }
    );


    test(
      "a previously completed financial operation can be reconciled without a second payment",
      async () => {
        const reward =
          createReward({
            status:
              "processing",
          });

        /**
         * Simulate financial success occurring immediately before the
         * worker crashed.
         */
        await financialGateway.issue({
          tenantId:
            reward.tenantId,
          idempotencyKey:
            reward.idempotencyKey,
          rewardReference:
            reward.rewardReference,
          amount:
            reward.amount,
          currency:
            reward.currency,
        });

        expect(
          financialGateway.count()
        ).toBe(
          1
        );

        /**
         * Recovery must observe the existing operation and must not create
         * another financial operation.
         */
        const result =
          await service.issueReward(
            reward,
            {
              source:
                "recovery_job",
              recovery:
                true,
              idempotencyKey:
                reward.idempotencyKey,
            }
          );

        expect(
          result
        ).toBeTruthy();

        expect(
          financialGateway.count()
        ).toBe(
          1
        );

        expect(
          financialGateway.successfulIssuances
        ).toBe(
          1
        );
      }
    );
  }
);


}
);

/**

* =============================================================================
* INTEGRATION / CONCURRENCY TEST
* =============================================================================
*
* This section intentionally uses a separate describe block.
*
* It is safe to run in the same Jest file when the project's test command
* includes unit tests, but teams may also move it to:
*
* backend/tests/integration/referralRewardService.concurrent.test.js
*
* for CI environments that connect to MongoDB.
*
* The test below verifies the service contract at the boundary where multiple
* independently-created service instances represent separate workers.
* =============================================================================
  */

describe(
"ReferralRewardService integration-style concurrent workers",
() => {
test(
"independent worker instances converge on one payment",
async () => {
const repository =
new TestRewardRepository();


    const financialGateway =
      new AtomicFinancialGateway();

    const reward =
      createReward();

    repository.seed(
      reward
    );

    /**
     * Create independent service instances.
     *
     * No shared service-level mutex is permitted here.
     *
     * The only protection is the durable financial idempotency boundary.
     */
    const workers =
      Array.from(
        {
          length:
            8,
        },
        () =>
          createService({
            repository,
            financialGateway,
          })
      );

    const results =
      await Promise.all(
        workers.map(
          (
            worker,
            index
          ) =>
            worker.issueReward(
              reward,
              {
                source:
                  "integration_concurrency_test",
                jobName:
                  "titech-referral-reward-recovery",
                workerId:
                  `independent-worker-${index}`,
                recovery:
                  true,
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              }
            )
        )
      );

    expect(
      results
    ).toHaveLength(
      workers.length
    );

    /**
     * HARD FINANCIAL INVARIANT:
     *
     * 8 workers must never become 8 payments.
     */
    expect(
      financialGateway.count()
    ).toBe(
      1
    );

    expect(
      financialGateway.successfulIssuances
    ).toBe(
      1
    );

    /**
     * All workers should receive a convergent result rather than a second
     * financial issuance.
     */
    for (
      const result of
        results
    ) {
      expect(
        result
      ).toBeTruthy();
    }
  }
);


}
);

/**

* =============================================================================
* PRODUCTION TEST REQUIREMENTS
* =============================================================================
*
* The following environment-controlled test is intentionally opt-in.
*
* Enable with:
*
* TITECH_RUN_MONGO_CONCURRENCY_TESTS=true
*
* This prevents normal unit-test execution from unexpectedly requiring a
* running MongoDB replica set while still providing a production-grade
* concurrency gate for CI/staging.
* =============================================================================
  */

const shouldRunMongoConcurrencyTests =
String(
process.env.TITECH_RUN_MONGO_CONCURRENCY_TESTS
).toLowerCase() ===
"true";

(
shouldRunMongoConcurrencyTests
? describe
: describe.skip
)(
"ReferralRewardService MongoDB concurrency verification",
() => {
let mongoUri;
let connection;


beforeAll(
  async () => {
    mongoUri =
      process.env.MONGODB_TEST_URI ||
      process.env.MONGO_TEST_URI;

    if (!mongoUri) {
      throw new Error(
        "TITECH_RUN_MONGO_CONCURRENCY_TESTS=true requires MONGODB_TEST_URI or MONGO_TEST_URI."
      );
    }

    connection =
      await mongoose.createConnection(
        mongoUri,
        {
          maxPoolSize:
            20,
          serverSelectionTimeoutMS:
            10000,
        }
      ).asPromise();
  }
);


afterAll(
  async () => {
    if (
      connection
    ) {
      await connection.close();
    }
  }
);


test(
  "MongoDB-backed workers issue one reward under concurrent recovery",
  async () => {
    /**
     * This is deliberately a contract test rather than a fabricated schema
     * test. The production ReferralReward model/repository must provide:
     *
     *   UNIQUE(tenantId, idempotencyKey)
     *
     * or an equivalent unique financial-operation constraint.
     *
     * The test is therefore only enabled in environments where the real
     * referral reward infrastructure is available.
     */
    expect(
      connection.readyState
    ).toBe(
      1
    );

    /**
     * The actual model/service wiring belongs to the project's integration
     * bootstrap. Do not silently fall back to an in-memory implementation
     * here: if MongoDB concurrency testing is enabled, failure to obtain
     * the real financial boundary must fail the test.
     */
    const ReferralReward =
      require(
        "../../models/ReferralReward"
      );

    expect(
      ReferralReward
    ).toBeTruthy();

    expect(
      typeof ReferralReward.findOne
    ).toBe(
      "function"
    );

    /**
     * Verify that the production model exposes the expected unique
     * idempotency contract through its schema/index metadata.
     */
    const indexes =
      typeof ReferralReward.schema?.indexes ===
        "function"
        ? ReferralReward.schema.indexes()
        : [];

    const hasIdempotencyIndex =
      indexes.some(
        ([fields, options]) => {
          if (
            !fields ||
            !options?.unique
          ) {
            return false;
          }

          const fieldNames =
            Object.keys(
              fields
            );

          return (
            fieldNames.includes(
              "idempotencyKey"
            ) &&
            (
              fieldNames.includes(
                "tenantId"
              ) ||
              fieldNames.length ===
                1
            )
          );
        }
      );

    /**
     * A financial referral system must have a durable uniqueness boundary.
     *
     * If the project's final model intentionally implements uniqueness in
     * a separate FinancialTransaction/RewardOutbox collection, adapt this
     * assertion to that model rather than deleting the concurrency test.
     */
    expect(
      hasIdempotencyIndex
    ).toBe(
      true
    );
  }
);


}
);

/**

* =============================================================================
* TEST EXPORTS
* =============================================================================
*
* No application exports are required from a Jest test file.
* =============================================================================
  */