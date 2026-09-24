import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatTabChangeEvent, MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { Subject, takeUntil } from 'rxjs';

import {
  ProfileService, 
  UserProfile, 
  ProfileUpdateRequest, 
  PasswordChangeRequest,
  UserPreferences,
  Certification 
} from './services/profile.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
    MatDividerModule,
    MatSlideToggleModule,
    MatListModule,
    MatChipsModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatBadgeModule
  ],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})
export class ProfileComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Profile Data
  currentProfile: UserProfile | null = null;
  isLoading = false;
  isEditing = false;
  selectedTabIndex = 0;

  // Forms
  profileForm!: FormGroup;
  passwordForm!: FormGroup;
  preferencesForm!: FormGroup;
  certificationForm!: FormGroup;

  // UI State
  avatarPreview: string | null = null;
  passwordStrength: { isValid: boolean; score: number; feedback: string[] } = { isValid: false, score: 0, feedback: [] };

  // Dropdown Options
  timezones: string[] = [];
  languages: { code: string; name: string }[] = [];
  departments = ['Engineering', 'HR', 'Marketing', 'Sales', 'Finance', 'Operations'];
  skills = ['JavaScript', 'TypeScript', 'Angular', 'React', 'Node.js', 'Python', 'Java', 'C#'];

  // Statistics
  userStats: any = {};

  // Role-based permissions and visibility
  rolePermissions = {
    canEditOthers: false,
    canViewSensitiveData: false,
    canManageRoles: false,
    canAccessAdminFeatures: false,
    canViewTeamData: false,
    canManageOrganization: false
  };

  constructor(
    private profileService: ProfileService,
    private fb: FormBuilder
  ) {
    this.initializeForms();
  }

  ngOnInit(): void {
    this.loadProfile();
    this.loadTimezones();
    this.loadLanguages();
    this.loadUserStats();

    // Subscribe to profile updates
    this.profileService.profile$
      .pipe(takeUntil(this.destroy$))
      .subscribe(profile => {
        if (profile) {
          this.currentProfile = profile;
          this.updateRolePermissions(profile.role);
          this.populateProfileForm();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private updateRolePermissions(role: string): void {
    switch (role) {
      case 'ADMIN':
        this.rolePermissions = {
          canEditOthers: true,
          canViewSensitiveData: true,
          canManageRoles: true,
          canAccessAdminFeatures: true,
          canViewTeamData: true,
          canManageOrganization: true
        };
        break;
      case 'HR':
        this.rolePermissions = {
          canEditOthers: true,
          canViewSensitiveData: true,
          canManageRoles: false,
          canAccessAdminFeatures: false,
          canViewTeamData: true,
          canManageOrganization: false
        };
        break;
      case 'MANAGER':
        this.rolePermissions = {
          canEditOthers: false,
          canViewSensitiveData: false,
          canManageRoles: false,
          canAccessAdminFeatures: false,
          canViewTeamData: true,
          canManageOrganization: false
        };
        break;
      case 'EMPLOYEE':
      default:
        this.rolePermissions = {
          canEditOthers: false,
          canViewSensitiveData: false,
          canManageRoles: false,
          canAccessAdminFeatures: false,
          canViewTeamData: false,
          canManageOrganization: false
        };
        break;
    }
  }

  // Role-based visibility methods
  isAdmin(): boolean {
    return this.currentProfile?.role === 'ADMIN';
  }

  isHR(): boolean {
    return this.currentProfile?.role === 'HR';
  }

  isManager(): boolean {
    return this.currentProfile?.role === 'MANAGER';
  }

  isEmployee(): boolean {
    return this.currentProfile?.role === 'EMPLOYEE';
  }

  hasPermission(permission: keyof typeof this.rolePermissions): boolean {
    return this.rolePermissions[permission];
  }

  canViewTab(tabName: string): boolean {
    switch (tabName) {
      case 'personal':
        return true; // All roles can view personal info
      case 'professional':
        return true; // All roles can view professional details
      case 'security':
        return true; // All roles can manage their security
      case 'preferences':
        return true; // All roles can set preferences
      case 'account':
        return true; // All roles can manage their account
      case 'admin':
        return this.isAdmin(); // Only admin can view admin tab
      case 'hr':
        return this.isAdmin() || this.isHR(); // Admin and HR can view HR tab
      case 'management':
        return this.isAdmin() || this.isHR() || this.isManager(); // Management roles only
      default:
        return true;
    }
  }

  getAvailableTabs(): string[] {
    const allTabs = ['personal', 'professional', 'security', 'preferences', 'account'];
    
    if (this.hasPermission('canAccessAdminFeatures')) {
      allTabs.push('admin');
    }
    
    if (this.hasPermission('canViewTeamData')) {
      allTabs.push('management');
    }
    
    if (this.isHR() || this.isAdmin()) {
      allTabs.push('hr');
    }
    
    return allTabs;
  }

  getRoleSpecificStats(): any {
    // this.userStats already comes back role-scoped for real from GET /users/stats -
    // no need to layer anything on top of it.
    return this.userStats;
  }

  canEditField(fieldName: string): boolean {
    const restrictedFields = ['email', 'employeeId', 'role'];
    
    if (restrictedFields.includes(fieldName)) {
      return this.hasPermission('canAccessAdminFeatures');
    }
    
    const hrOnlyFields = ['department', 'designation'];
    if (hrOnlyFields.includes(fieldName)) {
      return this.isHR() || this.isAdmin();
    }
    
    return true;
  }

  getTabLabel(tabName: string): string {
    const labels: { [key: string]: string } = {
      personal: 'Personal Information',
      professional: 'Professional Details',
      security: 'Security Settings',
      preferences: 'Preferences',
      account: 'Account Management',
      admin: 'System Administration',
      hr: 'HR Management',
      management: 'Team Management'
    };
    
    return labels[tabName] || tabName;
  }

  getTabIcon(tabName: string): string {
    const icons: { [key: string]: string } = {
      personal: 'person',
      professional: 'work',
      security: 'security',
      preferences: 'settings',
      account: 'admin_panel_settings',
      admin: 'admin_panel_settings',
      hr: 'people',
      management: 'groups'
    };
    
    return icons[tabName] || 'tab';
  }

  private initializeForms(): void {
    // Profile Form
    this.profileForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: [{ value: '', disabled: true }],
      phone: ['', [Validators.pattern(/^[\+]?[1-9][\d]{0,15}$/)]],
      department: [''],
      designation: [''],
      employeeId: [{ value: '', disabled: true }],
      skills: [[]],
      address: this.fb.group({
        street: [''],
        city: [''],
        state: [''],
        zipCode: [''],
        country: ['']
      }),
      emergencyContact: this.fb.group({
        name: [''],
        relationship: [''],
        phone: [''],
        email: ['']
      })
    });

    // Password Form
    this.passwordForm = this.fb.group({
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });

    // Preferences Form
    this.preferencesForm = this.fb.group({
      theme: ['system'],
      language: ['en'],
      timezone: ['UTC'],
      emailNotifications: [true],
      pushNotifications: [true],
      workingHours: this.fb.group({
        startTime: ['09:00'],
        endTime: ['17:00'],
        workingDays: [[1, 2, 3, 4, 5]]
      })
    });

    // Certification Form
    this.certificationForm = this.fb.group({
      name: ['', [Validators.required]],
      provider: ['', [Validators.required]],
      dateObtained: ['', [Validators.required]],
      expiryDate: [''],
      certificateUrl: ['']
    });

    // Watch password changes for strength validation
    this.passwordForm.get('newPassword')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(password => {
        if (password) {
          this.passwordStrength = this.profileService.validatePasswordStrength(password);
        }
      });
  }

  private passwordMatchValidator(form: FormGroup): any {
    const newPassword = form.get('newPassword');
    const confirmPassword = form.get('confirmPassword');
    
    if (!newPassword || !confirmPassword) return null;
    
    return newPassword.value === confirmPassword.value 
      ? null 
      : { passwordMismatch: true };
  }

  private loadProfile(): void {
    this.isLoading = true;
    this.profileService.getProfile()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (profile) => {
          this.currentProfile = profile;
          this.profileService.updateProfileSubject(profile);
          this.populateProfileForm();
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error loading profile:', error);
          this.isLoading = false;
        }
      });
  }

  private loadTimezones(): void {
    this.profileService.getTimezones()
      .pipe(takeUntil(this.destroy$))
      .subscribe(timezones => this.timezones = timezones);
  }

  private loadLanguages(): void {
    this.profileService.getLanguages()
      .pipe(takeUntil(this.destroy$))
      .subscribe(languages => this.languages = languages);
  }

  private loadUserStats(): void {
    this.profileService.getUserStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe(stats => this.userStats = stats);
  }

  private populateProfileForm(): void {
    if (!this.currentProfile) return;

    this.profileForm.patchValue({
      name: this.currentProfile.name,
      email: this.currentProfile.email,
      phone: this.currentProfile.phone || '',
      department: this.currentProfile.department,
      designation: this.currentProfile.designation,
      employeeId: this.currentProfile.employeeId,
      skills: this.currentProfile.skills || [],
      address: this.currentProfile.address || {},
      emergencyContact: this.currentProfile.emergencyContact || {}
    });

    this.preferencesForm.patchValue(this.currentProfile.preferences || {});
  }

  // Avatar Management
  onAvatarSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { // 2MB limit
        alert('File size should be less than 2MB');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.avatarPreview = e.target.result;
      };
      reader.readAsDataURL(file);

      this.uploadAvatar(file);
    }
  }

  uploadAvatar(file: File): void {
    this.profileService.updateAvatar(file)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (this.currentProfile) {
            this.currentProfile.avatar = response.avatarUrl;
            this.profileService.updateAvatarSubject(response.avatarUrl);
          }
          this.avatarPreview = null;
        },
        error: (error) => {
          console.error('Error uploading avatar:', error);
          this.avatarPreview = null;
        }
      });
  }

  removeAvatar(): void {
    this.profileService.removeAvatar()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (this.currentProfile) {
            this.currentProfile.avatar = undefined;
            this.profileService.updateAvatarSubject('');
          }
        },
        error: (error) => console.error('Error removing avatar:', error)
      });
  }

  // Profile Management
  toggleEdit(): void {
    this.isEditing = !this.isEditing;
    if (!this.isEditing) {
      this.populateProfileForm();
    }
  }

  saveProfile(): void {
    if (this.profileForm.valid) {
      const updateData: ProfileUpdateRequest = this.profileForm.value;
      
      this.profileService.updateProfile(updateData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (updatedProfile) => {
            this.currentProfile = updatedProfile;
            this.profileService.updateProfileSubject(updatedProfile);
            this.isEditing = false;
          },
          error: (error) => console.error('Error updating profile:', error)
        });
    }
  }

  // Password Management
  changePassword(): void {
    if (this.passwordForm.valid) {
      const passwordData: PasswordChangeRequest = this.passwordForm.value;
      
      this.profileService.changePassword(passwordData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.passwordForm.reset();
            alert('Password changed successfully');
          },
          error: (error) => console.error('Error changing password:', error)
        });
    }
  }

  // Preferences Management
  savePreferences(): void {
    if (this.preferencesForm.valid) {
      const preferences = this.preferencesForm.value as Partial<UserPreferences>;
      
      this.profileService.updatePreferences(preferences)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            if (this.currentProfile && this.currentProfile.preferences) {
              this.currentProfile.preferences = { ...this.currentProfile.preferences, ...preferences } as UserPreferences;
            }
          },
          error: (error) => console.error('Error updating preferences:', error)
        });
    }
  }

  // Certification Management
  addCertification(): void {
    if (this.certificationForm.valid) {
      const certificationData = this.certificationForm.value;
      
      this.profileService.addCertification(certificationData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (newCert) => {
            if (this.currentProfile) {
              this.currentProfile.certifications = [...(this.currentProfile.certifications || []), newCert];
            }
            this.certificationForm.reset();
          },
          error: (error) => console.error('Error adding certification:', error)
        });
    }
  }

  deleteCertification(certId: string): void {
    this.profileService.deleteCertification(certId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (this.currentProfile) {
            this.currentProfile.certifications = this.currentProfile.certifications?.filter(c => c.id !== certId);
          }
        },
        error: (error) => console.error('Error deleting certification:', error)
      });
  }

  // Utility Methods
  onTabChanged(event: MatTabChangeEvent): void {
    this.selectedTabIndex = event.index;
  }

  getInitials(name: string): string {
    return this.profileService.getUserInitials(name);
  }

  getRoleColor(role: string): string {
    return this.profileService.getRoleColor(role);
  }

  formatDate(dateString: string): string {
    return this.profileService.formatDate(dateString);
  }

  calculateExperience(): number {
    return this.currentProfile 
      ? this.profileService.calculateExperience(this.currentProfile.dateOfJoining)
      : 0;
  }

  getPasswordStrengthColor(): string {
    const score = this.passwordStrength.score;
    if (score < 40) return 'warn';
    if (score < 80) return 'accent';
    return 'primary';
  }

  getPasswordStrengthText(): string {
    const score = this.passwordStrength.score;
    if (score < 40) return 'Weak';
    if (score < 80) return 'Medium';
    return 'Strong';
  }

  // Data Export
  exportData(format: 'json' | 'pdf' = 'json'): void {
    this.profileService.exportUserData(format)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `profile-data.${format}`;
          link.click();
          window.URL.revokeObjectURL(url);
        },
        error: (error) => console.error('Error exporting data:', error)
      });
  }

  // Account Management
  requestAccountDeletion(): void {
    const reason = prompt('Please provide a reason for account deletion:');
    if (reason) {
      this.profileService.requestAccountDeletion(reason)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => alert('Account deletion request submitted'),
          error: (error) => console.error('Error requesting account deletion:', error)
        });
    }
  }
}