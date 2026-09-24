import { BaseEntity, Address, WorkingHours, EntityStatus } from './common.model';

export interface Organization extends BaseEntity {
  name: string;
  domain: string;
  timezone: string;
  address: Address;
  phone: string;
  email: string;
  website?: string;
  logo?: string;
  settings: OrganizationSettings;
  status: EntityStatus;
  subscriptionPlan: SubscriptionPlan;
  employeeCount: number;
}

export interface OrganizationSettings {
  workingHours: WorkingHours;
  allowFlexibleHours: boolean;
  requireLocationTracking: boolean;
  autoCheckout: boolean;
  graceMinutes: number;
  weekendDays: number[];
  holidays: string[];
  leaveApprovalRequired: boolean;
  emailNotifications: boolean;
  theme: 'light' | 'dark' | 'auto';
}

export interface SubscriptionPlan {
  name: string;
  maxEmployees: number;
  features: string[];
  expiresAt: string;
  isActive: boolean;
}