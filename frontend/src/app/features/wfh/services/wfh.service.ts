import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export interface WfhRequest {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDayType?: 'MORNING' | 'AFTERNOON';
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface WfhQuota {
  used: number;
  quota: number;
  remaining: number;
}

@Injectable({
  providedIn: 'root'
})
export class WfhService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1`;

  constructor(private http: HttpClient) {}

  applyWfh(data: { startDate: string, endDate: string, reason: string, isHalfDay?: boolean, halfDayType?: string }): Observable<WfhRequest> {
    return this.http.post<{ success: boolean, data: WfhRequest }>(`${this.apiUrl}/wfh/apply`, data)
      .pipe(map(response => response.data));
  }

  getMyRequests(status?: string): Observable<WfhRequest[]> {
    const params: any = {};
    if (status) params.status = status;

    return this.http.get<{ success: boolean, data: WfhRequest[] }>(`${this.apiUrl}/wfh/me`, { params })
      .pipe(map(response => response.data));
  }

  getQuota(month?: number, year?: number): Observable<WfhQuota> {
    const params: any = {};
    if (month) params.month = month;
    if (year) params.year = year;

    return this.http.get<{ success: boolean, data: WfhQuota }>(`${this.apiUrl}/wfh/quota`, { params })
      .pipe(map(response => response.data));
  }

  getPendingRequests(): Observable<WfhRequest[]> {
    return this.http.get<{ success: boolean, data: WfhRequest[] }>(`${this.apiUrl}/wfh/pending`)
      .pipe(map(response => response.data));
  }

  approve(requestId: string): Observable<WfhRequest> {
    return this.http.post<{ success: boolean, data: WfhRequest }>(`${this.apiUrl}/wfh/${requestId}/approve`, {})
      .pipe(map(response => response.data));
  }

  reject(requestId: string, rejectionReason: string): Observable<WfhRequest> {
    return this.http.post<{ success: boolean, data: WfhRequest }>(`${this.apiUrl}/wfh/${requestId}/reject`, { rejectionReason })
      .pipe(map(response => response.data));
  }
}
