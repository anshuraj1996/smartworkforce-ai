import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { AuthService } from '../../core/services/auth.service';
import { AnnouncementsService, FeedItem } from './services/announcements.service';

const FEED_ICONS: Record<string, string> = {
  ANNOUNCEMENT: 'campaign',
  BIRTHDAY: 'cake',
  NEW_JOINER: 'waving_hand'
};

@Component({
  selector: 'app-announcements',
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
    MatCheckboxModule
  ],
  templateUrl: './announcements.component.html',
  styleUrls: ['./announcements.component.scss']
})
export class AnnouncementsComponent implements OnInit {
  currentUser: any = null;
  feed: FeedItem[] = [];
  showForm = false;

  announcementForm: FormGroup;

  constructor(
    private authService: AuthService,
    private announcementsService: AnnouncementsService,
    private fb: FormBuilder
  ) {
    this.announcementForm = this.fb.group({
      title: ['', Validators.required],
      body: ['', Validators.required],
      category: ['GENERAL', Validators.required],
      isPinned: [false]
    });
  }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.loadFeed();
  }

  get canPost(): boolean {
    return this.currentUser?.role && ['HR', 'ADMIN'].includes(this.currentUser.role);
  }

  loadFeed(): void {
    this.announcementsService.getFeed().subscribe(feed => this.feed = feed);
  }

  submit(): void {
    if (this.announcementForm.invalid) return;

    this.announcementsService.create(this.announcementForm.value).subscribe(() => {
      this.announcementForm.reset({ category: 'GENERAL', isPinned: false });
      this.showForm = false;
      this.loadFeed();
    });
  }

  icon(item: FeedItem): string {
    return FEED_ICONS[item.type] || 'notifications';
  }
}
