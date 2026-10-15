import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export type PolicyCategory = 'LEAVE' | 'ATTENDANCE' | 'WFH' | 'CODE_OF_CONDUCT' | 'IT_SECURITY' | 'HR' | 'OTHER';

export interface Policy {
  id: string;
  title: string;
  category: PolicyCategory;
  summary?: string;
  content: string;
  version: number;
  effectiveDate: string;
  requiresAcknowledgement: boolean;
  isActive: boolean;
  updatedAt: string;
  author?: { id: string; name: string };
  acknowledged: boolean;
  acknowledgedAt?: string;
}

export interface PolicyInput {
  title: string;
  category: PolicyCategory;
  summary?: string;
  content: string;
  effectiveDate: string;
  requiresAcknowledgement: boolean;
}

export interface AcknowledgementStatus {
  policyId: string;
  version: number;
  totalEmployees: number;
  acknowledgedCount: number;
  acknowledged: { id: string; name: string; department?: string; acknowledgedAt: string }[];
  pending: { id: string; name: string; department?: string }[];
}

export interface LeavePolicy {
  id?: string;
  leaveType: string;
  annualAllocation: number;
  carryForwardMax: number;
  allowNegativeBalance: boolean;
  isActive: boolean;
}

export interface LeaveBalanceRow {
  leaveType: string;
  allocated: number;
  carried: number;
  used: number;
  pending: number;
  remaining: number;
  isConfigured: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PoliciesService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1`;

  constructor(private http: HttpClient) {}

  getPolicies(includeInactive = false): Observable<Policy[]> {
    const params: any = {};
    if (includeInactive) params.includeInactive = 'true';

    return this.http.get<{ success: boolean, data: Policy[] }>(`${this.apiUrl}/policies`, { params })
      .pipe(map(response => response.data));
  }

  createPolicy(data: PolicyInput): Observable<Policy> {
    return this.http.post<{ success: boolean, data: Policy }>(`${this.apiUrl}/policies`, data)
      .pipe(map(response => response.data));
  }

  updatePolicy(id: string, data: Partial<PolicyInput> & { isActive?: boolean }): Observable<Policy> {
    return this.http.put<{ success: boolean, data: Policy }>(`${this.apiUrl}/policies/${id}`, data)
      .pipe(map(response => response.data));
  }

  archivePolicy(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/policies/${id}`);
  }

  acknowledge(id: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/policies/${id}/acknowledge`, {});
  }

  getAcknowledgements(id: string): Observable<AcknowledgementStatus> {
    return this.http.get<{ success: boolean, data: AcknowledgementStatus }>(`${this.apiUrl}/policies/${id}/acknowledgements`)
      .pipe(map(response => response.data));
  }

  getLeavePolicies(): Observable<LeavePolicy[]> {
    return this.http.get<{ success: boolean, data: LeavePolicy[] }>(`${this.apiUrl}/policies/leave`)
      .pipe(map(response => response.data.map(p => ({
        ...p,
        annualAllocation: Number(p.annualAllocation),
        carryForwardMax: Number(p.carryForwardMax)
      }))));
  }

  saveLeavePolicy(policy: LeavePolicy): Observable<LeavePolicy> {
    const { leaveType, annualAllocation, carryForwardMax, allowNegativeBalance, isActive } = policy;
    return this.http.put<{ success: boolean, data: LeavePolicy }>(`${this.apiUrl}/policies/leave/${leaveType}`, {
      annualAllocation, carryForwardMax, allowNegativeBalance, isActive
    }).pipe(map(response => response.data));
  }

  getLeaveBalances(): Observable<LeaveBalanceRow[]> {
    return this.http.get<{ success: boolean, data: LeaveBalanceRow[] }>(`${this.apiUrl}/leave/balances`)
      .pipe(map(response => response.data));
  }
}
