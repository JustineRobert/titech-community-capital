'use strict';

/**
 * tests/unit/contribution.controller.test.cjs
 *
 * TITech Community Capital — Contribution Controller Tests
 *
 * Coverage:
 * - Contribution creation and input validation
 * - Group existence and membership authorization
 * - Contribution listing and group filtering
 * - Date-range filtering
 * - User/group contribution totals
 * - Contribution updates and ownership enforcement
 * - Contribution deletion and ownership enforcement
 * - Missing-record and persistence-error handling
 *
 * IMPORTANT:
 * These tests exercise controller logic with mocked model dependencies.
 * They do not replace integration tests for real database persistence,
 * double-entry ledger posting, audit trails, idempotency, or transaction
 * atomicity.
 *
 * Confirm the relative module paths against the repository before running.
 */

// ============================================================================
// MOCKS
// ============================================================================

jest.mock('../../models/Contribution.js', () => {
  const Contribution = jest.fn(function ContributionDocument(data = {}) {
    Object.assign(this, data);
  });

  Contribution.prototype.save = jest.fn();
  Contribution.create = jest.fn();
  Contribution.find = jest.fn();
  Contribution.findById = jest.fn();
  Contribution.findByIdAndDelete = jest.fn();
  Contribution.findOne = jest.fn();
  Contribution.deleteOne = jest.fn();
  Contribution.aggregate = jest.fn();

  // Support consumers that import a default model from this module.
  Contribution.default = Contribution;
  Contribution.__esModule = true;

  return Contribution;
});

jest.mock('../../models/Group.js', () => {
  const Group = jest.fn();

  Group.findById = jest.fn();
  Group.findOne = jest.fn();

  Group.default = Group;
  Group.__esModule = true;

  return Group;
});

const Contribution = require('../../models/Contribution.js');
const Group = require('../../models/Group.js');

const contributionController = require('../controllers/contributionController');

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const USER_ID = 'user-123';
const OTHER_USER_ID = 'user-456';
const NON_MEMBER_ID = 'user-999';
const GROUP_ID = 'group-123';
const CONTRIBUTION_ID = 'contribution-123';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createRequest({
  userId = USER_ID,
  params = {},
  query = {},
  body = {},
} = {}) {
  return {
    user: {
      id: userId,
      _id: userId,
    },
    params,
    query,
    body,
  };
}

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function getResponseBody(res) {
  const calls = res.json.mock.calls;

  return calls.length
    ? calls[calls.length - 1][0]
    : undefined;
}

function expectSuccessResponse(res) {
  expect(res.json).toHaveBeenCalled();

  // Express defaults to HTTP 200 if status() was not explicitly called.
  if (res.status.mock.calls.length > 0) {
    const finalStatus =
      res.status.mock.calls[
        res.status.mock.calls.length - 1
      ][0];

    expect(finalStatus).toBeGreaterThanOrEqual(200);
    expect(finalStatus).toBeLessThan(300);
  }
}

function expectErrorStatus(res, expectedStatus) {
  expect(res.status).toHaveBeenCalledWith(expectedStatus);
  expect(res.json).toHaveBeenCalled();
}

function makeGroup(overrides = {}) {
  return {
    _id: GROUP_ID,
    name: 'Savings Group A',
    members: [USER_ID, OTHER_USER_ID],
    ...overrides,
  };
}

function makeContribution(overrides = {}) {
  return {
    _id: CONTRIBUTION_ID,
    user: USER_ID,
    group: GROUP_ID,
    amount: 50000,
    note: 'Monthly savings',
    date: new Date('2026-10-01T00:00:00.000Z'),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    save: jest.fn(),
    deleteOne: jest.fn(),
    remove: jest.fn(),
    ...overrides,
  };
}

/**
 * Creates a lightweight Mongoose-query substitute.
 *
 * It supports direct awaiting and common query-chain methods. It is a test
 * helper only; no database behavior or production model behavior is mocked
 * inside the controller itself.
 */
function makeQuery(result) {
  const query = {
    populate: jest.fn(() => query),
    sort: jest.fn(() => query),
    select: jest.fn(() => query),
    lean: jest.fn(() => query),
    limit: jest.fn(() => query),
    skip: jest.fn(() => query),
    exec: jest.fn(() => Promise.resolve(result)),
    then: (resolve, reject) =>
      Promise.resolve(result).then(resolve, reject),
    catch: (reject) =>
      Promise.resolve(result).catch(reject),
  };

  return query;
}

function creationArguments() {
  return (
    Contribution.mock.calls[0]?.[0] ??
    Contribution.create.mock.calls[0]?.[0]
  );
}

function expectNoContributionWrite() {
  expect(Contribution.prototype.save).not.toHaveBeenCalled();
  expect(Contribution.create).not.toHaveBeenCalled();
}

function findDateRangeConditions(value) {
  let lowerBoundFound = false;
  let upperBoundFound = false;

  const stack = [value];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current || typeof current !== 'object') {
      continue;
    }

    if (current.$gte !== undefined) {
      lowerBoundFound = true;
    }

    if (current.$lte !== undefined) {
      upperBoundFound = true;
    }

    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') {
        stack.push(child);
      }
    }
  }

  return {
    lowerBoundFound,
    upperBoundFound,
  };
}

// ============================================================================
// RESET MOCK STATE
// ============================================================================

beforeEach(() => {
  jest.clearAllMocks();

  // Provide realistic default persistence behavior. Each test may override
  // these implementations with explicit results or error scenarios.
  Contribution.prototype.save.mockImplementation(async function save() {
    if (!this._id) {
      this._id = CONTRIBUTION_ID;
    }

    if (!this.createdAt) {
      this.createdAt = new Date();
    }

    return this;
  });

  Contribution.create.mockImplementation(async (data) => ({
    _id: CONTRIBUTION_ID,
    createdAt: new Date(),
    ...data,
  }));
});

// ============================================================================
// SUITE
// ============================================================================

describe('contributionController', () => {
  // ==========================================================================
  // ADD CONTRIBUTION
  // ==========================================================================

  describe('addContribution', () => {
    test('creates a contribution for a valid group member', async () => {
      const req = createRequest({
        body: {
          groupId: GROUP_ID,
          amount: 50000,
          note: 'Monthly savings',
          date: '2026-10-01T00:00:00.000Z',
        },
      });

      const res = createResponse();

      Group.findById.mockReturnValue(
        makeQuery(makeGroup())
      );

      await contributionController.addContribution(req, res);

      expect(Group.findById).toHaveBeenCalledWith(GROUP_ID);

      const persistedData = creationArguments();

      expect(persistedData).toEqual(
        expect.objectContaining({
          amount: 50000,
        })
      );

      // Support the two common model persistence patterns without pretending
      // that a missing controller implementation is a passing test.
      expect(
        Contribution.mock.calls.length > 0 ||
        Contribution.create.mock.calls.length > 0
      ).toBe(true);

      expectSuccessResponse(res);
    });

    test.each([
      ['zero amount', 0],
      ['negative amount', -100],
      ['missing amount', undefined],
      ['null amount', null],
    ])('rejects an invalid contribution amount: %s', async (_label, amount) => {
      const req = createRequest({
        body: {
          groupId: GROUP_ID,
          amount,
          note: 'Invalid contribution',
        },
      });

      const res = createResponse();

      await contributionController.addContribution(req, res);

      expectErrorStatus(res, 400);
      expectNoContributionWrite();
    });

    test('rejects a missing group identifier', async () => {
      const req = createRequest({
        body: {
          amount: 50000,
          note: 'Monthly savings',
        },
      });

      const res = createResponse();

      await contributionController.addContribution(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expectNoContributionWrite();
    });

    test('returns not found when the group does not exist', async () => {
      const req = createRequest({
        body: {
          groupId: GROUP_ID,
          amount: 50000,
        },
      });

      const res = createResponse();

      Group.findById.mockReturnValue(makeQuery(null));

      await contributionController.addContribution(req, res);

      expect(Group.findById).toHaveBeenCalledWith(GROUP_ID);
      expectErrorStatus(res, 404);
      expectNoContributionWrite();
    });

    test('rejects contributions from non-members', async () => {
      const req = createRequest({
        userId: NON_MEMBER_ID,
        body: {
          groupId: GROUP_ID,
          amount: 50000,
          note: 'Unauthorized contribution',
        },
      });

      const res = createResponse();

      Group.findById.mockReturnValue(
        makeQuery(
          makeGroup({
            members: [USER_ID, OTHER_USER_ID],
          })
        )
      );

      await contributionController.addContribution(req, res);

      expectErrorStatus(res, 403);
      expectNoContributionWrite();
    });

    test('rejects malformed contribution dates', async () => {
      const req = createRequest({
        body: {
          groupId: GROUP_ID,
          amount: 50000,
          date: 'not-a-date',
        },
      });

      const res = createResponse();

      await contributionController.addContribution(req, res);

      expectErrorStatus(res, 400);
      expectNoContributionWrite();
    });

    test('handles persistence failures without claiming success', async () => {
      const req = createRequest({
        body: {
          groupId: GROUP_ID,
          amount: 50000,
          note: 'Monthly savings',
        },
      });

      const res = createResponse();

      Group.findById.mockReturnValue(
        makeQuery(makeGroup())
      );

      Contribution.prototype.save.mockRejectedValue(
        new Error('Simulated persistence failure')
      );

      Contribution.create.mockRejectedValue(
        new Error('Simulated persistence failure')
      );

      await contributionController.addContribution(req, res);

      expect(res.json).toHaveBeenCalled();

      const finalStatus =
        res.status.mock.calls[
          res.status.mock.calls.length - 1
        ]?.[0];

      expect(finalStatus).toBeGreaterThanOrEqual(400);
    });
  });

  // ==========================================================================
  // LIST CONTRIBUTIONS
  // ==========================================================================

  describe('getContributions', () => {
    test('retrieves contributions for the requested group', async () => {
      const contributions = [
        {
          _id: 'contribution-1',
          user: USER_ID,
          group: GROUP_ID,
          amount: 50000,
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
        },
        {
          _id: 'contribution-2',
          user: OTHER_USER_ID,
          group: GROUP_ID,
          amount: 75000,
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
        },
      ];

      const req = createRequest({
        params: {
          groupId: GROUP_ID,
        },
      });

      const res = createResponse();

      Group.findById.mockReturnValue(
        makeQuery(makeGroup())
      );

      Contribution.find.mockImplementation(() =>
        makeQuery(contributions)
      );

      await contributionController.getContributions(req, res);

      expect(Contribution.find).toHaveBeenCalled();

      const body = JSON.stringify(getResponseBody(res));

      expect(body).toContain('contribution-1');
      expect(body).toContain('contribution-2');

      expectSuccessResponse(res);
    });

    test('applies both lower and upper date-range bounds', async () => {
      const startDate = new Date('2026-01-01T00:00:00.000Z');
      const endDate = new Date('2026-12-31T23:59:59.999Z');

      const req = createRequest({
        params: {
          groupId: GROUP_ID,
        },
        query: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      });

      const res = createResponse();

      Contribution.find.mockImplementation(() =>
        makeQuery([])
      );

      await contributionController.getContributions(req, res);

      expect(Contribution.find).toHaveBeenCalled();

      const filter = Contribution.find.mock.calls[0][0];

      expect(filter).toBeDefined();

      const {
        lowerBoundFound,
        upperBoundFound,
      } = findDateRangeConditions(filter);

      expect(lowerBoundFound).toBe(true);
      expect(upperBoundFound).toBe(true);

      expectSuccessResponse(res);
    });

    test('rejects an invalid date range', async () => {
      const req = createRequest({
        params: {
          groupId: GROUP_ID,
        },
        query: {
          startDate: 'invalid-date',
          endDate: 'also-invalid',
        },
      });

      const res = createResponse();

      await contributionController.getContributions(req, res);

      expectErrorStatus(res, 400);
      expect(Contribution.find).not.toHaveBeenCalled();
    });

    test('rejects a start date later than the end date', async () => {
      const req = createRequest({
        params: {
          groupId: GROUP_ID,
        },
        query: {
          startDate: '2026-12-31T00:00:00.000Z',
          endDate: '2026-01-01T00:00:00.000Z',
        },
      });

      const res = createResponse();

      await contributionController.getContributions(req, res);

      expectErrorStatus(res, 400);
      expect(Contribution.find).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // TOTAL CONTRIBUTIONS
  // ==========================================================================

  describe('getTotalContribution', () => {
    test('returns the calculated contribution total for the requested group', async () => {
      const aggregateResult = [
        {
          _id: USER_ID,
          total: 150000,
          count: 3,
        },
      ];

      const req = createRequest({
        params: {
          groupId: GROUP_ID,
        },
      });

      const res = createResponse();

      Contribution.aggregate.mockImplementation(() =>
        makeQuery(aggregateResult)
      );

      await contributionController.getTotalContribution(req, res);

      expect(Contribution.aggregate).toHaveBeenCalled();

      const body = JSON.stringify(getResponseBody(res));

      expect(body).toContain('150000');
      expect(body).toContain('3');

      expectSuccessResponse(res);
    });

    test('handles an empty contribution aggregate', async () => {
      const req = createRequest({
        params: {
          groupId: GROUP_ID,
        },
      });

      const res = createResponse();

      Contribution.aggregate.mockImplementation(() =>
        makeQuery([])
      );

      await contributionController.getTotalContribution(req, res);

      expect(Contribution.aggregate).toHaveBeenCalled();
      expectSuccessResponse(res);
    });
  });

  // ==========================================================================
  // UPDATE CONTRIBUTION
  // ==========================================================================

  describe('updateContribution', () => {
    test('updates an existing contribution owned by the current user', async () => {
      const contribution = makeContribution({
        user: USER_ID,
        amount: 50000,
      });

      const req = createRequest({
        params: {
          contributionId: CONTRIBUTION_ID,
        },
        body: {
          amount: 60000,
          note: 'Updated monthly savings',
        },
      });

      const res = createResponse();

      Contribution.findById.mockReturnValue(
        makeQuery(contribution)
      );

      contribution.save.mockResolvedValue(contribution);

      await contributionController.updateContribution(req, res);

      expect(Contribution.findById).toHaveBeenCalledWith(
        CONTRIBUTION_ID
      );

      expect(contribution.save).toHaveBeenCalled();

      expectSuccessResponse(res);
    });

    test('prevents a non-owner from updating a contribution', async () => {
      const contribution = makeContribution({
        user: USER_ID,
        amount: 50000,
      });

      const req = createRequest({
        userId: NON_MEMBER_ID,
        params: {
          contributionId: CONTRIBUTION_ID,
        },
        body: {
          amount: 60000,
        },
      });

      const res = createResponse();

      Contribution.findById.mockReturnValue(
        makeQuery(contribution)
      );

      await contributionController.updateContribution(req, res);

      expectErrorStatus(res, 403);
      expect(contribution.save).not.toHaveBeenCalled();
      expect(contribution.amount).toBe(50000);
    });

    test.each([
      ['zero amount', 0],
      ['negative amount', -100],
    ])('rejects an update with a %s', async (_label, amount) => {
      const contribution = makeContribution({
        user: USER_ID,
        amount: 50000,
      });

      const req = createRequest({
        params: {
          contributionId: CONTRIBUTION_ID,
        },
        body: {
          amount,
        },
      });

      const res = createResponse();

      Contribution.findById.mockReturnValue(
        makeQuery(contribution)
      );

      await contributionController.updateContribution(req, res);

      expectErrorStatus(res, 400);
      expect(contribution.save).not.toHaveBeenCalled();
    });

    test('returns not found when the contribution does not exist', async () => {
      const req = createRequest({
        params: {
          contributionId: CONTRIBUTION_ID,
        },
        body: {
          amount: 60000,
        },
      });

      const res = createResponse();

      Contribution.findById.mockReturnValue(
        makeQuery(null)
      );

      await contributionController.updateContribution(req, res);

      expectErrorStatus(res, 404);
    });
  });

  // ==========================================================================
  // DELETE CONTRIBUTION
  // ==========================================================================

  describe('deleteContribution', () => {
    test('allows the contribution owner to delete their contribution', async () => {
      const contribution = makeContribution({
        user: USER_ID,
      });

      const req = createRequest({
        params: {
          contributionId: CONTRIBUTION_ID,
        },
      });

      const res = createResponse();

      Contribution.findById.mockReturnValue(
        makeQuery(contribution)
      );

      Contribution.findByIdAndDelete.mockResolvedValue(
        contribution
      );

      Contribution.deleteOne.mockResolvedValue({
        deletedCount: 1,
      });

      await contributionController.deleteContribution(req, res);

      expect(Contribution.findById).toHaveBeenCalledWith(
        CONTRIBUTION_ID
      );

      const deletionOccurred =
        Contribution.findByIdAndDelete.mock.calls.length > 0 ||
        Contribution.deleteOne.mock.calls.length > 0 ||
        contribution.deleteOne.mock.calls.length > 0 ||
        contribution.remove.mock.calls.length > 0;

      expect(deletionOccurred).toBe(true);
      expectSuccessResponse(res);
    });

    test('prevents a non-owner from deleting a contribution', async () => {
      const contribution = makeContribution({
        user: USER_ID,
      });

      const req = createRequest({
        userId: NON_MEMBER_ID,
        params: {
          contributionId: CONTRIBUTION_ID,
        },
      });

      const res = createResponse();

      Contribution.findById.mockReturnValue(
        makeQuery(contribution)
      );

      await contributionController.deleteContribution(req, res);

      expectErrorStatus(res, 403);

      expect(Contribution.findByIdAndDelete).not.toHaveBeenCalled();
      expect(Contribution.deleteOne).not.toHaveBeenCalled();
      expect(contribution.deleteOne).not.toHaveBeenCalled();
      expect(contribution.remove).not.toHaveBeenCalled();
    });

    test('returns not found when the contribution does not exist', async () => {
      const req = createRequest({
        params: {
          contributionId: CONTRIBUTION_ID,
        },
      });

      const res = createResponse();

      Contribution.findById.mockReturnValue(
        makeQuery(null)
      );

      await contributionController.deleteContribution(req, res);

      expectErrorStatus(res, 404);

      expect(Contribution.findByIdAndDelete).not.toHaveBeenCalled();
      expect(Contribution.deleteOne).not.toHaveBeenCalled();
    });
  });
});