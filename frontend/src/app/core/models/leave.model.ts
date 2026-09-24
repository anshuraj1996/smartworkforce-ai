import { BaseEntity, LeaveStatus, FileUpload } from './common.model';

export interface LeaveRequest extends BaseEntity {
  userId: string;
  userName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  appliedDate: string;
  approvedBy?: string;
  approvedDate?: string;
  rejectedReason?: string;
  comments?: string;
  attachments?: FileUpload[];
  priority: LeavePriority;
}

export interface LeaveBalance extends BaseEntity {
  userId: string;
  type: LeaveType;
  allocated: number;
  used: number;
  remaining: number;
  carried: number;
  expires?: string;
}

export interface LeavePolicy extends BaseEntity {
  type: LeaveType;
  name: string;
  annualAllocation: number;
  maxConsecutiveDays: number;
  minNoticeRequired: number;
  requiresApproval: boolean;
  carryOverAllowed: boolean;
  maxCarryOver: number;
  isActive: boolean;
}

export type LeaveType = 'sick' | 'vacation' | 'personal' | 'emergency' | 'maternity' | 'paternity' | 'bereavement';
export type LeavePriority = 'low' | 'medium' | 'high' | 'urgent';