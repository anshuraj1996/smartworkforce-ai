import { BaseEntity, AttendanceStatus, LocationData, Statistics } from './common.model';

export interface AttendanceRecord extends BaseEntity {
  userId: string;
  date: string;
  checkInTime?: string;
  checkOutTime?: string;
  status: AttendanceStatus;
  workingHours: number;
  isLate: boolean;
  lateMinutes?: number;
  location?: LocationData;
  notes?: string;
  isInferredCheckout: boolean;
  shiftId?: string;
}

export interface AttendanceStats {
  todayStatus: AttendanceStatus;
  totalWorkingDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  averageWorkingHours: number;
  attendanceRate: number;
  monthlyStats: MonthlyAttendanceStats[];
  weeklyTrend: Statistics;
}

export interface MonthlyAttendanceStats {
  month: string;
  year: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  totalHours: number;
  attendanceRate: number;
}

export interface CheckInRequest {
  location: LocationData;
  notes?: string;
  timestamp: string;
}

export interface CheckOutRequest {
  notes?: string;
  timestamp: string;
}

export interface Shift extends BaseEntity {
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  isFlexible: boolean;
  workingDays: number[];
  timezone: string;
  isDefault: boolean;
}