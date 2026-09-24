import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export interface CalendarDay {
  date: string;
  dayOfWeek: number;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'HALF_DAY' | 'WORK_FROM_HOME' | 'LEAVE' | 'HOLIDAY' | 'WEEKEND' | 'UPCOMING';
  detail: any;
}

export interface MonthlyCalendar {
  month: number;
  year: number;
  days: CalendarDay[];
}

@Injectable({
  providedIn: 'root'
})
export class CalendarService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1`;

  constructor(private http: HttpClient) {}

  getMonth(month: number, year: number): Observable<MonthlyCalendar> {
    return this.http.get<{ success: boolean, data: MonthlyCalendar }>(`${this.apiUrl}/attendance/calendar`, {
      params: { month, year }
    }).pipe(map(response => response.data));
  }
}
