#!/usr/bin/env node

import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import bcrypt from "bcrypt";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Group from "../models/Group.js";

const GROUP_NAME = "The Kareu Clan SACCO";

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  const email = (process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "";

  if (!mongoUri) throw new Error("MONGODB_URI or MONGO_URI is required.");
  if (!email) throw new Error("SEED_ADMIN_EMAIL is required.");
  if (password.length < 12) throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.");

  await mongoose.connect(mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS: 45_000,
  });

  let tenant = await Tenant.findOne({
    $or: [{ tenantId: "kareu-clan" }, { slug: "kareu-clan" }],
  });

  if (!tenant) {
    tenant = await Tenant.create({
      tenantId: "kareu-clan",
      slug: "kareu-clan",
      name: "The Kareu Clan SACCO",
      countryCode: "UG",
      defaultCurrency: "UGX",
      status: "ACTIVE",
    });
  }

  let admin = await User.findOne({ email }).select("+password");
  if (!admin) {
    admin = await User.create({
      tenantId: tenant._id,
      firstName: "Igune",
      lastName: "Justine Robert",
      name: "Igune Justine Robert",
      email,
      password,
      role: "tenant_admin",
      roles: ["tenant_admin"],
      isActive: true,
      status: "active",
      isVerified: true,
      emailVerified: true,
      kycStatus: "VERIFIED",
      memberStatus: "ACTIVE",
    });
  } else {
    const changes = {};
    if (String(admin.tenantId) !== String(tenant._id)) changes.tenantId = tenant._id;
    if (admin.role !== "tenant_admin") changes.role = "tenant_admin";
    if (!admin.roles?.includes("tenant_admin")) changes.roles = [...new Set([...(admin.roles || []), "tenant_admin"])];
    if (admin.name !== "Igune Justine Robert") changes.name = "Igune Justine Robert";
    if (admin.firstName !== "Igune") changes.firstName = "Igune";
    if (admin.lastName !== "Justine Robert") changes.lastName = "Justine Robert";
    if (!admin.isActive) changes.isActive = true;
    if (admin.status !== "active") changes.status = "active";
    if (!admin.emailVerified) changes.emailVerified = true;
    if (!admin.isVerified) changes.isVerified = true;
    if (!(await bcrypt.compare(password, admin.password))) changes.password = password;

    if (Object.keys(changes).length > 0) {
      Object.assign(admin, changes);
      await admin.save();
    }
  }

  let group = await Group.findOne({
    tenantId: tenant._id,
    name: GROUP_NAME,
    deletedAt: null,
  });

  if (!group) {
    group = await Group.create({
      tenantId: tenant._id,
      name: GROUP_NAME,
      description: "Community savings and credit cooperative for the Kareu clan.",
      type: "sacco",
      status: "active",
      createdBy: admin._id,
      managedBy: admin._id,
      memberRoles: [{
        user: admin._id,
        role: "group_admin",
        status: "active",
      }],
      capabilities: {
        savings: true,
        lending: true,
      },
    });
    console.log(`Group created: ${GROUP_NAME}`);
  } else {
    const changes = {};
    if (String(group.createdBy) !== String(admin._id)) changes.createdBy = admin._id;
    if (String(group.managedBy || "") !== String(admin._id)) changes.managedBy = admin._id;
    if (group.type !== "sacco") changes.type = "sacco";
    if (group.status !== "active") changes.status = "active";

    if (Object.keys(changes).length > 0) {
      Object.assign(group, changes);
      await group.save();
    }
    console.log(`Group synchronized: ${GROUP_NAME}`);
  }

  const persistedAdmin = await User.findById(admin._id)
    .select("_id name email role tenantId")
    .lean();

  return {
    tenantId: String(tenant._id),
    tenantName: tenant.name,
    admin: persistedAdmin,
    groupId: String(group._id),
    groupName: group.name,
  };
}

export { run };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Kareu SACCO seed failed:", error?.message || String(error));
    process.exitCode = 1;
  }).finally(async () => {
    await mongoose.disconnect();
  });
}
