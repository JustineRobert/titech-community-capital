const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Migration = require('../models/Migration');

async function run() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory present');
    return;
  }
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const applied = await Migration.findOne({ name: file });
    if (applied) continue;
    const m = require(path.join(migrationsDir, file));
    if (typeof m.up === 'function') {
      await m.up({ mongoose });
      await Migration.create({ name: file, appliedAt: new Date() });
    }
  }
  console.log('Migrations complete');
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
