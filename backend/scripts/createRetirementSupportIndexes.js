import 'dotenv/config';
import mongoose from 'mongoose';
import RetirementSupportCase from '../modules/retirement/models/RetirementSupportCase.js';
import RetirementContributionRecord from '../modules/retirement/models/RetirementContributionRecord.js';
import RetirementFinancialSupportApplication from '../modules/retirement/models/RetirementFinancialSupportApplication.js';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Retirement-support index setup blocked: configure MONGODB_URI or MONGO_URI for the intended environment.');
  process.exit(2);
}

try {
  await mongoose.connect(uri);
  for (const model of [RetirementSupportCase, RetirementContributionRecord, RetirementFinancialSupportApplication]) {
    await model.createIndexes();
    console.log(`Retirement-support indexes ensured: ${model.modelName}`);
  }
  console.log('Retirement-support index setup completed. Review index additions in staging and take an approved backup before any production schema operation.');
} catch (error) {
  console.error(`Retirement-support index setup failed: ${error?.name || 'Error'}; inspect protected database operator logs without exposing connection credentials.`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
