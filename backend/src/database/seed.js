const { 
  Organization, 
  User, 
  Shift, 
  AttendanceLog, 
  LeaveRequest,
  closeDatabase 
} = require('../models');

const seedData = async () => {
  try {
    console.log('🌱 Starting database seeding...');

    // Create demo organization
    const organization = await Organization.create({
      name: 'TechCorp Solutions',
      timezone: 'Asia/Kolkata',
      settings: {
        defaultShiftStart: '09:00',
        defaultShiftEnd: '17:00',
        defaultGraceMinutes: 15,
        autoCheckout: true,
        requireApproval: true
      }
    });

    console.log('✅ Created organization:', organization.name);

    // Create default shift for the organization
    const defaultShift = await Shift.create({
      organizationId: organization.id,
      name: 'Standard Shift',
      startTime: '09:00:00',
      endTime: '17:00:00',
      graceMinutes: 15,
      isDefault: true,
      workingDays: [1, 2, 3, 4, 5], // Monday to Friday
      breakMinutes: 60
    });

    console.log('✅ Created default shift:', defaultShift.name);

    // Create admin user
    const adminUser = await User.create({
      organizationId: organization.id,
      name: 'System Administrator',
      email: 'admin@techcorp.com',
      password: 'admin123456',
      role: 'ADMIN',
      employeeId: 'EMP001',
      department: 'IT',
      isActive: true
    });

    console.log('✅ Created admin user:', adminUser.email);

    // Create HR manager
    const hrManager = await User.create({
      organizationId: organization.id,
      name: 'HR Manager',
      email: 'hr@techcorp.com',
      password: 'hr123456',
      role: 'HR',
      employeeId: 'EMP002',
      department: 'Human Resources',
      isActive: true
    });

    console.log('✅ Created HR manager:', hrManager.email);

    // Create team manager
    const teamManager = await User.create({
      organizationId: organization.id,
      name: 'John Manager',
      email: 'manager@techcorp.com',
      password: 'manager123456',
      role: 'MANAGER',
      employeeId: 'EMP003',
      department: 'Engineering',
      isActive: true
    });

    console.log('✅ Created team manager:', teamManager.email);

    // Create employees
    const employees = await User.bulkCreate([
      {
        organizationId: organization.id,
        name: 'Alice Johnson',
        email: 'alice@techcorp.com',
        password: 'employee123',
        role: 'EMPLOYEE',
        managerId: teamManager.id,
        employeeId: 'EMP004',
        department: 'Engineering'
      },
      {
        organizationId: organization.id,
        name: 'Bob Smith',
        email: 'bob@techcorp.com',
        password: 'employee123',
        role: 'EMPLOYEE',
        managerId: teamManager.id,
        employeeId: 'EMP005',
        department: 'Engineering'
      },
      {
        organizationId: organization.id,
        name: 'Carol Wilson',
        email: 'carol@techcorp.com',
        password: 'employee123',
        role: 'EMPLOYEE',
        managerId: teamManager.id,
        employeeId: 'EMP006',
        department: 'Engineering'
      },
      {
        organizationId: organization.id,
        name: 'David Brown',
        email: 'david@techcorp.com',
        password: 'employee123',
        role: 'EMPLOYEE',
        managerId: hrManager.id,
        employeeId: 'EMP007',
        department: 'Marketing'
      }
    ]);

    console.log('✅ Created employees:', employees.length);

    // Create sample attendance logs for the past week
    const today = new Date();
    const attendanceLogs = [];

    for (let i = 7; i >= 1; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      
      // Skip weekends
      if (date.getDay() === 0 || date.getDay() === 6) continue;

      for (const employee of employees) {
        const checkInTime = new Date(date);
        checkInTime.setHours(9, Math.floor(Math.random() * 30), 0, 0); // 9:00-9:30 AM
        
        const checkOutTime = new Date(date);
        checkOutTime.setHours(17, Math.floor(Math.random() * 60), 0, 0); // 5:00-6:00 PM
        
        const lateMinutes = checkInTime.getHours() === 9 && checkInTime.getMinutes() > 15 
          ? checkInTime.getMinutes() - 15 
          : 0;

        attendanceLogs.push({
          organizationId: organization.id,
          userId: employee.id,
          date: date.toISOString().split('T')[0],
          checkInTime: checkInTime.toTimeString().split(' ')[0],
          checkOutTime: checkOutTime.toTimeString().split(' ')[0],
          checkInTimestamp: checkInTime,
          checkOutTimestamp: checkOutTime,
          attendanceType: lateMinutes > 0 ? 'LATE' : 'PRESENT',
          lateMinutes: lateMinutes,
          workingMinutes: Math.floor((checkOutTime - checkInTime) / (1000 * 60)),
          isInferredCheckout: false
        });
      }
    }

    await AttendanceLog.bulkCreate(attendanceLogs);
    console.log('✅ Created attendance logs:', attendanceLogs.length);

    // Create sample leave requests
    const leaveRequests = await LeaveRequest.bulkCreate([
      {
        organizationId: organization.id,
        userId: employees[0].id,
        startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Next week
        endDate: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
        leaveType: 'ANNUAL',
        reason: 'Family vacation planned for next week',
        dayCount: 3,
        status: 'PENDING'
      },
      {
        organizationId: organization.id,
        userId: employees[1].id,
        startDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // Two weeks from now
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        leaveType: 'SICK',
        reason: 'Medical appointment scheduled',
        dayCount: 1,
        status: 'APPROVED',
        approvedBy: teamManager.id,
        approvedAt: new Date()
      }
    ]);

    console.log('✅ Created leave requests:', leaveRequests.length);

    console.log('\n🎉 Database seeding completed successfully!');
    console.log('\n📋 Demo accounts created:');
    console.log('┌─────────────────┬─────────────────────┬─────────────┐');
    console.log('│ Role            │ Email               │ Password    │');
    console.log('├─────────────────┼─────────────────────┼─────────────┤');
    console.log('│ Admin           │ admin@techcorp.com  │ admin123456 │');
    console.log('│ HR Manager      │ hr@techcorp.com     │ hr123456    │');
    console.log('│ Team Manager    │ manager@techcorp.com│ manager123456│');
    console.log('│ Employee        │ alice@techcorp.com  │ employee123 │');
    console.log('│ Employee        │ bob@techcorp.com    │ employee123 │');
    console.log('│ Employee        │ carol@techcorp.com  │ employee123 │');
    console.log('│ Employee        │ david@techcorp.com  │ employee123 │');
    console.log('└─────────────────┴─────────────────────┴─────────────┘');
    console.log('\n🚀 You can now start the server with: npm run dev');

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await closeDatabase();
    process.exit(0);
  }
};

// Run seeding if this file is executed directly
if (require.main === module) {
  seedData();
}

module.exports = seedData;