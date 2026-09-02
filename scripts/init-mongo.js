// MongoDB initialization script for Docker
// This script runs when the MongoDB container starts for the first time

db = db.getSiblingDB('community-savings');

// Create application user
db.createUser({
  user: 'appuser',
  pwd: 'apppassword123',
  roles: [
    {
      role: 'readWrite',
      db: 'community-savings',
    },
  ],
});

// Create collections with initial indexes
db.createCollection('users');
db.createCollection('groups');
db.createCollection('contributions');
db.createCollection('loans');
db.createCollection('loanapplications');
db.createCollection('transactions');
db.createCollection('notifications');

// Create indexes for better performance
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ phone: 1 }, { unique: true });
db.users.createIndex({ role: 1 });
db.users.createIndex({ isVerified: 1 });

db.groups.createIndex({ admin: 1 });
db.groups.createIndex({ status: 1 });
db.groups.createIndex({ members: 1 });
db.groups.createIndex({ createdAt: -1 });

db.contributions.createIndex({ user: 1, group: 1 });
db.contributions.createIndex({ group: 1 });
db.contributions.createIndex({ status: 1 });
db.contributions.createIndex({ createdAt: -1 });

db.loans.createIndex({ user: 1, group: 1 });
db.loans.createIndex({ group: 1, status: 1 });
db.loans.createIndex({ status: 1 });
db.loans.createIndex({ user: 1, status: 1 });
db.loans.createIndex({ approvedBy: 1 });
db.loans.createIndex({ createdAt: -1 });

print('✅ MongoDB initialized successfully for Community Savings App');
