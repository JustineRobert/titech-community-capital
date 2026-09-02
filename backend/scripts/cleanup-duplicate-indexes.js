// scripts/cleanup-duplicate-indexes.js
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Aborting.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const collections = ['ledgerentries', 'transactions']; // adjust if your collection names differ

  for (const name of collections) {
    const coll = mongoose.connection.db.collection(name);
    try {
      const indexes = await coll.indexes();
      console.log(`Indexes for ${name}:`, indexes.map((i) => ({ name: i.name, key: i.key })));

      for (const idx of indexes) {
        if (idx.key && idx.key.reference === 1) {
          // keep canonical 'reference_1' or the unique index name if present
          if (idx.name !== 'reference_1') {
            console.log(`Dropping duplicate index ${idx.name} from ${name}`);
            await coll.dropIndex(idx.name);
          }
        }
      }
      const after = await coll.indexes();
      console.log(`Indexes after cleanup for ${name}:`, after.map((i) => ({ name: i.name, key: i.key })));
    } catch (err) {
      console.error(`Error processing collection ${name}:`, err.message);
    }
  }

  await mongoose.disconnect();
  console.log('Done');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
