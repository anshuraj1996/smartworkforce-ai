import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatBadgeModule } from '@angular/material/badge';
import { Router } from '@angular/router';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';

// Services
import { 
  TeamService, 
  TeamMember, 
  TeamStats, 
  UserRole, 
  UserStatus,
  TeamSearchParams,
  BulkUpdateRequest
} from './services/team.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-team',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatDialogModule,
    MatChipsModule,
    MatMenuModule,
    MatPaginatorModule,
    MatCheckboxModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatDividerModule,
    MatBadgeModule
  ],
  templateUrl: './team.component.html',
  styleUrls: ['./team.component.scss']
})
export class TeamComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Current User & Role
  currentUser: any = null;
  currentUserRole: UserRole = UserRole.EMPLOYEE;

  // Team Data
  teamMembers: TeamMember[] = [];
  filteredMembers: TeamMember[] = [];
  selectedMembers: TeamMember[] = [];
  
  // Team Statistics
  teamStats: TeamStats = {
    totalMembers: 0,
    activeMembers: 0,
    presentToday: 0,
    onLeave: 0,
    avgAttendance: 0,
    departmentBreakdown: {},
    newHires: 0
  };

  // UI State
  isLoading = false;
  viewMode: 'grid' | 'list' = 'grid';
  
  // Filters
  searchTerm = '';
  selectedDepartment = '';
  selectedRole: UserRole | '' = '';
  selectedStatus: UserStatus | '' = '';
  
  // Dropdowns
  departments: string[] = [];
  
  // Table Configuration
  displayedColumns: string[] = ['member', 'role', 'department', 'status', 'attendance', 'lastSeen', 'actions'];
  
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  // Search Control with debouncing
  searchControl = new FormControl('');

  // Role-based Feature Flags
  get canAddMember(): boolean {
    return this.currentUserRole === UserRole.ADMIN || this.currentUserRole === UserRole.HR;
  }

  get canEditMember(): boolean {
    return this.currentUserRole === UserRole.ADMIN || 
           this.currentUserRole === UserRole.HR || 
           this.currentUserRole === UserRole.MANAGER;
  }

  get canDeactivateMember(): boolean {
    return this.currentUserRole === UserRole.ADMIN || this.currentUserRole === UserRole.HR;
  }

  get canBulkOperations(): boolean {
    return this.currentUserRole === UserRole.ADMIN || this.currentUserRole === UserRole.HR;
  }

  get canViewAllTeam(): boolean {
    return this.currentUserRole === UserRole.ADMIN || this.currentUserRole === UserRole.HR;
  }

  get canViewAnalytics(): boolean {
    return this.currentUserRole !== UserRole.EMPLOYEE;
  }

  constructor(
    private teamService: TeamService,
    private authService: AuthService,
    private dialog: MatDialog,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initializeCurrentUser();
    this.loadTeamData();
    this.loadDepartments();
    this.setupSearchDebounce();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeCurrentUser(): void {
    this.currentUser = this.authService.getCurrentUser();
    if (this.currentUser) {
      this.currentUserRole = this.currentUser.role as UserRole;
    }

    // Subscribe to user changes
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        if (user) {
          this.currentUser = user;
          this.currentUserRole = user.role as UserRole;
          this.loadTeamData(); // Reload data when user changes
        }
      });
  }

  private setupSearchDebounce(): void {
    this.searchControl.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(value => {
        this.searchTerm = value || '';
        this.applyFilters();
      });
  }

  // ============================================================================
  // Data Loading
  // ============================================================================

  private loadTeamData(): void {
    this.isLoading = true;
    
    // Load team members
    this.teamService.getTeamMembers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (members) => {
          this.teamMembers = members;
          this.filteredMembers = members;
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error loading team members:', error);
          this.isLoading = false;
        }
      });

    // Load team statistics
    this.teamService.getTeamStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats) => {
          this.teamStats = stats;
        },
        error: (error) => {
          console.error('Error loading team stats:', error);
        }
      });
  }

  private loadDepartments(): void {
    this.teamService.getDepartments()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (departments) => {
          this.departments = departments;
        },
        error: (error) => {
          console.error('Error loading departments:', error);
        }
      });
  }

  refreshData(): void {
    this.loadTeamData();
  }

  // ============================================================================
  // Filtering & Search
  // ============================================================================

  applyFilters(): void {
    this.filteredMembers = this.teamService.filterTeamMembers(
      this.teamMembers,
      this.searchTerm,
      this.selectedDepartment,
      this.selectedRole,
      this.selectedStatus
    );
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedDepartment = '';
    this.selectedRole = '';
    this.selectedStatus = '';
    this.searchControl.setValue('');
    this.filteredMembers = this.teamMembers;
  }

  // ============================================================================
  // View Management
  // ============================================================================

  setViewMode(mode: 'grid' | 'list'): void {
    this.viewMode = mode;
  }

  // ============================================================================
  // Team Member Actions
  // ============================================================================

  viewMemberProfile(member: TeamMember): void {
    // TODO: Open profile detail dialog/modal
    console.log('View profile:', member);
    // this.dialog.open(MemberProfileDialogComponent, {
    //   width: '600px',
    //   data: { member }
    // });
  }

  editMember(member: TeamMember): void {
    if (!this.canEditMember) {
      alert('You do not have permission to edit team members.');
      return;
    }
    
    // TODO: Open edit dialog
    console.log('Edit member:', member);
    // this.dialog.open(EditMemberDialogComponent, {
    //   width: '800px',
    //   data: { member }
    // }).afterClosed().subscribe(result => {
    //   if (result) {
    //     this.refreshData();
    //   }
    // });
  }

  addNewMember(): void {
    if (!this.canAddMember) {
      alert('You do not have permission to add team members.');
      return;
    }

    // Navigate to signup page for HR/Admin to register new employees
    this.router.navigate(['/signup']);
  }

  deactivateMember(member: TeamMember): void {
    if (!this.canDeactivateMember) {
      alert('You do not have permission to deactivate team members.');
      return;
    }

    if (confirm(`Are you sure you want to deactivate ${member.name}?`)) {
      this.teamService.deactivateTeamMember(member.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response) => {
            alert(response.message);
            this.refreshData();
          },
          error: (error) => {
            alert(`Error deactivating member: ${error.message}`);
          }
        });
    }
  }

  activateMember(member: TeamMember): void {
    if (!this.canDeactivateMember) {
      alert('You do not have permission to activate team members.');
      return;
    }

    this.teamService.activateTeamMember(member.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          alert(response.message);
          this.refreshData();
        },
        error: (error) => {
          alert(`Error activating member: ${error.message}`);
        }
      });
  }

  viewAttendance(member: TeamMember): void {
    // TODO: Open attendance history dialog
    console.log('View attendance for:', member);
  }

  viewLeaveHistory(member: TeamMember): void {
    // TODO: Open leave history dialog
    console.log('View leave history for:', member);
  }

  sendMessage(member: TeamMember): void {
    // TODO: Open messaging dialog or navigate to messages
    console.log('Send message to:', member);
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  bulkDeactivate(): void {
    if (!this.canBulkOperations) {
      alert('You do not have permission to perform bulk operations.');
      return;
    }

    if (this.selectedMembers.length === 0) {
      alert('Please select team members first.');
      return;
    }

    const userIds = this.selectedMembers.map(m => m.id);
    if (confirm(`Are you sure you want to deactivate ${userIds.length} members?`)) {
      this.teamService.bulkDeactivateTeamMembers(userIds)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response) => {
            alert(`${response.updatedCount} members deactivated successfully.`);
            this.clearSelection();
            this.refreshData();
          },
          error: (error) => {
            alert(`Error in bulk deactivation: ${error.message}`);
          }
        });
    }
  }

  bulkTransferDepartment(): void {
    if (!this.canBulkOperations) return;

    const newDepartment = prompt('Enter new department name:');
    if (!newDepartment) return;

    const userIds = this.selectedMembers.map(m => m.id);
    this.teamService.bulkTransferDepartment(userIds, newDepartment)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          alert(`${response.updatedCount} members transferred successfully.`);
          this.clearSelection();
          this.refreshData();
        },
        error: (error) => {
          alert(`Error in bulk transfer: ${error.message}`);
        }
      });
  }

  bulkAssignManager(): void {
    if (!this.canBulkOperations) return;

    const managerId = prompt('Enter new manager ID:');
    if (!managerId) return;

    const userIds = this.selectedMembers.map(m => m.id);
    this.teamService.bulkAssignManager(userIds, managerId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          alert(`${response.updatedCount} members assigned to new manager.`);
          this.clearSelection();
          this.refreshData();
        },
        error: (error) => {
          alert(`Error in bulk assignment: ${error.message}`);
        }
      });
  }

  sendBulkMessage(): void {
    if (this.selectedMembers.length === 0) {
      alert('Please select team members first.');
      return;
    }

    // TODO: Open bulk message dialog
    console.log('Send message to selected members:', this.selectedMembers);
  }

  // ============================================================================
  // Selection Management
  // ============================================================================

  toggleMemberSelection(member: TeamMember): void {
    const index = this.selectedMembers.findIndex(m => m.id === member.id);
    if (index > -1) {
      this.selectedMembers.splice(index, 1);
    } else {
      this.selectedMembers.push(member);
    }
    this.teamService.updateSelectedMembers(this.selectedMembers);
  }

  isMemberSelected(member: TeamMember): boolean {
    return this.selectedMembers.some(m => m.id === member.id);
  }

  selectAll(): void {
    this.selectedMembers = [...this.filteredMembers];
    this.teamService.updateSelectedMembers(this.selectedMembers);
  }

  clearSelection(): void {
    this.selectedMembers = [];
    this.teamService.clearSelectedMembers();
  }

  // ============================================================================
  // Export Operations
  // ============================================================================

  exportTeamData(): void {
    const format = prompt('Enter export format (csv, excel, pdf):', 'csv') as 'csv' | 'excel' | 'pdf';
    if (!format) return;

    const filters: TeamSearchParams = {
      department: this.selectedDepartment || undefined,
      role: this.selectedRole || undefined,
      status: this.selectedStatus || undefined
    };

    this.teamService.exportTeamData(format, filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `team-data.${format}`;
          link.click();
          window.URL.revokeObjectURL(url);
        },
        error: (error) => {
          alert(`Error exporting data: ${error.message}`);
        }
      });
  }

  exportSelectedMembers(): void {
    if (this.selectedMembers.length === 0) {
      alert('Please select team members first.');
      return;
    }

    const format = prompt('Enter export format (csv, excel, pdf):', 'csv') as 'csv' | 'excel' | 'pdf';
    if (!format) return;

    const userIds = this.selectedMembers.map(m => m.id);
    this.teamService.exportSelectedMembers(userIds, format)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `selected-members.${format}`;
          link.click();
          window.URL.revokeObjectURL(url);
        },
        error: (error) => {
          alert(`Error exporting data: ${error.message}`);
        }
      });
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  getInitials(name: string): string {
    return this.teamService.getUserInitials(name);
  }

  getRoleClass(role: UserRole): string {
    const roleClasses: { [key in UserRole]: string } = {
      [UserRole.ADMIN]: 'role-admin',
      [UserRole.HR]: 'role-hr',
      [UserRole.MANAGER]: 'role-manager',
      [UserRole.EMPLOYEE]: 'role-employee'
    };
    return roleClasses[role] || 'role-employee';
  }

  getStatusClass(status: UserStatus): string {
    const statusClasses: { [key in UserStatus]: string } = {
      [UserStatus.ACTIVE]: 'status-active',
      [UserStatus.INACTIVE]: 'status-inactive',
      [UserStatus.ON_LEAVE]: 'status-on-leave',
      [UserStatus.PENDING]: 'status-pending'
    };
    return statusClasses[status] || 'status-inactive';
  }

  formatLastSeen(lastLoginAt?: Date): string {
    return this.teamService.formatLastSeen(lastLoginAt);
  }

  // ============================================================================
  // Role Badge Styling
  // ============================================================================

  getRoleBadgeColor(role: UserRole): { bg: string; text: string } {
    const colors: { [key in UserRole]: { bg: string; text: string } } = {
      [UserRole.ADMIN]: { bg: 'bg-purple-100', text: 'text-purple-800' },
      [UserRole.HR]: { bg: 'bg-blue-100', text: 'text-blue-800' },
      [UserRole.MANAGER]: { bg: 'bg-green-100', text: 'text-green-800' },
      [UserRole.EMPLOYEE]: { bg: 'bg-gray-100', text: 'text-gray-800' }
    };
    return colors[role] || colors[UserRole.EMPLOYEE];
  }

  getStatusBadgeColor(status: UserStatus): { bg: string; text: string } {
    const colors: { [key in UserStatus]: { bg: string; text: string } } = {
      [UserStatus.ACTIVE]: { bg: 'bg-green-100', text: 'text-green-800' },
      [UserStatus.INACTIVE]: { bg: 'bg-gray-100', text: 'text-gray-800' },
      [UserStatus.ON_LEAVE]: { bg: 'bg-orange-100', text: 'text-orange-800' },
      [UserStatus.PENDING]: { bg: 'bg-yellow-100', text: 'text-yellow-800' }
    };
    return colors[status] || colors[UserStatus.INACTIVE];
  }
}