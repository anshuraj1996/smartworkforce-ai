import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router, RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule, MatMenu } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatBadgeModule } from '@angular/material/badge';
import { Subject, interval } from 'rxjs';
import { startWith, takeUntil } from 'rxjs/operators';

import { AuthService } from './core/services/auth.service';
import { AppNotification, NotificationService } from './core/services/notification.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule,
    MatListModule,
    MatMenuModule,
    MatDividerModule,
    MatBadgeModule
  ],
  template: `
    <div class="app-container">
      <mat-toolbar color="primary" class="app-toolbar">
        <button
          mat-icon-button
          *ngIf="isLoggedIn"
          (click)="sidenav.toggle()"
          class="menu-button">
          <mat-icon>menu</mat-icon>
        </button>
        
        <span class="app-title">
          <mat-icon>business</mat-icon>
          SmartWorkforce AI
        </span>
        
        <span class="spacer"></span>
        
        <div *ngIf="isLoggedIn" class="user-info">
          <button mat-icon-button [matMenuTriggerFor]="notificationMenu" matBadge="{{ unreadCount }}" matBadgeColor="warn" [matBadgeHidden]="unreadCount === 0" matBadgeSize="small">
            <mat-icon>notifications</mat-icon>
          </button>

          <mat-menu #notificationMenu="matMenu" class="notification-menu">
            <div class="notification-header" (click)="$event.stopPropagation()">
              <span>Notifications</span>
              <button mat-button *ngIf="unreadCount > 0" (click)="markAllNotificationsRead()">Mark all read</button>
            </div>
            <button mat-menu-item *ngFor="let n of recentNotifications" (click)="openNotification(n)">
              <mat-icon [class.unread-dot]="!n.isRead">{{ n.isRead ? 'drafts' : 'mail' }}</mat-icon>
              <span class="notification-text">
                <strong>{{ n.title }}</strong>
                <small>{{ n.message }}</small>
              </span>
            </button>
            <div class="notification-empty" *ngIf="recentNotifications.length === 0">No notifications yet</div>
          </mat-menu>

          <span class="user-name">{{ currentUser?.name }}</span>
          <button mat-icon-button [matMenuTriggerFor]="userMenu">
            <mat-icon>account_circle</mat-icon>
          </button>
          
          <mat-menu #userMenu="matMenu">
            <button mat-menu-item (click)="toggleTheme()">
              <mat-icon>{{ isDarkTheme ? 'light_mode' : 'dark_mode' }}</mat-icon>
              <span>{{ isDarkTheme ? 'Light Theme' : 'Dark Theme' }}</span>
            </button>
            <button mat-menu-item routerLink="/profile">
              <mat-icon>person</mat-icon>
              <span>Profile</span>
            </button>
            <mat-divider></mat-divider>
            <button mat-menu-item (click)="logout()">
              <mat-icon>logout</mat-icon>
              <span>Logout</span>
            </button>
          </mat-menu>
        </div>
      </mat-toolbar>

      <mat-sidenav-container class="sidenav-container" *ngIf="isLoggedIn">
        <mat-sidenav #sidenav mode="side" opened class="sidenav">
          <mat-nav-list>
            <a mat-list-item routerLink="/dashboard" routerLinkActive="active">
              <mat-icon matListItemIcon>dashboard</mat-icon>
              <span matListItemTitle>Dashboard</span>
            </a>
            
            <a mat-list-item routerLink="/attendance" routerLinkActive="active">
              <mat-icon matListItemIcon>access_time</mat-icon>
              <span matListItemTitle>Attendance</span>
            </a>
            
            <a mat-list-item routerLink="/leave" routerLinkActive="active">
              <mat-icon matListItemIcon>event_available</mat-icon>
              <span matListItemTitle>Leave Requests</span>
            </a>

            <a mat-list-item routerLink="/wfh" routerLinkActive="active">
              <mat-icon matListItemIcon>home_work</mat-icon>
              <span matListItemTitle>Work From Home</span>
            </a>

            <a mat-list-item routerLink="/calendar" routerLinkActive="active">
              <mat-icon matListItemIcon>calendar_month</mat-icon>
              <span matListItemTitle>Calendar</span>
            </a>

            <a mat-list-item routerLink="/announcements" routerLinkActive="active">
              <mat-icon matListItemIcon>campaign</mat-icon>
              <span matListItemTitle>Announcements</span>
            </a>

            <a mat-list-item routerLink="/analytics" routerLinkActive="active" *ngIf="isManagerOrAbove">
              <mat-icon matListItemIcon>analytics</mat-icon>
              <span matListItemTitle>Analytics</span>
            </a>
            
            <a mat-list-item routerLink="/team" routerLinkActive="active" *ngIf="isManagerOrAbove">
              <mat-icon matListItemIcon>group</mat-icon>
              <span matListItemTitle>Team Management</span>
            </a>
            
            <mat-divider></mat-divider>
            
            <a mat-list-item routerLink="/profile" routerLinkActive="active">
              <mat-icon matListItemIcon>person</mat-icon>
              <span matListItemTitle>Profile</span>
            </a>
            
            <a mat-list-item (click)="logout()">
              <mat-icon matListItemIcon>logout</mat-icon>
              <span matListItemTitle>Logout</span>
            </a>
          </mat-nav-list>
        </mat-sidenav>

        <mat-sidenav-content class="main-content">
          <router-outlet></router-outlet>
        </mat-sidenav-content>
      </mat-sidenav-container>

      <!-- Login screen when not authenticated -->
      <div class="login-container" *ngIf="!isLoggedIn">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [`
    .app-container {
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .app-toolbar {
      position: sticky;
      top: 0;
      z-index: 1000;
    }

    .app-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }

    .spacer {
      flex: 1 1 auto;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .user-name {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.9);
    }

    .sidenav-container {
      flex: 1;
      background: #fafafa;
    }

    .sidenav {
      width: 250px;
      background: white;
      border-right: 1px solid #e0e0e0;
    }

    .main-content {
      padding: 20px;
      min-height: calc(100vh - 64px);
    }

    .login-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .active {
      background-color: #e3f2fd !important;
      color: #1976d2 !important;
    }

    .active mat-icon {
      color: #1976d2 !important;
    }

    .notification-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      font-weight: 600;
    }

    .notification-text {
      display: flex;
      flex-direction: column;
      line-height: 1.3;
      white-space: normal;
    }

    .notification-text small {
      color: rgba(0, 0, 0, 0.6);
    }

    .unread-dot {
      color: #1976d2;
    }

    .notification-empty {
      padding: 12px 16px;
      color: rgba(0, 0, 0, 0.5);
    }

    @media (max-width: 768px) {
      .sidenav {
        width: 200px;
      }
      
      .main-content {
        padding: 16px;
      }
      
      .user-name {
        display: none;
      }
    }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  @ViewChild('sidenav') sidenav!: MatSidenav;
  @ViewChild('userMenu') userMenu!: MatMenu;

  title = 'SmartWorkforce AI';
  isLoggedIn = false;
  currentUser: any = null;
  isDarkTheme = false;

  unreadCount = 0;
  recentNotifications: AppNotification[] = [];
  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private notificationService: NotificationService,
    private router: Router
  ) {
    // Check for saved theme preference
    const savedTheme = localStorage.getItem('theme');
    this.isDarkTheme = savedTheme === 'dark';
    this.applyTheme();
  }

  ngOnInit() {
    // Check authentication status
    this.authService.currentUser$.subscribe(user => {
      this.isLoggedIn = !!user;
      this.currentUser = user;
    });

    // Check if user is already logged in
    this.authService.checkAuthStatus();

    this.notificationService.unreadCount$
      .pipe(takeUntil(this.destroy$))
      .subscribe(count => this.unreadCount = count);

    // Poll every minute so the bell badge stays current without a websocket
    interval(60000)
      .pipe(startWith(0), takeUntil(this.destroy$))
      .subscribe(() => {
        if (!this.isLoggedIn) return;
        this.notificationService.refreshUnreadCount();
        this.notificationService.getMyNotifications({ limit: 8 }).subscribe(list => this.recentNotifications = list);
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  openNotification(notification: AppNotification) {
    if (!notification.isRead) {
      this.notificationService.markAsRead(notification.id).subscribe(updated => {
        notification.isRead = true;
        notification.readAt = updated.readAt;
      });
    }
    if (notification.link) {
      this.router.navigateByUrl(notification.link);
    }
  }

  markAllNotificationsRead() {
    this.notificationService.markAllAsRead().subscribe(() => {
      this.recentNotifications.forEach(n => n.isRead = true);
    });
  }

  get isManagerOrAbove(): boolean {
    return this.currentUser?.role && 
           ['MANAGER', 'HR', 'ADMIN'].includes(this.currentUser.role);
  }

  logout() {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }

  toggleTheme() {
    this.isDarkTheme = !this.isDarkTheme;
    localStorage.setItem('theme', this.isDarkTheme ? 'dark' : 'light');
    this.applyTheme();
  }

  private applyTheme() {
    const body = document.body;
    if (this.isDarkTheme) {
      body.classList.add('dark-theme');
      body.classList.remove('light-theme');
    } else {
      body.classList.add('light-theme');
      body.classList.remove('dark-theme');
    }
  }
}
