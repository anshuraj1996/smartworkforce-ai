import { BaseEntity, Address, EmergencyContact, UserRole, EntityStatus, WorkingHours } from './common.model';

export interface User extends BaseEntity {
  name: string;
  email: string;
  role: UserRole;
  department: string;
  designation: string;
  employeeId: string;
  phone?: string;
  avatar?: string;
  dateOfBirth?: string;
  dateOfJoining: string;
  address?: Address;
  emergencyContact?: EmergencyContact;
  managerId?: string;
  manager?: Manager;
  skills?: string[];
  certifications?: Certification[];
  preferences?: UserPreferences;
  status: EntityStatus;
  lastLoginAt?: string;
  isEmailVerified: boolean;
  isTwoFactorEnabled: boolean;
}

export interface Manager {
  id: string;
  name: string;
  email: string;
  department: string;
  designation: string;
}

export interface Certification {
  id: string;
  name: string;
  provider: string;
  dateObtained: string;
  expiryDate?: string;
  certificateUrl?: string;
  verified: boolean;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  language: string;
  timezone: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  workingHours: WorkingHours;
  dashboardLayout: string[];
  dateFormat: string;
  timeFormat: '12h' | '24h';
}

export interface UserStats {
  totalWorkingDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  averageWorkingHours: number;
  attendanceRate: number;
  totalLeavesTaken: number;
  pendingLeaves: number;
  yearsOfService: number;
}

export interface CreateUserRequest {
  name: string;
  email: string;
  role: UserRole;
  department: string;
  designation: string;
  employeeId: string;
  phone?: string;
  dateOfBirth?: string;
  dateOfJoining: string;
  managerId?: string;
  address?: Partial<Address>;
  emergencyContact?: Partial<EmergencyContact>;
  skills?: string[];
}

export interface UpdateUserRequest {
  name?: string;
  phone?: string;
  department?: string;
  designation?: string;
  managerId?: string;
  address?: Partial<Address>;
  emergencyContact?: Partial<EmergencyContact>;
  skills?: string[];
  preferences?: Partial<UserPreferences>;
  status?: EntityStatus;
}

export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface UserActivity {
  id: string;
  action: string;
  description: string;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}