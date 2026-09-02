// scripts/seed.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Group = require('../models/Group');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    // 1️⃣ Ensure Admin User Exists
    let admin = await User.findOne({ email: 'titechaafrica@gmail.com' });

    if (!admin) {
      admin = await User.create({
        _id: new mongoose.Types.ObjectId('694ef1e676c665793b6cca75'),
        name: 'System Admin',
        email: 'titechaafrica@gmail.com',
        password: 'Justine@881234', // ⚠️ hashed automatically if pre-save hook exists
        role: 'admin',
        isVerified: true,
      });

      console.log('✅ Admin user created');
    } else {
      console.log('ℹ️ Admin user already exists');
    }

    // 2️⃣ Clear existing groups
    await Group.deleteMany({});
    console.log('🧹 Existing groups cleared');

    // 3️⃣ Seed Groups
    await Group.insertMany([
      {
        name: 'Public Savings Group',
        description: 'Open community savings',
        visibility: 'public',
        createdBy: admin._id,
        members: [],
      },
      {
        name: 'Admin Private Group',
        description: 'Admins only',
        visibility: 'private',
        createdBy: admin._id,
        members: [admin._id],
      },
    ]);

    console.log('✅ Groups seeded successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  }
})();
