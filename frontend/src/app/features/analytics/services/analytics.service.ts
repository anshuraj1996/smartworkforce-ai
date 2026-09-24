import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError, interval } from 'rxjs';
import { map, catchError, tap, switchMap } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

// ============================================================================
// Data Models
// ============================================================================

export enum UserRole {
  EMPLOYEE = 'EMPLOYEE',
  MANAGER = 'MANAGER',
  HR = 'HR',
  ADMIN = 'ADMIN'
}

export enum InsightType {
  LATE_ARRIVAL_PATTERN = 'late_arrival_pattern',
  BEHAVIOR_PATTERN = 'behavior_pattern',
  ANOMALY_DETECTION = 'anomaly_detection',
  PERFORMANCE_INSIGHT = 'performance_insight',
  TEAM_INSIGHT = 'team_insight'
}

export enum Severity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

export enum TrendDirection {
  UP = 'up',
  DOWN = 'down',
  STABLE = 'stable',
  IMPROVING = 'improving',
  DECLINING = 'declining'
}

// KPI Card Interface
export interface KPICard {
  title: string;
  value: number | string;
  trend: TrendDirection;
  trendPercentage: number;
  icon: string;
  color: 'success' | 'warning' | 'danger' | 'info' | 'primary';
  comparison: string;
  description?: string;
}

// Dashboard Data Interface
export interface DashboardData {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  pendingLeaves: number;
  attendanceRate: number;
  systemHealth?: number;
  avgWorkingHours?: number;
  productivityScore?: number;
}

// AI Insight Interface
export interface AIInsight {
  id: string;
  userId?: string;
  userName?: string;
  insightType: InsightType;
  score: number;
  title?: string;
  explanation: string;
  severity: Severity;
  actionable: boolean;
  recommendations?: string[];
  affectedUsers?: string[];
  trend: TrendDirection;
  metadata: {
    [key: string]: any;
  };
  generatedAt: Date;
}

// Attendance Trend Interface
export interface AttendanceTrend {
  date: string;
  present: number;
  late: number;
  absent: number;
}

export interface AttendanceAnalytics {
  trends: AttendanceTrend[];
  departmentBreakdown: {
    [department: string]: {
      attendance: number;
      avgHours: number;
    };
  };
  latePatterns?: {
    date: string;
    count: number;
    avgLateMinutes: number;
  }[];
}

// Leave Analytics Interface
export interface LeaveAnalytics {
  totalLeavesTaken: number;
  leaveUtilizationRate: number;
  averageLeavePerEmployee: number;
  typeDistribution: {
    [leaveType: string]: number;
  };
  monthlyPattern: {
    month: string;
    leaves: number;
  }[];
}

// Performance Metrics Interface
export interface PerformanceMetrics {
  productivityScore: number;
  engagementLevel: number;
  averageWorkingHours: number;
  overtimeHours: number;
  taskCompletionRate: number;
  performanceTrend: TrendDirection;
  benchmarkComparison?: {
    industry: number;
    organization: number;
  };
}

// Anomaly Interface
export interface Anomaly {
  userId: string;
  userName: string;
  type: string;
  severity: Severity;
  value: number;
  expectedRange: [number, number];
  date: string;
  explanation: string;
}

export interface AnomalyData {
  anomalies: Anomaly[];
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
}

// Department Comparison Interface
export interface DepartmentComparison {
  department: string;
  attendance: number;
  performance: number;
  productivity: number;
  employeeCount: number;
}

// Team Analytics Interface
export interface TeamAnalytics {
  teamSize: number;
  activeToday: number;
  teamAttendance: number;
  teamProductivity: number;
  directReports: number;
  pendingApprovals: number;
  teamInsights: {
    type: string;
    message: string;
    trend: 'positive' | 'negative' | 'neutral';
  }[];
}

// System Health Interface (Admin Only)
export interface SystemHealth {
  systemUptime: string;
  responseTime: number;
  activeUsers: number;
  databaseConnections: number;
  memoryUsage: number;
  cpuUsage: number;
  apiCallsToday: number;
  errorRate: number;
  overallStatus: 'healthy' | 'warning' | 'critical';
  apiUptime: number;
  databaseHealth: number;
}

// Filter Interfaces
export interface AnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  period?: '7d' | '30d' | '90d' | '1y';
  department?: string[];
  role?: UserRole[];
  userId?: string;
  insightType?: InsightType[];
  minScore?: number;
  maxScore?: number;
  severity?: Severity[];
}

export interface ExportFilters extends AnalyticsFilters {
  includeAIInsights?: boolean;
  includeCharts?: boolean;
}

export type ExportFormat = 'pdf' | 'excel' | 'csv' | 'png';

// Real-Time Update Interface
export interface RealTimeUpdate {
  type: 'attendance_update' | 'insight_generated' | 'anomaly_detected' | 'metric_update';
  data: any;
  timestamp: Date;
}

// Chart Data Interface
export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string;
    fill?: boolean;
  }[];
}

// ============================================================================
// Analytics Service
// ============================================================================

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  private readonly API_URL = `${environment.apiUrl}/api/v1/analytics`;

  // State Management
  private dashboardDataSubject = new BehaviorSubject<DashboardData | null>(null);
  public dashboardData$ = this.dashboardDataSubject.asObservable();

  private aiInsightsSubject = new BehaviorSubject<AIInsight[]>([]);
  public aiInsights$ = this.aiInsightsSubject.asObservable();

  private realTimeUpdatesSubject = new BehaviorSubject<RealTimeUpdate | null>(null);
  public realTimeUpdates$ = this.realTimeUpdatesSubject.asObservable();

  // Auto-refresh interval (30 seconds)
  private autoRefreshInterval = 30000;

  constructor(private http: HttpClient) {}

  // ============================================================================
  // Dashboard Data
  // ============================================================================

  /**
   * Get dashboard overview data (role-based)
   */
  getDashboardData(): Observable<DashboardData> {
    return this.http.get<{ success: boolean; data: DashboardData }>(`${this.API_URL}/dashboard`)
      .pipe(
        map(response => response.data),
        tap(data => this.dashboardDataSubject.next(data)),
        catchError(this.handleError)
      );
  }

  /**
   * Get dashboard data with auto-refresh
   */
  getDashboardDataWithRefresh(): Observable<DashboardData> {
    return interval(this.autoRefreshInterval)
      .pipe(
        switchMap(() => this.getDashboardData())
      );
  }

  // ============================================================================
  // AI Insights
  // ============================================================================

  /**
   * Get AI insights for current user
   */
  getMyAIInsights(filters?: AnalyticsFilters): Observable<AIInsight[]> {
    const params = this.buildQueryParams(filters);
    return this.http.get<{ success: boolean; data: AIInsight[] }>(
      `${this.API_URL}/ai-insights/me`,
      { params }
    ).pipe(
      map(response => response.data),
      tap(insights => this.aiInsightsSubject.next(insights)),
      catchError(this.handleError)
    );
  }

  /**
   * Get team AI insights (Manager/HR/Admin)
   */
  getTeamAIInsights(filters?: AnalyticsFilters): Observable<AIInsight[]> {
    const params = this.buildQueryParams(filters);
    return this.http.get<{ success: boolean; data: AIInsight[] }>(
      `${this.API_URL}/ai-insights/team`,
      { params }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get organization-wide AI insights (Admin/HR)
   */
  getOrganizationAIInsights(filters?: AnalyticsFilters): Observable<AIInsight[]> {
    const params = this.buildQueryParams(filters);
    return this.http.get<{ success: boolean; data: AIInsight[] }>(
      `${this.API_URL}/ai-insights/organization`,
      { params }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  // ============================================================================
  // Attendance Analytics
  // ============================================================================

  /**
   * Get attendance trends
   */
  getAttendanceTrends(filters?: AnalyticsFilters): Observable<AttendanceAnalytics> {
    const params = this.buildQueryParams(filters);
    return this.http.get<{ success: boolean; data: AttendanceAnalytics }>(
      `${this.API_URL}/attendance/trends`,
      { params }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get department-wise attendance
   */
  getDepartmentAttendance(): Observable<any> {
    return this.http.get<{ success: boolean; data: any }>(
      `${this.API_URL}/attendance/departments`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get late arrival patterns
   */
  getLatePatterns(period: string = '90d'): Observable<any> {
    return this.http.get<{ success: boolean; data: any }>(
      `${this.API_URL}/attendance/late-patterns`,
      { params: { period } }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get user attendance history
   */
  getUserAttendanceHistory(userId: string, filters?: AnalyticsFilters): Observable<any> {
    const params = this.buildQueryParams(filters);
    return this.http.get<{ success: boolean; data: any }>(
      `${this.API_URL}/attendance/user/${userId}`,
      { params }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  // ============================================================================
  // Leave Analytics
  // ============================================================================

  /**
   * Get leave statistics
   */
  getLeaveStatistics(period: string = '1y'): Observable<LeaveAnalytics> {
    return this.http.get<{ success: boolean; data: LeaveAnalytics }>(
      `${this.API_URL}/leave/statistics`,
      { params: { period } }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get leave type distribution
   */
  getLeaveTypeDistribution(): Observable<any> {
    return this.http.get<{ success: boolean; data: any }>(
      `${this.API_URL}/leave/types-distribution`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get department-wise leave utilization
   */
  getDepartmentLeave(): Observable<any> {
    return this.http.get<{ success: boolean; data: any }>(
      `${this.API_URL}/leave/departments`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  // ============================================================================
  // Performance Metrics
  // ============================================================================

  /**
   * Get overall performance metrics
   */
  getPerformanceOverview(): Observable<PerformanceMetrics> {
    return this.http.get<{ success: boolean; data: PerformanceMetrics }>(
      `${this.API_URL}/performance/overview`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get team performance (Manager/HR/Admin)
   */
  getTeamPerformance(teamId: string): Observable<any> {
    return this.http.get<{ success: boolean; data: any }>(
      `${this.API_URL}/performance/team/${teamId}`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get user performance tracking
   */
  getUserPerformance(userId: string): Observable<any> {
    return this.http.get<{ success: boolean; data: any }>(
      `${this.API_URL}/performance/user/${userId}`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  // ============================================================================
  // Anomaly Detection
  // ============================================================================

  /**
   * Get anomalies for user/team
   */
  getAnomalies(filters?: AnalyticsFilters): Observable<AnomalyData> {
    const params = this.buildQueryParams(filters);
    return this.http.get<{ success: boolean; data: AnomalyData }>(
      `${this.API_URL}/anomalies`,
      { params }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get organization-wide anomalies (Admin/HR)
   */
  getOrganizationAnomalies(severity?: Severity): Observable<AnomalyData> {
    let params: any = {};
    if (severity) {
      params.severity = severity;
    }
    return this.http.get<{ success: boolean; data: AnomalyData }>(
      `${this.API_URL}/anomalies/organization`,
      { params }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  // ============================================================================
  // Team and Department Analytics
  // ============================================================================

  /**
   * Get team overview (Manager+)
   */
  getTeamOverview(teamId: string): Observable<TeamAnalytics> {
    return this.http.get<{ success: boolean; data: TeamAnalytics }>(
      `${this.API_URL}/team/${teamId}/overview`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get department comparison
   */
  getDepartmentComparison(metrics?: string[]): Observable<DepartmentComparison[]> {
    let params: any = {};
    if (metrics && metrics.length > 0) {
      params.metrics = metrics.join(',');
    }
    return this.http.get<{ success: boolean; data: DepartmentComparison[] }>(
      `${this.API_URL}/departments/comparison`,
      { params }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get manager dashboard data
   */
  getManagerDashboard(): Observable<TeamAnalytics> {
    return this.http.get<{ success: boolean; data: TeamAnalytics }>(
      `${this.API_URL}/manager/dashboard`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  // ============================================================================
  // System Health (Admin Only)
  // ============================================================================

  /**
   * Get system health metrics
   */
  getSystemHealth(): Observable<SystemHealth> {
    return this.http.get<{ success: boolean; data: SystemHealth }>(
      `${this.API_URL}/system/health`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get API usage statistics
   */
  getAPIUsage(period: string = '7d'): Observable<any> {
    return this.http.get<{ success: boolean; data: any }>(
      `${this.API_URL}/system/api-usage`,
      { params: { period } }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  // ============================================================================
  // Export and Reports
  // ============================================================================

  /**
   * Export analytics data
   */
  exportReport(format: ExportFormat, type: string, filters?: ExportFilters): Observable<Blob> {
    const body = {
      format,
      type,
      filters
    };

    return this.http.post(`${this.API_URL}/export`, body, {
      responseType: 'blob'
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Download report by ID
   */
  downloadReport(reportId: string): Observable<Blob> {
    return this.http.get(`${this.API_URL}/export/${reportId}`, {
      responseType: 'blob'
    }).pipe(
      catchError(this.handleError)
    );
  }

  // ============================================================================
  // Real-Time Updates
  // ============================================================================

  /**
   * Get live dashboard metrics
   */
  getLiveDashboard(): Observable<DashboardData> {
    return this.http.get<{ success: boolean; data: DashboardData }>(
      `${this.API_URL}/live/dashboard`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get current online users
   */
  getOnlineUsers(): Observable<number> {
    return this.http.get<{ success: boolean; data: { count: number } }>(
      `${this.API_URL}/live/online-users`
    ).pipe(
      map(response => response.data.count),
      catchError(this.handleError)
    );
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Build query parameters from filters
   */
  private buildQueryParams(filters?: AnalyticsFilters): HttpParams {
    let params = new HttpParams();

    if (!filters) return params;

    if (filters.startDate) {
      params = params.set('startDate', filters.startDate.toISOString());
    }
    if (filters.endDate) {
      params = params.set('endDate', filters.endDate.toISOString());
    }
    if (filters.period) {
      params = params.set('period', filters.period);
    }
    if (filters.department && filters.department.length > 0) {
      params = params.set('department', filters.department.join(','));
    }
    if (filters.role && filters.role.length > 0) {
      params = params.set('role', filters.role.join(','));
    }
    if (filters.userId) {
      params = params.set('userId', filters.userId);
    }
    if (filters.insightType && filters.insightType.length > 0) {
      params = params.set('insightType', filters.insightType.join(','));
    }
    if (filters.minScore !== undefined) {
      params = params.set('minScore', filters.minScore.toString());
    }
    if (filters.maxScore !== undefined) {
      params = params.set('maxScore', filters.maxScore.toString());
    }
    if (filters.severity && filters.severity.length > 0) {
      params = params.set('severity', filters.severity.join(','));
    }

    return params;
  }

  /**
   * Generate KPI cards from dashboard data
   */
  generateKPICards(data: DashboardData, role: UserRole): KPICard[] {
    const baseKPIs: KPICard[] = [
      {
        title: 'Present Today',
        value: data.presentToday,
        trend: TrendDirection.UP,
        trendPercentage: 2.1,
        icon: 'check_circle',
        color: 'success',
        comparison: 'vs yesterday',
        description: 'Employees present today'
      },
      {
        title: 'Attendance Rate',
        value: `${data.attendanceRate.toFixed(1)}%`,
        trend: TrendDirection.UP,
        trendPercentage: 1.5,
        icon: 'trending_up',
        color: 'primary',
        comparison: 'vs last month',
        description: 'Overall attendance rate'
      },
      {
        title: 'Late Arrivals',
        value: data.lateToday,
        trend: TrendDirection.DOWN,
        trendPercentage: -12.5,
        icon: 'schedule',
        color: 'warning',
        comparison: 'vs yesterday',
        description: 'Late arrivals today'
      },
      {
        title: 'Pending Leaves',
        value: data.pendingLeaves,
        trend: TrendDirection.DOWN,
        trendPercentage: -8.3,
        icon: 'pending_actions',
        color: 'info',
        comparison: 'pending approval',
        description: 'Leave requests pending'
      }
    ];

    // Add role-specific KPIs
    if (role === UserRole.ADMIN) {
      baseKPIs.unshift({
        title: 'Total Employees',
        value: data.totalEmployees,
        trend: TrendDirection.UP,
        trendPercentage: 3.2,
        icon: 'groups',
        color: 'primary',
        comparison: 'vs last month',
        description: 'Total organization size'
      });
    }

    if (data.systemHealth && (role === UserRole.ADMIN || role === UserRole.HR)) {
      baseKPIs.push({
        title: 'System Health',
        value: `${data.systemHealth.toFixed(1)}%`,
        trend: TrendDirection.STABLE,
        trendPercentage: 0,
        icon: 'health_and_safety',
        color: 'success',
        comparison: 'uptime',
        description: 'System health status'
      });
    }

    return baseKPIs;
  }

  /**
   * Get severity color
   */
  getSeverityColor(severity: Severity): string {
    const colors: { [key in Severity]: string } = {
      [Severity.LOW]: 'green',
      [Severity.MEDIUM]: 'orange',
      [Severity.HIGH]: 'red'
    };
    return colors[severity];
  }

  /**
   * Get trend icon
   */
  getTrendIcon(trend: TrendDirection): string {
    const icons: { [key in TrendDirection]: string } = {
      [TrendDirection.UP]: 'trending_up',
      [TrendDirection.DOWN]: 'trending_down',
      [TrendDirection.STABLE]: 'trending_flat',
      [TrendDirection.IMPROVING]: 'north_east',
      [TrendDirection.DECLINING]: 'south_east'
    };
    return icons[trend];
  }

  /**
   * Format date for display
   */
  formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  }

  /**
   * Format time ago
   */
  formatTimeAgo(date: Date | string): string {
    const now = new Date();
    const past = new Date(date);
    const diffMs = now.getTime() - past.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return this.formatDate(date);
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  private handleError(error: any): Observable<never> {
    console.error('Analytics Service Error:', error);
    let errorMessage = 'An error occurred while fetching analytics data.';
    
    if (error.error?.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return throwError(() => new Error(errorMessage));
  }
}
