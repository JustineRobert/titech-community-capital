/*
  Seed script to create an admin user locally.
  Usage (PowerShell):
    $env:ADMIN_EMAIL='admin@example.com'; $env:ADMIN_PASS='AdminPass123'; node scripts/seed-admin.js
  Or set in .env: ADMIN_EMAIL, ADMIN_PASS, ADMIN_NAME, MONGO_URI
*/

require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const crypto = require('crypto');

function generatePassword(len = 16) {
  return crypto
    .randomBytes(Math.ceil(len * 0.75))
    .toString('base64')
    .slice(0, len);
}

function validatePassword(pw) {
  // Policy: min 12 chars, at least one lowercase, one uppercase, one digit
  const minLen = 12;
  if (!pw || pw.length < minLen) return false;
  if (!/[a-z]/.test(pw)) return false;
  if (!/[A-Z]/.test(pw)) return false;
  if (!/[0-9]/.test(pw)) return false;
  return true;
}

async function run({ skipConnect = false } = {}) {
  if (!skipConnect) {
    await connectDB();
  }

  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  let password = process.env.ADMIN_PASS;
  const name = process.env.ADMIN_NAME || 'Administrator';
  const force = (process.env.ADMIN_FORCE || 'false').toString().toLowerCase() === 'true';

  // If no password was provided, generate one
  if (!password) {
    password = generatePassword(16);
    console.log('No ADMIN_PASS provided — generated a strong password for you.');
  }

  if (!validatePassword(password)) {
    const msg = `Admin password does not meet policy: min 12 chars, include lower, upper and digits.`;
    if (!force) {
      console.error(msg);
      console.error(
        'Set ADMIN_FORCE=true to override (not recommended) or provide a stronger ADMIN_PASS.'
      );
      process.exit(2);
    }
    console.warn(msg + ' Proceeding because ADMIN_FORCE=true');
  }

  try {
    let admin = await User.findOne({ email });
    if (admin) {
      let changed = false;
      if (admin.role !== 'admin') {
        admin.role = 'admin';
        changed = true;
      }
      if (!admin.isVerified) {
        admin.isVerified = true;
        changed = true;
      }
      if (!admin.isActive) {
        admin.isActive = true;
        changed = true;
      }
      if (changed) await admin.save();
      console.log(`Admin user already exists: ${email}`);
      process.exit(0);
    }

    admin = new User({ name, email, password, role: 'admin', isVerified: true, isActive: true });
    await admin.save();
    console.log(`Created admin user: ${email}`);
    console.log(`Password: ${password}`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create admin user', err);
    process.exit(1);
  }
}

module.exports = run;

if (require.main === module) {
  run();
}
