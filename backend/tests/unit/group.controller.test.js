import { beforeAll, describe, expect, jest, test } from "@jest/globals";

let groupController;

beforeAll(async () => {
  ({ default: groupController } = await import(
    "../../controllers/groupController.js"
  ));
});

describe("groupController", () => {
  test("rejects group creation without an authenticated tenant", async () => {
    const req = {
      user: { id: "65f000000000000000000001" },
      body: { name: "Savings Circle" },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await groupController.createGroup(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "GROUP_TENANT_CONTEXT_REQUIRED",
      })
    );
  });

  test("rejects invalid group input before persistence", async () => {
    const req = {
      user: {
        id: "65f000000000000000000001",
        tenantId: "65f000000000000000000010",
      },
      body: { name: "x" },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await groupController.createGroup(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "GROUP_INPUT_INVALID",
      })
    );
  });
});
