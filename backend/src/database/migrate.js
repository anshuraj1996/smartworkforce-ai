const { syncDatabase, closeDatabase } = require('../models');

const migrate = async () => {
  try {
    console.log('Starting database migration...');
    
    // Get command line arguments
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const alter = args.includes('--alter');
    
    if (force) {
      console.log('⚠️  WARNING: This will drop and recreate all tables!');
      console.log('All existing data will be lost.');
    }
    
    const options = { force, alter };
    
    await syncDatabase(options);
    
    console.log('✅ Database migration completed successfully!');
    
    if (force) {
      console.log('\n📋 Next steps:');
      console.log('1. Run: npm run seed (to create initial data)');
      console.log('2. Start the server: npm run dev');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await closeDatabase();
    process.exit(0);
  }
};

// Run migration if this file is executed directly
if (require.main === module) {
  migrate();
}

module.exports = migrate;