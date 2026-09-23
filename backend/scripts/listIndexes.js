// scripts/listIndexes.js
'use strict';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/yourDatabase';
const CONNECT_OPTS = { useNewUrlParser: true, useUnifiedTopology: true };

async function listIndexes() {
  await mongoose.connect(MONGO_URI, CONNECT_OPTS);
  const db = mongoose.connection.db;

  try {
    const collections = await db.listCollections().toArray();
    for (const c of collections) {
      const name = c.name;
      const indexes = await db.collection(name).indexes();
      console.log('Collection:', name);
      indexes.forEach(idx => {
        console.log('  name:', idx.name);
        console.log('  key :', JSON.stringify(idx.key));
        if (idx.unique) console.log('  unique: true');
        if (idx.sparse) console.log('  sparse: true');
        if (idx.expireAfterSeconds !== undefined) console.log('  expireAfterSeconds:', idx.expireAfterSeconds);
        console.log('  ---');
      });
      console.log('');
    }
  } catch (err) {
    console.error('Error listing indexes:', err);
  } finally {
    await mongoose.disconnect();
  }
}

listIndexes().catch(err => {
  console.error(err);
  process.exit(1);
});
