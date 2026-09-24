import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { Chart, ChartConfiguration, ChartType, registerables } from 'chart.js';
import { AttendanceService } from './services/attendance.service';

Chart.register(...registerables);

interface AttendanceRecord {
  id: string;
  date: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: 'Present' | 'Late' | 'Absent' | 'Working' | 'Completed';
  workHours: number;
  isLate: boolean;
  lateMinutes?: number;
  employeeName?: string;
}

interface AttendanceStats {
  todayStatus: string;
  totalWorkingDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  averageWorkingHours: number;
  attendanceRate: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  avgWorkHours: number;
}

const EMPTY_STATS: AttendanceStats = {
  todayStatus: 'Not Checked In',
  totalWorkingDays: 0,
  presentDays: 0,
  lateDays: 0,
  absentDays: 0,
  averageWorkingHours: 0,
  attendanceRate: 0,
  presentToday: 0,
  lateToday: 0,
  absentToday: 0,
  avgWorkHours: 0
};

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatChipsModule,
    MatSnackBarModule
  ],
  templateUrl: './attendance.component.html',
  styleUrls: ['./attendance.component.scss']
})
export class AttendanceComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('attendanceChart') chartCanvas!: ElementRef<HTMLCanvasElement>;

  currentUser: any = null;
  currentDateTime = new Date();
  isCheckedIn = false;
  isLoading = false;

  stats: AttendanceStats = { ...EMPTY_STATS };
  recentAttendance: AttendanceRecord[] = [];
  filteredRecords: AttendanceRecord[] = [];
  selectedPeriod = '30';

  displayedColumns: string[] = ['date', 'checkIn', 'checkOut', 'status', 'workHours', 'actions'];

  private chart: Chart | null = null;
  private timeInterval: any;

  constructor(
    private authService: AuthService,
    private attendanceService: AttendanceService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) this.loadAttendanceData();
    });

    this.timeInterval = setInterval(() => {
      this.currentDateTime = new Date();
    }, 60000);
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.initializeChart(), 500);
  }

  ngOnDestroy(): void {
    if (this.timeInterval) clearInterval(this.timeInterval);
    if (this.chart) this.chart.destroy();
  }

  private initializeChart(): void {
    if (!this.chartCanvas || !this.isEmployee) return;

    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const byDay: { [key: string]: number } = {};
    this.recentAttendance.slice(0, 7).forEach(r => {
      const day = new Date(r.date).toLocaleDateString('en-US', { weekday: 'short' });
      byDay[day] = r.workHours;
    });
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const data = labels.map(d => byDay[d] || 0);

    const config: ChartConfiguration = {
      type: 'line' as ChartType,
      data: {
        labels,
        datasets: [
          {
            label: 'Working Hours',
            data,
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderColor: 'rgb(59, 130, 246)',
            borderWidth: 2,
            fill: true,
            tension: 0.4
          },
          {
            label: 'Expected Hours',
            data: labels.map(() => 8),
            backgroundColor: 'rgba(156, 163, 175, 0.1)',
            borderColor: 'rgb(156, 163, 175)',
            borderWidth: 1,
            borderDash: [5, 5],
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: 'Weekly Working Hours', font: { size: 16, weight: 'bold' } },
          legend: { display: true, position: 'top' }
        },
        scales: {
          x: { title: { display: true, text: 'Days of Week' } },
          y: { title: { display: true, text: 'Hours' }, beginAtZero: true, max: 12 }
        },
        interaction: { intersect: false, mode: 'index' }
      }
    };

    this.chart = new Chart(ctx, config);
  }

  private loadAttendanceData(): void {
    this.isLoading = true;

    if (this.isEmployee) {
      this.attendanceService.getAttendanceHistory(undefined, undefined, 1, 30).subscribe({
        next: (result) => {
          this.recentAttendance = (result?.data || []).map((r: any) => this.toRecord(r, this.currentUser?.name));
          this.checkTodayStatus();
          this.filterRecords();
          this.initializeChart();
          this.isLoading = false;
        },
        error: () => { this.isLoading = false; }
      });

      this.attendanceService.getAttendanceStats().subscribe({
        next: (s: any) => {
          this.stats = {
            ...this.stats,
            totalWorkingDays: s.totalDays ?? 0,
            presentDays: s.presentDays ?? 0,
            lateDays: s.lateDays ?? 0,
            absentDays: (s.totalDays ?? 0) - (s.presentDays ?? 0) - (s.lateDays ?? 0),
            averageWorkingHours: s.averageWorkingHours ?? 0,
            attendanceRate: s.attendancePercentage ?? 0
          };
        }
      });
    } else {
      this.attendanceService.getTeamAttendance().subscribe({
        next: (team: any[]) => {
          this.recentAttendance = (team || []).map((m: any) => this.toTeamRecord(m));
          this.filteredRecords = this.recentAttendance;

          const present = this.recentAttendance.filter(r => r.status === 'Present').length;
          const late = this.recentAttendance.filter(r => r.status === 'Late').length;
          const withHours = this.recentAttendance.filter(r => r.workHours > 0);
          const avg = withHours.length
            ? withHours.reduce((sum, r) => sum + r.workHours, 0) / withHours.length
            : 0;

          this.stats = {
            ...this.stats,
            presentToday: present,
            lateToday: late,
            absentToday: this.recentAttendance.length - present - late,
            avgWorkHours: Math.round(avg * 10) / 10
          };
          this.isLoading = false;
        },
        error: () => { this.isLoading = false; }
      });
    }
  }

  private toRecord(log: any, employeeName?: string): AttendanceRecord {
    const workHours = log.workingMinutes ? Math.round((log.workingMinutes / 60) * 100) / 100 : 0;
    let status: AttendanceRecord['status'] = this.mapAttendanceType(log.attendanceType);
    if (log.checkInTime && !log.checkOutTime) status = 'Working';

    return {
      id: log.id,
      date: log.date,
      checkInTime: log.checkInTime,
      checkOutTime: log.checkOutTime,
      status,
      workHours,
      isLate: log.attendanceType === 'LATE',
      lateMinutes: log.lateMinutes,
      employeeName
    };
  }

  private toTeamRecord(member: any): AttendanceRecord {
    const attendance = member.attendance;
    const record = attendance ? this.toRecord(attendance, member.user?.name) : null;

    return record || {
      id: member.user?.id,
      date: new Date().toISOString().split('T')[0],
      checkInTime: null,
      checkOutTime: null,
      status: 'Absent',
      workHours: 0,
      isLate: false,
      employeeName: member.user?.name || 'Unknown'
    };
  }

  private mapAttendanceType(type: string): AttendanceRecord['status'] {
    switch (type) {
      case 'LATE': return 'Late';
      case 'ABSENT': return 'Absent';
      case 'PRESENT':
      case 'WORK_FROM_HOME':
      case 'HALF_DAY':
      default:
        return 'Present';
    }
  }

  private checkTodayStatus(): void {
    const today = this.todayAttendance;
    this.isCheckedIn = !!(today && today.checkInTime && !today.checkOutTime);
    this.stats.todayStatus = today?.status || 'Not Checked In';
  }

  checkIn(): void {
    this.isLoading = true;

    this.attendanceService.checkIn({ location: 'Office', notes: '', timestamp: new Date().toISOString() }).subscribe({
      next: () => {
        this.isLoading = false;
        this.snackBar.open('Successfully checked in!', 'Close', { duration: 3000, panelClass: ['success-snackbar'] });
        this.loadAttendanceData();
      },
      error: (err) => {
        this.isLoading = false;
        this.snackBar.open(err?.error?.message || 'Check-in failed', 'Close', { duration: 3000 });
      }
    });
  }

  checkOut(): void {
    this.isLoading = true;

    this.attendanceService.checkOut().subscribe({
      next: () => {
        this.isLoading = false;
        this.snackBar.open('Successfully checked out!', 'Close', { duration: 3000, panelClass: ['success-snackbar'] });
        this.loadAttendanceData();
      },
      error: (err) => {
        this.isLoading = false;
        this.snackBar.open(err?.error?.message || 'Check-out failed', 'Close', { duration: 3000 });
      }
    });
  }

  getStatusClass(status: string): string {
    const statusMap: { [key: string]: string } = {
      'Present': 'attendance-status-present',
      'Late': 'attendance-status-late',
      'Absent': 'attendance-status-absent',
      'Working': 'attendance-status-working',
      'Completed': 'attendance-status-completed'
    };
    return statusMap[status] || '';
  }

  getStatusIcon(status?: string): string {
    const iconMap: { [key: string]: string } = {
      'Present': 'check_circle',
      'Late': 'schedule',
      'Absent': 'cancel',
      'Working': 'work',
      'Completed': 'check_circle_outline'
    };
    return iconMap[status || this.stats.todayStatus] || 'help';
  }

  get isEmployee(): boolean {
    return this.currentUser?.role === 'EMPLOYEE';
  }

  get currentDate(): Date {
    return this.currentDateTime;
  }

  get currentTime(): Date {
    return this.currentDateTime;
  }

  get todayAttendance(): AttendanceRecord | null {
    const today = new Date().toISOString().split('T')[0];
    return this.recentAttendance.find(r => r.date === today) || null;
  }

  getStatusCardClass(): string {
    const cardMap: { [key: string]: string } = {
      'Present': 'bg-green-50 border-green-200',
      'Late': 'bg-orange-50 border-orange-200',
      'Absent': 'bg-red-50 border-red-200',
      'Working': 'bg-blue-50 border-blue-200',
      'Completed': 'bg-green-50 border-green-200'
    };
    return cardMap[this.stats.todayStatus] || 'bg-gray-50 border-gray-200';
  }

  getStatusText(): string {
    return this.stats.todayStatus;
  }

  getStatusIconClass(): string {
    const colorMap: { [key: string]: string } = {
      'Present': 'text-green-500',
      'Late': 'text-orange-500',
      'Absent': 'text-red-500',
      'Working': 'text-blue-500',
      'Completed': 'text-green-500'
    };
    return colorMap[this.stats.todayStatus] || 'text-gray-500';
  }

  getAttendanceStatusClass(status: string): string {
    const badgeMap: { [key: string]: string } = {
      'Present': 'bg-green-100 text-green-800',
      'Late': 'bg-orange-100 text-orange-800',
      'Absent': 'bg-red-100 text-red-800',
      'Working': 'bg-blue-100 text-blue-800',
      'Completed': 'bg-green-100 text-green-800'
    };
    return badgeMap[status] || 'bg-gray-100 text-gray-800';
  }

  getTotalWorkHours(): string {
    const today = this.todayAttendance;
    if (today?.workHours) {
      return this.formatWorkingHours(today.workHours);
    }
    if (today?.checkInTime && !today.checkOutTime) {
      const [h, m] = today.checkInTime.split(':').map(Number);
      const checkIn = new Date();
      checkIn.setHours(h, m, 0, 0);
      const elapsedHours = (this.currentDateTime.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
      return this.formatWorkingHours(Math.max(elapsedHours, 0));
    }
    return '0h 0m';
  }

  filterRecords(): void {
    if (!this.isEmployee) {
      this.filteredRecords = this.recentAttendance;
      return;
    }

    const days = parseInt(this.selectedPeriod, 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    this.filteredRecords = this.recentAttendance.filter(r => new Date(r.date) >= cutoff);
  }

  formatTime(time: string | null): string {
    if (!time) return '-';
    return time;
  }

  formatWorkingHours(hours: number): string {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  }

  refreshData(): void {
    this.loadAttendanceData();
  }

  get canCheckIn(): boolean {
    return !this.isCheckedIn && !this.isLoading;
  }

  get canCheckOut(): boolean {
    return this.isCheckedIn && !this.isLoading;
  }

  get attendancePercentage(): number {
    return this.stats.attendanceRate;
  }
}
