import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: 'GENERAL' | 'POLICY' | 'FESTIVAL' | 'ACHIEVEMENT';
  isPinned: boolean;
  createdAt: string;
  author?: { id: string, name: string };
}

export interface FeedItem {
  type: 'ANNOUNCEMENT' | 'BIRTHDAY' | 'NEW_JOINER';
  id: string;
  title: string;
  body: string;
  category?: string;
  isPinned?: boolean;
  timestamp: string;
}

@Injectable({
  providedIn: 'root'
})
export class AnnouncementsService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1`;

  constructor(private http: HttpClient) {}

  list(): Observable<Announcement[]> {
    return this.http.get<{ success: boolean, data: Announcement[] }>(`${this.apiUrl}/announcements`)
      .pipe(map(response => response.data));
  }

  getFeed(): Observable<FeedItem[]> {
    return this.http.get<{ success: boolean, data: FeedItem[] }>(`${this.apiUrl}/announcements/feed`)
      .pipe(map(response => response.data));
  }

  create(data: { title: string, body: string, category: string, isPinned?: boolean }): Observable<Announcement> {
    return this.http.post<{ success: boolean, data: Announcement }>(`${this.apiUrl}/announcements`, data)
      .pipe(map(response => response.data));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/announcements/${id}`);
  }
}
