import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChartConfiguration } from 'chart.js';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, Subject, Subscription, takeUntil, timer } from 'rxjs';
import { MiniChartComponent } from './mini-chart.component';
import {
  ApprovalTurnaround, AssistantAnswer, AttendanceForecast, ChatTurn, EmployeeRiskDetail, Granularity, LeaveForecast, RiskOverview, KpiSeries, LeaveUtilization, Lifecycle, MySummary, Overtime, Period,
  ReportType, WorkMode, WorkforceInsightsService, WorkforceReport
} from './workforce-insights.service';

type TabKey = 'assistant' | 'me' | 'workMode' | 'overtime' | 'approvals' | 'forecast' | 'risk' | 'kpis' | 'workforce' | 'reports';

interface TabDef { key: TabKey; label: string; icon: string; minRole: 'EMPLOYEE' | 'MANAGER' | 'HR'; }

const TABS: TabDef[] = [
  { key: 'assistant', label: 'Ask AI', icon: 'smart_toy', minRole: 'EMPLOYEE' },
  { key: 'me', label: 'My summary', icon: 'person', minRole: 'EMPLOYEE' },
  { key: 'workMode', label: 'Work mode', icon: 'home_work', minRole: 'EMPLOYEE' },
  { key: 'overtime', label: 'Overtime', icon: 'schedule', minRole: 'EMPLOYEE' },
  { key: 'approvals', label: 'Approvals', icon: 'task_alt', minRole: 'MANAGER' },
  { key: 'forecast', label: 'Forecast', icon: 'online_prediction', minRole: 'MANAGER' },
  { key: 'risk', label: 'Risk', icon: 'health_and_safety', minRole: 'MANAGER' },
  { key: 'kpis', label: 'KPI trends', icon: 'insights', minRole: 'HR' },
  { key: 'workforce', label: 'Workforce', icon: 'groups', minRole: 'HR' },
  { key: 'reports', label: 'Reports', icon: 'description', minRole: 'MANAGER' }
];

const PERIOD_TABS: TabKey[] = ['me', 'workMode', 'overtime', 'approvals'];
const ROLE_RANK: Record<string, number> = { EMPLOYEE: 0, MANAGER: 1, HR: 2, ADMIN: 3 };
const COLORS = { blue: '#3f51b5', teal: '#009688', amber: '#ffb300', red: '#e53935', green: '#43a047' };
const REPORT_POLL_MS = 5000;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Phase 2D dashboards: role-scoped workforce metrics, KPI trends from the KPI engine, and
// persisted reports. Each tab loads its data the first time it's opened.
@Component({
  selector: 'app-workforce-insights',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatTabsModule, MatButtonToggleModule, MatFormFieldModule,
    MatSelectModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
    MiniChartComponent
  ],
  templateUrl: './workforce-insights.component.html',
  styleUrls: ['./workforce-insights.component.scss']
})
export class WorkforceInsightsComponent implements OnInit, OnDestroy {
  @Input({ required: true }) role!: string;

  tabs: TabDef[] = [];
  period: Period = '30d';
  readonly periods: { value: Period; label: string }[] = [
    { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: '1y', label: '1 year' }
  ];

  loading: Partial<Record<TabKey, boolean>> = {};
  errors: Partial<Record<TabKey, string>> = {};
  private loaded = new Set<TabKey>();
  activeKey: TabKey = 'me';

  summary?: MySummary;
  workMode?: WorkMode;
  overtime?: Overtime;
  approvals?: ApprovalTurnaround;
  kpis?: KpiSeries;
  lifecycle?: Lifecycle;
  utilization?: LeaveUtilization;
  reports: WorkforceReport[] = [];
  forecast?: AttendanceForecast;
  forecastChart?: ChartConfiguration;
  forecastHorizon = 30;
  forecastDepartment: string | null = null;
  leaveForecast?: LeaveForecast;
  leaveForecastChart?: ChartConfiguration;
  leaveForecastError = '';
  risk?: RiskOverview;
  riskDepartment: string | null = null;
  riskDetail?: EmployeeRiskDetail;
  riskDetailFor: string | null = null;
  riskDetailLoading = false;

  // Assistant chat
  assistantEnabled: boolean | null = null;
  chat: (ChatTurn & { toolsUsed?: AssistantAnswer['toolsUsed']; error?: boolean })[] = [];
  question = '';
  asking = false;

  workModeChart?: ChartConfiguration;
  overtimeChart?: ChartConfiguration;
  kpiChart?: ChartConfiguration;
  lifecycleChart?: ChartConfiguration;

  kpiGranularity: Granularity = 'week';
  kpiDepartment: string | null = null;
  kpiDepartments: string[] = [];

  readonly reportTypes: { value: ReportType; label: string }[] = [
    { value: 'attendance-summary', label: 'Attendance summary' },
    { value: 'leave-summary', label: 'Leave summary' }
  ];
  reportForm = this.lastMonthReportForm();
  requestingReport = false;
  reportMessage = '';

  private destroy$ = new Subject<void>();
  private reportPoll?: Subscription;

  constructor(private api: WorkforceInsightsService) {}

  ngOnInit(): void {
    const rank = ROLE_RANK[this.role] ?? 0;
    this.tabs = TABS.filter(t => rank >= ROLE_RANK[t.minRole]);
    this.activeKey = this.tabs[0].key;
    this.load(this.activeKey);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.reportPoll?.unsubscribe();
  }

  get usesPeriod(): boolean {
    return PERIOD_TABS.includes(this.activeKey);
  }

  onTabChange(index: number): void {
    this.activeKey = this.tabs[index].key;
    if (!this.loaded.has(this.activeKey)) this.load(this.activeKey);
  }

  onPeriodChange(): void {
    // Period-based tabs reload when next opened; the visible one right away
    PERIOD_TABS.forEach(k => this.loaded.delete(k));
    this.load(this.activeKey);
  }

  reload(): void {
    this.load(this.activeKey);
  }

  private track<T>(key: TabKey, source: Observable<T>, onData: (data: T) => void): void {
    this.loading[key] = true;
    delete this.errors[key];
    source.pipe(takeUntil(this.destroy$)).subscribe({
      next: data => { onData(data); this.loaded.add(key); this.loading[key] = false; },
      error: err => { this.errors[key] = err?.error?.message || 'Could not load this data.'; this.loading[key] = false; }
    });
  }

  private load(key: TabKey): void {
    switch (key) {
      case 'assistant':
        this.api.assistantStatus().pipe(takeUntil(this.destroy$)).subscribe({
          next: s => { this.assistantEnabled = s.enabled; this.loaded.add('assistant'); },
          error: () => { this.assistantEnabled = false; }
        });
        break;
      case 'me':
        this.track(key, this.api.mySummary(this.period), d => { this.summary = d; });
        break;
      case 'workMode':
        this.track(key, this.api.workMode(this.period), d => { this.workMode = d; this.workModeChart = this.buildWorkModeChart(d); });
        break;
      case 'overtime':
        this.track(key, this.api.overtime(this.period), d => { this.overtime = d; this.overtimeChart = this.buildOvertimeChart(d); });
        break;
      case 'approvals':
        this.track(key, this.api.approvalTurnaround(this.period), d => { this.approvals = d; });
        break;
      case 'forecast':
        this.loadForecast();
        break;
      case 'risk':
        this.loadRisk();
        break;
      case 'kpis':
        this.loadKpis();
        break;
      case 'workforce':
        this.track(key, this.api.lifecycle(12), d => { this.lifecycle = d; this.lifecycleChart = this.buildLifecycleChart(d); });
        this.api.leaveUtilization().pipe(takeUntil(this.destroy$)).subscribe({ next: d => { this.utilization = d; }, error: () => {} });
        break;
      case 'reports':
        this.loadReports();
        break;
    }
  }

  // ---- KPI trends ----

  loadKpis(): void {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (this.kpiGranularity === 'month' ? 364 : this.kpiGranularity === 'week' ? 89 : 29));
    this.track('kpis', this.api.kpis({ from: ymd(from), to: ymd(to), granularity: this.kpiGranularity, department: this.kpiDepartment }), d => {
      this.kpis = d;
      if (!this.kpiDepartment) this.kpiDepartments = d.byDepartment.map(x => x.department);
      this.kpiChart = this.buildKpiChart(d);
    });
  }

  // ---- Forecast ----

  get isHr(): boolean {
    return this.role === 'HR' || this.role === 'ADMIN';
  }

  loadForecast(): void {
    this.track('forecast', this.api.attendanceForecast(this.forecastHorizon, this.forecastDepartment), d => {
      this.forecast = d;
      this.forecastChart = this.buildForecastChart(d);
    });
    // Leave demand over a matching horizon (in weeks), shown below availability
    const weeks = Math.min(26, Math.max(4, Math.ceil(this.forecastHorizon / 7) + 4));
    this.leaveForecastError = '';
    this.api.leaveForecast(weeks, this.forecastDepartment).pipe(takeUntil(this.destroy$)).subscribe({
      next: d => { this.leaveForecast = d; this.leaveForecastChart = this.buildLeaveForecastChart(d); },
      error: err => { this.leaveForecastError = err?.error?.message || 'Could not load the leave forecast.'; }
    });
    // HR can narrow to a department - the list comes from the KPI store
    if (this.isHr && !this.kpiDepartments.length) {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 89);
      this.api.kpis({ from: ymd(from), to: ymd(to), granularity: 'month' }).pipe(takeUntil(this.destroy$))
        .subscribe({ next: k => { this.kpiDepartments = k.byDepartment.map(x => x.department); }, error: () => {} });
    }
  }

  forecastModelText(f: AttendanceForecast): string {
    const m = f.model.absence;
    if (!m) return '';
    const name = m.type === 'ridge' ? 'Ridge regression (weekday + seasonality + trend)' : 'Same-weekday baseline';
    const quality = m.backtest && m.backtest.improvementVsMeanPct !== null
      ? ` · backtest error ${m.backtest.improvementVsMeanPct}% lower than the historical average`
      : '';
    return `${name}, trained on ${m.trainingDays} working days${quality}`;
  }

  // ---- Assistant ----

  get starterQuestions(): string[] {
    if (this.role === 'EMPLOYEE') {
      return ['How much annual leave do I have left?', 'How has my attendance been this month?', 'How often did I work from home in the last 90 days?'];
    }
    const team = ['Who is on leave next week?', 'Who is late or not checked in today?', 'What is waiting for my approval?', 'Will we be short-staffed in the next two weeks?'];
    return this.isHr ? [...team, 'Which departments use the most leave this year?'] : team;
  }

  ask(text?: string): void {
    const message = (text ?? this.question).trim();
    if (!message || this.asking) return;
    // earlier turns as plain text (failed answers aren't sent back)
    const history: ChatTurn[] = this.chat.filter(t => !t.error).map(({ role, content }) => ({ role, content }));
    this.chat.push({ role: 'user', content: message });
    this.question = '';
    this.asking = true;
    this.api.askAssistant(message, history).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.chat.push({ role: 'assistant', content: r.answer, toolsUsed: r.toolsUsed });
        this.asking = false;
      },
      error: err => {
        this.chat.push({ role: 'assistant', content: err?.error?.message || 'Something went wrong - please try again.', error: true });
        this.asking = false;
      }
    });
  }

  clearChat(): void {
    this.chat = [];
  }

  toolLabel(name: string): string {
    return name.replace(/^get_/, '').replace(/_/g, ' ');
  }

  // Minimal, safe formatting of the model's answer: escape everything, then **bold** and
  // "- " bullet lines. Angular sanitizes [innerHTML] as well.
  formatAnswer(text: string): string {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = escaped.split('\n');
    const out: string[] = [];
    let inList = false;
    for (const line of lines) {
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      if (bullet && !inList) { out.push('<ul>'); inList = true; }
      if (!bullet && inList) { out.push('</ul>'); inList = false; }
      const body = (bullet ? bullet[1] : line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      out.push(bullet ? `<li>${body}</li>` : (body ? `<p>${body}</p>` : ''));
    }
    if (inList) out.push('</ul>');
    return out.join('');
  }

  // ---- Risk ----

  loadRisk(): void {
    this.riskDetail = undefined;
    this.riskDetailFor = null;
    this.track('risk', this.api.riskOverview(this.riskDepartment), d => { this.risk = d; });
    if (this.isHr && !this.kpiDepartments.length) {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 89);
      this.api.kpis({ from: ymd(from), to: ymd(to), granularity: 'month' }).pipe(takeUntil(this.destroy$))
        .subscribe({ next: k => { this.kpiDepartments = k.byDepartment.map(x => x.department); }, error: () => {} });
    }
  }

  // Click a row: the full factor breakdown + recent anomaly alerts (click again to close)
  toggleRiskDetail(userId: string): void {
    if (this.riskDetailFor === userId) {
      this.riskDetailFor = null;
      this.riskDetail = undefined;
      return;
    }
    this.riskDetailFor = userId;
    this.riskDetail = undefined;
    this.riskDetailLoading = true;
    this.api.employeeRisk(userId).pipe(takeUntil(this.destroy$)).subscribe({
      next: d => { if (this.riskDetailFor === userId) this.riskDetail = d; this.riskDetailLoading = false; },
      error: () => { this.riskDetailLoading = false; }
    });
  }

  // ---- Reports ----

  private loadReports(): void {
    this.track('reports', this.api.listReports(), list => {
      this.reports = list;
      this.pollWhilePending();
    });
  }

  // Reports are generated by a worker - refresh the list until none is PENDING
  private pollWhilePending(): void {
    this.reportPoll?.unsubscribe();
    if (!this.reports.some(r => r.status === 'PENDING')) return;
    this.reportPoll = timer(REPORT_POLL_MS).pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.api.listReports().pipe(takeUntil(this.destroy$)).subscribe({
        next: list => { this.reports = list; this.pollWhilePending(); },
        error: () => {}
      });
    });
  }

  requestReport(): void {
    const { reportType, from, to } = this.reportForm;
    if (!from || !to || from > to) {
      this.reportMessage = 'Choose a valid date range.';
      return;
    }
    this.requestingReport = true;
    this.reportMessage = '';
    this.api.requestReport({ reportType, from, to }).pipe(takeUntil(this.destroy$)).subscribe({
      next: report => {
        this.requestingReport = false;
        this.reportMessage = 'Report requested - it is being generated, and you will get a notification when it is ready.';
        this.reports = [report, ...this.reports];
        this.pollWhilePending();
      },
      error: err => {
        this.requestingReport = false;
        this.reportMessage = err?.error?.message || 'Could not request the report.';
      }
    });
  }

  download(report: WorkforceReport): void {
    this.api.downloadReport(report.id).pipe(takeUntil(this.destroy$)).subscribe(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.reportType}_${report.periodStart}_${report.periodEnd}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  reportLabel(type: string): string {
    return this.reportTypes.find(t => t.value === type)?.label || type;
  }

  summaryEntries(report: WorkforceReport): { key: string; value: unknown }[] {
    if (!report.summary) return [];
    return Object.entries(report.summary)
      .filter(([, v]) => typeof v === 'number')
      .map(([key, value]) => ({ key: key.replace(/([A-Z])/g, ' $1').toLowerCase(), value }));
  }

  hoursText(h: number | null | undefined): string {
    if (h === null || h === undefined) return '—';
    return h >= 48 ? `${Math.round((h / 24) * 10) / 10} days` : `${h} h`;
  }

  private lastMonthReportForm(): { reportType: ReportType; from: string; to: string } {
    const now = new Date();
    return {
      reportType: 'attendance-summary',
      from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: ymd(new Date(now.getFullYear(), now.getMonth(), 0))
    };
  }

  // ---- Charts ----

  private buildWorkModeChart(d: WorkMode): ChartConfiguration {
    return {
      type: 'bar',
      data: {
        labels: d.weekly.map(w => `Week of ${w.week}`),
        datasets: [
          { label: 'Office', data: d.weekly.map(w => w.office), backgroundColor: COLORS.blue },
          { label: 'WFH', data: d.weekly.map(w => w.wfh), backgroundColor: COLORS.teal },
          { label: 'Half day', data: d.weekly.map(w => w.halfDay), backgroundColor: COLORS.amber }
        ]
      },
      options: { scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'Employee-days' } } } }
    };
  }

  private buildOvertimeChart(d: Overtime): ChartConfiguration {
    return {
      type: 'bar',
      data: {
        labels: d.weekly.map(w => `Week of ${w.week}`),
        datasets: [{ label: 'Overtime hours', data: d.weekly.map(w => w.overtimeHours), backgroundColor: COLORS.amber }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Hours' } } } }
    };
  }

  private buildForecastChart(d: AttendanceForecast): ChartConfiguration {
    const pct = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : 0);
    return {
      type: 'line',
      data: {
        labels: d.days.map(x => `${x.weekday.slice(0, 3)} ${x.date.slice(5)}`),
        datasets: [
          // p10-p90 band: the "high" line filled down to the "low" line
          { type: 'line', label: 'Likely range (high)', data: d.days.map(x => (x.availableRange ? pct(x.availableRange.high, x.headcount) : null)), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(63, 81, 181, 0.15)', fill: '+1', yAxisID: 'y' },
          { type: 'line', label: 'Likely range (low)', data: d.days.map(x => (x.availableRange ? pct(x.availableRange.low, x.headcount) : null)), borderWidth: 0, pointRadius: 0, fill: false, yAxisID: 'y' },
          { type: 'line', label: 'Expected availability %', data: d.days.map(x => x.availabilityRate), borderColor: COLORS.blue, backgroundColor: COLORS.blue, tension: 0.2, yAxisID: 'y' },
          { type: 'bar', label: 'Booked leave', data: d.days.map(x => x.plannedLeave), backgroundColor: COLORS.amber, yAxisID: 'y1' },
          { type: 'bar', label: 'Pending leave', data: d.days.map(x => x.pendingLeave), backgroundColor: 'rgba(255, 179, 0, 0.35)', yAxisID: 'y1' }
        ]
      } as ChartConfiguration['data'],
      options: {
        plugins: { legend: { labels: { filter: (item) => !String(item.text).startsWith('Likely range') } } },
        scales: {
          y: { min: 0, max: 100, title: { display: true, text: 'Available %' } },
          y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { precision: 0 }, title: { display: true, text: 'People on leave' } }
        }
      }
    };
  }

  private buildLeaveForecastChart(d: LeaveForecast): ChartConfiguration {
    return {
      type: 'bar',
      data: {
        labels: d.weeks.map(w => `${w.spike ? '▲ ' : ''}${w.weekStart.slice(5)}`),
        datasets: [
          { type: 'bar', label: 'Approved', data: d.weeks.map(w => w.bookedDays), backgroundColor: COLORS.blue, stack: 'leave' },
          { type: 'bar', label: 'Pending', data: d.weeks.map(w => w.pendingDays), backgroundColor: 'rgba(63, 81, 181, 0.35)', stack: 'leave' },
          { type: 'bar', label: 'Likely new requests', data: d.weeks.map(w => w.likelyNewRequests), backgroundColor: 'rgba(255, 179, 0, 0.55)', stack: 'leave' },
          { type: 'line', label: 'Expected total', data: d.weeks.map(w => w.expectedDays), borderColor: COLORS.red, backgroundColor: COLORS.red, tension: 0.2 },
          { type: 'line', label: 'Usual week', data: d.weeks.map(() => d.summary.typicalWeekDays), borderColor: COLORS.green, borderDash: [6, 4], pointRadius: 0, fill: false }
        ]
      } as ChartConfiguration['data'],
      options: {
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Leave person-days per week' } }
        }
      }
    };
  }

  private buildKpiChart(d: KpiSeries): ChartConfiguration {
    const line = (label: string, values: number[], color: string) => ({
      label, data: values, borderColor: color, backgroundColor: color, tension: 0.25, pointRadius: 2
    });
    return {
      type: 'line',
      data: {
        labels: d.series.map(s => s.period),
        datasets: [
          line('Attendance %', d.series.map(s => s.attendanceRate), COLORS.blue),
          line('Absence %', d.series.map(s => s.absenceRate), COLORS.red),
          line('Late %', d.series.map(s => s.lateRate), COLORS.amber),
          line('WFH %', d.series.map(s => s.wfhRate), COLORS.teal)
        ]
      },
      options: { scales: { y: { min: 0, max: 100, title: { display: true, text: '%' } } } }
    };
  }

  private buildLifecycleChart(d: Lifecycle): ChartConfiguration {
    return {
      type: 'bar',
      data: {
        labels: d.months.map(m => m.month),
        datasets: [
          { type: 'bar', label: 'Joiners', data: d.months.map(m => m.joiners), backgroundColor: COLORS.green, yAxisID: 'y' },
          { type: 'bar', label: 'Exits', data: d.months.map(m => m.exits), backgroundColor: COLORS.red, yAxisID: 'y' },
          { type: 'line', label: 'Headcount', data: d.months.map(m => m.headcount), borderColor: COLORS.blue, backgroundColor: COLORS.blue, yAxisID: 'y1', tension: 0.25 }
        ]
      } as ChartConfiguration['data'],
      options: {
        scales: {
          y: { beginAtZero: true, position: 'left', title: { display: true, text: 'People' } },
          y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Headcount' } }
        }
      }
    };
  }
}
