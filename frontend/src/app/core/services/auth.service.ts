import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'EMPLOYEE' | 'MANAGER' | 'HR' | 'ADMIN';
  organizationId: string;
  department?: string;
  employeeId?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  data?: {
    user: User;
    token: string;
    organization: any;
  };
  message?: string;
}

export interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
  role: 'EMPLOYEE' | 'MANAGER' | 'HR' | 'ADMIN';
  employeeId?: string;
  department?: string;
  managerId?: string;
}

export interface CreateUserResponse {
  success: boolean;
  data?: User;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/api/v1`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient) {
    this.checkAuthStatus();
  }

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API_URL}/auth/login`, credentials)
      .pipe(
        tap(response => {
          if (response.success && response.data) {
            this.setAuthData(response.data);
          }
        }),
        catchError(error => {
          console.error('Login error:', error);
          return of({ success: false, message: error.error?.message || 'Login failed' });
        })
      );
  }

  logout(): Observable<any> {
    return of(true).pipe(
      tap(() => {
        this.clearAuthData();
      })
    );
  }

  createUser(userData: CreateUserRequest): Observable<CreateUserResponse> {
    return this.http.post<CreateUserResponse>(`${this.API_URL}/users`, userData)
      .pipe(
        map(response => {
          if (response.success) {
            return response;
          }
          throw new Error(response.message || 'Failed to create user');
        }),
        catchError(error => {
          console.error('Create user error:', error);
          throw error;
        })
      );
  }

  checkAuthStatus(): void {
    const token = this.getToken();
    const userData = this.getUserData();
    
    if (token && userData) {
      this.currentUserSubject.next(userData);
    } else {
      this.clearAuthData();
    }
  }

  isAuthenticated(): boolean {
    const token = this.getToken();
    if (!token) return false;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp > Date.now() / 1000;
    } catch {
      return false;
    }
  }

  hasRole(requiredRoles: string[]): boolean {
    const user = this.currentUserSubject.value;
    return user ? requiredRoles.includes(user.role) : false;
  }

  getToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  private setAuthData(authData: { user: User; token: string; organization: any }): void {
    localStorage.setItem('auth_token', authData.token);
    localStorage.setItem('user_data', JSON.stringify(authData.user));
    localStorage.setItem('organization_data', JSON.stringify(authData.organization));
    this.currentUserSubject.next(authData.user);
  }

  private clearAuthData(): void {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');
    localStorage.removeItem('organization_data');
    this.currentUserSubject.next(null);
  }

  private getUserData(): User | null {
    const userData = localStorage.getItem('user_data');
    return userData ? JSON.parse(userData) : null;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  getOrganizationData(): any {
    const orgData = localStorage.getItem('organization_data');
    return orgData ? JSON.parse(orgData) : null;
  }
}