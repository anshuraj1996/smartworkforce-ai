import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthService } from '../../core/services/auth.service';
import { WfhService, WfhRequest, WfhQuota } from './services/wfh.service';

@Component({
  selector: 'app-wfh',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatCheckboxModule,
    MatChipsModule,
    MatProgressBarModule
  ],
  templateUrl: './wfh.component.html',
  styleUrls: ['./wfh.component.scss']
})
export class WfhComponent implements OnInit {
  currentUser: any = null;
  myRequests: WfhRequest[] = [];
  pendingRequests: WfhRequest[] = [];
  quota: WfhQuota | null = null;
  submitting = false;
  errorMessage = '';

  wfhForm: FormGroup;

  constructor(
    private authService: AuthService,
    private wfhService: WfhService,
    private fb: FormBuilder
  ) {
    this.wfhForm = this.fb.group({
      startDate: ['', Validators.required],
      endDate: ['', Validators.required],
      isHalfDay: [false],
      halfDayType: [''],
      reason: ['', [Validators.required, Validators.minLength(5)]]
    });
  }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.loadMyRequests();
    this.loadQuota();

    if (this.isManagerOrAbove) {
      this.loadPendingRequests();
    }
  }

  get isManagerOrAbove(): boolean {
    return this.currentUser?.role && ['MANAGER', 'HR', 'ADMIN'].includes(this.currentUser.role);
  }

  loadMyRequests(): void {
    this.wfhService.getMyRequests().subscribe(requests => this.myRequests = requests);
  }

  loadQuota(): void {
    this.wfhService.getQuota().subscribe(quota => this.quota = quota);
  }

  loadPendingRequests(): void {
    this.wfhService.getPendingRequests().subscribe(requests => this.pendingRequests = requests);
  }

  submit(): void {
    if (this.wfhForm.invalid) return;

    this.submitting = true;
    this.errorMessage = '';

    const { startDate, endDate, isHalfDay, halfDayType, reason } = this.wfhForm.value;

    this.wfhService.applyWfh({
      startDate: this.toDateString(startDate),
      endDate: this.toDateString(endDate),
      isHalfDay,
      halfDayType: isHalfDay ? halfDayType : undefined,
      reason
    }).subscribe({
      next: () => {
        this.submitting = false;
        this.wfhForm.reset({ isHalfDay: false });
        this.loadMyRequests();
        this.loadQuota();
      },
      error: (err) => {
        this.submitting = false;
        this.errorMessage = err?.error?.message || 'Failed to submit WFH request';
      }
    });
  }

  approveRequest(request: WfhRequest): void {
    this.wfhService.approve(request.id).subscribe(() => this.loadPendingRequests());
  }

  rejectRequest(request: WfhRequest): void {
    const reason = window.prompt('Reason for rejecting this request?');
    if (!reason) return;

    this.wfhService.reject(request.id, reason).subscribe(() => this.loadPendingRequests());
  }

  statusColor(status: string): string {
    switch (status) {
      case 'APPROVED': return 'primary';
      case 'REJECTED': return 'warn';
      default: return '';
    }
  }

  private toDateString(value: Date | string): string {
    const d = new Date(value);
    return d.toISOString().split('T')[0];
  }
}
