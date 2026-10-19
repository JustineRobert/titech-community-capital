import 'dotenv/config';
import mongoose from 'mongoose';
import SecureDocument from '../modules/secure-documents/secureDocument.model.js';
import RefugeeServingOrganisationProfile from '../modules/refugee-partners/models/RefugeeServingOrganisationProfile.js';
import InsuranceInstitutionProfile from '../modules/insurance/models/InsuranceInstitutionProfile.js';
import InsuranceProduct from '../modules/insurance/models/InsuranceProduct.js';
import InsuranceEnrolment from '../modules/insurance/models/InsuranceEnrolment.js';
import InsurancePremium from '../modules/insurance/models/InsurancePremium.js';
import InsuranceClaim from '../modules/insurance/models/InsuranceClaim.js';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Inclusive/insurance index setup blocked: configure MONGODB_URI or MONGO_URI for the intended environment.');
  process.exit(2);
}

const models = [
  SecureDocument,
  RefugeeServingOrganisationProfile,
  InsuranceInstitutionProfile,
  InsuranceProduct,
  InsuranceEnrolment,
  InsurancePremium,
  InsuranceClaim,
];

try {
  await mongoose.connect(uri);
  for (const model of models) {
    await model.createIndexes();
    console.log(`Indexes ensured: ${model.modelName}`);
  }
  console.log('Inclusive onboarding / insurance index setup completed. Review index changes in a non-production environment before production execution.');
} catch (error) {
  console.error(`Inclusive onboarding / insurance index setup failed: ${error?.name || 'Error'}; inspect the database operator logs without exposing connection credentials.`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
