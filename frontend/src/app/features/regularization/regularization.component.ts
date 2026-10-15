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
import { MatChipsModule } from '@angular/material/chips';
import { AuthService } from '../../core/services/auth.service';
import { RegularizationService, RegularizationRequest, RegularizationType } from './services/regularization.service';
import { toLocalDateString } from '../../core/utils/date.util';

@Component({
  selector: 'app-regularization',
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
    MatChipsModule
  ],
  templateUrl: './regularization.component.html',
  styleUrls: ['./regularization.component.scss']
})
export class RegularizationComponent implements OnInit {
  currentUser: any = null;
  myRequests: RegularizationRequest[] = [];
  pendingRequests: RegularizationRequest[] = [];
  submitting = false;
  errorMessage = '';

  // Matches REGULARIZATION_WINDOW_DAYS on the backend
  readonly maxDate = new Date();
  readonly minDate = new Date(new Date().setDate(new Date().getDate() - 30));

  readonly requestTypes: { value: RegularizationType, label: string }[] = [
    { value: 'MISSED_CHECK_IN', label: 'Missed check-in' },
    { value: 'MISSED_CHECK_OUT', label: 'Missed check-out' },
    { value: 'WRONG_TIME', label: 'Wrong time recorded' },
    { value: 'MARK_PRESENT', label: 'Mark present (no record)' }
  ];

  form: FormGroup;

  constructor(
    private authService: AuthService,
    private regularizationService: RegularizationService,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      date: ['', Validators.required],
      requestType: ['MISSED_CHECK_OUT', Validators.required],
      requestedCheckIn: [''],
      requestedCheckOut: [''],
      reason: ['', [Validators.required, Validators.minLength(5)]]
    });
  }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.loadMyRequests();

    if (this.isManagerOrAbove) {
      this.loadPendingRequests();
    }
  }

  get isManagerOrAbove(): boolean {
    return this.currentUser?.role && ['MANAGER', 'HR', 'ADMIN'].includes(this.currentUser.role);
  }

  get showCheckIn(): boolean {
    return this.form.value.requestType !== 'MISSED_CHECK_OUT';
  }

  get showCheckOut(): boolean {
    return this.form.value.requestType !== 'MISSED_CHECK_IN';
  }

  typeLabel(type: RegularizationType): string {
    return this.requestTypes.find(t => t.value === type)?.label || type;
  }

  loadMyRequests(): void {
    this.regularizationService.getMyRequests().subscribe(requests => this.myRequests = requests);
  }

  loadPendingRequests(): void {
    this.regularizationService.getPendingRequests().subscribe(requests => this.pendingRequests = requests);
  }

  submit(): void {
    if (this.form.invalid) return;

    this.submitting = true;
    this.errorMessage = '';

    const { date, requestType, requestedCheckIn, requestedCheckOut, reason } = this.form.value;

    this.regularizationService.apply({
      date: toLocalDateString(date),
      requestType,
      requestedCheckIn: this.showCheckIn ? requestedCheckIn || undefined : undefined,
      requestedCheckOut: this.showCheckOut ? requestedCheckOut || undefined : undefined,
      reason
    }).subscribe({
      next: () => {
        this.submitting = false;
        this.form.reset({ requestType: 'MISSED_CHECK_OUT' });
        this.loadMyRequests();
      },
      error: (err) => {
        this.submitting = false;
        this.errorMessage = err?.error?.message || 'Failed to submit regularization request';
      }
    });
  }

  cancelRequest(request: RegularizationRequest): void {
    this.regularizationService.cancel(request.id).subscribe(() => this.loadMyRequests());
  }

  approveRequest(request: RegularizationRequest): void {
    this.regularizationService.approve(request.id).subscribe({
      next: () => this.loadPendingRequests(),
      error: (err) => window.alert(err?.error?.message || 'Failed to approve request')
    });
  }

  rejectRequest(request: RegularizationRequest): void {
    const reason = window.prompt('Reason for rejecting this request?');
    if (!reason) return;

    this.regularizationService.reject(request.id, reason).subscribe({
      next: () => this.loadPendingRequests(),
      error: (err) => window.alert(err?.error?.message || 'Failed to reject request')
    });
  }

  statusColor(status: string): string {
    switch (status) {
      case 'APPROVED': return 'primary';
      case 'REJECTED': return 'warn';
      default: return '';
    }
  }
}
