import { BaseEntity, NotificationType, NotificationPriority } from './common.model';

export interface Notification extends BaseEntity {
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  userId: string;
  read: boolean;
  actionUrl?: string;
  actionLabel?: string;
  readAt?: string;
  metadata?: Record<string, any>;
  expiresAt?: string;
}

export interface NotificationPreferences extends BaseEntity {
  userId: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  notificationTypes: {
    [key in NotificationType]: boolean;
  };
  quietHoursStart?: string;
  quietHoursEnd?: string;
  weekendNotifications: boolean;
}

export interface NotificationTemplate extends BaseEntity {
  name: string;
  type: NotificationType;
  title: string;
  message: string;
  isActive: boolean;
  variables: string[];
}