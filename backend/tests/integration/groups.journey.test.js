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
    role: "tenant_admin",
    isVerified: true,
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
  assert.equal(
    primaryRegistration.status,
    201,
    JSON.stringify(primaryRegistration.body)
  );
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
  assert.ok(ownerToken);

  const memberCannotCreate = await request(app)
    .post("/api/v1/groups")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: "Unauthorized Group", type: "community", description: "Must be denied", members: [] });
  assert.equal(memberCannotCreate.status, 403);

  const createResponse = await request(app)
    .post("/api/v1/groups")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "End-to-End Savings Circle",
      type: "savings",
      description: "Signup to group membership journey",
      members: [],
    });
  assert.equal(createResponse.status, 201);
  const groupId =
    createResponse.body.groupId || createResponse.body.data?.id;
  assert.ok(mongoose.Types.ObjectId.isValid(groupId));

  const vslaCreateResponse = await request(app)
    .post("/api/v1/groups")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "End-to-End VSLA Classification",
      type: "vsla",
      description: "Classification contract only; no lending capability is enabled.",
      members: [],
    });
  assert.equal(vslaCreateResponse.status, 201, JSON.stringify(vslaCreateResponse.body));
  const persistedVsla = await Group.findTenantGroup(
    tenantId,
    vslaCreateResponse.body.groupId || vslaCreateResponse.body.data?.id,
  );
  assert.equal(persistedVsla?.type, "vsla");
  assert.equal(persistedVsla?.capabilities?.lending, false);

  const memberLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: memberEmail, password: PASSWORD });
  assert.equal(memberLogin.status, 200);
  const memberToken = getAccessToken(memberLogin);

  const pendingMemberBalance = await request(app)
    .get(`/api/v1/group-wallets/${groupId}/balance`)
    .set("Authorization", `Bearer ${memberToken}`);
  assert.equal(pendingMemberBalance.status, 403);

  const availableGroups = await request(app)
    .get("/api/groups")
    .set("Authorization", `Bearer ${memberToken}`)
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
  assert.equal(joinResponse.status, 202);
  assert.equal(joinResponse.body.membershipStatus, "pending");

  let persistedGroup = await Group.findTenantGroup(tenantId, groupId);
  assert.ok(persistedGroup);
  assert.equal(persistedGroup.hasMember(memberLogin.body.user.id), false);
  assert.equal(
    persistedGroup.getMembership(memberLogin.body.user.id)?.membershipStatus,
    "pending"
  );
  const creatorMembership = persistedGroup.getMembership(admin._id);
  assert.equal(creatorMembership?.role, "group_admin");
  assert.equal(creatorMembership?.membershipStatus, "active");

  const pendingRequests = await request(app)
    .get(`/api/groups/${groupId}/membership-requests`)
    .set("Authorization", `Bearer ${adminToken}`);
  assert.equal(pendingRequests.status, 200, JSON.stringify(pendingRequests.body));
  assert.equal(pendingRequests.body.count, 1);
  assert.equal(String(pendingRequests.body.data[0].userId), String(memberLogin.body.user.id));

  const memberCannotApprove = await request(app)
    .patch(`/api/groups/${groupId}/members/${memberLogin.body.user.id}`)
    .set("Authorization", `Bearer ${memberToken}`)
    .send({ action: "approve" });
  assert.equal(memberCannotApprove.status, 403);

  const approval = await request(app)
    .patch(`/api/groups/${groupId}/members/${memberLogin.body.user.id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ action: "approve" });
  assert.equal(approval.status, 200, JSON.stringify(approval.body));
  persistedGroup = await Group.findTenantGroup(tenantId, groupId);
  assert.equal(persistedGroup.hasMember(memberLogin.body.user.id), true);
  assert.equal(
    persistedGroup.getMembership(memberLogin.body.user.id)?.membershipStatus,
    "active"
  );

  const authorizedGroupBalance = await request(app)
    .get(`/api/v1/group-wallets/${groupId}/balance`)
    .set("Authorization", `Bearer ${memberToken}`);
  // Membership authorization succeeds, but the current Group model has no
  // canonical account reference. Do not report a misleading zero balance by
  // summing both sides of double-entry journals.
  assert.equal(authorizedGroupBalance.status, 503, JSON.stringify(authorizedGroupBalance.body));
  assert.equal(authorizedGroupBalance.body.meta?.details?.code, "GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED");

  const rejectedEmail = `group-rejected-${Date.now()}@titech.test`;
  const rejectedRegistration = await request(app)
    .post("/api/auth/register")
    .send({
      email: rejectedEmail,
      name: "Applicant for Rejection",
      password: PASSWORD,
      tenantInviteCode: inviteCode,
    });
  assert.equal(rejectedRegistration.status, 201, JSON.stringify(rejectedRegistration.body));
  const rejectedLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: rejectedEmail, password: PASSWORD });
  assert.equal(rejectedLogin.status, 200);
  const rejectedToken = getAccessToken(rejectedLogin);
  const rejectedGroupBalance = await request(app)
    .get(`/api/v1/group-wallets/${groupId}/balance`)
    .set("Authorization", `Bearer ${rejectedToken}`);
  assert.equal(rejectedGroupBalance.status, 403);

  const rejectedJoin = await request(app)
    .post(`/api/groups/join/${groupId}`)
    .set("Authorization", `Bearer ${rejectedToken}`)
    .send({});
  assert.equal(rejectedJoin.status, 202, JSON.stringify(rejectedJoin.body));

  const rejection = await request(app)
    .patch(`/api/groups/${groupId}/members/${rejectedLogin.body.user.id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ action: "reject" });
  assert.equal(rejection.status, 200, JSON.stringify(rejection.body));
  persistedGroup = await Group.findTenantGroup(tenantId, groupId);
  assert.equal(persistedGroup.hasMember(rejectedLogin.body.user.id), false);
  assert.equal(
    persistedGroup.getMembership(rejectedLogin.body.user.id)?.membershipStatus,
    "rejected"
  );

  const invalidMemberId = await request(app)
    .patch(`/api/groups/${groupId}/members/not-a-mongodb-id`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ action: "approve" });
  assert.equal(invalidMemberId.status, 400);

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

  const crossTenantRequestRead = await request(app)
    .get(`/api/groups/${groupId}/membership-requests`)
    .set("Authorization", `Bearer ${wrongTenantToken}`);
  assert.equal(crossTenantRequestRead.status, 403);

  const crossTenantGroupBalance = await request(app)
    .get(`/api/v1/group-wallets/${groupId}/balance`)
    .set("Authorization", `Bearer ${wrongTenantToken}`);
  assert.equal(crossTenantGroupBalance.status, 404);

  const crossTenantModeration = await request(app)
    .patch(`/api/groups/${groupId}/members/${memberLogin.body.user.id}`)
    .set("Authorization", `Bearer ${wrongTenantToken}`)
    .send({ action: "approve" });
  assert.equal(crossTenantModeration.status, 403);

  const storedInvitation = await TenantInvitation.findOne({
    tenantId,
  }).select("+codeHash");
  assert.ok(storedInvitation);
  assert.notEqual(storedInvitation.codeHash, inviteCode);
  assert.equal(storedInvitation.uses, 3);
  assert.ok(admin._id);
});
