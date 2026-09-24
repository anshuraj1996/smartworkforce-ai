import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'EMPLOYEE' | 'MANAGER' | 'HR' | 'ADMIN';
  department: string;
  designation: string;
  employeeId: string;
  phone?: string;
  avatar?: string;
  dateOfBirth?: string;
  dateOfJoining: string;
  address?: Address;
  emergencyContact?: EmergencyContact;
  manager?: Manager;
  skills?: string[];
  certifications?: Certification[];
  preferences?: UserPreferences;
  status: 'Active' | 'Inactive' | 'Suspended';
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  twoFactorEnabled?: boolean;
  loginHistory?: LoginHistoryEntry[];
}

export interface LoginHistoryEntry {
  ipAddress: string;
  deviceInfo: string;
  timestamp: string;
  success: boolean;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

export interface Manager {
  id: string;
  name: string;
  email: string;
  department: string;
}

export interface Certification {
  id: string;
  name: string;
  provider: string;
  dateObtained: string;
  expiryDate?: string;
  certificateUrl?: string;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  language: string;
  timezone: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  workingHours: WorkingHours;
  dashboardLayout: string[];
}

export interface WorkingHours {
  startTime: string;
  endTime: string;
  workingDays: number[];
}

export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ProfileUpdateRequest {
  name?: string;
  phone?: string;
  address?: Partial<Address>;
  emergencyContact?: Partial<EmergencyContact>;
  skills?: string[];
  preferences?: Partial<UserPreferences>;
}

@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  private readonly apiUrl = `${environment.apiUrl}/api/v1`;
  
  private profileSubject = new BehaviorSubject<UserProfile | null>(null);
  private avatarSubject = new BehaviorSubject<string | null>(null);

  public profile$ = this.profileSubject.asObservable();
  public avatar$ = this.avatarSubject.asObservable();

  constructor(private http: HttpClient) {}

  // The backend's User record uses hireDate, not dateOfJoining - map it once here
  // rather than touching every place in the component that reads the profile.
  private static toProfile(raw: any): UserProfile {
    return { ...raw, dateOfJoining: raw.hireDate, avatar: raw.metadata?.avatarUrl };
  }

  /**
   * Get user profile
   */
  getProfile(): Observable<UserProfile> {
    return this.http.get<{ success: boolean, data: any }>(`${this.apiUrl}/users/profile`)
      .pipe(map(response => ProfileService.toProfile(response.data)));
  }

  /**
   * Update user profile
   */
  updateProfile(updateData: ProfileUpdateRequest): Observable<UserProfile> {
    return this.http.put<{ success: boolean, data: any }>(`${this.apiUrl}/users/profile`, updateData)
      .pipe(map(response => ProfileService.toProfile(response.data)));
  }

  /**
   * Update user avatar - read as a data URL client-side since there's no file-storage
   * backend (S3, etc.) wired up; the avatar is persisted as a data URL in the user record.
   */
  updateAvatar(file: File): Observable<{ avatarUrl: string }> {
    return from(this.readFileAsDataUrl(file)).pipe(
      switchMap(dataUrl => this.http.post<{ success: boolean, avatarUrl: string }>(`${this.apiUrl}/users/avatar`, { dataUrl }))
    );
  }

  /**
   * Remove user avatar
   */
  removeAvatar(): Observable<any> {
    return this.http.delete(`${this.apiUrl}/users/avatar`);
  }

  /**
   * Change password
   */
  changePassword(passwordData: PasswordChangeRequest): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/change-password`, passwordData);
  }

  /**
   * Update user preferences
   */
  updatePreferences(preferences: Partial<UserPreferences>): Observable<any> {
    return this.http.put(`${this.apiUrl}/users/preferences`, preferences);
  }

  /**
   * Get user activity history
   */
  getActivityHistory(limit: number = 50): Observable<any[]> {
    return this.http.get<{ success: boolean, data: any[] }>(`${this.apiUrl}/users/activity`, {
      params: { limit: limit.toString() }
    }).pipe(map(response => response.data));
  }

  /**
   * Get user login history
   */
  getLoginHistory(limit: number = 20): Observable<LoginHistoryEntry[]> {
    return this.http.get<{ success: boolean, data: LoginHistoryEntry[] }>(`${this.apiUrl}/users/login-history`, {
      params: { limit: limit.toString() }
    }).pipe(map(response => response.data));
  }

  /**
   * Add certification
   */
  addCertification(certification: Omit<Certification, 'id'>): Observable<Certification> {
    return this.http.post<{ success: boolean, data: Certification }>(`${this.apiUrl}/users/certifications`, certification)
      .pipe(map(response => response.data));
  }

  /**
   * Update certification
   */
  updateCertification(id: string, certification: Partial<Certification>): Observable<Certification> {
    return this.http.put<{ success: boolean, data: Certification }>(`${this.apiUrl}/users/certifications/${id}`, certification)
      .pipe(map(response => response.data));
  }

  /**
   * Delete certification
   */
  deleteCertification(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/users/certifications/${id}`);
  }

  /**
   * Upload certification document (stored as a data URL, same reasoning as the avatar)
   */
  uploadCertificationDocument(certificationId: string, file: File): Observable<Certification> {
    return from(this.readFileAsDataUrl(file)).pipe(
      switchMap(dataUrl => this.http.post<{ success: boolean, data: Certification }>(
        `${this.apiUrl}/users/certifications/${certificationId}/document`, { dataUrl }
      )),
      map(response => response.data)
    );
  }

  /**
   * Get user statistics
   */
  getUserStats(): Observable<any> {
    return this.http.get<{ success: boolean, data: any }>(`${this.apiUrl}/users/stats`)
      .pipe(map(response => response.data));
  }

  /**
   * Export user data
   */
  exportUserData(format: 'json' | 'pdf' = 'json'): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/users/export`, {
      params: { format: format === 'pdf' ? 'csv' : format }, // no PDF renderer wired up - falls back to csv
      responseType: 'blob'
    });
  }

  /**
   * Request account deletion
   */
  requestAccountDeletion(reason: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/delete-request`, { reason });
  }

  /**
   * Start enabling two-factor auth - returns a real TOTP secret/URI to scan into an authenticator app
   */
  enableTwoFactor(): Observable<{ secret: string, authUri: string }> {
    return this.http.post<{ success: boolean, data: { secret: string, authUri: string } }>(`${this.apiUrl}/users/2fa/enable`, {})
      .pipe(map(response => response.data));
  }

  /**
   * Disable two-factor authentication
   */
  disableTwoFactor(code: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/2fa/disable`, { code });
  }

  /**
   * Verify two-factor authentication
   */
  verifyTwoFactor(code: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/2fa/verify`, { code });
  }

  /**
   * Get available timezones
   */
  getTimezones(): Observable<string[]> {
    return this.http.get<{ success: boolean, data: string[] }>(`${this.apiUrl}/users/timezones`)
      .pipe(map(response => response.data));
  }

  /**
   * Get available languages
   */
  getLanguages(): Observable<{ code: string; name: string }[]> {
    return this.http.get<{ success: boolean, data: { code: string; name: string }[] }>(`${this.apiUrl}/users/languages`)
      .pipe(map(response => response.data));
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Update profile subject
   */
  updateProfileSubject(profile: UserProfile): void {
    this.profileSubject.next(profile);
  }

  /**
   * Update avatar subject
   */
  updateAvatarSubject(avatarUrl: string): void {
    this.avatarSubject.next(avatarUrl);
  }

  /**
   * Get current profile
   */
  getCurrentProfile(): UserProfile | null {
    return this.profileSubject.value;
  }

  /**
   * Get user initials
   */
  getUserInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  /**
   * Get role color
   */
  getRoleColor(role: string): string {
    const colorMap = {
      'ADMIN': 'purple',
      'HR': 'blue',
      'MANAGER': 'green',
      'EMPLOYEE': 'gray'
    };
    return colorMap[role as keyof typeof colorMap] || 'gray';
  }

  /**
   * Get department color
   */
  getDepartmentColor(department: string): string {
    const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple', 'pink'];
    const hash = department.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return colors[hash % colors.length];
  }

  /**
   * Format date for display
   */
  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * Calculate years of experience
   */
  calculateExperience(joinDate: string): number {
    const join = new Date(joinDate);
    const now = new Date();
    return Math.floor((now.getTime() - join.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  }

  /**
   * Validate phone number
   */
  validatePhoneNumber(phone: string): boolean {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone);
  }

  /**
   * Validate password strength
   */
  validatePasswordStrength(password: string): { isValid: boolean; score: number; feedback: string[] } {
    const feedback: string[] = [];
    let score = 0;

    if (password.length >= 8) score += 20;
    else feedback.push('Password should be at least 8 characters long');

    if (/[a-z]/.test(password)) score += 20;
    else feedback.push('Include lowercase letters');

    if (/[A-Z]/.test(password)) score += 20;
    else feedback.push('Include uppercase letters');

    if (/[0-9]/.test(password)) score += 20;
    else feedback.push('Include numbers');

    if (/[^A-Za-z0-9]/.test(password)) score += 20;
    else feedback.push('Include special characters');

    return {
      isValid: score >= 80,
      score,
      feedback
    };
  }

  /**
   * Clean up subscriptions
   */
  ngOnDestroy(): void {
    this.profileSubject.complete();
    this.avatarSubject.complete();
  }
}