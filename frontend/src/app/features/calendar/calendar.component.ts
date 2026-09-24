import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { CalendarService, CalendarDay } from './services/calendar.service';

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  ABSENT: 'Absent',
  HALF_DAY: 'Half Day',
  WORK_FROM_HOME: 'WFH',
  LEAVE: 'Leave',
  HOLIDAY: 'Holiday',
  WEEKEND: 'Weekend',
  UPCOMING: ''
};

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule, MatButtonModule],
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.scss']
})
export class CalendarComponent implements OnInit {
  currentMonth: number;
  currentYear: number;
  days: CalendarDay[] = [];
  leadingBlanks: number[] = [];
  selectedDay: CalendarDay | null = null;

  weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  constructor(private calendarService: CalendarService) {
    const now = new Date();
    this.currentMonth = now.getMonth() + 1;
    this.currentYear = now.getFullYear();
  }

  ngOnInit(): void {
    this.loadMonth();
  }

  loadMonth(): void {
    this.selectedDay = null;
    this.calendarService.getMonth(this.currentMonth, this.currentYear).subscribe(calendar => {
      this.days = calendar.days;
      this.leadingBlanks = Array(this.days[0]?.dayOfWeek || 0).fill(0);
    });
  }

  previousMonth(): void {
    this.currentMonth--;
    if (this.currentMonth < 1) {
      this.currentMonth = 12;
      this.currentYear--;
    }
    this.loadMonth();
  }

  nextMonth(): void {
    this.currentMonth++;
    if (this.currentMonth > 12) {
      this.currentMonth = 1;
      this.currentYear++;
    }
    this.loadMonth();
  }

  selectDay(day: CalendarDay): void {
    this.selectedDay = day;
  }

  statusClass(status: string): string {
    return 'status-' + status.toLowerCase().replace('_', '-');
  }

  statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  get monthLabel(): string {
    return new Date(this.currentYear, this.currentMonth - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
}
