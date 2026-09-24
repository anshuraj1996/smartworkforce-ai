const jwt = require('jsonwebtoken');
const { User, Organization, AuditLog } = require('../models');

class AuthService {
  // User login
  static async login(email, password, metadata = {}) {
    try {
      const user = await User.findOne({
        where: { email: email.toLowerCase(), isActive: true }
      });

      if (!user) {
        throw new Error('Invalid credentials');
      }

      const organization = await Organization.findOne({
        where: { id: user.organizationId, isActive: true }
      });

      if (!organization) {
        throw new Error('Organization not found');
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        throw new Error('Invalid credentials');
      }

      await user.update({ lastLogin: new Date() });

      const token = this.generateToken(user.id, user.organizationId, user.role);

      return {
        success: true,
        user: { ...user.toJSON(), organization },
        token,
        organization
      };

    } catch (error) {
      console.error('Login error:', error);
      throw new Error(error.message || 'Login failed');
    }
  }

  // User logout
  static async logout(userId, organizationId, metadata = {}) {
    try {
      return { message: 'Logged out successfully' };
    } catch (error) {
      console.error('Logout error:', error);
      throw new Error('Logout failed');
    }
  }

  // Register new organization and admin user
  static async register(registrationData) {
    try {
      const { organizationName, name, email, password, timezone = 'Asia/Kolkata' } = registrationData;

      const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      const organization = await Organization.create({
        name: organizationName,
        timezone,
        isActive: true
      });

      const user = await User.create({
        organizationId: organization.id,
        name,
        email: email.toLowerCase(),
        password,
        role: 'ADMIN',
        employeeId: 'ADMIN001',
        department: 'Administration',
        isActive: true
      });

      const token = this.generateToken(user.id, organization.id, user.role);

      return {
        success: true,
        user: user.toJSON(),
        organization,
        token
      };

    } catch (error) {
      console.error('Registration error:', error);
      throw new Error(error.message || 'Registration failed');
    }
  }

  // Change password
  static async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const isCurrentValid = await user.comparePassword(currentPassword);
      if (!isCurrentValid) {
        throw new Error('Current password is incorrect');
      }

      await user.update({ password: newPassword });

      await AuditLog.create({
        organizationId: user.organizationId,
        actorId: userId,
        action: 'PASSWORD_CHANGE',
        entityType: 'USER',
        entityId: userId,
        description: 'Password changed by user',
        timestamp: new Date().toISOString(),
        source: 'WEB',
        severity: 'INFO'
      });

      return {
        success: true,
        message: 'Password changed successfully'
      };

    } catch (error) {
      console.error('Change password error:', error);
      throw new Error(error.message || 'Password change failed');
    }
  }

  // Verify token and get user
  static async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

      const user = await User.findOne({ where: { id: decoded.userId, isActive: true } });
      if (!user) {
        throw new Error('Invalid or inactive user');
      }

      const organization = await Organization.findOne({ where: { id: user.organizationId, isActive: true } });
      if (!organization) {
        throw new Error('Invalid or inactive organization');
      }

      return {
        ...user.toJSON(),
        organization
      };

    } catch (error) {
      throw new Error('Token verification failed');
    }
  }

  // Reset password request
  static async requestPasswordReset(email) {
    try {
      const user = await User.findOne({ where: { email: email.toLowerCase(), isActive: true } });

      if (!user) {
        // Don't reveal if user exists
        return { message: 'If the email exists, a reset link has been sent' };
      }

      await AuditLog.create({
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'PASSWORD_CHANGE',
        entityType: 'USER',
        entityId: user.id,
        description: 'Password reset requested',
        timestamp: new Date().toISOString(),
        source: 'WEB',
        severity: 'INFO'
      });

      return { message: 'If the email exists, a reset link has been sent' };

    } catch (error) {
      console.error('Password reset request error:', error);
      throw new Error('Password reset request failed');
    }
  }

  // Get user profile
  static async getUserProfile(userId) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const organization = await Organization.findByPk(user.organizationId);

      let manager = null;
      if (user.managerId) {
        const managerUser = await User.findByPk(user.managerId);
        if (managerUser) {
          manager = {
            id: managerUser.id,
            name: managerUser.name,
            email: managerUser.email,
            role: managerUser.role
          };
        }
      }

      return {
        ...user.toJSON(),
        organization,
        manager
      };

    } catch (error) {
      console.error('Get user profile error:', error);
      throw new Error('Failed to get user profile');
    }
  }

  // Update user profile
  static async updateUserProfile(userId, updateData, updatedBy) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const previousData = {
        name: user.name,
        department: user.department,
        managerId: user.managerId
      };

      const updatedUser = await user.update(updateData);

      await AuditLog.create({
        organizationId: user.organizationId,
        actorId: updatedBy,
        action: 'UPDATE',
        entityType: 'USER',
        entityId: userId,
        previousValues: previousData,
        newValues: updateData,
        description: 'User profile updated',
        timestamp: new Date().toISOString(),
        source: 'WEB',
        severity: 'INFO'
      });

      return updatedUser;

    } catch (error) {
      console.error('Update user profile error:', error);
      throw new Error(error.message || 'Failed to update user profile');
    }
  }

  // Refresh token
  static async refreshToken(userId) {
    try {
      const user = await User.findOne({ where: { id: userId, isActive: true } });
      if (!user) {
        throw new Error('User not found or inactive');
      }

      return this.generateToken(user.id, user.organizationId, user.role);

    } catch (error) {
      console.error('Refresh token error:', error);
      throw new Error('Token refresh failed');
    }
  }

  // Generate token helper
  static generateToken(userId, organizationId, role) {
    return jwt.sign(
      { userId, organizationId, role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
    );
  }
}

module.exports = AuthService;
