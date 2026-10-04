import mongoose from 'mongoose';
import Group from '../models/Group.js';

const APPLY = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!uri) {
  throw new Error('MONGODB_URI or MONGO_URI is required.');
}

await mongoose.connect(uri);

try {
  // Existing group semantics are preserved. This migration only introduces
  // the new agriculture capability flag; all pre-existing capabilities keep
  // their current values.
  const filter = { 'capabilities.agriculture': { $exists: false } };
  const count = await Group.countDocuments(filter);
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', groupsToBackfill: count }));

  if (APPLY && count > 0) {
    const result = await Group.updateMany(filter, {
      $set: { 'capabilities.agriculture': false },
    });
    console.log(JSON.stringify({ matched: result.matchedCount, modified: result.modifiedCount }));
  }
} finally {
  await mongoose.disconnect();
}
