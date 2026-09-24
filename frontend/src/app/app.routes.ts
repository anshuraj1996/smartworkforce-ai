import { Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/dashboard',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'signup',
    loadComponent: () => import('./features/auth/signup/signup.component').then(m => m.SignupComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'attendance',
    loadComponent: () => import('./features/attendance/attendance.component').then(m => m.AttendanceComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'leave',
    loadComponent: () => import('./features/leave/leave.component').then(m => m.LeaveComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'wfh',
    loadComponent: () => import('./features/wfh/wfh.component').then(m => m.WfhComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'calendar',
    loadComponent: () => import('./features/calendar/calendar.component').then(m => m.CalendarComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'announcements',
    loadComponent: () => import('./features/announcements/announcements.component').then(m => m.AnnouncementsComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'analytics',
    loadComponent: () => import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'team',
    loadComponent: () => import('./features/team/team.component').then(m => m.TeamComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'profile',
    loadComponent: () => import('./features/profile/profile.component').then(m => m.ProfileComponent),
    canActivate: [AuthGuard]
  },
  {
    path: '**',
    redirectTo: '/dashboard'
  }
];