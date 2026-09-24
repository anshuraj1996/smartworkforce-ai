import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartConfiguration, ChartType, registerables } from 'chart.js';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { Subject, takeUntil, forkJoin } from 'rxjs';

// Services
import {
  AnalyticsService,
  UserRole,
  DashboardData,
  KPICard,
  AIInsight,
  AttendanceAnalytics,
  LeaveAnalytics,
  PerformanceMetrics,
  AnomalyData,
  DepartmentComparison,
  TeamAnalytics,
  SystemHealth,
  AnalyticsFilters,
  ExportFormat,
  ChartData,
  TrendDirection,
  InsightType,
  Severity
} from './services/analytics.service';
import { AuthService } from '../../core/services/auth.service';

Chart.register(...registerables);

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatMenuModule,
    MatButtonToggleModule,
    MatTooltipModule,
    MatChipsModule,
    MatProgressBarModule,
    MatDialogModule
  ],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss']
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  @ViewChild('attendanceChartCanvas') attendanceChartCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('departmentChartCanvas') departmentChartCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('leaveTypeChartCanvas') leaveTypeChartCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('performanceChartCanvas') performanceChartCanvas?: ElementRef<HTMLCanvasElement>;

  private attendanceChartInstance?: Chart;
  private departmentChartInstance?: Chart;
  private leaveTypeChartInstance?: Chart;
  private performanceChartInstance?: Chart;

  // Current User & Role
  currentUser: any = null;
  currentUserRole: UserRole = UserRole.EMPLOYEE;

  // UI State
  isLoading = false;
  selectedTimeRange: '7d' | '30d' | '90d' | '1y' = '30d';
  selectedTab = 0;

  // Dashboard Data
  dashboardData: DashboardData | null = null;
  kpiCards: KPICard[] = [];
  
  // Analytics Data
  aiInsights: AIInsight[] = [];
  attendanceAnalytics: AttendanceAnalytics | null = null;
  leaveAnalytics: LeaveAnalytics | null = null;
  performanceMetrics: PerformanceMetrics | null = null;
  anomalyData: AnomalyData | null = null;
  departmentComparison: DepartmentComparison[] = [];
  teamAnalytics: TeamAnalytics | null = null;
  systemHealth: SystemHealth | null = null;

  // Chart Data
  attendanceTrendChart: ChartData | null = null;
  departmentChart: ChartData | null = null;
  leaveTypeChart: ChartData | null = null;
  performanceChart: ChartData | null = null;

  // Filters
  currentFilters: AnalyticsFilters = {
    period: '30d'
  };

  // Real-time updates
  autoRefreshEnabled = true;
  lastRefreshTime: Date = new Date();

  // Role-based feature flags
  get canViewOrganizationInsights(): boolean {
    return this.currentUserRole === UserRole.ADMIN || this.currentUserRole === UserRole.HR;
  }

  get canViewTeamInsights(): boolean {
    return this.currentUserRole === UserRole.MANAGER || 
           this.currentUserRole === UserRole.HR || 
           this.currentUserRole === UserRole.ADMIN;
  }

  get canViewSystemHealth(): boolean {
    return this.currentUserRole === UserRole.ADMIN;
  }

  get canExportData(): boolean {
    return this.currentUserRole !== UserRole.EMPLOYEE;
  }

  // Enums for template
  UserRole = UserRole;
  TrendDirection = TrendDirection;
  Severity = Severity;
  InsightType = InsightType;

  constructor(
    private analyticsService: AnalyticsService,
    private authService: AuthService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.initializeCurrentUser();
    this.loadAllAnalytics();
    
    // Setup auto-refresh if enabled
    if (this.autoRefreshEnabled) {
      this.setupAutoRefresh();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.attendanceChartInstance?.destroy();
    this.departmentChartInstance?.destroy();
    this.leaveTypeChartInstance?.destroy();
    this.performanceChartInstance?.destroy();
  }

  // ============================================================================
  // Chart Rendering
  // ============================================================================

  // The chart cards only exist in the DOM once isLoading flips to false (*ngIf), so this
  // has to run a tick after that - can't render onto a canvas that doesn't exist yet.
  private renderCharts(): void {
    setTimeout(() => {
      if (this.attendanceTrendChart) {
        this.attendanceChartInstance = this.renderChart(
          this.attendanceChartCanvas, this.attendanceChartInstance, 'line', this.attendanceTrendChart, this.getLineChartOptions()
        );
      }
      if (this.departmentChart) {
        this.departmentChartInstance = this.renderChart(
          this.departmentChartCanvas, this.departmentChartInstance, 'bar', this.departmentChart, this.getDepartmentChartOptions()
        );
      }
      if (this.leaveTypeChart) {
        this.leaveTypeChartInstance = this.renderChart(
          this.leaveTypeChartCanvas, this.leaveTypeChartInstance, 'doughnut', this.leaveTypeChart, this.getDoughnutChartOptions()
        );
      }
      if (this.performanceChart) {
        this.performanceChartInstance = this.renderChart(
          this.performanceChartCanvas, this.performanceChartInstance, 'bar', this.performanceChart, this.getBarChartOptions()
        );
      }
    });
  }

  private renderChart(
    canvasRef: ElementRef<HTMLCanvasElement> | undefined,
    existing: Chart | undefined,
    type: ChartType,
    data: ChartData,
    options: any
  ): Chart | undefined {
    if (!canvasRef) return existing;

    existing?.destroy();

    const ctx = canvasRef.nativeElement.getContext('2d');
    if (!ctx) return existing;

    return new Chart(ctx, { type, data: data as ChartConfiguration['data'], options });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeCurrentUser(): void {
    this.currentUser = this.authService.getCurrentUser();
    if (this.currentUser) {
      this.currentUserRole = this.currentUser.role as UserRole;
    }

    // Subscribe to user changes
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        if (user) {
          this.currentUser = user;
          this.currentUserRole = user.role as UserRole;
          this.loadAllAnalytics();
        }
      });
  }

  private setupAutoRefresh(): void {
    // Refresh dashboard data every 30 seconds
    this.analyticsService.getDashboardDataWithRefresh()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.dashboardData = data;
          this.kpiCards = this.analyticsService.generateKPICards(data, this.currentUserRole);
          this.lastRefreshTime = new Date();
        },
        error: (error) => console.error('Auto-refresh error:', error)
      });
  }

  // ============================================================================
  // Data Loading
  // ============================================================================

  private loadAllAnalytics(): void {
    this.isLoading = true;

    // Load dashboard and AI insights for all roles
    const baseRequests = {
      dashboard: this.analyticsService.getDashboardData(),
      aiInsights: this.getAIInsightsForRole()
    };

    // Add role-specific requests
    const requests: any = { ...baseRequests };

    if (this.canViewOrganizationInsights) {
      requests.attendance = this.analyticsService.getAttendanceTrends(this.currentFilters);
      requests.leave = this.analyticsService.getLeaveStatistics(this.currentFilters.period || '1y');
      requests.performance = this.analyticsService.getPerformanceOverview();
      requests.departments = this.analyticsService.getDepartmentComparison();
      requests.anomalies = this.analyticsService.getAnomalies(this.currentFilters);
    }

    if (this.canViewTeamInsights && this.currentUserRole === UserRole.MANAGER) {
      requests.team = this.analyticsService.getManagerDashboard();
    }

    if (this.canViewSystemHealth) {
      requests.systemHealth = this.analyticsService.getSystemHealth();
    }

    forkJoin(requests)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (results: any) => {
          this.dashboardData = results.dashboard;
          this.kpiCards = this.analyticsService.generateKPICards(results.dashboard, this.currentUserRole);
          this.aiInsights = results.aiInsights;

          if (results.attendance) {
            this.attendanceAnalytics = results.attendance;
            this.prepareAttendanceChart(results.attendance);
          }

          if (results.leave) {
            this.leaveAnalytics = results.leave;
            this.prepareLeaveTypeChart(results.leave);
          }

          if (results.performance) {
            this.performanceMetrics = results.performance;
            this.preparePerformanceChart(results.performance);
          }

          if (results.departments) {
            this.departmentComparison = results.departments;
            this.prepareDepartmentChart(results.departments);
          }

          if (results.anomalies) {
            this.anomalyData = results.anomalies;
          }

          if (results.team) {
            this.teamAnalytics = results.team;
          }

          if (results.systemHealth) {
            this.systemHealth = results.systemHealth;
          }

          this.isLoading = false;
          this.lastRefreshTime = new Date();
          this.renderCharts();
        },
        error: (error) => {
          console.error('Error loading analytics:', error);
          this.isLoading = false;
        }
      });
  }

  private getAIInsightsForRole() {
    if (this.canViewOrganizationInsights) {
      return this.analyticsService.getOrganizationAIInsights(this.currentFilters);
    } else if (this.canViewTeamInsights) {
      return this.analyticsService.getTeamAIInsights(this.currentFilters);
    } else {
      return this.analyticsService.getMyAIInsights(this.currentFilters);
    }
  }

  // ============================================================================
  // Chart Data Preparation
  // ============================================================================

  private prepareAttendanceChart(data: AttendanceAnalytics): void {
    if (!data.trends || data.trends.length === 0) return;

    this.attendanceTrendChart = {
      labels: data.trends.map(t => this.formatChartDate(t.date)),
      datasets: [
        {
          label: 'Present',
          data: data.trends.map(t => t.present),
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true
        },
        {
          label: 'Late',
          data: data.trends.map(t => t.late),
          borderColor: '#F59E0B',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          fill: true
        },
        {
          label: 'Absent',
          data: data.trends.map(t => t.absent),
          borderColor: '#EF4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: true
        }
      ]
    };
  }

  private prepareDepartmentChart(data: DepartmentComparison[]): void {
    if (!data || data.length === 0) return;

    const colors = [
      '#3B82F6', '#10B981', '#F59E0B', '#EF4444', 
      '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
    ];

    this.departmentChart = {
      labels: data.map(d => d.department),
      datasets: [{
        label: 'Employees',
        data: data.map(d => d.employeeCount),
        backgroundColor: colors.slice(0, data.length)
      }]
    };
  }

  private prepareLeaveTypeChart(data: LeaveAnalytics): void {
    if (!data.typeDistribution) return;

    const types = Object.keys(data.typeDistribution);
    const values = Object.values(data.typeDistribution);

    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

    this.leaveTypeChart = {
      labels: types,
      datasets: [{
        label: 'Leave Distribution',
        data: values,
        backgroundColor: colors.slice(0, types.length)
      }]
    };
  }

  private preparePerformanceChart(data: PerformanceMetrics): void {
    this.performanceChart = {
      labels: ['Productivity', 'Engagement', 'Task Completion'],
      datasets: [{
        label: 'Performance Metrics',
        data: [
          data.productivityScore,
          data.engagementLevel,
          data.taskCompletionRate
        ],
        backgroundColor: [
          'rgba(59, 130, 246, 0.7)',
          'rgba(16, 185, 129, 0.7)',
          'rgba(139, 92, 246, 0.7)'
        ]
      }]
    };
  }

  // ============================================================================
  // Filter Management
  // ============================================================================

  onTimeRangeChange(range: '7d' | '30d' | '90d' | '1y'): void {
    this.selectedTimeRange = range;
    this.currentFilters = {
      ...this.currentFilters,
      period: range
    };
    this.loadAllAnalytics();
  }

  applyFilters(filters: AnalyticsFilters): void {
    this.currentFilters = filters;
    this.loadAllAnalytics();
  }

  resetFilters(): void {
    this.currentFilters = { period: '30d' };
    this.selectedTimeRange = '30d';
    this.loadAllAnalytics();
  }

  // ============================================================================
  // Export Functionality
  // ============================================================================

  exportDashboard(format: ExportFormat): void {
    if (!this.canExportData) {
      alert('You do not have permission to export data.');
      return;
    }

    this.analyticsService.exportReport(format, 'dashboard', this.currentFilters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          this.downloadBlob(blob, `analytics-dashboard.${format}`);
        },
        error: (error) => {
          alert(`Error exporting data: ${error.message}`);
        }
      });
  }

  exportChart(chartName: string, format: ExportFormat = 'png'): void {
    // TODO: Implement chart-specific export
    console.log(`Exporting ${chartName} as ${format}`);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  // ============================================================================
  // UI Actions
  // ============================================================================

  refreshData(): void {
    this.loadAllAnalytics();
  }

  toggleAutoRefresh(): void {
    this.autoRefreshEnabled = !this.autoRefreshEnabled;
    
    if (this.autoRefreshEnabled) {
      this.setupAutoRefresh();
    }
  }

  onTabChange(index: number): void {
    this.selectedTab = index;
  }

  viewInsightDetails(insight: AIInsight): void {
    this.dialog.open(AnalyticsDetailDialogComponent, {
      width: '520px',
      data: {
        icon: 'psychology',
        title: insight.title || 'AI Insight',
        rows: [
          { label: 'Affected', value: insight.userName || 'Team-wide' },
          { label: 'Type', value: insight.insightType },
          { label: 'Score', value: `${insight.score}` },
          { label: 'Severity', value: insight.severity },
          { label: 'Trend', value: insight.trend },
          { label: 'Explanation', value: insight.explanation }
        ],
        recommendations: insight.recommendations || []
      }
    });
  }

  viewAnomalyDetails(anomaly: any): void {
    this.dialog.open(AnalyticsDetailDialogComponent, {
      width: '520px',
      data: {
        icon: 'warning',
        title: `Anomaly: ${anomaly.type}`,
        rows: [
          { label: 'Employee', value: anomaly.userName },
          { label: 'Date', value: this.formatChartDate(anomaly.date) },
          { label: 'Observed value', value: `${anomaly.value}` },
          { label: 'Expected range', value: `${anomaly.expectedRange?.[0]} - ${anomaly.expectedRange?.[1]}` },
          { label: 'Severity', value: anomaly.severity },
          { label: 'Explanation', value: anomaly.explanation }
        ],
        recommendations: []
      }
    });
  }

  viewDepartmentDetails(dept: DepartmentComparison): void {
    this.dialog.open(AnalyticsDetailDialogComponent, {
      width: '480px',
      data: {
        icon: 'apartment',
        title: dept.department,
        rows: [
          { label: 'Attendance', value: `${dept.attendance}%` },
          { label: 'Performance', value: `${dept.performance}%` },
          { label: 'Productivity', value: `${dept.productivity}%` }
        ],
        recommendations: []
      }
    });
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  formatChartDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  formatDate(date: Date | string): string {
    return this.analyticsService.formatDate(date);
  }

  formatTimeAgo(date: Date | string): string {
    return this.analyticsService.formatTimeAgo(date);
  }

  getTrendIcon(trend: TrendDirection): string {
    return this.analyticsService.getTrendIcon(trend);
  }

  getSeverityColor(severity: Severity): string {
    return this.analyticsService.getSeverityColor(severity);
  }

  getSeverityClass(severity: Severity): string {
    const classes: { [key in Severity]: string } = {
      [Severity.LOW]: 'severity-low',
      [Severity.MEDIUM]: 'severity-medium',
      [Severity.HIGH]: 'severity-high'
    };
    return classes[severity];
  }

  getInsightTypeIcon(type: InsightType): string {
    const icons: { [key in InsightType]: string } = {
      [InsightType.LATE_ARRIVAL_PATTERN]: 'schedule',
      [InsightType.BEHAVIOR_PATTERN]: 'psychology',
      [InsightType.ANOMALY_DETECTION]: 'warning',
      [InsightType.PERFORMANCE_INSIGHT]: 'trending_up',
      [InsightType.TEAM_INSIGHT]: 'groups'
    };
    return icons[type];
  }

  getTrendClass(trend: TrendDirection): string {
    if (trend === TrendDirection.UP || trend === TrendDirection.IMPROVING) {
      return 'trend-positive';
    } else if (trend === TrendDirection.DOWN || trend === TrendDirection.DECLINING) {
      return 'trend-negative';
    }
    return 'trend-stable';
  }

  getKPICardClass(color: string): string {
    const colorMap: { [key: string]: string } = {
      'success': 'kpi-success',
      'warning': 'kpi-warning',
      'danger': 'kpi-danger',
      'info': 'kpi-info',
      'primary': 'kpi-primary'
    };
    return colorMap[color] || 'kpi-primary';
  }

  // ============================================================================
  // Chart Configuration
  // ============================================================================

  getLineChartOptions(): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        }
      }
    };
  }

  getDoughnutChartOptions(): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom'
        },
        tooltip: {
          enabled: true
        }
      }
    };
  }

  getBarChartOptions(): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        }
      }
    };
  }

  // Same bar chart, plus a click handler so a bar is a second drill-down entry point
  // into the same department detail dialog the table row click already opens.
  getDepartmentChartOptions(): any {
    const options = this.getBarChartOptions();
    options.onClick = (_event: any, elements: any[]) => {
      if (!elements.length) return;
      const dept = this.departmentComparison[elements[0].index];
      if (dept) {
        this.viewDepartmentDetails(dept);
      }
    };
    return options;
  }
}

// Generic drill-down dialog shared by insight, anomaly, and department detail views -
// all three just render a real field/value list from whatever record was clicked.
@Component({
  selector: 'app-analytics-detail-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatListModule, MatIconModule, MatButtonModule, MatChipsModule],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>{{ data.icon }}</mat-icon>
      {{ data.title }}
    </h2>
    <mat-dialog-content>
      <mat-list>
        <mat-list-item *ngFor="let row of data.rows">
          <div matListItemTitle>{{ row.label }}</div>
          <div matListItemLine>{{ row.value }}</div>
        </mat-list-item>
      </mat-list>
      <div class="recommendations" *ngIf="data.recommendations?.length">
        <h4>Recommendations</h4>
        <mat-chip-listbox>
          <mat-chip *ngFor="let rec of data.recommendations">{{ rec }}</mat-chip>
        </mat-chip-listbox>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { max-height: 60vh; overflow-y: auto; }
    .recommendations { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.08); }
    .recommendations h4 { margin: 0 0 8px; font-size: 0.875rem; color: #666; }
  `]
})
export class AnalyticsDetailDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: any) {}
}