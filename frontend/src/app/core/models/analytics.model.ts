import { ChartData, Statistics, TimeSeriesData } from './common.model';

export interface AnalyticsData {
  attendanceAnalytics: AttendanceAnalytics;
  leaveAnalytics: LeaveAnalytics;
  performanceMetrics: PerformanceMetrics;
  trends: TrendAnalysis;
}

export interface AttendanceAnalytics {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  attendanceRate: Statistics;
  averageWorkingHours: Statistics;
  lateArrivalTrend: TimeSeriesData[];
  monthlyAttendance: ChartData;
  departmentWiseAttendance: ChartData;
}

export interface LeaveAnalytics {
  pendingRequests: number;
  approvedThisMonth: number;
  totalLeaveTaken: number;
  leaveUtilizationRate: number;
  leaveTypeDistribution: ChartData;
  monthlyLeavePattern: ChartData;
  departmentWiseLeave: ChartData;
}

export interface PerformanceMetrics {
  productivityScore: number;
  engagementLevel: number;
  satisfactionIndex: number;
  turnoverRate: number;
  averageWorkingDays: number;
  overtimeHours: number;
}

export interface TrendAnalysis {
  attendanceTrend: 'improving' | 'declining' | 'stable';
  leaveTrend: 'increasing' | 'decreasing' | 'stable';
  performanceTrend: 'up' | 'down' | 'steady';
  predictions: Prediction[];
}

export interface Prediction {
  metric: string;
  predictedValue: number;
  confidence: number;
  timeframe: string;
}