// scripts/listIndexes.js
// ESM-compatible database index inspection utility.
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/yourDatabase';

async function listIndexes() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  try {
    const collections = await db.listCollections().toArray();
    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const indexes = await db.collection(collectionName).indexes();
      console.log('Collection:', collectionName);
      for (const index of indexes) {
        console.log('  name:', index.name);
        console.log('  key :', JSON.stringify(index.key));
        if (index.unique) console.log('  unique: true');
        if (index.sparse) console.log('  sparse: true');
        if (index.expireAfterSeconds !== undefined) console.log('  expireAfterSeconds:', index.expireAfterSeconds);
        console.log('  ---');
      }
      console.log('');
    }
  } finally {
    await mongoose.disconnect();
  }
}

listIndexes().catch((error) => {
  console.error('Fatal error listing indexes:', error);
  process.exitCode = 1;
});
