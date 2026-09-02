// Sample migration — demonstrates up/down pattern
module.exports = {
  up: async function ({ mongoose }) {
    // Add indexes or schema updates here
    console.log('Migration: sample migration up');
  },
  down: async function ({ mongoose }) {
    // Rollback logic
    console.log('Migration: sample migration down');
  },
};
