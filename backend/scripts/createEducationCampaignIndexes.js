import 'dotenv/config';
import mongoose from 'mongoose';
import EducationCampaign from '../modules/education/models/EducationCampaign.js';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Education campaign index setup blocked: configure MONGODB_URI or MONGO_URI for the intended environment.');
  process.exit(2);
}

try {
  await mongoose.connect(uri);
  await EducationCampaign.createIndexes();
  console.log('Education campaign indexes ensured. Review index additions in staging and take an approved backup before production execution.');
} catch (error) {
  console.error(`Education campaign index setup failed: ${error?.name || 'Error'}; inspect protected database operator logs without exposing connection credentials.`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
