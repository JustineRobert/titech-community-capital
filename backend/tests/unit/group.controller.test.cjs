"use strict";

const {
  beforeAll,
  describe,
  expect,
  jest: jestMock,
  test,
} = require("@jest/globals");

let groupController;

beforeAll(async () => {
  ({ default: groupController } = await import(
    "../../controllers/groupController.js"
  ));
});

describe("groupController ESM compatibility", () => {
  test("rejects group creation without tenant context", async () => {
    const res = {
      status: jestMock.fn().mockReturnThis(),
      json: jestMock.fn(),
    };

    await groupController.createGroup(
      {
        user: { id: "65f000000000000000000001" },
        body: { name: "Savings Circle" },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "GROUP_TENANT_CONTEXT_REQUIRED",
      })
    );
  });
});
