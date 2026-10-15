import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';

// Typed client for the Phase 2D analytics endpoints (SQL-aggregated metrics, the KPI engine
// and persisted reports). Every endpoint is role-scoped by the API: HR/Admin get the
// organization, managers their direct reports, employees themselves.

export type Period = '7d' | '30d' | '90d' | '1y';
export type Granularity = 'day' | 'week' | 'month';
export type ReportType = 'attendance-summary' | 'leave-summary';
export type MetricScope = 'organization' | 'team' | 'self';

export interface DateRange { from: string; to: string; }

export interface MySummary {
  period: DateRange;
  workingDays: number;
  leaveDays: number;
  daysPresent: number;
  daysLate: number;
  daysWfh: number;
  halfDays: number;
  daysAbsent: number;
  attendanceRate: number;
  punctualityRate: number;
  wfhRate: number;
  avgWorkingHours: number;
  overtimeHours: number;
  avgLateMinutes: number;
  leaveBalance: { leaveType: string; allocated: number; carried: number; used: number; pending: number; remaining: number }[];
}

export interface WorkModeCounts { office: number; wfh: number; halfDay: number; absent: number; wfhRate: number; }
export interface WorkMode {
  period: DateRange;
  scope: MetricScope;
  summary: WorkModeCounts;
  byDepartment: (WorkModeCounts & { department: string })[];
  weekly: (WorkModeCounts & { week: string })[];
  requests: Record<'pending' | 'approved' | 'rejected' | 'cancelled', { requests: number; days: number }>;
}

export interface OvertimeCounts {
  overtimeHours: number;
  overtimeDays: number;
  employeesWithOvertime: number;
  workedDays: number;
  overtimeDayRate: number;
  avgOvertimeHoursPerOvertimeDay: number;
}
export interface Overtime {
  period: DateRange;
  scope: MetricScope;
  standardHours: number;
  summary: OvertimeCounts;
  weekly: (OvertimeCounts & { week: string })[];
  byDepartment: (OvertimeCounts & { department: string })[];
  topEmployees: { userId: string; name: string; department: string; overtimeHours: number; overtimeDays: number }[];
}

export interface TurnaroundStats {
  decided: number;
  approved: number;
  rejected: number;
  approvalRate: number;
  avgHours: number | null;
  medianHours: number | null;
  p90Hours: number | null;
  withinSlaRate: number | null;
  pending: number;
  oldestPendingHours: number | null;
}
export interface ApprovalTurnaround {
  period: DateRange;
  scope: MetricScope;
  slaHours: number;
  overall: TurnaroundStats;
  byKind: Record<'LEAVE' | 'WFH' | 'REGULARIZATION', TurnaroundStats>;
  byApprover: { approverId: string; approverName: string; decided: number; avgHours: number | null; medianHours: number | null }[];
}

export interface Tenure { under1y: number; from1to3y: number; from3to5y: number; over5y: number; }
export interface Lifecycle {
  months: { month: string; joiners: number; exits: number; headcount: number }[];
  headcount: number;
  totals: { joiners: number; exits: number; netChange: number; attritionRate: number };
  tenure: Tenure;
  byDepartment: { department: string; headcount: number; tenure: Tenure }[];
}

export interface LeaveUtilization {
  year: number;
  headcount: number;
  byType: { leaveType: string; allocatedDays: number; usedDays: number; utilizationRate: number | null }[];
  totalAllocatedDays: number;
  totalUsedDays: number;
  utilizationRate: number | null;
  averageDaysPerEmployee: number;
}

export interface KpiValues {
  days: number;
  workingDays: number;
  avgHeadcount: number;
  present: number;
  late: number;
  wfh: number;
  halfDay: number;
  onLeave: number;
  absent: number;
  attendanceRate: number;
  absenceRate: number;
  lateRate: number;
  wfhRate: number;
  avgWorkingHours: number;
  overtimeHours: number;
  leaveRequested: number;
  wfhRequested: number;
  requestsDecided: number;
  avgDecisionHours: number | null;
}
export interface KpiSeries {
  from: string;
  to: string;
  granularity: Granularity;
  department: string | null;
  totals: KpiValues;
  series: (KpiValues & { period: string })[];
  byDepartment: (KpiValues & { department: string })[];
  freshness: { lastComputedAt: string | null; queuedDays: number; oldestQueuedSeconds: number };
}

export interface ForecastModelInfo {
  type: 'ridge' | 'weekday-baseline';
  lambda: number | null;
  trainingDays: number;
  backtest: {
    folds: number;
    horizonDays: number;
    mae: { model: number; weekdayBaseline: number; historicalMean: number };
    improvementVsMeanPct: number | null;
  } | null;
}
export interface ForecastDay {
  date: string;
  weekday: string;
  headcount: number;
  plannedLeave: number;
  pendingLeave: number;
  approvedWfh: number;
  expectedUnplannedAbsent: number | null;
  expectedAvailable: number;
  availableRange: { low: number; high: number } | null;
  availabilityRate: number;
  expectedWfh: number;
  risk: 'normal' | 'elevated' | 'high';
}
export interface AttendanceForecast {
  scope: 'organization' | 'department' | 'team';
  department: string | null;
  horizonDays: number;
  generatedAt: string;
  status: 'ok' | 'insufficient_history';
  history: { usableDays: number; excludedDays: number; minimumDays: number };
  model: { absence: ForecastModelInfo | null; wfhShare: ForecastModelInfo | null; note: string | null };
  summary: {
    workingDays: number;
    avgAvailabilityRate: number | null;
    lowestDay: { date: string; availabilityRate: number } | null;
    highRiskDays: number;
    plannedLeaveDays: number;
  };
  days: ForecastDay[];
}

export interface LeaveForecastWeek {
  weekStart: string;
  expectedDays: number;
  range: { low: number; high: number } | null;
  bookedDays: number;
  pendingDays: number;
  likelyNewRequests: number;
  perEmployee: number;
  spike: boolean;
  reasons: string[];
}
export interface LeaveForecast {
  scope: 'organization' | 'department' | 'team';
  department: string | null;
  horizonWeeks: number;
  status: 'ok' | 'insufficient_history';
  history: { usableWeeks: number; minimumWeeks: number };
  model: (Omit<ForecastModelInfo, 'trainingDays' | 'type'> & { type: 'ridge' | 'seasonal-baseline'; trainingWeeks: number }) | null;
  note: string | null;
  headcount: number;
  summary: {
    expectedLeaveDays: number;
    bookedDays: number;
    pendingDays: number;
    likelyNewRequests: number;
    typicalWeekDays: number;
    peakWeek: { weekStart: string; expectedDays: number } | null;
    spikeWeeks: number;
  };
  byType: { leaveType: string; share: number; expectedDays: number }[];
  yearEnd: { year: number; days: number; employees: number; byType: Record<string, number> };
  weeks: LeaveForecastWeek[];
}

export type RiskLevel = 'low' | 'medium' | 'high';
export interface RiskFactor { key: string; label: string; value: number; scaled: number; points: number; text: string; }
export interface RiskScore { score: number; level: RiskLevel; reasons: string[]; factors?: RiskFactor[]; }
export interface EmployeeRisk {
  userId: string;
  name: string;
  department: string;
  status: 'ok' | 'insufficient_data';
  attendanceRisk: RiskScore | null;
  burnoutRisk: RiskScore | null;
}
export interface RiskMethodology { note: string; levels: string; attendanceRisk: string; burnoutRisk: string; minimumExpectedDays: number; }
export interface RiskOverview {
  scope: 'organization' | 'department' | 'team';
  department: string | null;
  asOf: string;
  summary: {
    employees: number;
    scored: number;
    insufficientData: number;
    attendance: { high: number; medium: number; average: number | null };
    burnout: { high: number; medium: number; average: number | null };
  };
  methodology: RiskMethodology;
  employees: EmployeeRisk[];
}
export interface EmployeeRiskDetail extends EmployeeRisk {
  asOf: string;
  methodology: RiskMethodology;
  recentInsights: { insightType: string; title: string; description: string; severity: string; confidence: number; generatedAt: string }[];
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string; }
export interface AssistantAnswer {
  answer: string;
  toolsUsed: { name: string; input: Record<string, unknown>; ok: boolean }[];
  model: string;
  usage: { inputTokens: number; outputTokens: number; rounds: number };
}

export interface WorkforceReport {
  id: string;
  reportType: ReportType;
  periodStart: string;
  periodEnd: string;
  scopeManagerId: string | null;
  requestedBy: string | null;
  status: 'PENDING' | 'READY' | 'FAILED';
  summary: Record<string, unknown> | null;
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

type Envelope<T> = { success: boolean; data: T };

@Injectable({ providedIn: 'root' })
export class WorkforceInsightsService {
  private readonly api = `${environment.apiUrl}/api/v1/analytics`;
  private readonly assistantApi = `${environment.apiUrl}/api/v1/assistant`;

  constructor(private http: HttpClient) {}

  private get<T>(path: string, params: Record<string, string | number | null | undefined> = {}): Observable<T> {
    let httpParams = new HttpParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') httpParams = httpParams.set(key, String(value));
    });
    return this.http.get<Envelope<T>>(`${this.api}${path}`, { params: httpParams }).pipe(map(r => r.data));
  }

  mySummary(period: Period): Observable<MySummary> { return this.get('/me/summary', { period }); }
  workMode(period: Period): Observable<WorkMode> { return this.get('/work-mode', { period }); }
  overtime(period: Period): Observable<Overtime> { return this.get('/overtime', { period }); }
  approvalTurnaround(period: Period): Observable<ApprovalTurnaround> { return this.get('/approvals/turnaround', { period }); }
  lifecycle(months = 12): Observable<Lifecycle> { return this.get('/lifecycle', { months }); }
  leaveUtilization(year?: number): Observable<LeaveUtilization> { return this.get('/leave/utilization', { year }); }

  kpis(query: { from?: string; to?: string; granularity: Granularity; department?: string | null }): Observable<KpiSeries> {
    return this.get('/kpis', query);
  }

  attendanceForecast(horizonDays: number, department?: string | null): Observable<AttendanceForecast> {
    return this.get('/forecast/attendance', { horizonDays, department });
  }

  leaveForecast(weeks: number, department?: string | null): Observable<LeaveForecast> {
    return this.get('/forecast/leave', { weeks, department });
  }

  riskOverview(department?: string | null): Observable<RiskOverview> { return this.get('/risk', { department }); }
  employeeRisk(userId: string): Observable<EmployeeRiskDetail> { return this.get(`/risk/${userId}`); }

  assistantStatus(): Observable<{ enabled: boolean }> {
    return this.http.get<Envelope<{ enabled: boolean }>>(`${this.assistantApi}/status`).pipe(map(r => r.data));
  }

  askAssistant(message: string, history: ChatTurn[]): Observable<AssistantAnswer> {
    return this.http.post<Envelope<AssistantAnswer>>(`${this.assistantApi}/chat`, { message, history }).pipe(map(r => r.data));
  }

  listReports(): Observable<WorkforceReport[]> { return this.get('/reports'); }

  requestReport(body: { reportType: ReportType; from: string; to: string }): Observable<WorkforceReport> {
    return this.http.post<Envelope<WorkforceReport>>(`${this.api}/reports`, body).pipe(map(r => r.data));
  }

  // A blob (not a plain link) so the request carries the auth header like every API call
  downloadReport(id: string): Observable<Blob> {
    return this.http.get(`${this.api}/reports/${id}/download`, { responseType: 'blob' });
  }
}
