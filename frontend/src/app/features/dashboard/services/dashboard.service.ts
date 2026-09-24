import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface DashboardStats {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  pendingLeaves: number;
  attendanceRate: number;
  averageWorkingHours: number;
}

export interface ActivityItem {
  id: string;
  icon: string;
  title: string;
  description: string;
  time: string;
  type: 'info' | 'success' | 'warning' | 'error';
  userId?: string;
  organizationId: string;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  status: 'Present' | 'Late' | 'Absent' | 'Working';
  checkInTime?: string;
  checkOutTime?: string;
  manager?: string;
  avatar?: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  appliedDate: string;
  approvedBy?: string;
}

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1`;
  
  // BehaviorSubjects for real-time updates
  private statsSubject = new BehaviorSubject<DashboardStats | null>(null);
  private activitiesSubject = new BehaviorSubject<ActivityItem[]>([]);
  private employeesSubject = new BehaviorSubject<Employee[]>([]);
  private leaveRequestsSubject = new BehaviorSubject<LeaveRequest[]>([]);

  // Public observables
  public stats$ = this.statsSubject.asObservable();
  public activities$ = this.activitiesSubject.asObservable();
  public employees$ = this.employeesSubject.asObservable();
  public leaveRequests$ = this.leaveRequestsSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Load dashboard statistics
   */
  loadDashboardStats(role: string = 'EMPLOYEE'): Observable<DashboardStats> {
    const endpoint = this.getRoleBasedEndpoint(role, 'stats');
    return this.http.get<DashboardStats>(`${this.apiUrl}${endpoint}`);
  }

  /**
   * Load recent activities based on user role
   */
  loadRecentActivities(role: string = 'EMPLOYEE', limit: number = 10): Observable<ActivityItem[]> {
    const endpoint = this.getRoleBasedEndpoint(role, 'activities');
    return this.http.get<ActivityItem[]>(`${this.apiUrl}${endpoint}`, {
      params: { limit: limit.toString() }
    });
  }

  /**
   * Load employees based on user role and permissions
   */
  loadEmployees(role: string = 'EMPLOYEE'): Observable<Employee[]> {
    const endpoint = this.getRoleBasedEndpoint(role, 'employees');
    return this.http.get<Employee[]>(`${this.apiUrl}${endpoint}`);
  }

  /**
   * Load pending leave requests
   */
  loadPendingLeaveRequests(role: string = 'EMPLOYEE'): Observable<LeaveRequest[]> {
    const endpoint = this.getRoleBasedEndpoint(role, 'leave-requests');
    return this.http.get<LeaveRequest[]>(`${this.apiUrl}${endpoint}`, {
      params: { status: 'Pending' }
    });
  }

  /**
   * Approve leave request
   */
  approveLeaveRequest(requestId: string, comments?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/leave/${requestId}/approve`, {
      comments
    });
  }

  /**
   * Reject leave request
   */
  rejectLeaveRequest(requestId: string, reason: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/leave/${requestId}/reject`, {
      reason
    });
  }

  /**
   * Send reminder to late employees
   */
  sendLateArrivalReminder(employeeIds: string[]): Observable<any> {
    return this.http.post(`${this.apiUrl}/notifications/late-reminder`, {
      employeeIds
    });
  }

  /**
   * Export dashboard data
   */
  exportDashboardData(format: 'csv' | 'pdf' = 'csv'): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/dashboard/export`, {
      params: { format },
      responseType: 'blob'
    });
  }

  /**
   * Get real-time dashboard updates via WebSocket or polling
   */
  subscribeToRealTimeUpdates(): void {
    // Implementation for WebSocket connection or periodic polling
    // This would typically connect to a WebSocket endpoint for real-time updates
    console.log('Subscribing to real-time dashboard updates...');
    
    // For now, simulate periodic updates
    setInterval(() => {
      this.refreshDashboardData();
    }, 30000); // Refresh every 30 seconds
  }

  /**
   * Refresh all dashboard data
   */
  refreshDashboardData(): void {
    // This method would be called to refresh all dashboard data
    console.log('Refreshing dashboard data...');
  }

  /**
   * Update stats subject
   */
  updateStats(stats: DashboardStats): void {
    this.statsSubject.next(stats);
  }

  /**
   * Add new activity
   */
  addActivity(activity: ActivityItem): void {
    const currentActivities = this.activitiesSubject.value;
    this.activitiesSubject.next([activity, ...currentActivities.slice(0, 9)]);
  }

  /**
   * Update employee status
   */
  updateEmployeeStatus(employeeId: string, status: string): void {
    const currentEmployees = this.employeesSubject.value;
    const updatedEmployees = currentEmployees.map(emp => 
      emp.id === employeeId ? { ...emp, status: status as any } : emp
    );
    this.employeesSubject.next(updatedEmployees);
  }

  /**
   * Get role-based API endpoint
   */
  private getRoleBasedEndpoint(role: string, type: string): string {
    const roleEndpoints = {
      'EMPLOYEE': {
        'stats': '/dashboard/employee/stats',
        'activities': '/dashboard/employee/activities',
        'employees': '/users/me',
        'leave-requests': '/leave/me'
      },
      'MANAGER': {
        'stats': '/dashboard/manager/stats',
        'activities': '/dashboard/manager/activities',
        'employees': '/users/team',
        'leave-requests': '/leave/team'
      },
      'HR': {
        'stats': '/dashboard/hr/stats',
        'activities': '/dashboard/hr/activities',
        'employees': '/users/organization',
        'leave-requests': '/leave/organization'
      },
      'ADMIN': {
        'stats': '/dashboard/admin/stats',
        'activities': '/dashboard/admin/activities',
        'employees': '/users/all',
        'leave-requests': '/leave/all'
      }
    };

    return roleEndpoints[role]?.[type] || roleEndpoints['EMPLOYEE'][type];
  }

  /**
   * Get current stats
   */
  getCurrentStats(): DashboardStats | null {
    return this.statsSubject.value;
  }

  /**
   * Get current activities
   */
  getCurrentActivities(): ActivityItem[] {
    return this.activitiesSubject.value;
  }

  /**
   * Clean up subscriptions
   */
  ngOnDestroy(): void {
    this.statsSubject.complete();
    this.activitiesSubject.complete();
    this.employeesSubject.complete();
    this.leaveRequestsSubject.complete();
  }
}