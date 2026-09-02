#!/usr/bin/env node

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const User = require('../models/User'); // adjust path if different

// ===== CLI ARGUMENT PARSER =====
const args = process.argv.slice(2);

const getArg = (key) => {
  const index = args.indexOf(`--${key}`);
  return index !== -1 ? args[index + 1] : null;
};

const email = getArg('email');
const password = getArg('password');
const name = getArg('name');
const role = getArg('role') || 'admin';

// ===== VALIDATION =====
if (!email || !password || !name) {
  console.error('❌ Missing required arguments');
  process.exit(1);
}

// ===== RUN =====
(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/community_savings');

    const existing = await User.findOne({ email });

    if (existing) {
      console.log('✅ Admin already exists:', email);
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await User.create({
      email,
      password: hashedPassword,
      name,
      role,
      status: 'active',
    });

    console.log('✅ Admin created successfully');
    console.log(admin);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating admin:', err.message);
    process.exit(1);
  }
})();