import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

// ============================================================================
// Data Models
// ============================================================================

export enum UserRole {
  EMPLOYEE = 'EMPLOYEE',
  MANAGER = 'MANAGER',
  HR = 'HR',
  ADMIN = 'ADMIN'
}

export enum UserStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
  ON_LEAVE = 'On Leave',
  PENDING = 'Pending'
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  designation: string;
  managerId?: string;
  managerName?: string;
  avatar?: string;
  phone?: string;
  isActive: boolean;
  status: UserStatus;
  lastLoginAt?: Date;
  dateOfJoining: Date;
  employeeId: string;
  
  // Stats
  attendancePercentage?: number;
  leaveBalance?: number;
  tasksCompleted?: number;
  performanceRating?: number;
  
  // Additional Info
  skills?: string[];
  location?: string;
  directReports?: number;
}

export interface TeamStats {
  totalMembers: number;
  activeMembers: number;
  presentToday: number;
  onLeave: number;
  avgAttendance: number;
  departmentBreakdown: { [key: string]: number };
  newHires: number;
  pendingApprovals?: number;
  teamSize?: number;
  directReports?: number;
}

export interface TeamAnalytics {
  attendanceRate: number;
  productivityScore: number;
  averageLeaveBalance: number;
  departmentDistribution: { department: string; count: number }[];
  roleDistribution: { role: string; count: number }[];
  recentActivity: TeamActivity[];
  performanceMetrics: PerformanceMetric[];
}

export interface TeamActivity {
  id: string;
  userId: string;
  userName: string;
  action: string;
  timestamp: Date;
  details?: string;
}

export interface PerformanceMetric {
  userId: string;
  userName: string;
  attendanceRate: number;
  productivityScore: number;
  tasksCompleted: number;
  rating: number;
}

export interface OrganizationHierarchy {
  id: string;
  name: string;
  role: UserRole;
  designation: string;
  avatar?: string;
  children: OrganizationHierarchy[];
}

export interface TeamSearchParams {
  searchTerm?: string;
  department?: string;
  role?: UserRole | '';
  status?: UserStatus | '';
  managerId?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface TeamSearchResponse {
  members: TeamMember[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BulkUpdateRequest {
  userIds: string[];
  updates: {
    department?: string;
    role?: UserRole;
    managerId?: string;
    isActive?: boolean;
  };
}

export interface BulkUpdateResponse {
  success: boolean;
  updatedCount: number;
  failedIds: string[];
  message: string;
}

// ============================================================================
// Team Service
// ============================================================================

@Injectable({
  providedIn: 'root'
})
export class TeamService {
  private readonly API_URL = `${environment.apiUrl}/api/v1/users`;
  
  // State Management
  private teamMembersSubject = new BehaviorSubject<TeamMember[]>([]);
  public teamMembers$ = this.teamMembersSubject.asObservable();
  
  private teamStatsSubject = new BehaviorSubject<TeamStats | null>(null);
  public teamStats$ = this.teamStatsSubject.asObservable();
  
  private selectedMembersSubject = new BehaviorSubject<TeamMember[]>([]);
  public selectedMembers$ = this.selectedMembersSubject.asObservable();

  constructor(private http: HttpClient) {}

  // ============================================================================
  // Team Member Retrieval
  // ============================================================================

  /**
   * Get all team members (role-filtered on backend)
   */
  getTeamMembers(): Observable<TeamMember[]> {
    return this.http.get<{ success: boolean, data: TeamMember[] }>(`${this.API_URL}`)
      .pipe(
        map(response => response.data),
        tap(members => this.teamMembersSubject.next(members)),
        catchError(this.handleError)
      );
  }

  /**
   * Get team members with advanced search and filters
   */
  searchTeamMembers(params: TeamSearchParams): Observable<TeamSearchResponse> {
    let httpParams = new HttpParams();
    
    if (params.searchTerm) httpParams = httpParams.set('search', params.searchTerm);
    if (params.department) httpParams = httpParams.set('department', params.department);
    if (params.role) httpParams = httpParams.set('role', params.role);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.managerId) httpParams = httpParams.set('managerId', params.managerId);
    if (params.page) httpParams = httpParams.set('page', params.page.toString());
    if (params.limit) httpParams = httpParams.set('limit', params.limit.toString());
    if (params.sortBy) httpParams = httpParams.set('sortBy', params.sortBy);
    if (params.sortOrder) httpParams = httpParams.set('sortOrder', params.sortOrder);

    return this.http.get<{ success: boolean, data: TeamSearchResponse }>(`${this.API_URL}/search`, { params: httpParams })
      .pipe(map(response => response.data), catchError(this.handleError));
  }

  /**
   * Get team member by ID
   */
  getTeamMemberById(userId: string): Observable<TeamMember> {
    return this.http.get<{ success: boolean, data: TeamMember }>(`${this.API_URL}/${userId}`)
      .pipe(map(response => response.data), catchError(this.handleError));
  }

  /**
   * Get direct reports for a manager
   */
  getDirectReports(managerId: string): Observable<TeamMember[]> {
    return this.http.get<{ success: boolean, data: TeamMember[] }>(`${this.API_URL}/manager/${managerId}/reports`)
      .pipe(
        map(response => response.data),
        catchError(this.handleError)
      );
  }

  /**
   * Get team members by department
   */
  getTeamByDepartment(department: string): Observable<TeamMember[]> {
    return this.http.get<{ success: boolean, data: TeamMember[] }>(`${this.API_URL}/department/${department}`)
      .pipe(
        map(response => response.data),
        catchError(this.handleError)
      );
  }

  // ============================================================================
  // Team Statistics
  // ============================================================================

  /**
   * Get team statistics (role-filtered)
   */
  getTeamStats(): Observable<TeamStats> {
    return this.http.get<{ success: boolean, data: TeamStats }>(`${this.API_URL}/stats`)
      .pipe(
        map(response => response.data),
        tap(stats => this.teamStatsSubject.next(stats)),
        catchError(this.handleError)
      );
  }

  /**
   * Get comprehensive team analytics
   */
  getTeamAnalytics(): Observable<TeamAnalytics> {
    return this.http.get<{ success: boolean, data: TeamAnalytics }>(`${this.API_URL}/analytics`)
      .pipe(map(response => response.data), catchError(this.handleError));
  }

  /**
   * Get department-wise statistics
   */
  getDepartmentStats(): Observable<{ [key: string]: TeamStats }> {
    return this.http.get<{ success: boolean, data: { [key: string]: TeamStats } }>(`${this.API_URL}/stats/departments`)
      .pipe(map(response => response.data), catchError(this.handleError));
  }

  // ============================================================================
  // Organizational Hierarchy
  // ============================================================================

  /**
   * Get organizational hierarchy tree
   */
  getOrganizationHierarchy(): Observable<OrganizationHierarchy[]> {
    return this.http.get<{ success: boolean, data: OrganizationHierarchy[] }>(`${this.API_URL}/hierarchy`)
      .pipe(map(response => response.data), catchError(this.handleError));
  }

  /**
   * Get hierarchy starting from specific manager
   */
  getManagerHierarchy(managerId: string): Observable<OrganizationHierarchy> {
    return this.http.get<{ success: boolean, data: OrganizationHierarchy }>(`${this.API_URL}/hierarchy/${managerId}`)
      .pipe(map(response => response.data), catchError(this.handleError));
  }

  // ============================================================================
  // Team Member Management (Admin/HR)
  // ============================================================================

  /**
   * Create new team member
   */
  createTeamMember(memberData: Partial<TeamMember>): Observable<TeamMember> {
    return this.http.post<{ success: boolean, data: TeamMember }>(`${this.API_URL}`, memberData)
      .pipe(
        map(response => response.data),
        tap(() => this.refreshTeamData()),
        catchError(this.handleError)
      );
  }

  /**
   * Update team member
   */
  updateTeamMember(userId: string, updates: Partial<TeamMember>): Observable<TeamMember> {
    return this.http.put<{ success: boolean, data: TeamMember }>(`${this.API_URL}/${userId}`, updates)
      .pipe(
        map(response => response.data),
        tap(() => this.refreshTeamData()),
        catchError(this.handleError)
      );
  }

  /**
   * Deactivate team member
   */
  deactivateTeamMember(userId: string): Observable<{ success: boolean; message: string }> {
    return this.http.patch<{ success: boolean; message: string }>(
      `${this.API_URL}/${userId}/deactivate`, 
      {}
    ).pipe(
      tap(() => this.refreshTeamData()),
      catchError(this.handleError)
    );
  }

  /**
   * Activate team member
   */
  activateTeamMember(userId: string): Observable<{ success: boolean; message: string }> {
    return this.http.patch<{ success: boolean; message: string }>(
      `${this.API_URL}/${userId}/activate`, 
      {}
    ).pipe(
      tap(() => this.refreshTeamData()),
      catchError(this.handleError)
    );
  }

  /**
   * Delete team member (soft delete)
   */
  deleteTeamMember(userId: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.API_URL}/${userId}`)
      .pipe(
        tap(() => this.refreshTeamData()),
        catchError(this.handleError)
      );
  }

  // ============================================================================
  // Bulk Operations (Admin/HR)
  // ============================================================================

  /**
   * Bulk update team members
   */
  bulkUpdateTeamMembers(request: BulkUpdateRequest): Observable<BulkUpdateResponse> {
    return this.http.post<BulkUpdateResponse>(`${this.API_URL}/bulk-update`, request)
      .pipe(
        tap(() => this.refreshTeamData()),
        catchError(this.handleError)
      );
  }

  /**
   * Bulk deactivate team members
   */
  bulkDeactivateTeamMembers(userIds: string[]): Observable<BulkUpdateResponse> {
    return this.http.post<BulkUpdateResponse>(`${this.API_URL}/bulk-deactivate`, { userIds })
      .pipe(
        tap(() => this.refreshTeamData()),
        catchError(this.handleError)
      );
  }

  /**
   * Transfer team members to new department
   */
  bulkTransferDepartment(userIds: string[], newDepartment: string): Observable<BulkUpdateResponse> {
    return this.http.post<BulkUpdateResponse>(`${this.API_URL}/bulk-transfer`, {
      userIds,
      department: newDepartment
    }).pipe(
      tap(() => this.refreshTeamData()),
      catchError(this.handleError)
    );
  }

  /**
   * Assign new manager to team members
   */
  bulkAssignManager(userIds: string[], managerId: string): Observable<BulkUpdateResponse> {
    return this.http.post<BulkUpdateResponse>(`${this.API_URL}/bulk-assign-manager`, {
      userIds,
      managerId
    }).pipe(
      tap(() => this.refreshTeamData()),
      catchError(this.handleError)
    );
  }

  // ============================================================================
  // Data Export
  // ============================================================================

  /**
   * Export team data
   */
  exportTeamData(format: 'csv' | 'excel' | 'pdf' = 'csv', filters?: TeamSearchParams): Observable<Blob> {
    let httpParams = new HttpParams().set('format', format);
    
    if (filters) {
      if (filters.department) httpParams = httpParams.set('department', filters.department);
      if (filters.role) httpParams = httpParams.set('role', filters.role);
      if (filters.status) httpParams = httpParams.set('status', filters.status);
    }

    return this.http.get(`${this.API_URL}/export`, { 
      params: httpParams, 
      responseType: 'blob' 
    }).pipe(catchError(this.handleError));
  }

  /**
   * Export selected members
   */
  exportSelectedMembers(userIds: string[], format: 'csv' | 'excel' | 'pdf' = 'csv'): Observable<Blob> {
    return this.http.post(`${this.API_URL}/export`, 
      { userIds, format },
      { responseType: 'blob' }
    ).pipe(catchError(this.handleError));
  }

  // ============================================================================
  // Departments
  // ============================================================================

  /**
   * Get all departments
   */
  getDepartments(): Observable<string[]> {
    return this.http.get<{ success: boolean, data: string[] }>(`${this.API_URL}/departments`)
      .pipe(
        map(response => response.data),
        catchError(this.handleError)
      );
  }

  /**
   * Create new department
   */
  createDepartment(departmentName: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.API_URL}/departments`, 
      { name: departmentName }
    ).pipe(catchError(this.handleError));
  }

  // ============================================================================
  // Team Activity & History
  // ============================================================================

  /**
   * Get recent team activity
   */
  getRecentActivity(limit: number = 20): Observable<TeamActivity[]> {
    return this.http.get<{ success: boolean, data: TeamActivity[] }>(
      `${this.API_URL}/activity?limit=${limit}`
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get team member attendance history
   */
  getMemberAttendanceHistory(userId: string, startDate?: Date, endDate?: Date): Observable<any[]> {
    let httpParams = new HttpParams();
    if (startDate) httpParams = httpParams.set('startDate', startDate.toISOString());
    if (endDate) httpParams = httpParams.set('endDate', endDate.toISOString());

    return this.http.get<{ success: boolean, data: any[] }>(
      `${this.API_URL}/${userId}/attendance`,
      { params: httpParams }
    ).pipe(
      map(response => response.data),
      catchError(this.handleError)
    );
  }

  /**
   * Get team member leave history
   */
  getMemberLeaveHistory(userId: string): Observable<any[]> {
    return this.http.get<{ success: boolean, data: any[] }>(`${this.API_URL}/${userId}/leaves`)
      .pipe(
        map(response => response.data),
        catchError(this.handleError)
      );
  }

  // ============================================================================
  // State Management Helpers
  // ============================================================================

  /**
   * Update selected members
   */
  updateSelectedMembers(members: TeamMember[]): void {
    this.selectedMembersSubject.next(members);
  }

  /**
   * Clear selected members
   */
  clearSelectedMembers(): void {
    this.selectedMembersSubject.next([]);
  }

  /**
   * Refresh team data
   */
  refreshTeamData(): void {
    this.getTeamMembers().subscribe();
    this.getTeamStats().subscribe();
  }

  // ============================================================================
  // Utility Functions
  // ============================================================================

  /**
   * Get user initials for avatar placeholder
   */
  getUserInitials(name: string): string {
    return name
      .split(' ')
      .map(part => part.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');
  }

  /**
   * Get role color for badges
   */
  getRoleColor(role: UserRole): string {
    const roleColors: { [key in UserRole]: string } = {
      [UserRole.ADMIN]: 'purple',
      [UserRole.HR]: 'blue',
      [UserRole.MANAGER]: 'green',
      [UserRole.EMPLOYEE]: 'gray'
    };
    return roleColors[role] || 'gray';
  }

  /**
   * Get status color for badges
   */
  getStatusColor(status: UserStatus): string {
    const statusColors: { [key in UserStatus]: string } = {
      [UserStatus.ACTIVE]: 'green',
      [UserStatus.INACTIVE]: 'gray',
      [UserStatus.ON_LEAVE]: 'orange',
      [UserStatus.PENDING]: 'yellow'
    };
    return statusColors[status] || 'gray';
  }

  /**
   * Format last seen timestamp
   */
  formatLastSeen(lastLoginAt?: Date): string {
    if (!lastLoginAt) return 'Never';
    
    const now = new Date();
    const lastLogin = new Date(lastLoginAt);
    const diffMs = now.getTime() - lastLogin.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return lastLogin.toLocaleDateString();
  }

  /**
   * Calculate experience in years
   */
  calculateExperience(joinDate: Date): number {
    const now = new Date();
    const join = new Date(joinDate);
    const diffMs = now.getTime() - join.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365));
  }

  /**
   * Filter team members locally
   */
  filterTeamMembers(
    members: TeamMember[], 
    searchTerm: string, 
    department?: string, 
    role?: UserRole | '', 
    status?: UserStatus | ''
  ): TeamMember[] {
    return members.filter(member => {
      const matchesSearch = !searchTerm || 
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.designation.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesDepartment = !department || member.department === department;
      const matchesRole = !role || member.role === role;
      const matchesStatus = !status || member.status === status;

      return matchesSearch && matchesDepartment && matchesRole && matchesStatus;
    });
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  private handleError(error: any): Observable<never> {
    console.error('Team Service Error:', error);
    let errorMessage = 'An error occurred while processing your request.';
    
    if (error.error?.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return throwError(() => new Error(errorMessage));
  }
}
