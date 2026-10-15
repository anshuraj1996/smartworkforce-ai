import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
export type JobStatus = 'OPEN' | 'ON_HOLD' | 'CLOSED';
export type ReferralStatus = 'SUBMITTED' | 'SCREENING' | 'INTERVIEWING' | 'OFFERED' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';

export interface JobOpening {
  id: string;
  title: string;
  department?: string;
  location?: string;
  employmentType: EmploymentType;
  experienceMin?: number;
  experienceMax?: number;
  description: string;
  openings: number;
  referralBonus?: string | number;
  status: JobStatus;
  createdAt: string;
  referralCount?: number;
  referralsByStatus?: Partial<Record<ReferralStatus, number>>;
}

export interface JobOpeningInput {
  title: string;
  department?: string;
  location?: string;
  employmentType: EmploymentType;
  experienceMin?: number | null;
  experienceMax?: number | null;
  description: string;
  openings: number;
  referralBonus?: number | null;
}

export interface Referral {
  id: string;
  jobOpeningId: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone?: string;
  resumeUrl?: string;
  relationship?: string;
  notes?: string;
  status: ReferralStatus;
  statusNote?: string;
  statusUpdatedAt?: string;
  createdAt: string;
  jobOpening?: { id: string; title: string; department?: string; status: JobStatus; referralBonus?: string | number };
  referrer?: { id: string; name: string; email: string; department?: string };
}

export interface ReferralInput {
  candidateName: string;
  candidateEmail: string;
  candidatePhone?: string;
  resumeUrl?: string;
  relationship?: string;
  notes?: string;
}

// Mirrors Referral.TRANSITIONS on the backend
export const REFERRAL_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  SUBMITTED: ['SCREENING', 'REJECTED', 'WITHDRAWN'],
  SCREENING: ['INTERVIEWING', 'REJECTED', 'WITHDRAWN'],
  INTERVIEWING: ['OFFERED', 'REJECTED', 'WITHDRAWN'],
  OFFERED: ['HIRED', 'REJECTED', 'WITHDRAWN'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: []
};

@Injectable({
  providedIn: 'root'
})
export class HiringService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1/hiring`;

  constructor(private http: HttpClient) {}

  getJobs(status?: JobStatus): Observable<JobOpening[]> {
    const params: any = {};
    if (status) params.status = status;

    return this.http.get<{ success: boolean, data: JobOpening[] }>(`${this.apiUrl}/jobs`, { params })
      .pipe(map(response => response.data));
  }

  createJob(data: JobOpeningInput): Observable<JobOpening> {
    return this.http.post<{ success: boolean, data: JobOpening }>(`${this.apiUrl}/jobs`, data)
      .pipe(map(response => response.data));
  }

  updateJob(id: string, data: Partial<JobOpeningInput> & { status?: JobStatus }): Observable<JobOpening> {
    return this.http.patch<{ success: boolean, data: JobOpening }>(`${this.apiUrl}/jobs/${id}`, data)
      .pipe(map(response => response.data));
  }

  refer(jobId: string, data: ReferralInput): Observable<Referral> {
    return this.http.post<{ success: boolean, data: Referral }>(`${this.apiUrl}/jobs/${jobId}/referrals`, data)
      .pipe(map(response => response.data));
  }

  getMyReferrals(): Observable<Referral[]> {
    return this.http.get<{ success: boolean, data: Referral[] }>(`${this.apiUrl}/referrals/me`)
      .pipe(map(response => response.data));
  }

  getAllReferrals(filters: { jobOpeningId?: string, status?: ReferralStatus } = {}): Observable<Referral[]> {
    const params: any = {};
    if (filters.jobOpeningId) params.jobOpeningId = filters.jobOpeningId;
    if (filters.status) params.status = filters.status;

    return this.http.get<{ success: boolean, data: Referral[] }>(`${this.apiUrl}/referrals`, { params })
      .pipe(map(response => response.data));
  }

  updateReferralStatus(id: string, status: ReferralStatus, statusNote?: string): Observable<Referral> {
    return this.http.patch<{ success: boolean, data: Referral }>(`${this.apiUrl}/referrals/${id}/status`, { status, statusNote })
      .pipe(map(response => response.data));
  }

  withdraw(id: string): Observable<Referral> {
    return this.http.post<{ success: boolean, data: Referral }>(`${this.apiUrl}/referrals/${id}/withdraw`, {})
      .pipe(map(response => response.data));
  }
}
