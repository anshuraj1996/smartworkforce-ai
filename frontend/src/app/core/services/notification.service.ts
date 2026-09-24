import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export type NotificationCategory = 'ATTENDANCE' | 'LEAVE' | 'WFH' | 'ANNOUNCEMENT' | 'HR' | 'SYSTEM';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1`;

  private unreadCountSubject = new BehaviorSubject<number>(0);
  public unreadCount$ = this.unreadCountSubject.asObservable();

  constructor(private http: HttpClient) {}

  getMyNotifications(params?: { category?: string; unreadOnly?: boolean; page?: number; limit?: number }): Observable<AppNotification[]> {
    return this.http.get<{ success: boolean, data: { data: AppNotification[] } }>(`${this.apiUrl}/notifications/me`, { params: params as any })
      .pipe(map(response => response.data.data));
  }

  refreshUnreadCount(): void {
    this.http.get<{ success: boolean, data: { count: number } }>(`${this.apiUrl}/notifications/unread-count`)
      .subscribe(response => this.unreadCountSubject.next(response.data.count));
  }

  markAsRead(notificationId: string): Observable<AppNotification> {
    return this.http.post<{ success: boolean, data: AppNotification }>(`${this.apiUrl}/notifications/${notificationId}/read`, {})
      .pipe(
        map(response => response.data),
        tap(() => this.refreshUnreadCount())
      );
  }

  markAllAsRead(): Observable<{ updatedCount: number }> {
    return this.http.post<{ success: boolean, data: { updatedCount: number } }>(`${this.apiUrl}/notifications/read-all`, {})
      .pipe(
        map(response => response.data),
        tap(() => this.unreadCountSubject.next(0))
      );
  }
}
