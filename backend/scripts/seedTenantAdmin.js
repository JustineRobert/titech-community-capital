#!/usr/bin/env node

import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { pathToFileURL } from "node:url";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";

const MIN_PASSWORD_LENGTH = 12;

function validatePassword(password) {
  return Boolean(
    password &&
      password.length >= MIN_PASSWORD_LENGTH &&
      /[a-z]/.test(password) &&
      /[A-Z]/.test(password) &&
      /[0-9]/.test(password),
  );
}

function readConfig() {
  return Object.freeze({
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || "",
    tenantId: process.env.SEED_TENANT_ID || "titech-family",
    tenantSlug: process.env.SEED_TENANT_SLUG || "titech-family",
    tenantName: process.env.SEED_TENANT_NAME || "TITech Family",
    email: (process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase(),
    password: process.env.SEED_ADMIN_PASSWORD || "",
    firstName: process.env.SEED_ADMIN_FIRSTNAME || "TITech",
    lastName: process.env.SEED_ADMIN_LASTNAME || "Family Administrator",
    name: process.env.SEED_ADMIN_NAME || "",
  });
}

async function run() {
  const config = readConfig();

  if (!config.mongoUri) throw new Error("MONGODB_URI or MONGO_URI is required.");
  if (!config.email) throw new Error("SEED_ADMIN_EMAIL is required.");
  if (!validatePassword(config.password)) {
    throw new Error(
      `Administrator password must be at least ${MIN_PASSWORD_LENGTH} characters and contain uppercase, lowercase and numeric characters.`,
    );
  }

  await mongoose.connect(config.mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS: 45_000,
  });

  try {
    let tenant = await Tenant.findOne({
      $or: [{ tenantId: config.tenantId }, { slug: config.tenantSlug }],
    });

    if (!tenant) {
      tenant = await Tenant.create({
        tenantId: config.tenantId,
        slug: config.tenantSlug,
        name: config.tenantName,
        countryCode: process.env.SEED_TENANT_COUNTRY || "UG",
        defaultCurrency: process.env.SEED_TENANT_CURRENCY || "UGX",
        status: "ACTIVE",
      });
      console.log(`Tenant created: ${tenant.name}`);
    } else {
      const changes = {};
      if (tenant.name !== config.tenantName) changes.name = config.tenantName;
      if (tenant.status !== "ACTIVE") changes.status = "ACTIVE";

      if (Object.keys(changes).length > 0) {
        Object.assign(tenant, changes);
        await tenant.save();
      }
      console.log(`Tenant synchronized: ${tenant.name}`);
    }

    let admin = await User.findOne({ email: config.email }).select("+password");

    if (admin) {
      let changed = false;
      if (!admin.tenantId || String(admin.tenantId) !== String(tenant._id)) {
        admin.tenantId = tenant._id;
        changed = true;
      }
      if (admin.role !== "tenant_admin") {
        admin.role = "tenant_admin";
        changed = true;
      }
      const synchronizedName = config.name || `${config.firstName} ${config.lastName}`.trim();
      if (admin.name !== synchronizedName) {
        admin.name = synchronizedName;
        changed = true;
      }
      if (admin.firstName !== config.firstName) {
        admin.firstName = config.firstName;
        changed = true;
      }
      if (admin.lastName !== config.lastName) {
        admin.lastName = config.lastName;
        changed = true;
      }
      if (!Array.isArray(admin.roles) || !admin.roles.includes("tenant_admin")) {
        admin.roles = [...new Set([...(admin.roles || []), "tenant_admin"])];
        changed = true;
      }
      if (!admin.isActive) {
        admin.isActive = true;
        changed = true;
      }
      if (admin.status !== "active") {
        admin.status = "active";
        changed = true;
      }
      if (!admin.emailVerified) {
        admin.emailVerified = true;
        changed = true;
      }
      if (!admin.isVerified) {
        admin.isVerified = true;
        changed = true;
      }
      if (!await bcrypt.compare(config.password, admin.password)) {
        admin.password = config.password;
        changed = true;
      }
      if (changed) await admin.save();
      console.log(`Tenant administrator synchronized: ${admin.email}`);
      return { tenant, admin };
    }

    admin = await User.create({
      tenantId: tenant._id,
      firstName: config.firstName,
      lastName: config.lastName,
      name: `${config.firstName} ${config.lastName}`.trim(),
      email: config.email,
      password: config.password,
      role: "tenant_admin",
      roles: ["tenant_admin"],
      isActive: true,
      status: "active",
      isVerified: true,
      emailVerified: true,
      phoneVerified: false,
      kycStatus: "VERIFIED",
      memberStatus: "ACTIVE",
    });

    console.log(`Tenant administrator created: ${admin.email}`);
    return { tenant, admin };
  } finally {
    await mongoose.disconnect();
  }
}

export { run };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Tenant administrator bootstrap failed:", error?.message || String(error));
    process.exitCode = 1;
  });
}
