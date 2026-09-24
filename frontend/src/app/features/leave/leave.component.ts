import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDialogModule, MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { LeaveService } from './services/leave.service';

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY', 'EMERGENCY', 'UNPAID', 'COMPENSATORY', 'BEREAVEMENT'];

interface LeaveStats {
  totalRequests: number;
  pending: number;
  approved: number;
  rejected: number;
}

interface LeaveRequestRow {
  id: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  appliedDate: string;
}

@Component({
  selector: 'app-leave',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTableModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatDialogModule,
    ReactiveFormsModule
  ],
  templateUrl: './leave.component.html',
  styleUrls: ['./leave.component.scss']
})
export class LeaveComponent implements OnInit {
  currentDate = new Date();
  currentUser: any = null;
  selectedFilter = 'all';
  isLoading = false;

  stats: LeaveStats = { totalRequests: 0, pending: 0, approved: 0, rejected: 0 };

  allRequests: LeaveRequestRow[] = [];
  filteredRequests: LeaveRequestRow[] = [];

  constructor(
    private authService: AuthService,
    private leaveService: LeaveService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.loadData();
    });
  }

  get isEmployee(): boolean {
    return this.currentUser?.role === 'EMPLOYEE';
  }

  get isManagerOrAbove(): boolean {
    return this.currentUser?.role && ['MANAGER', 'HR', 'ADMIN'].includes(this.currentUser.role);
  }

  loadData(): void {
    if (!this.currentUser) return;

    this.isLoading = true;

    if (this.isEmployee) {
      this.leaveService.getMyLeaveRequests().subscribe({
        next: (requests) => {
          this.allRequests = (requests || []).map(r => this.toRow(r, this.currentUser.name));
          this.stats = {
            totalRequests: this.allRequests.length,
            pending: this.allRequests.filter(r => r.status === 'pending').length,
            approved: this.allRequests.filter(r => r.status === 'approved').length,
            rejected: this.allRequests.filter(r => r.status === 'rejected').length
          };
          this.filterRequests();
          this.isLoading = false;
        },
        error: () => { this.isLoading = false; }
      });
    } else {
      // No backend endpoint exists yet to browse all historical team requests -
      // this view shows the actionable pending queue only.
      this.leaveService.getPendingLeaveRequests().subscribe({
        next: (requests: any[]) => {
          this.allRequests = (requests || []).map(r => this.toRow(r, r.user?.name || 'Unknown'));
          this.stats = {
            totalRequests: this.allRequests.length,
            pending: this.allRequests.length,
            approved: 0,
            rejected: 0
          };
          this.filteredRequests = this.allRequests;
          this.isLoading = false;
        },
        error: () => { this.isLoading = false; }
      });
    }
  }

  private toRow(r: any, employeeName: string): LeaveRequestRow {
    return {
      id: r.id,
      employeeName,
      leaveType: this.formatLeaveType(r.leaveType),
      startDate: r.startDate,
      endDate: r.endDate,
      totalDays: r.dayCount ?? r.leaveDays ?? 0,
      reason: r.reason,
      status: (r.status || 'pending').toLowerCase(),
      appliedDate: r.createdAt || r.appliedAt
    };
  }

  private formatLeaveType(type: string): string {
    if (!type) return '';
    return type.charAt(0) + type.slice(1).toLowerCase();
  }

  filterRequests(): void {
    if (!this.isEmployee) {
      this.filteredRequests = this.allRequests;
      return;
    }

    this.filteredRequests = this.selectedFilter === 'all'
      ? this.allRequests
      : this.allRequests.filter(r => r.status === this.selectedFilter);
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'approved': return 'status-approved';
      case 'rejected': return 'status-rejected';
      default: return '';
    }
  }

  openLeaveForm(): void {
    const dialogRef = this.dialog.open(LeaveFormDialogComponent, {
      width: '500px',
      data: { currentUser: this.currentUser }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.submitLeaveRequest(result);
      }
    });
  }

  private submitLeaveRequest(formData: any): void {
    this.leaveService.applyLeave({
      startDate: this.toDateString(formData.startDate),
      endDate: this.toDateString(formData.endDate),
      leaveType: formData.leaveType,
      reason: formData.reason
    }).subscribe({
      next: () => {
        this.snackBar.open('Leave request submitted', 'Close', { duration: 2000 });
        this.loadData();
      },
      error: (err) => {
        this.snackBar.open(err?.error?.message || 'Failed to submit leave request', 'Close', { duration: 3000 });
      }
    });
  }

  private toDateString(value: Date | string): string {
    const d = new Date(value);
    return d.toISOString().split('T')[0];
  }

  approveRequest(request: LeaveRequestRow): void {
    this.leaveService.approveLeaveRequest(request.id).subscribe({
      next: () => {
        this.snackBar.open('Leave request approved', 'Close', { duration: 2000 });
        this.loadData();
      },
      error: (err) => this.snackBar.open(err?.error?.message || 'Failed to approve', 'Close', { duration: 3000 })
    });
  }

  rejectRequest(request: LeaveRequestRow): void {
    const comments = window.prompt('Reason for rejecting this leave request?');
    if (!comments) return;

    this.leaveService.rejectLeaveRequest(request.id, comments).subscribe({
      next: () => {
        this.snackBar.open('Leave request rejected', 'Close', { duration: 2000 });
        this.loadData();
      },
      error: (err) => this.snackBar.open(err?.error?.message || 'Failed to reject', 'Close', { duration: 3000 })
    });
  }
}

// Leave Form Dialog Component
@Component({
  selector: 'app-leave-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonModule,
    ReactiveFormsModule
  ],
  template: `
    <h2 mat-dialog-title>Apply for Leave</h2>
    <mat-dialog-content>
      <form [formGroup]="leaveForm" class="space-y-4">
        <mat-form-field appearance="outline">
          <mat-label>Leave Type</mat-label>
          <mat-select formControlName="leaveType" required>
            <mat-option *ngFor="let type of leaveTypes" [value]="type">{{ formatLabel(type) }}</mat-option>
          </mat-select>
          <mat-error *ngIf="leaveForm.get('leaveType')?.hasError('required')">
            Leave type is required
          </mat-error>
        </mat-form-field>

        <div class="grid grid-cols-2 gap-4">
          <mat-form-field appearance="outline">
            <mat-label>Start Date</mat-label>
            <input matInput [matDatepicker]="startPicker" formControlName="startDate" required>
            <mat-datepicker-toggle matIconSuffix [for]="startPicker"></mat-datepicker-toggle>
            <mat-datepicker #startPicker></mat-datepicker>
            <mat-error *ngIf="leaveForm.get('startDate')?.hasError('required')">
              Start date is required
            </mat-error>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>End Date</mat-label>
            <input matInput [matDatepicker]="endPicker" formControlName="endDate" required>
            <mat-datepicker-toggle matIconSuffix [for]="endPicker"></mat-datepicker-toggle>
            <mat-datepicker #endPicker></mat-datepicker>
            <mat-error *ngIf="leaveForm.get('endDate')?.hasError('required')">
              End date is required
            </mat-error>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline">
          <mat-label>Reason</mat-label>
          <textarea matInput rows="3" formControlName="reason" required
                    placeholder="Please provide a reason for your leave request (min 10 characters)"></textarea>
          <mat-error *ngIf="leaveForm.get('reason')?.hasError('required')">
            Reason is required
          </mat-error>
          <mat-error *ngIf="leaveForm.get('reason')?.hasError('minlength')">
            Reason must be at least 10 characters
          </mat-error>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary" [disabled]="!leaveForm.valid"
              (click)="submitForm()">Apply Leave</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      min-width: 400px;
      padding: 20px 0;
    }
    .space-y-4 > * + * {
      margin-top: 1rem;
    }
    .grid {
      display: grid;
    }
    .grid-cols-2 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .gap-4 {
      gap: 1rem;
    }
  `]
})
export class LeaveFormDialogComponent implements OnInit {
  leaveForm: FormGroup;
  leaveTypes = LEAVE_TYPES;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<LeaveFormDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    this.leaveForm = this.fb.group({
      leaveType: ['', Validators.required],
      startDate: ['', Validators.required],
      endDate: ['', Validators.required],
      reason: ['', [Validators.required, Validators.minLength(10)]]
    });
  }

  ngOnInit(): void {}

  formatLabel(type: string): string {
    return type.charAt(0) + type.slice(1).toLowerCase();
  }

  submitForm(): void {
    if (this.leaveForm.valid) {
      this.dialogRef.close(this.leaveForm.value);
    }
  }
}

// Required import for dialog
import { Inject } from '@angular/core';
