// scripts/drop-duplicate-indexes.js
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const coll = mongoose.connection.db.collection('ledgerentries');
  const indexes = await coll.indexes();
  console.log('Indexes before:', indexes);

  for (const idx of indexes) {
    // drop any index that matches the key but is not the canonical name you expect
    if (idx.key && (idx.key.momoTransactionId === 1 || idx.key.reference === 1)) {
      // choose to keep unique 'reference_1' if you want; otherwise drop duplicates
      if (idx.name !== 'reference_1' && idx.key.reference === 1) {
        console.log('Dropping index', idx.name);
        await coll.dropIndex(idx.name);
      }
      if (idx.name !== 'momoTransactionId_1' && idx.key.momoTransactionId === 1) {
        console.log('Dropping index', idx.name);
        await coll.dropIndex(idx.name);
      }
    }
  }

  const after = await coll.indexes();
  console.log('Indexes after:', after);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
