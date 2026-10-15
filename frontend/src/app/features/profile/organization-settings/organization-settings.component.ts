import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { map } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface Holiday { date: string; name: string; }
export interface OrganizationSettings {
  name: string;
  timezone: string;
  wfhMonthlyQuota: number;
  regularizationWindowDays: number;
  approvalSlaHours: number;
  publicHolidays: Holiday[];
}

// Organization (tenant) settings for HR and admins: the per-organization rules that used to
// be fixed for every company. HR edits the rules; only admins edit the name and timezone
// (the API enforces this too).
@Component({
  selector: 'app-organization-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="org-settings">
      <p class="muted" *ngIf="loading">Loading…</p>
      <p class="error" *ngIf="loadError">{{ loadError }}</p>

      <form *ngIf="form" (ngSubmit)="save()">
        <h3>Organization</h3>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Name</mat-label>
            <input matInput [(ngModel)]="form.name" name="name" [disabled]="!isAdmin" required>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Timezone (IANA, e.g. Asia/Kolkata)</mat-label>
            <input matInput [(ngModel)]="form.timezone" name="timezone" [disabled]="!isAdmin" required>
          </mat-form-field>
        </div>
        <p class="hint" *ngIf="!isAdmin">Only admins can change the name and timezone.</p>

        <h3>Rules</h3>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>WFH days per employee per month</mat-label>
            <input matInput type="number" min="0" max="31" [(ngModel)]="form.wfhMonthlyQuota" name="wfhMonthlyQuota" required>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Regularization window (days back)</mat-label>
            <input matInput type="number" min="1" max="365" [(ngModel)]="form.regularizationWindowDays" name="regularizationWindowDays" required>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Approval target (hours)</mat-label>
            <input matInput type="number" min="1" max="720" [(ngModel)]="form.approvalSlaHours" name="approvalSlaHours" required>
          </mat-form-field>
        </div>

        <h3>Public holidays</h3>
        <div class="holiday" *ngFor="let h of form.publicHolidays; let i = index">
          <mat-form-field appearance="outline">
            <mat-label>Date</mat-label>
            <input matInput type="date" [(ngModel)]="h.date" [name]="'hdate' + i" required>
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Name</mat-label>
            <input matInput [(ngModel)]="h.name" [name]="'hname' + i" maxlength="100">
          </mat-form-field>
          <button mat-icon-button type="button" (click)="removeHoliday(i)" matTooltip="Remove" aria-label="Remove holiday">
            <mat-icon>delete</mat-icon>
          </button>
        </div>
        <button mat-stroked-button type="button" (click)="addHoliday()"><mat-icon>add</mat-icon> Add holiday</button>

        <div class="actions">
          <button mat-flat-button color="primary" type="submit" [disabled]="saving">Save settings</button>
          <span class="ok" *ngIf="saved">Saved.</span>
          <span class="error" *ngIf="saveError">{{ saveError }}</span>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .org-settings { padding: 8px 0; }
    h3 { margin: 16px 0 8px; font-size: 1rem; font-weight: 500; }
    .row { display: flex; flex-wrap: wrap; gap: 12px; }
    .row mat-form-field { min-width: 220px; }
    .holiday { display: flex; align-items: center; gap: 12px; }
    .grow { flex: 1; }
    .actions { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
    .muted, .hint { color: rgba(0, 0, 0, 0.6); font-size: 0.85rem; }
    .error { color: #c62828; }
    .ok { color: #2e7d32; }
  `]
})
export class OrganizationSettingsComponent implements OnInit {
  @Input() isAdmin = false;

  private readonly api = `${environment.apiUrl}/api/v1/organization/settings`;
  form: OrganizationSettings | null = null;
  private original: OrganizationSettings | null = null;
  loading = false;
  saving = false;
  saved = false;
  loadError = '';
  saveError = '';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loading = true;
    this.http.get<{ success: boolean; data: OrganizationSettings }>(this.api).pipe(map(r => r.data)).subscribe({
      next: s => { this.original = s; this.form = JSON.parse(JSON.stringify(s)); this.loading = false; },
      error: err => { this.loadError = err?.error?.message || 'Could not load the settings.'; this.loading = false; }
    });
  }

  addHoliday(): void {
    this.form?.publicHolidays.push({ date: '', name: '' });
  }

  removeHoliday(index: number): void {
    this.form?.publicHolidays.splice(index, 1);
  }

  save(): void {
    if (!this.form || !this.original) return;
    const body: Partial<OrganizationSettings> = {
      wfhMonthlyQuota: Number(this.form.wfhMonthlyQuota),
      regularizationWindowDays: Number(this.form.regularizationWindowDays),
      approvalSlaHours: Number(this.form.approvalSlaHours),
      publicHolidays: this.form.publicHolidays.filter(h => h.date).map(h => ({ date: h.date, name: (h.name || '').trim() }))
    };
    // name/timezone only when an admin actually changed them (HR sending them is refused)
    if (this.isAdmin && this.form.name !== this.original.name) body.name = this.form.name;
    if (this.isAdmin && this.form.timezone !== this.original.timezone) body.timezone = this.form.timezone;

    this.saving = true;
    this.saved = false;
    this.saveError = '';
    this.http.put<{ success: boolean; data: OrganizationSettings }>(this.api, body).pipe(map(r => r.data)).subscribe({
      next: s => { this.original = s; this.form = JSON.parse(JSON.stringify(s)); this.saving = false; this.saved = true; },
      error: err => { this.saveError = err?.error?.message || 'Could not save the settings.'; this.saving = false; }
    });
  }
}
