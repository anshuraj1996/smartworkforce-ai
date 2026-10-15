import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../core/services/auth.service';
import {
  HiringService, JobOpening, JobStatus, Referral, ReferralStatus, EmploymentType, REFERRAL_TRANSITIONS
} from './services/hiring.service';

@Component({
  selector: 'app-hiring',
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
    MatChipsModule,
    MatTabsModule,
    MatMenuModule
  ],
  templateUrl: './hiring.component.html',
  styleUrls: ['./hiring.component.scss']
})
export class HiringComponent implements OnInit {
  currentUser: any = null;
  jobs: JobOpening[] = [];
  myReferrals: Referral[] = [];
  allReferrals: Referral[] = [];

  referringJob: JobOpening | null = null;
  showJobForm = false;
  editingJob: JobOpening | null = null;
  pipelineStatusFilter: ReferralStatus | '' = '';
  pipelineJobFilter = '';

  submitting = false;
  referralError = '';
  referralSuccess = '';
  jobError = '';

  readonly employmentTypes: { value: EmploymentType, label: string }[] = [
    { value: 'FULL_TIME', label: 'Full-time' },
    { value: 'PART_TIME', label: 'Part-time' },
    { value: 'CONTRACT', label: 'Contract' },
    { value: 'INTERN', label: 'Internship' }
  ];

  readonly referralStatuses: ReferralStatus[] = ['SUBMITTED', 'SCREENING', 'INTERVIEWING', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN'];

  referralForm: FormGroup;
  jobForm: FormGroup;

  constructor(
    private authService: AuthService,
    private hiringService: HiringService,
    private fb: FormBuilder
  ) {
    this.referralForm = this.fb.group({
      candidateName: ['', [Validators.required, Validators.minLength(2)]],
      candidateEmail: ['', [Validators.required, Validators.email]],
      candidatePhone: [''],
      resumeUrl: ['', Validators.pattern(/^https?:\/\/.+/)],
      relationship: [''],
      notes: ['']
    });

    this.jobForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(3)]],
      department: [''],
      location: [''],
      employmentType: ['FULL_TIME', Validators.required],
      experienceMin: [null],
      experienceMax: [null],
      openings: [1, [Validators.required, Validators.min(1)]],
      referralBonus: [null],
      description: ['', [Validators.required, Validators.minLength(10)]]
    });
  }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.loadJobs();
    this.loadMyReferrals();

    if (this.isHrOrAbove) {
      this.loadAllReferrals();
    }
  }

  get isHrOrAbove(): boolean {
    return this.currentUser?.role && ['HR', 'ADMIN'].includes(this.currentUser.role);
  }

  get openJobs(): JobOpening[] {
    return this.jobs.filter(j => j.status === 'OPEN');
  }

  employmentLabel(type: EmploymentType): string {
    return this.employmentTypes.find(t => t.value === type)?.label || type;
  }

  experienceLabel(job: JobOpening): string {
    if (job.experienceMin == null && job.experienceMax == null) return '';
    if (job.experienceMax == null) return `${job.experienceMin}+ yrs`;
    return `${job.experienceMin ?? 0}–${job.experienceMax} yrs`;
  }

  nextStatuses(referral: Referral): ReferralStatus[] {
    return REFERRAL_TRANSITIONS[referral.status];
  }

  statusColor(status: ReferralStatus | JobStatus): string {
    switch (status) {
      case 'HIRED':
      case 'OFFERED':
      case 'OPEN':
        return 'primary';
      case 'REJECTED':
      case 'CLOSED':
        return 'warn';
      default:
        return '';
    }
  }

  loadJobs(): void {
    this.hiringService.getJobs().subscribe(jobs => this.jobs = jobs);
  }

  loadMyReferrals(): void {
    this.hiringService.getMyReferrals().subscribe(referrals => this.myReferrals = referrals);
  }

  loadAllReferrals(): void {
    this.hiringService.getAllReferrals({
      status: this.pipelineStatusFilter || undefined,
      jobOpeningId: this.pipelineJobFilter || undefined
    }).subscribe(referrals => this.allReferrals = referrals);
  }

  // ---- Referring a candidate ----

  startReferral(job: JobOpening): void {
    this.referringJob = job;
    this.referralError = '';
    this.referralSuccess = '';
    this.referralForm.reset();
  }

  submitReferral(): void {
    if (!this.referringJob || this.referralForm.invalid) return;

    this.submitting = true;
    this.referralError = '';

    const job = this.referringJob;
    this.hiringService.refer(job.id, this.stripEmpty(this.referralForm.value)).subscribe({
      next: (referral) => {
        this.submitting = false;
        this.referralSuccess = `Thanks! ${referral.candidateName} was referred for ${job.title}.`;
        this.referringJob = null;
        this.loadMyReferrals();
        if (this.isHrOrAbove) {
          this.loadAllReferrals();
          this.loadJobs();
        }
      },
      error: (err) => {
        this.submitting = false;
        this.referralError = err?.error?.message || 'Failed to submit referral';
      }
    });
  }

  withdraw(referral: Referral): void {
    if (!window.confirm(`Withdraw your referral of ${referral.candidateName}?`)) return;
    this.hiringService.withdraw(referral.id).subscribe(() => this.loadMyReferrals());
  }

  // ---- HR: job openings ----

  openCreateJob(): void {
    this.editingJob = null;
    this.jobError = '';
    this.jobForm.reset({ employmentType: 'FULL_TIME', openings: 1 });
    this.showJobForm = true;
  }

  openEditJob(job: JobOpening): void {
    this.editingJob = job;
    this.jobError = '';
    this.jobForm.reset({
      title: job.title,
      department: job.department || '',
      location: job.location || '',
      employmentType: job.employmentType,
      experienceMin: job.experienceMin ?? null,
      experienceMax: job.experienceMax ?? null,
      openings: job.openings,
      referralBonus: job.referralBonus != null ? Number(job.referralBonus) : null,
      description: job.description
    });
    this.showJobForm = true;
  }

  saveJob(): void {
    if (this.jobForm.invalid) return;

    this.submitting = true;
    this.jobError = '';

    // On edit, blanks become null so a cleared field is actually cleared on the backend
    const request = this.editingJob
      ? this.hiringService.updateJob(this.editingJob.id, this.blankToNull(this.jobForm.value))
      : this.hiringService.createJob(this.stripEmpty(this.jobForm.value));

    request.subscribe({
      next: () => {
        this.submitting = false;
        this.showJobForm = false;
        this.loadJobs();
      },
      error: (err) => {
        this.submitting = false;
        this.jobError = err?.error?.message || 'Failed to save job opening';
      }
    });
  }

  setJobStatus(job: JobOpening, status: JobStatus): void {
    this.hiringService.updateJob(job.id, { status }).subscribe(() => this.loadJobs());
  }

  // ---- HR: referral pipeline ----

  moveReferral(referral: Referral, status: ReferralStatus): void {
    const note = window.prompt(`Note for moving ${referral.candidateName} to ${status} (optional)`, '');
    if (note === null) return;

    this.hiringService.updateReferralStatus(referral.id, status, note || undefined).subscribe({
      next: () => {
        this.loadAllReferrals();
        this.loadJobs();
      },
      error: (err) => window.alert(err?.error?.message || 'Failed to update referral')
    });
  }

  // Blank optional fields are sent as absent rather than '' so they don't trip backend validation
  private stripEmpty<T extends object>(value: T): T {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== '' && v !== null && v !== undefined)
    ) as T;
  }

  private blankToNull<T extends object>(value: T): T {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, v === '' || v === undefined ? null : v])
    ) as T;
  }
}
