// scripts/checkIndexes.js
'use strict';

const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/community_savings';
const ENV = process.env.NODE_ENV || 'development'; // 'production' | 'staging' | 'development'

async function checkIndexes() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  let duplicatesFound = false;

  try {
    const collections = await db.listCollections().toArray();

    for (const c of collections) {
      const coll = db.collection(c.name);
      const indexes = await coll.indexes();

      const seen = new Map();
      for (const idx of indexes) {
        const keyStr = JSON.stringify(idx.key);
        if (seen.has(keyStr)) {
          console.error(`❌ Duplicate index detected in ${c.name}: ${keyStr} (indexes: ${seen.get(keyStr)}, ${idx.name})`);
          duplicatesFound = true;

          if (ENV === 'staging') {
            try {
              await coll.dropIndex(idx.name);
              console.log(`🧹 [Staging] Dropped duplicate index: ${idx.name}`);
            } catch (err) {
              console.error(`⚠️ Failed to drop index ${idx.name}:`, err.message);
            }
          }
        } else {
          seen.set(keyStr, idx.name);
        }
      }
    }
  } catch (err) {
    console.error('Error during index check:', err);
    process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }

  if (duplicatesFound && ENV === 'production') {
    console.error('🚨 Duplicate indexes found! Failing pipeline.');
    process.exit(1);
  } else if (!duplicatesFound) {
    console.log(`✅ No duplicate indexes detected. Safe to deploy (${ENV}).`);
  }
}

checkIndexes().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
