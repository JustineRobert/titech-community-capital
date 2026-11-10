import 'dotenv/config';
import mongoose from 'mongoose';
import FaithGivingCampaign from '../modules/faith-community-giving/models/FaithGivingCampaign.js';
import FaithGivingPledge from '../modules/faith-community-giving/models/FaithGivingPledge.js';
import FaithGivingExpenseRequest from '../modules/faith-community-giving/models/FaithGivingExpenseRequest.js';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Faith & Community Giving index setup blocked: configure MONGODB_URI or MONGO_URI for the intended environment.');
  process.exit(2);
}

try {
  await mongoose.connect(uri);
  await Promise.all([
    FaithGivingCampaign.createIndexes(),
    FaithGivingPledge.createIndexes(),
    FaithGivingExpenseRequest.createIndexes(),
  ]);
  console.log('Faith & Community Giving indexes ensured. Review additions in staging and take an approved backup before production execution.');
} catch (error) {
  console.error(`Faith & Community Giving index setup failed: ${error?.name || 'Error'}; inspect protected database operator logs without exposing connection credentials.`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
