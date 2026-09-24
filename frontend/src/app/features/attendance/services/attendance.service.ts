import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export interface AttendanceRecord {
  id: string;
  date: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: 'Present' | 'Late' | 'Absent' | 'Working' | 'Completed';
  workingHours: number;
  isLate: boolean;
  lateMinutes?: number;
  location?: string;
  notes?: string;
}

export interface AttendanceStats {
  todayStatus: string;
  totalWorkingDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  averageWorkingHours: number;
  attendanceRate: number;
  monthlyStats: MonthlyStats[];
}

export interface MonthlyStats {
  month: string;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  totalHours: number;
}

export interface CheckInRequest {
  location: string;
  notes?: string;
  timestamp: string;
  coordinates?: { lat: number; lng: number };
}

@Injectable({
  providedIn: 'root'
})
export class AttendanceService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1`;
  
  private attendanceRecordsSubject = new BehaviorSubject<AttendanceRecord[]>([]);
  private statsSubject = new BehaviorSubject<AttendanceStats | null>(null);
  private todayStatusSubject = new BehaviorSubject<string>('Not Checked In');

  public attendanceRecords$ = this.attendanceRecordsSubject.asObservable();
  public stats$ = this.statsSubject.asObservable();
  public todayStatus$ = this.todayStatusSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Check in employee
   */
  checkIn(request: CheckInRequest): Observable<any> {
    return this.http.post(`${this.apiUrl}/attendance/check-in`, {
      location: request.location,
      notes: request.notes
    });
  }

  /**
   * Check out employee
   */
  checkOut(notes?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/attendance/check-out`, { notes });
  }

  /**
   * Get employee attendance records
   */
  getAttendanceRecords(startDate?: string, endDate?: string): Observable<AttendanceRecord[]> {
    const params: any = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    
    return this.http.get<{success: boolean, data: any}>(`${this.apiUrl}/attendance/me`, { params })
      .pipe(map(response => response.data));
  }

  /**
   * Get attendance history with pagination
   */
  getAttendanceHistory(startDate?: string, endDate?: string, page: number = 1, limit: number = 30): Observable<any> {
    const params: any = { page: page.toString(), limit: limit.toString() };
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    
    return this.http.get<{success: boolean, data: any}>(`${this.apiUrl}/attendance/history`, { params })
      .pipe(map(response => response.data));
  }

  /**
   * Get attendance statistics
   */
  getAttendanceStats(month?: number, year?: number): Observable<AttendanceStats> {
    const params: any = {};
    if (month) params.month = month.toString();
    if (year) params.year = year.toString();
    
    return this.http.get<{success: boolean, data: any}>(`${this.apiUrl}/attendance/stats`, { params })
      .pipe(map(response => response.data));
  }

  /**
   * Get today's attendance status
   */
  getTodayStatus(): Observable<any> {
    return this.http.get<{success: boolean, data: any}>(`${this.apiUrl}/attendance/today`)
      .pipe(map(response => response.data));
  }

  /**
   * Get team attendance (Manager/HR/Admin only)
   */
  getTeamAttendance(date?: string): Observable<any> {
    const params: any = {};
    if (date) params.date = date;
    
    return this.http.get<{success: boolean, data: any}>(`${this.apiUrl}/attendance/team`, { params })
      .pipe(map(response => response.data));
  }

  /**
   * Export attendance data
   */
  exportAttendance(format: 'csv' | 'pdf' = 'csv', dateRange?: { start: string; end: string }): Observable<Blob> {
    const params: any = { format };
    if (dateRange) {
      params.startDate = dateRange.start;
      params.endDate = dateRange.end;
    }
    
    return this.http.get(`${this.apiUrl}/attendance/export`, {
      params,
      responseType: 'blob'
    });
  }

  /**
   * Update attendance records subject
   */
  updateAttendanceRecords(records: AttendanceRecord[]): void {
    this.attendanceRecordsSubject.next(records);
  }

  /**
   * Update stats subject
   */
  updateStats(stats: AttendanceStats): void {
    this.statsSubject.next(stats);
  }

  /**
   * Update today status
   */
  updateTodayStatus(status: string): void {
    this.todayStatusSubject.next(status);
  }

  /**
   * Get current attendance records
   */
  getCurrentRecords(): AttendanceRecord[] {
    return this.attendanceRecordsSubject.value;
  }

  /**
   * Get current stats
   */
  getCurrentStats(): AttendanceStats | null {
    return this.statsSubject.value;
  }

  /**
   * Check if user is checked in today
   */
  isCheckedInToday(): boolean {
    const today = new Date().toISOString().split('T')[0];
    const records = this.getCurrentRecords();
    const todayRecord = records.find(r => r.date === today);
    return todayRecord?.checkInTime != null && todayRecord?.checkOutTime == null;
  }

  /**
   * Clean up subscriptions
   */
  ngOnDestroy(): void {
    this.attendanceRecordsSubject.complete();
    this.statsSubject.complete();
    this.todayStatusSubject.complete();
  }
}