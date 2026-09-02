// scripts/cleanupIndexes.js
'use strict';

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/community_savings';
const ENV = process.env.NODE_ENV || 'development'; // 'production' | 'staging' | 'development'
const DRY_RUN = process.env.DRY_RUN === 'true'; // preview only

async function cleanupIndexes() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  let duplicatesFound = false;
  const report = [];

  try {
    const collections = await db.listCollections().toArray();

    for (const c of collections) {
      const name = c.name;
      const coll = db.collection(name);
      const indexes = await coll.indexes();

      console.log(`\n📂 Collection: ${name}`);
      indexes.forEach(idx => {
        console.log(`  - ${idx.name} => ${JSON.stringify(idx.key)}`);
      });

      const seen = new Map();
      for (const idx of indexes) {
        const keyStr = JSON.stringify(idx.key);
        if (seen.has(keyStr)) {
          console.warn(`⚠️ Duplicate index detected on ${name}: ${keyStr}`);
          duplicatesFound = true;
          report.push({ collection: name, duplicate: keyStr, index: idx.name });

          if (!DRY_RUN) {
            if (ENV === 'staging') {
              try {
                await coll.dropIndex(idx.name);
                console.log(`🧹 [Staging] Dropped duplicate index: ${idx.name}`);
              } catch (err) {
                console.error(`⚠️ Failed to drop index ${idx.name}:`, err.message);
              }
            } else if (ENV === 'production') {
              console.error(`🚨 Duplicate index ${idx.name} found in production. Will fail pipeline.`);
            }
          } else {
            console.log(`(Dry run) Would drop: ${idx.name}`);
          }
        } else {
          seen.set(keyStr, idx.name);
        }
      }
    }
  } catch (err) {
    console.error('Error during index cleanup:', err);
    process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }

  // Guardrail enforcement
  if (duplicatesFound && ENV === 'production') {
    console.error('🚨 Duplicate indexes found! Failing pipeline.');
    console.error('Summary:', JSON.stringify(report, null, 2));
    process.exit(1);
  } else if (!duplicatesFound) {
    console.log(`✅ No duplicate indexes detected. Safe to deploy (${ENV}).`);
  } else {
    console.log('ℹ️ Duplicate indexes handled. Summary:', JSON.stringify(report, null, 2));
  }
}

cleanupIndexes().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
