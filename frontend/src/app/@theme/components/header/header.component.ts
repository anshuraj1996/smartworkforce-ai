import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  currentUser: any = null;
  isDarkMode = false;
  isMenuOpen = false;
  notifications: any[] = [];
  unreadNotifications = 0;

  navigationItems = [
    { label: 'Dashboard', icon: 'dashboard', route: '/dashboard', roles: ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'] },
    { label: 'Attendance', icon: 'access_time', route: '/attendance', roles: ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'] },
    { label: 'Leave', icon: 'event_available', route: '/leave', roles: ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'] },
    { label: 'Analytics', icon: 'analytics', route: '/analytics', roles: ['MANAGER', 'HR', 'ADMIN'] },
    { label: 'Team', icon: 'group', route: '/team', roles: ['MANAGER', 'HR', 'ADMIN'] },
    { label: 'Create Employee', icon: 'person_add', route: '/signup', roles: ['HR', 'ADMIN'] },
    { label: 'Profile', icon: 'account_circle', route: '/profile', roles: ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'] }
  ];

  constructor(
    private authService: AuthService,
    private themeService: ThemeService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Subscribe to current user
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
      });

    // Subscribe to theme changes
    this.themeService.isDarkMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isDark => {
        this.isDarkMode = isDark;
      });

    // Load notifications (simulate for now)
    this.loadNotifications();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Toggle theme between light and dark
   */
  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  /**
   * Toggle mobile menu
   */
  toggleMenu(): void {
    this.isMenuOpen = !this.isMenuOpen;
  }

  /**
   * Navigate to route
   */
  navigate(route: string): void {
    this.router.navigate([route]);
    this.isMenuOpen = false;
  }

  /**
   * Check if user has permission for navigation item
   */
  hasPermission(roles: string[]): boolean {
    if (!this.currentUser) return false;
    return roles.includes(this.currentUser.role);
  }

  /**
   * Get user initials for avatar
   */
  getUserInitials(): string {
    if (!this.currentUser?.name) return 'U';
    return this.currentUser.name
      .split(' ')
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  /**
   * Get user avatar color based on role
   */
  getUserAvatarColor(): string {
    const colorMap = {
      'ADMIN': 'bg-purple-500',
      'HR': 'bg-blue-500',
      'MANAGER': 'bg-green-500',
      'EMPLOYEE': 'bg-gray-500'
    };
    return colorMap[this.currentUser?.role as keyof typeof colorMap] || 'bg-gray-500';
  }

  /**
   * Load user notifications
   */
  private loadNotifications(): void {
    // Simulate notifications
    this.notifications = [
      {
        id: '1',
        title: 'Leave Request Approved',
        message: 'Your leave request for March 15-17 has been approved',
        type: 'success',
        timestamp: new Date(Date.now() - 1800000), // 30 minutes ago
        read: false
      },
      {
        id: '2',
        title: 'Team Meeting Reminder',
        message: 'Weekly team meeting starts in 1 hour',
        type: 'info',
        timestamp: new Date(Date.now() - 3600000), // 1 hour ago
        read: false
      },
      {
        id: '3',
        title: 'System Maintenance',
        message: 'Scheduled maintenance tonight 11:00 PM - 2:00 AM',
        type: 'warning',
        timestamp: new Date(Date.now() - 7200000), // 2 hours ago
        read: true
      }
    ];

    this.unreadNotifications = this.notifications.filter(n => !n.read).length;
  }

  /**
   * Mark notification as read
   */
  markNotificationAsRead(notificationId: string): void {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification && !notification.read) {
      notification.read = true;
      this.unreadNotifications--;
    }
  }

  /**
   * Mark all notifications as read
   */
  markAllNotificationsAsRead(): void {
    this.notifications.forEach(n => n.read = true);
    this.unreadNotifications = 0;
  }

  /**
   * Get notification icon
   */
  getNotificationIcon(type: string): string {
    const iconMap = {
      'success': 'check_circle',
      'info': 'info',
      'warning': 'warning',
      'error': 'error'
    };
    return iconMap[type as keyof typeof iconMap] || 'notifications';
  }

  /**
   * Get notification color class
   */
  getNotificationColorClass(type: string): string {
    const colorMap = {
      'success': 'text-green-500',
      'info': 'text-blue-500',
      'warning': 'text-orange-500',
      'error': 'text-red-500'
    };
    return colorMap[type as keyof typeof colorMap] || 'text-gray-500';
  }

  /**
   * Format notification time
   */
  formatNotificationTime(timestamp: Date): string {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }

  /**
   * Logout user
   */
  logout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }

  /**
   * Get current route for active navigation highlighting
   */
  isRouteActive(route: string): boolean {
    return this.router.url === route;
  }
}