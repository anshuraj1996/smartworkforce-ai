import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
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
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthService } from '../../core/services/auth.service';
import {
  PoliciesService, Policy, PolicyCategory, AcknowledgementStatus, LeavePolicy, LeaveBalanceRow
} from './services/policies.service';
import { toLocalDateString, parseLocalDate } from '../../core/utils/date.util';

const LEAVE_TYPES = [
  'ANNUAL', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY',
  'EMERGENCY', 'UNPAID', 'COMPENSATORY', 'BEREAVEMENT'
];

@Component({
  selector: 'app-policies',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
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
    MatExpansionModule,
    MatProgressBarModule
  ],
  templateUrl: './policies.component.html',
  styleUrls: ['./policies.component.scss']
})
export class PoliciesComponent implements OnInit {
  currentUser: any = null;
  policies: Policy[] = [];
  balances: LeaveBalanceRow[] = [];
  leavePolicies: LeavePolicy[] = [];
  ackStatus: Record<string, AcknowledgementStatus> = {};

  showForm = false;
  editingPolicy: Policy | null = null;
  saving = false;
  errorMessage = '';
  leavePolicyMessage = '';

  readonly categories: { value: PolicyCategory, label: string }[] = [
    { value: 'LEAVE', label: 'Leave' },
    { value: 'ATTENDANCE', label: 'Attendance' },
    { value: 'WFH', label: 'Work From Home' },
    { value: 'CODE_OF_CONDUCT', label: 'Code of Conduct' },
    { value: 'IT_SECURITY', label: 'IT & Security' },
    { value: 'HR', label: 'HR' },
    { value: 'OTHER', label: 'Other' }
  ];

  policyForm: FormGroup;

  constructor(
    private authService: AuthService,
    private policiesService: PoliciesService,
    private fb: FormBuilder
  ) {
    this.policyForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(3)]],
      category: ['OTHER', Validators.required],
      summary: [''],
      content: ['', [Validators.required, Validators.minLength(10)]],
      effectiveDate: [new Date(), Validators.required],
      requiresAcknowledgement: [true]
    });
  }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.loadPolicies();
    this.loadBalances();

    if (this.isHrOrAbove) {
      this.loadLeavePolicies();
    }
  }

  get isHrOrAbove(): boolean {
    return this.currentUser?.role && ['HR', 'ADMIN'].includes(this.currentUser.role);
  }

  get usesCompanyPolicy(): boolean {
    return this.balances.length > 0 && this.balances[0].isConfigured;
  }

  get pendingAckCount(): number {
    return this.policies.filter(p => p.isActive && p.requiresAcknowledgement && !p.acknowledged).length;
  }

  categoryLabel(category: PolicyCategory): string {
    return this.categories.find(c => c.value === category)?.label || category;
  }

  loadPolicies(): void {
    this.policiesService.getPolicies(this.isHrOrAbove).subscribe(policies => this.policies = policies);
  }

  loadBalances(): void {
    this.policiesService.getLeaveBalances().subscribe(balances => this.balances = balances);
  }

  // One editable row per leave type - unconfigured types start at 0 and inactive
  loadLeavePolicies(): void {
    this.policiesService.getLeavePolicies().subscribe(existing => {
      this.leavePolicies = LEAVE_TYPES.map(leaveType =>
        existing.find(p => p.leaveType === leaveType) || {
          leaveType,
          annualAllocation: 0,
          carryForwardMax: 0,
          allowNegativeBalance: false,
          isActive: false
        }
      );
    });
  }

  acknowledge(policy: Policy): void {
    this.policiesService.acknowledge(policy.id).subscribe(() => this.loadPolicies());
  }

  openCreate(): void {
    this.editingPolicy = null;
    this.errorMessage = '';
    this.policyForm.reset({ category: 'OTHER', effectiveDate: new Date(), requiresAcknowledgement: true });
    this.showForm = true;
  }

  openEdit(policy: Policy): void {
    this.editingPolicy = policy;
    this.errorMessage = '';
    this.policyForm.reset({
      title: policy.title,
      category: policy.category,
      summary: policy.summary || '',
      content: policy.content,
      effectiveDate: parseLocalDate(policy.effectiveDate),
      requiresAcknowledgement: policy.requiresAcknowledgement
    });
    this.showForm = true;
  }

  savePolicy(): void {
    if (this.policyForm.invalid) return;

    this.saving = true;
    this.errorMessage = '';

    const value = this.policyForm.value;
    const payload = { ...value, effectiveDate: toLocalDateString(value.effectiveDate) };
    const request = this.editingPolicy
      ? this.policiesService.updatePolicy(this.editingPolicy.id, payload)
      : this.policiesService.createPolicy(payload);

    request.subscribe({
      next: () => {
        this.saving = false;
        this.showForm = false;
        this.loadPolicies();
      },
      error: (err) => {
        this.saving = false;
        this.errorMessage = err?.error?.message || 'Failed to save policy';
      }
    });
  }

  archive(policy: Policy): void {
    if (!window.confirm(`Archive "${policy.title}"? Employees will no longer see it.`)) return;
    this.policiesService.archivePolicy(policy.id).subscribe(() => this.loadPolicies());
  }

  restore(policy: Policy): void {
    this.policiesService.updatePolicy(policy.id, { isActive: true }).subscribe(() => this.loadPolicies());
  }

  loadAckStatus(policy: Policy): void {
    if (!this.isHrOrAbove || !policy.requiresAcknowledgement || this.ackStatus[policy.id]) return;
    this.policiesService.getAcknowledgements(policy.id).subscribe(status => this.ackStatus[policy.id] = status);
  }

  pendingNames(status: AcknowledgementStatus): string {
    return status.pending.slice(0, 15).map(p => p.name).join(', ');
  }

  saveLeavePolicy(row: LeavePolicy): void {
    this.leavePolicyMessage = '';
    this.policiesService.saveLeavePolicy(row).subscribe({
      next: () => {
        this.leavePolicyMessage = `${row.leaveType} allocation saved`;
        this.loadLeavePolicies();
        this.loadBalances();
      },
      error: (err) => this.leavePolicyMessage = err?.error?.message || 'Failed to save leave policy'
    });
  }
}
