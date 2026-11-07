import mongoose from 'mongoose';
import EduFinanceApplication from '../modules/edufinance/models/EduFinanceApplication.js';

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  throw new Error('MONGO_URI or MONGODB_URI must be configured before creating EduFinance indexes.');
}

try {
  await mongoose.connect(uri);
  const indexes = await EduFinanceApplication.createIndexes();
  process.stdout.write(`${JSON.stringify({ status: 'PASS', collection: EduFinanceApplication.collection.name, indexes: indexes.map((index) => index.name) }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`EduFinance index creation failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => undefined);
}
