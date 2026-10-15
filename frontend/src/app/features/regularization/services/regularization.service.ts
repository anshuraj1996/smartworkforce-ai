import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export type RegularizationType = 'MISSED_CHECK_IN' | 'MISSED_CHECK_OUT' | 'WRONG_TIME' | 'MARK_PRESENT';

export interface RegularizationRequest {
  id: string;
  userId: string;
  date: string;
  requestType: RegularizationType;
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  approver?: { id: string; name: string; email: string };
  user?: { id: string; name: string; email: string; employeeId?: string; department?: string };
  attendanceLog?: { id: string; checkInTime?: string; checkOutTime?: string; attendanceType: string };
}

export interface ApplyRegularization {
  date: string;
  requestType: RegularizationType;
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  reason: string;
}

@Injectable({
  providedIn: 'root'
})
export class RegularizationService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1`;

  constructor(private http: HttpClient) {}

  apply(data: ApplyRegularization): Observable<RegularizationRequest> {
    return this.http.post<{ success: boolean, data: RegularizationRequest }>(`${this.apiUrl}/regularization/apply`, data)
      .pipe(map(response => response.data));
  }

  getMyRequests(status?: string): Observable<RegularizationRequest[]> {
    const params: any = {};
    if (status) params.status = status;

    return this.http.get<{ success: boolean, data: RegularizationRequest[] }>(`${this.apiUrl}/regularization/me`, { params })
      .pipe(map(response => response.data));
  }

  getPendingRequests(): Observable<RegularizationRequest[]> {
    return this.http.get<{ success: boolean, data: RegularizationRequest[] }>(`${this.apiUrl}/regularization/pending`)
      .pipe(map(response => response.data));
  }

  approve(requestId: string): Observable<RegularizationRequest> {
    return this.http.post<{ success: boolean, data: RegularizationRequest }>(`${this.apiUrl}/regularization/${requestId}/approve`, {})
      .pipe(map(response => response.data));
  }

  reject(requestId: string, rejectionReason: string): Observable<RegularizationRequest> {
    return this.http.post<{ success: boolean, data: RegularizationRequest }>(`${this.apiUrl}/regularization/${requestId}/reject`, { rejectionReason })
      .pipe(map(response => response.data));
  }

  cancel(requestId: string): Observable<RegularizationRequest> {
    return this.http.post<{ success: boolean, data: RegularizationRequest }>(`${this.apiUrl}/regularization/${requestId}/cancel`, {})
      .pipe(map(response => response.data));
  }
}
