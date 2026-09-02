#!/usr/bin/env node
/*
  Seed script to create a group and link it to an Admin user.
  Usage (bash):
    GROUP_ADMIN_EMAIL='admin@example.com' \
    GROUP_NAME='Staff SACCO' \
    GROUP_DESCRIPTION='Investment group for staff' \
    GROUP_TYPE='investment' \
    SEED_LOG_LEVEL='info' \
    node community-savings-app-backend/scripts/seed-group.js
*/

require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Group = require('../models/Group');

// --- Structured logger ---
const LOG_LEVELS = { error: 0, warn: 1, info: 2 };
const CURRENT_LEVEL = (process.env.SEED_LOG_LEVEL || 'info').toLowerCase();
function log(level, message, meta = null) {
  if (LOG_LEVELS[level] <= LOG_LEVELS[CURRENT_LEVEL]) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(meta ? { meta } : {}),
    };
    console.log(JSON.stringify(entry));
  }
}
const info = (msg, meta) => log('info', msg, meta);
const warn = (msg, meta) => log('warn', msg, meta);
const error = (msg, meta) => log('error', msg, meta);

// --- Validation Policies ---
function validateDescription(desc) {
  const minLen = 20;
  return desc && desc.trim().length >= minLen;
}

function validateType(type) {
  const allowedTypes = ['savings', 'investment', 'community', 'welfare'];
  return allowedTypes.includes(type.toLowerCase());
}

async function run({ skipConnect = false } = {}) {
  if (!skipConnect) {
    try {
      await connectDB();
      info('MongoDB connected by seed-group runner');
    } catch (err) {
      error('Failed to connect to MongoDB', { error: err.message });
      process.exit(1);
    }
  }

  const adminEmail = process.env.GROUP_ADMIN_EMAIL;
  const groupName = process.env.GROUP_NAME;
  const groupDescription = process.env.GROUP_DESCRIPTION || '';
  const groupType = (process.env.GROUP_TYPE || 'savings').toLowerCase();
  const force = (process.env.GROUP_FORCE || 'false').toLowerCase() === 'true';

  if (!adminEmail || !groupName) {
    error('Missing required environment variables: GROUP_ADMIN_EMAIL and GROUP_NAME');
    process.exit(2);
  }

  // --- Enforce Policies ---
  if (!validateDescription(groupDescription)) {
    const msg = 'Group description must be at least 20 characters long.';
    if (!force) {
      error(msg);
      error('Set GROUP_FORCE=true to override (not recommended).');
      process.exit(3);
    }
    warn(msg + ' Proceeding because GROUP_FORCE=true');
  } else {
    info('Description policy passed');
  }

  if (!validateType(groupType)) {
    const msg = `Invalid GROUP_TYPE "${groupType}". Allowed values: savings, investment, community, welfare`;
    if (!force) {
      error(msg);
      error('Set GROUP_FORCE=true to override (not recommended).');
      process.exit(4);
    }
    warn(msg + ' Proceeding because GROUP_FORCE=true');
  } else {
    info('Type policy passed');
  }

  try {
    const adminUser = await User.findOne({ email: adminEmail });
    if (!adminUser) {
      error(`Admin user not found: ${adminEmail}`);
      process.exit(5);
    }
    info('Admin user found', { adminEmail, adminId: String(adminUser._id) });

    let group = await Group.findOne({ name: groupName });
    if (group) {
      info('Group already exists', { groupName, groupId: String(group._id) });
      if (String(group.admin) !== String(adminUser._id)) {
        group.admin = adminUser._id;
        group.createdBy = adminUser._id;
        await group.save();
        info('Group re-linked to admin', { groupName, adminEmail });
      } else {
        info('Group admin already correct', { groupName, adminEmail });
      }
      process.exit(0);
    }

    group = new Group({
      name: groupName,
      description: groupDescription,
      type: groupType,
      admin: adminUser._id,
      createdBy: adminUser._id, // required by schema
      createdAt: new Date(),
      isActive: true,
    });

    await group.save();
    info('Created group', { groupName, groupId: String(group._id), adminEmail });
    process.exit(0);
  } catch (err) {
    error('Failed to create group', { error: err.message });
    process.exit(1);
  }
}

module.exports = run;

if (require.main === module) {
  run();
}
