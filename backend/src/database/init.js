const { syncDatabase, Organization, User, Shift } = require('../models');

async function initializeDatabase() {
  try {
    console.log('🔄 Initializing database...');
    
    // Sync database (create tables if they don't exist)
    await syncDatabase({ alter: true });
    
    console.log('✅ Database tables synchronized');
    
    // Check if we need to create initial data
    const orgCount = await Organization.count();
    
    if (orgCount === 0) {
      console.log('🏢 Creating initial organization...');
      
      // Create default organization
      const organization = await Organization.create({
        name: 'SmartWorkforce Demo Company',
        timezone: 'Asia/Kolkata',
        settings: {
          workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          publicHolidays: [],
          leaveTypes: ['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'PATERNITY']
        },
        isActive: true
      });

      // Create default shift
      await Shift.create({
        organizationId: organization.id,
        name: 'Regular Shift',
        startTime: '09:00',
        endTime: '18:00',
        graceMinutes: 15,
        isDefault: true,
        isActive: true
      });

      // Passwords are hashed by the User model's beforeCreate hook - pass plain text here
      const today = new Date();
      const threeDaysAgo = new Date(today);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      // Give John a birthday that lands on today (different year) so the birthday feed has something to show
      const johnBirthday = new Date(1990, today.getMonth(), today.getDate());

      // Create admin user
      await User.create({
        organizationId: organization.id,
        name: 'System Administrator',
        email: 'admin@smartworkforce.ai',
        employeeId: 'ADM001',
        password: 'admin123',
        role: 'ADMIN',
        department: 'IT',
        isActive: true,
        hireDate: today
      });

      // Create sample HR user
      await User.create({
        organizationId: organization.id,
        name: 'HR Manager',
        email: 'hr@smartworkforce.ai',
        employeeId: 'HR001',
        password: 'hr123456',
        role: 'HR',
        department: 'Human Resources',
        isActive: true,
        hireDate: today
      });

      // Create sample manager
      const manager = await User.create({
        organizationId: organization.id,
        name: 'Team Manager',
        email: 'manager@smartworkforce.ai',
        employeeId: 'MGR001',
        password: 'manager123',
        role: 'MANAGER',
        department: 'Engineering',
        isActive: true,
        hireDate: today
      });

      // Create sample employees
      await User.create({
        organizationId: organization.id,
        name: 'John Doe',
        email: 'john@smartworkforce.ai',
        employeeId: 'EMP001',
        password: 'emp123',
        role: 'EMPLOYEE',
        department: 'Engineering',
        managerId: manager.id,
        isActive: true,
        hireDate: today,
        dateOfBirth: johnBirthday
      });

      await User.create({
        organizationId: organization.id,
        name: 'Jane Smith',
        email: 'jane@smartworkforce.ai',
        employeeId: 'EMP002',
        password: 'emp123',
        role: 'EMPLOYEE',
        department: 'Engineering',
        managerId: manager.id,
        isActive: true,
        hireDate: threeDaysAgo
      });

      console.log('✅ Initial data created successfully!');
      console.log('');
      console.log('📋 Login Credentials:');
      console.log('👑 Admin: admin@smartworkforce.ai / admin123');
      console.log('🏢 HR: hr@smartworkforce.ai / hr123456');
      console.log('👨‍💼 Manager: manager@smartworkforce.ai / manager123');
      console.log('👨‍💻 Employee: john@smartworkforce.ai / emp123');
      console.log('👩‍💻 Employee: jane@smartworkforce.ai / emp123');
      console.log('');
    } else {
      console.log('✅ Database already has data, skipping initialization');
    }

    console.log('🎉 Database initialization completed!');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

// Run initialization if called directly
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      console.log('Database ready for use!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Initialization failed:', error);
      process.exit(1);
    });
}

module.exports = { initializeDatabase };