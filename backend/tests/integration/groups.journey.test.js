import assert from "node:assert/strict";
import {
  afterAll,
  beforeAll,
  beforeEach,
  test,
} from "@jest/globals";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { User } from "../../models/User.js";
import Group from "../../models/Group.js";
import TenantInvitation from "../../models/TenantInvitation.js";

const TEST_JWT_SECRET =
  process.env.TEST_JWT_SECRET || "titech-test-secret-authentication";
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.ACCESS_TOKEN_SECRET = TEST_JWT_SECRET;
process.env.TITECH_AUTH_ALLOW_LOCALHOST_RATE_LIMIT_BYPASS = "true";

const { default: routeRegistry } = await import("../../routes/index.js");
const app = express();
app.use(express.json());
routeRegistry.registerRoutes(app);

const TEST_MONGO_URI =
  process.env.TEST_MONGO_URI ||
  "mongodb://127.0.0.1:27017/titech_group_journey_test";
const PASSWORD = "SecurePassword123!";

function getAccessToken(response) {
  return (
    response.body?.token ||
    response.body?.accessToken ||
    response.body?.data?.token ||
    response.body?.data?.accessToken
  );
}

function assertIsolatedTestDatabase(uri) {
  const databaseName = decodeURIComponent(
    new URL(uri).pathname.replace(/^\/+/, "")
  );
  if (!/(?:^|[_-])(?:test|tests|testing)(?:$|[_-])/i.test(databaseName)) {
    throw new Error(
      "Group journey tests require a database name containing a test marker."
    );
  }
}

beforeAll(async () => {
  assertIsolatedTestDatabase(TEST_MONGO_URI);
  if (
    /production/i.test(process.env.NODE_ENV || "") &&
    !process.env.ALLOW_PRODUCTION_TEST_DATABASE
  ) {
    throw new Error("Refusing to run group journey tests in production.");
  }
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_MONGO_URI);
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Group.deleteMany({}),
    TenantInvitation.deleteMany({}),
  ]);
});

test("tenant admin invite enables signup, login, create, join, logout, and refresh revocation", async () => {
  const tenantId = new mongoose.Types.ObjectId();
  const adminEmail = `group-admin-${Date.now()}@titech.test`;
  const admin = await User.create({
    name: "Tenant Administrator",
    email: adminEmail,
    password: PASSWORD,
    tenantId,
    role: "admin",
  });

  const adminLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: adminEmail, password: PASSWORD });
  assert.equal(adminLogin.status, 200);
  const adminToken = getAccessToken(adminLogin);
  assert.ok(adminToken);

  const invitationResponse = await request(app)
    .post("/api/auth/tenant-invitations")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ maxUses: 3, expiresInHours: 48 });
  assert.equal(invitationResponse.status, 201);
  const inviteCode = invitationResponse.body.invitation.code;
  assert.equal(invitationResponse.body.invitation.maxUses, 3);

  const primaryEmail = `group-owner-${Date.now()}@titech.test`;
  const primaryRegistration = await request(app)
    .post("/api/auth/register")
    .send({
      email: primaryEmail,
      name: "Group Owner",
      password: PASSWORD,
      tenantInviteCode: inviteCode,
    });
  assert.equal(primaryRegistration.status, 201);
  assert.equal(
    String(primaryRegistration.body.user.tenantId),
    String(tenantId)
  );

  const memberEmail = `group-member-${Date.now()}@titech.test`;
  const memberRegistration = await request(app)
    .post("/api/auth/register")
    .send({
      email: memberEmail,
      name: "Group Member",
      password: PASSWORD,
      tenantInviteCode: inviteCode,
    });
  assert.equal(memberRegistration.status, 201);

  const ownerLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: primaryEmail, password: PASSWORD });
  assert.equal(ownerLogin.status, 200);
  const ownerToken = getAccessToken(ownerLogin);

  const createResponse = await request(app)
    .post("/api/v1/groups")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      name: "End-to-End Savings Circle",
      type: "savings",
      description: "Signup to group membership journey",
      members: [memberEmail],
    });
  assert.equal(createResponse.status, 201);
  const groupId =
    createResponse.body.groupId || createResponse.body.data?.id;
  assert.ok(mongoose.Types.ObjectId.isValid(groupId));

  const memberLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: memberEmail, password: PASSWORD });
  assert.equal(memberLogin.status, 200);
  const memberToken = getAccessToken(memberLogin);

  const availableGroups = await request(app)
    .get("/api/groups")
    .set("Authorization", `Bearer ${memberToken}`);
  assert.equal(availableGroups.status, 200);
  assert.equal(
    availableGroups.body.data.some(
      (group) => String(group.id || group._id) === String(groupId)
    ),
    true
  );

  const joinResponse = await request(app)
    .post(`/api/v1/groups/join/${groupId}`)
    .set("Authorization", `Bearer ${memberToken}`)
    .send({});
  assert.equal(joinResponse.status, 200);

  const persistedGroup = await Group.findTenantGroup(tenantId, groupId);
  assert.ok(persistedGroup);
  assert.equal(persistedGroup.hasMember(memberLogin.body.user.id), true);

  const duplicateJoin = await request(app)
    .post(`/api/groups/join/${groupId}`)
    .set("Authorization", `Bearer ${memberToken}`)
    .send({});
  assert.equal(duplicateJoin.status, 409);

  const logoutCookies = memberLogin.headers["set-cookie"];
  assert.ok(logoutCookies?.length);
  const logoutResponse = await request(app)
    .post("/api/auth/logout")
    .set("Cookie", logoutCookies);
  assert.equal(logoutResponse.status, 204);

  const refreshAfterLogout = await request(app)
    .post("/api/auth/refresh")
    .set("Cookie", logoutCookies);
  assert.equal(refreshAfterLogout.status, 401);

  const wrongTenantId = new mongoose.Types.ObjectId();
  const wrongTenantUser = await User.create({
    name: "Different Tenant User",
    email: `other-tenant-${Date.now()}@titech.test`,
    password: PASSWORD,
    tenantId: wrongTenantId,
  });
  const wrongTenantToken = jwt.sign(
    {
      sub: String(wrongTenantUser._id),
      id: String(wrongTenantUser._id),
      userId: String(wrongTenantUser._id),
      tenantId: String(wrongTenantId),
      role: "user",
      user: {
        id: String(wrongTenantUser._id),
        tenantId: String(wrongTenantId),
        role: "user",
      },
    },
    TEST_JWT_SECRET,
    { algorithm: "HS256", expiresIn: "5m" }
  );
  const crossTenantJoin = await request(app)
    .post(`/api/v1/groups/join/${groupId}`)
    .set("Authorization", `Bearer ${wrongTenantToken}`)
    .send({});
  assert.equal(crossTenantJoin.status, 404);

  const storedInvitation = await TenantInvitation.findOne({
    tenantId,
  }).select("+codeHash");
  assert.ok(storedInvitation);
  assert.notEqual(storedInvitation.codeHash, inviteCode);
  assert.equal(storedInvitation.uses, 2);
  assert.ok(admin._id);
});
