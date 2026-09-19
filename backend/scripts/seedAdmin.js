#!/usr/bin/env node

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrator Bootstrap
 * ============================================================================
 *
 * Purpose
 * -------
 * Creates the first privileged administrator using environment-controlled
 * credentials. This script is intentionally deterministic, idempotent and
 * safe to import from the root CLI.
 *
 * Security boundaries
 * -------------------
 * - Never contains a default password or credential.
 * - Never prints the administrator password.
 * - Requires an explicitly configured MongoDB URI.
 * - Uses the canonical User model.
 * - Does not create financial balances, ledger entries or tenant data beyond
 *   the explicitly supplied system tenant identifier.
 *
 * ============================================================================
 */

import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { pathToFileURL } from "node:url";
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

function resolveConfig() {
  const password = process.env.SEED_ADMIN_PASSWORD || "";

  return Object.freeze({
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || "",
    tenantId: process.env.SEED_ADMIN_TENANT_ID || "SYSTEM",
    firstName: process.env.SEED_ADMIN_FIRSTNAME || "System",
    lastName: process.env.SEED_ADMIN_LASTNAME || "Administrator",
    email: (process.env.SEED_ADMIN_EMAIL || "admin@titechcapital.com").trim().toLowerCase(),
    phone: process.env.SEED_ADMIN_PHONE || "+256700000000",
    password,
    role: process.env.SEED_ADMIN_ROLE || "super_admin",
  });
}

async function connect(mongoUri) {
  if (!mongoUri) {
    throw new Error("MONGODB_URI or MONGO_URI is required.");
  }

  await mongoose.connect(mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS: 45_000,
  });
}

export async function run() {
  const config = resolveConfig();

  if (!config.password) {
    throw new Error("SEED_ADMIN_PASSWORD is required; refusing to create a default or generated administrator credential.");
  }

  if (!validatePassword(config.password)) {
    throw new Error(
      `Administrator password must be at least ${MIN_PASSWORD_LENGTH} characters and contain uppercase, lowercase and numeric characters.`,
    );
  }

  await connect(config.mongoUri);

  try {
    const existingAdmin = await User.findOne({ email: config.email });

    if (existingAdmin) {
      let changed = false;

      if (existingAdmin.role !== config.role) {
        existingAdmin.role = config.role;
        changed = true;
      }

      if (!existingAdmin.isActive) {
        existingAdmin.isActive = true;
        changed = true;
      }

      if (changed) {
        await existingAdmin.save();
      }

      console.log(`Administrator already exists: ${existingAdmin.email}`);
      return existingAdmin;
    }

    const passwordHash = await bcrypt.hash(config.password, 12);

    const admin = await User.create({
      tenantId: config.tenantId,
      firstName: config.firstName,
      lastName: config.lastName,
      name: `${config.firstName} ${config.lastName}`.trim(),
      email: config.email,
      phone: config.phone,
      password: passwordHash,
      role: config.role,
      roles: [config.role, "admin"],
      isActive: true,
      isVerified: true,
      emailVerified: true,
      phoneVerified: true,
      kycStatus: "VERIFIED",
      memberStatus: "ACTIVE",
      createdBy: "SYSTEM",
    });

    console.log(`Administrator created: ${admin.email}`);

    return admin;
  } finally {
    await mongoose.disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Admin bootstrap failed:", error?.message || String(error));
    process.exitCode = 1;
  });
}
