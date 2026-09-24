import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { interval, Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { AuthService } from '../../core/services/auth.service';
import { AttendanceService } from '../attendance/services/attendance.service';
import { LeaveService } from '../leave/services/leave.service';
import { AnnouncementsService, FeedItem } from '../announcements/services/announcements.service';
import { AnalyticsService } from '../analytics/services/analytics.service';
import { TeamService } from '../team/services/team.service';

Chart.register(...registerables);

interface DashboardStats {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  pendingLeaves: number;
}

interface ActivityItem {
  icon: string;
  title: string;
  description: string;
  time: string;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  status: string;
  checkInTime?: string;
}

interface LeaveRequestSummary {
  id: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
}

const FEED_ICONS: Record<string, string> = {
  ANNOUNCEMENT: 'campaign',
  BIRTHDAY: 'cake',
  NEW_JOINER: 'waving_hand'
};

// Matches the backend's dashboard cache TTL (20s) plus headroom, so polling this often
// almost always serves a fresh Redis-cached response instead of hitting the database.
const DASHBOARD_REFRESH_INTERVAL_MS = 30000;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatGridListModule,
    MatDialogModule,
    MatListModule,
    MatDividerModule,
    MatProgressBarModule,
    MatTooltipModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('dashboardChart') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;
  private pendingChartConfig: ChartConfiguration | null = null;

  currentDate = new Date();
  currentTime = new Date();
  lastUpdated: Date | null = null;
  private timeSubscription?: Subscription;
  private refreshSubscription?: Subscription;

  isLoading = true;

  stats: DashboardStats = {
    totalEmployees: 0,
    presentToday: 0,
    lateToday: 0,
    pendingLeaves: 0
  };

  recentActivities: ActivityItem[] = [];
  allEmployees: Employee[] = [];
  lateEmployees: Employee[] = [];
  pendingLeaveRequests: LeaveRequestSummary[] = [];

  currentUser: any = null;

  constructor(
    private dialog: MatDialog,
    private authService: AuthService,
    private attendanceService: AttendanceService,
    private leaveService: LeaveService,
    private announcementsService: AnnouncementsService,
    private analyticsService: AnalyticsService,
    private teamService: TeamService
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.loadDashboardData();
      }
    });

    this.timeSubscription = interval(60000).subscribe(() => {
      this.currentTime = new Date();
    });

    this.refreshSubscription = interval(DASHBOARD_REFRESH_INTERVAL_MS).subscribe(() => {
      if (this.currentUser) {
        this.loadDashboardData();
      }
    });
  }

  ngAfterViewInit(): void {
    // Data usually arrives before the view is ready to draw on, but cover the reverse order too.
    if (this.pendingChartConfig) {
      this.drawChart(this.pendingChartConfig);
    }
  }

  ngOnDestroy(): void {
    if (this.timeSubscription) {
      this.timeSubscription.unsubscribe();
    }
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
    }
    if (this.chart) {
      this.chart.destroy();
    }
  }

  getAttendanceRate(): number {
    if (this.stats.totalEmployees === 0) return 0;
    return Math.round((this.stats.presentToday / this.stats.totalEmployees) * 100);
  }

  // Card click handlers
  onTotalEmployeesClick(): void {
    this.dialog.open(EmployeeListDialogComponent, {
      width: '600px',
      data: { title: 'All Employees', employees: this.allEmployees, type: 'all' }
    });
  }

  onPresentTodayClick(): void {
    const presentEmployees = this.allEmployees.filter(emp => emp.status === 'Present');
    this.dialog.open(EmployeeListDialogComponent, {
      width: '600px',
      data: { title: 'Present Today', employees: presentEmployees, type: 'present' }
    });
  }

  onLateArrivalsClick(): void {
    this.dialog.open(EmployeeListDialogComponent, {
      width: '600px',
      data: { title: 'Late Arrivals Today', employees: this.lateEmployees, type: 'late' }
    });
  }

  onPendingLeavesClick(): void {
    const dialogRef = this.dialog.open(LeaveRequestDialogComponent, {
      width: '700px',
      data: { title: 'Pending Leave Requests', leaveRequests: this.pendingLeaveRequests }
    });

    dialogRef.afterClosed().subscribe(() => this.loadDashboardData());
  }

  refreshData(): void {
    this.loadDashboardData();
  }

  get userRole(): string {
    return this.currentUser?.role || 'EMPLOYEE';
  }

  get isEmployee(): boolean {
    return this.userRole === 'EMPLOYEE';
  }

  get isManager(): boolean {
    return this.userRole === 'MANAGER';
  }

  get isHR(): boolean {
    return this.userRole === 'HR';
  }

  get isAdmin(): boolean {
    return this.userRole === 'ADMIN';
  }

  private loadDashboardData(): void {
    this.isLoading = true;

    this.announcementsService.getFeed().pipe(catchError(() => of([] as FeedItem[]))).subscribe(feed => {
      this.recentActivities = feed.slice(0, 4).map(item => ({
        icon: FEED_ICONS[item.type] || 'notifications',
        title: item.title,
        description: item.body,
        time: this.formatTimeAgo(item.timestamp)
      }));
    });

    if (this.isEmployee) {
      this.loadEmployeeStats();
    } else {
      this.loadTeamOrOrgStats();
    }
  }

  private loadEmployeeStats(): void {
    forkJoin({
      today: this.attendanceService.getTodayStatus().pipe(catchError(() => of(null))),
      myLeaves: this.leaveService.getMyLeaveRequests('PENDING').pipe(catchError(() => of([]))),
      history: this.attendanceService.getAttendanceHistory(undefined, undefined, 1, 7).pipe(catchError(() => of(null)))
    }).subscribe(({ today, myLeaves, history }) => {
      const isPresent = !!today?.checkInTime;
      const isLate = today?.attendanceType === 'LATE';

      this.stats = {
        totalEmployees: 0,
        presentToday: isPresent ? 1 : 0,
        lateToday: isLate ? 1 : 0,
        pendingLeaves: (myLeaves || []).length
      };

      this.allEmployees = [];
      this.lateEmployees = [];
      this.pendingLeaveRequests = [];
      this.isLoading = false;
      this.lastUpdated = new Date();

      this.buildPersonalHoursChart((history?.data || []).slice().reverse());
    });
  }

  private loadTeamOrOrgStats(): void {
    forkJoin({
      team: this.attendanceService.getTeamAttendance().pipe(catchError(() => of([]))),
      pendingLeaves: this.leaveService.getPendingLeaveRequests().pipe(catchError(() => of([]))),
      trends: this.analyticsService.getAttendanceTrends({ period: '7d' }).pipe(catchError(() => of(null)))
    }).subscribe(({ team, pendingLeaves, trends }) => {
      const members: any[] = team || [];

      this.allEmployees = members.map(m => this.toEmployee(m));
      this.lateEmployees = this.allEmployees.filter(e => e.status === 'Late');

      this.stats = {
        totalEmployees: members.length,
        presentToday: this.allEmployees.filter(e => e.status === 'Present').length,
        lateToday: this.lateEmployees.length,
        pendingLeaves: (pendingLeaves || []).length
      };

      this.pendingLeaveRequests = (pendingLeaves || []).map((r: any) => ({
        id: r.id,
        employeeName: r.user?.name || 'Unknown',
        type: this.formatLeaveType(r.leaveType),
        startDate: r.startDate,
        endDate: r.endDate,
        reason: r.reason
      }));

      this.isLoading = false;
      this.lastUpdated = new Date();

      this.buildTeamTrendChart(trends?.trends || []);
    });
  }

  private buildPersonalHoursChart(records: any[]): void {
    const labels = records.map(r => new Date(r.date).toLocaleDateString('en-US', { weekday: 'short' }));
    const hours = records.map(r => r.workingMinutes ? Math.round((r.workingMinutes / 60) * 100) / 100 : 0);

    this.drawChart({
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Hours Worked',
          data: hours,
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3
        }]
      },
      options: this.chartOptions('Hours')
    });
  }

  private buildTeamTrendChart(trends: { date: string, present: number, late: number, absent: number }[]): void {
    const labels = trends.map(t => new Date(t.date).toLocaleDateString('en-US', { weekday: 'short' }));

    this.drawChart({
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Present', data: trends.map(t => t.present), backgroundColor: '#10B981' },
          { label: 'Late', data: trends.map(t => t.late), backgroundColor: '#F59E0B' },
          { label: 'Absent', data: trends.map(t => t.absent), backgroundColor: '#EF4444' }
        ]
      },
      options: this.chartOptions('People')
    });
  }

  private chartOptions(yLabel: string): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'top' } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: yLabel } }
      }
    };
  }

  private drawChart(config: ChartConfiguration): void {
    this.pendingChartConfig = config;
    if (!this.chartCanvas) return; // view not ready yet - ngAfterViewInit will pick it up

    if (this.chart) {
      this.chart.destroy();
    }

    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    this.chart = new Chart(ctx, config);
  }

  private toEmployee(member: any): Employee {
    const attendanceType = member.attendance?.attendanceType;
    let status = 'Absent';
    if (attendanceType === 'LATE') status = 'Late';
    else if (attendanceType === 'PRESENT' || attendanceType === 'WORK_FROM_HOME' || attendanceType === 'HALF_DAY') status = 'Present';

    return {
      id: member.user?.id,
      name: member.user?.name || 'Unknown',
      role: member.user?.department || '',
      status,
      checkInTime: member.attendance?.checkInTime || undefined
    };
  }

  private formatLeaveType(type: string): string {
    if (!type) return '';
    return type.charAt(0) + type.slice(1).toLowerCase();
  }

  private formatTimeAgo(timestamp: string): string {
    const diffMs = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }
}

// Employee List Dialog Component
@Component({
  selector: 'app-employee-list-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>{{ getIcon() }}</mat-icon>
      {{ data.title }}
    </h2>
    <mat-dialog-content>
      <mat-list>
        <mat-list-item *ngFor="let employee of data.employees" class="clickable" (click)="openDetail(employee)">
          <mat-icon matListItemIcon [class]="getStatusClass(employee.status)">
            {{ getStatusIcon(employee.status) }}
          </mat-icon>
          <div matListItemTitle>{{ employee.name }}</div>
          <div matListItemLine>{{ employee.role }}</div>
          <div matListItemMeta *ngIf="employee.checkInTime">
            <span class="check-in-time">{{ employee.checkInTime }}</span>
          </div>
        </mat-list-item>
        <div class="empty-state" *ngIf="data.employees.length === 0">Nothing to show</div>
      </mat-list>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .status-present { color: #4caf50; }
    .status-late { color: #ff9800; }
    .status-absent { color: #f44336; }
    .check-in-time { font-size: 0.875rem; color: #666; }
    .empty-state { padding: 16px; color: #999; text-align: center; }
    mat-dialog-content { max-height: 400px; overflow-y: auto; }
    .clickable { cursor: pointer; }
    .clickable:hover { background: rgba(0, 0, 0, 0.04); }
  `]
})
export class EmployeeListDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private dialog: MatDialog,
    private teamService: TeamService
  ) {}

  getIcon(): string {
    switch (this.data.type) {
      case 'all': return 'group';
      case 'present': return 'check_circle';
      case 'late': return 'schedule';
      default: return 'group';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'Present': return 'check_circle';
      case 'Late': return 'schedule';
      case 'Absent': return 'cancel';
      default: return 'help';
    }
  }

  getStatusClass(status: string): string {
    return `status-${status.toLowerCase()}`;
  }

  openDetail(employee: Employee): void {
    if (!employee.id) return;

    this.dialog.open(EmployeeAttendanceHistoryDialogComponent, {
      width: '480px',
      data: { employee, teamService: this.teamService }
    });
  }
}

// Employee Attendance History Dialog - the drill-down target from the employee list
// above: a real fetch of that specific person's recent attendance, not derived data.
@Component({
  selector: 'app-employee-attendance-history-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatListModule, MatIconModule, MatButtonModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>history</mat-icon>
      {{ data.employee.name }} - Recent Attendance
    </h2>
    <mat-dialog-content>
      <mat-progress-bar mode="indeterminate" *ngIf="isLoading"></mat-progress-bar>
      <mat-list *ngIf="!isLoading">
        <mat-list-item *ngFor="let record of records">
          <div matListItemTitle>{{ formatDate(record.date) }}</div>
          <div matListItemLine>
            {{ record.attendanceType || 'N/A' }}
            <span *ngIf="record.checkInTime"> • In: {{ record.checkInTime }}</span>
            <span *ngIf="record.checkOutTime"> • Out: {{ record.checkOutTime }}</span>
          </div>
        </mat-list-item>
        <div class="empty-state" *ngIf="records.length === 0">No recent attendance records</div>
      </mat-list>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .empty-state { padding: 16px; color: #999; text-align: center; }
    mat-dialog-content { max-height: 400px; overflow-y: auto; min-height: 80px; }
  `]
})
export class EmployeeAttendanceHistoryDialogComponent implements OnInit {
  records: any[] = [];
  isLoading = true;

  constructor(@Inject(MAT_DIALOG_DATA) public data: any) {}

  ngOnInit(): void {
    this.data.teamService.getMemberAttendanceHistory(this.data.employee.id).subscribe({
      next: (records: any[]) => {
        this.records = (records || []).slice(0, 10);
        this.isLoading = false;
      },
      error: () => {
        this.records = [];
        this.isLoading = false;
      }
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
}

// Leave Request Dialog Component
@Component({
  selector: 'app-leave-request-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatSnackBarModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>event_available</mat-icon>
      {{ data.title }}
    </h2>
    <mat-dialog-content>
      <mat-list>
        <mat-list-item *ngFor="let request of data.leaveRequests">
          <mat-icon matListItemIcon class="leave-icon">person</mat-icon>
          <div matListItemTitle>{{ request.employeeName }}</div>
          <div matListItemLine>
            <strong>{{ request.type }}</strong> •
            {{ formatDate(request.startDate) }} - {{ formatDate(request.endDate) }}
          </div>
          <div matListItemLine class="reason">{{ request.reason }}</div>
          <div matListItemMeta class="actions">
            <button mat-icon-button color="primary" (click)="approveLeave(request)">
              <mat-icon>check</mat-icon>
            </button>
            <button mat-icon-button color="warn" (click)="rejectLeave(request)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        </mat-list-item>
        <div class="empty-state" *ngIf="data.leaveRequests.length === 0">Nothing pending</div>
      </mat-list>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .leave-icon { color: #2196f3; }
    .reason { color: #666; font-style: italic; }
    .actions { display: flex; gap: 4px; }
    .empty-state { padding: 16px; color: #999; text-align: center; }
    mat-dialog-content { max-height: 400px; overflow-y: auto; }
  `]
})
export class LeaveRequestDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private leaveService: LeaveService,
    private snackBar: MatSnackBar
  ) {}

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  approveLeave(request: any): void {
    this.leaveService.approveLeaveRequest(request.id).subscribe({
      next: () => {
        this.removeFromList(request);
        this.snackBar.open('Leave request approved', 'Close', { duration: 2000 });
      },
      error: (err) => this.snackBar.open(err?.error?.message || 'Failed to approve', 'Close', { duration: 3000 })
    });
  }

  rejectLeave(request: any): void {
    const reason = window.prompt('Reason for rejecting this leave request?');
    if (!reason) return;

    this.leaveService.rejectLeaveRequest(request.id, reason).subscribe({
      next: () => {
        this.removeFromList(request);
        this.snackBar.open('Leave request rejected', 'Close', { duration: 2000 });
      },
      error: (err) => this.snackBar.open(err?.error?.message || 'Failed to reject', 'Close', { duration: 3000 })
    });
  }

  private removeFromList(request: any): void {
    const idx = this.data.leaveRequests.indexOf(request);
    if (idx > -1) this.data.leaveRequests.splice(idx, 1);
  }
}
