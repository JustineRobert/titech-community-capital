#!/usr/bin/env node

/**
 * ============================================================================
 * TITech Capital SMC LTD
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
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import User from "../models/User.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: process.env.SEED_ADMIN_ENV_FILE || path.join(backendRoot, ".env"), override: false });

const MIN_PASSWORD_LENGTH = 12;
const PLATFORM_ADMIN_ROLE = "platform_admin";

function validatePassword(password) {
  return Boolean(
    password &&
      password.length >= MIN_PASSWORD_LENGTH &&
      /[a-z]/.test(password) &&
      /[A-Z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password),
  );
}

function resolveConfig() {
  const password = process.env.SEED_ADMIN_PASSWORD || "";

  return Object.freeze({
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || "",
    tenantId: process.env.SEED_ADMIN_TENANT_ID || "",
    firstName: process.env.SEED_ADMIN_FIRSTNAME || "System",
    lastName: process.env.SEED_ADMIN_LASTNAME || "Administrator",
    email: (process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase(),
    phone: (process.env.SEED_ADMIN_PHONE || "").trim(),
    password,
    role: process.env.SEED_ADMIN_ROLE || PLATFORM_ADMIN_ROLE,
    allowPasswordRotation: process.env.SEED_ADMIN_ALLOW_PASSWORD_ROTATION === "true",
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

  if (!config.email) {
    throw new Error("SEED_ADMIN_EMAIL is required; refusing to create an administrator with an implicit account identity.");
  }

  if (config.role !== PLATFORM_ADMIN_ROLE) {
    throw new Error(`SEED_ADMIN_ROLE must be ${PLATFORM_ADMIN_ROLE} for this platform administrator bootstrap.`);
  }

  if (!config.password) {
    throw new Error("SEED_ADMIN_PASSWORD is required; refusing to create a default or generated administrator credential.");
  }

  if (!validatePassword(config.password)) {
    throw new Error(
      `Administrator password must be at least ${MIN_PASSWORD_LENGTH} characters and contain uppercase, lowercase, numeric and special characters.`,
    );
  }

  if (config.tenantId && !mongoose.isValidObjectId(config.tenantId)) {
    throw new Error("SEED_ADMIN_TENANT_ID must be a valid tenant ObjectId when supplied.");
  }

  await connect(config.mongoUri);

  try {
    const existingAdmin = await User.findOne({ email: config.email }).select("+password");

    if (existingAdmin) {
      if (existingAdmin.status !== "active" || existingAdmin.isActive !== true) {
        throw new Error("The existing administrator account is not active. Complete the approved account-recovery process before platform-admin promotion.");
      }

      let changed = false;

      if (existingAdmin.role !== config.role) {
        existingAdmin.role = config.role;
        changed = true;
      }

      if (!Array.isArray(existingAdmin.roles) || !existingAdmin.roles.includes(config.role)) {
        existingAdmin.roles = [...new Set([...(existingAdmin.roles || []), config.role, "admin"])];
        changed = true;
      }

      if (!await bcrypt.compare(config.password, existingAdmin.password)) {
        if (!config.allowPasswordRotation) {
          throw new Error("Existing account password differs. Set SEED_ADMIN_ALLOW_PASSWORD_ROTATION=true only during an explicitly approved credential rotation.");
        }
        existingAdmin.password = config.password;
        changed = true;
      }

      if (changed) {
        await existingAdmin.save();
      }

      console.log(`Administrator synchronized: ${existingAdmin.email}`);
      return existingAdmin;
    }

    const passwordHash = await bcrypt.hash(config.password, 12);

    const admin = await User.create({
      ...(mongoose.isValidObjectId(config.tenantId) ? { tenantId: config.tenantId } : {}),
      firstName: config.firstName,
      lastName: config.lastName,
      name: `${config.firstName} ${config.lastName}`.trim(),
      email: config.email,
      ...(config.phone ? { phone: config.phone } : {}),
      password: passwordHash,
      role: config.role,
      roles: [config.role, "admin"],
      status: "active",
      isActive: true,
      isVerified: true,
    });

    console.log(`Administrator created: ${admin.email}`);

    return admin;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Admin bootstrap failed:", error?.message || String(error));
    process.exitCode = 1;
  });
}
