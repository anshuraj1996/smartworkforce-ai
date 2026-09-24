import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'Sick' | 'Vacation' | 'Personal' | 'Emergency' | 'Maternity' | 'Paternity';
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  appliedDate: string;
  approvedBy?: string;
  approvedDate?: string;
  comments?: string;
  attachments?: string[];
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
}

export interface LeaveBalance {
  type: string;
  allocated: number;
  used: number;
  remaining: number;
  carried: number;
  expires: string;
}

export interface LeaveStats {
  totalRequests: number;
  pendingRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  totalDaysTaken: number;
  averageLeaveLength: number;
  monthlyBreakdown: MonthlyLeave[];
}

export interface MonthlyLeave {
  month: string;
  approved: number;
  pending: number;
  rejected: number;
}

export interface LeavePolicy {
  id: string;
  type: string;
  annualAllocation: number;
  maxConsecutiveDays: number;
  minNoticeRequired: number;
  requiresApproval: boolean;
  carryOverAllowed: boolean;
  maxCarryOver: number;
}

@Injectable({
  providedIn: 'root'
})
export class LeaveService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1`;
  
  private leaveRequestsSubject = new BehaviorSubject<LeaveRequest[]>([]);
  private leaveBalancesSubject = new BehaviorSubject<LeaveBalance[]>([]);
  private statsSubject = new BehaviorSubject<LeaveStats | null>(null);
  private policiesSubject = new BehaviorSubject<LeavePolicy[]>([]);

  public leaveRequests$ = this.leaveRequestsSubject.asObservable();
  public leaveBalances$ = this.leaveBalancesSubject.asObservable();
  public stats$ = this.statsSubject.asObservable();
  public policies$ = this.policiesSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Apply for leave
   */
  applyLeave(leaveData: {startDate: string, endDate: string, leaveType: string, reason: string, isHalfDay?: boolean}): Observable<any> {
    return this.http.post<{success: boolean, data: any}>(`${this.apiUrl}/leave/apply`, {
      startDate: leaveData.startDate,
      endDate: leaveData.endDate,
      leaveType: leaveData.leaveType,
      reason: leaveData.reason,
      isHalfDay: leaveData.isHalfDay || false
    }).pipe(map(response => response.data));
  }

  /**
   * Get user's leave requests
   */
  getMyLeaveRequests(status?: string, startDate?: string, endDate?: string): Observable<LeaveRequest[]> {
    const params: any = {};
    if (status) params.status = status;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    
    return this.http.get<{success: boolean, data: any[]}>(`${this.apiUrl}/leave/me`, { params })
      .pipe(map(response => response.data));
  }

  /**
   * Get pending leave requests (for managers/HR/Admin)
   */
  getPendingLeaveRequests(): Observable<LeaveRequest[]> {
    return this.http.get<{success: boolean, data: any[]}>(`${this.apiUrl}/leave/pending`)
      .pipe(map(response => response.data));
  }

  /**
   * Approve leave request
   */
  approveLeaveRequest(requestId: string, comments?: string): Observable<any> {
    return this.http.post<{success: boolean, data: any}>(`${this.apiUrl}/leave/${requestId}/approve`, { comments })
      .pipe(map(response => response.data));
  }

  /**
   * Reject leave request
   */
  rejectLeaveRequest(requestId: string, comments: string): Observable<any> {
    return this.http.post<{success: boolean, data: any}>(`${this.apiUrl}/leave/${requestId}/reject`, { comments })
      .pipe(map(response => response.data));
  }

  /**
   * Get leave statistics (HR/Admin)
   */
  getLeaveStatistics(period: string = '1y'): Observable<any> {
    return this.http.get<{success: boolean, data: any}>(`${this.apiUrl}/leave/statistics`, { 
      params: { period } 
    }).pipe(map(response => response.data));
  }

  /**
   * Cancel leave request
   */
  cancelLeaveRequest(requestId: string, reason?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/leave/${requestId}/cancel`, { reason });
  }

  /**
   * Get leave balances
   */
  getLeaveBalances(): Observable<LeaveBalance[]> {
    return this.http.get<LeaveBalance[]>(`${this.apiUrl}/leave/balances`);
  }

  /**
   * Get leave statistics
   */
  getLeaveStats(): Observable<LeaveStats> {
    return this.http.get<LeaveStats>(`${this.apiUrl}/analytics/leave/me`);
  }

  /**
   * Get leave policies
   */
  getLeavePolicies(): Observable<LeavePolicy[]> {
    return this.http.get<LeavePolicy[]>(`${this.apiUrl}/leave/policies`);
  }

  /**
   * Upload leave attachment
   */
  uploadAttachment(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.apiUrl}/leave/upload`, formData);
  }

  /**
   * Download leave attachment
   */
  downloadAttachment(attachmentId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/leave/attachment/${attachmentId}`, {
      responseType: 'blob'
    });
  }

  /**
   * Export leave data
   */
  exportLeaveData(format: 'csv' | 'pdf' = 'csv', dateRange?: { start: string; end: string }): Observable<Blob> {
    const params: any = { format };
    if (dateRange) {
      params.startDate = dateRange.start;
      params.endDate = dateRange.end;
    }
    
    return this.http.get(`${this.apiUrl}/leave/export`, {
      params,
      responseType: 'blob'
    });
  }

  /**
   * Check leave conflicts
   */
  checkLeaveConflicts(startDate: string, endDate: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/leave/conflicts`, {
      params: { startDate, endDate }
    });
  }

  /**
   * Get leave calendar
   */
  getLeaveCalendar(month?: string, year?: string): Observable<any> {
    const params: any = {};
    if (month) params.month = month;
    if (year) params.year = year;
    
    return this.http.get(`${this.apiUrl}/leave/calendar`, { params });
  }

  /**
   * Update leave requests subject
   */
  updateLeaveRequests(requests: LeaveRequest[]): void {
    this.leaveRequestsSubject.next(requests);
  }

  /**
   * Update leave balances subject
   */
  updateLeaveBalances(balances: LeaveBalance[]): void {
    this.leaveBalancesSubject.next(balances);
  }

  /**
   * Update stats subject
   */
  updateStats(stats: LeaveStats): void {
    this.statsSubject.next(stats);
  }

  /**
   * Get current leave requests
   */
  getCurrentLeaveRequests(): LeaveRequest[] {
    return this.leaveRequestsSubject.value;
  }

  /**
   * Get current leave balances
   */
  getCurrentLeaveBalances(): LeaveBalance[] {
    return this.leaveBalancesSubject.value;
  }

  /**
   * Calculate working days between dates
   */
  calculateWorkingDays(startDate: Date, endDate: Date): number {
    let workingDays = 0;
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Exclude weekends
        workingDays++;
      }
      current.setDate(current.getDate() + 1);
    }
    
    return workingDays;
  }

  /**
   * Get leave type color
   */
  getLeaveTypeColor(type: string): string {
    const colorMap = {
      'Sick': 'red',
      'Vacation': 'blue',
      'Personal': 'green',
      'Emergency': 'orange',
      'Maternity': 'purple',
      'Paternity': 'indigo'
    };
    return colorMap[type as keyof typeof colorMap] || 'gray';
  }

  /**
   * Get leave status color
   */
  getLeaveStatusColor(status: string): string {
    const colorMap = {
      'Pending': 'yellow',
      'Approved': 'green',
      'Rejected': 'red',
      'Cancelled': 'gray'
    };
    return colorMap[status as keyof typeof colorMap] || 'gray';
  }

  /**
   * Clean up subscriptions
   */
  ngOnDestroy(): void {
    this.leaveRequestsSubject.complete();
    this.leaveBalancesSubject.complete();
    this.statsSubject.complete();
    this.policiesSubject.complete();
  }
}