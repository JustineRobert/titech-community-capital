import 'dotenv/config';
import mongoose from 'mongoose';
import UbuntuFloatAgentProfile from '../modules/ubuntu-float/models/UbuntuFloatAgentProfile.js';
import UbuntuFloatPositionObservation from '../modules/ubuntu-float/models/UbuntuFloatPositionObservation.js';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('UbuntuFloat index setup blocked: configure MONGODB_URI or MONGO_URI for the intended environment.');
  process.exit(2);
}

try {
  await mongoose.connect(uri);
  for (const model of [UbuntuFloatAgentProfile, UbuntuFloatPositionObservation]) {
    await model.createIndexes();
    console.log(`Indexes ensured: ${model.modelName}`);
  }
  console.log('UbuntuFloat index setup completed. Verify the index plan in a non-production environment and take an approved backup before production execution.');
} catch (error) {
  console.error(`UbuntuFloat index setup failed: ${error?.name || 'Error'}; inspect protected database operator logs without exposing connection credentials.`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
