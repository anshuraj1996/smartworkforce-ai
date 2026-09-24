// Common interfaces and types used across the application

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
  errors?: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  icon?: string;
}

export interface FilterOption {
  key: string;
  value: any;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'nin';
}

export interface SortOption {
  field: string;
  direction: 'asc' | 'desc';
}

export interface SearchParams {
  query?: string;
  filters?: FilterOption[];
  sort?: SortOption[];
  page?: number;
  limit?: number;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface ContactInfo {
  phone?: string;
  email: string;
  alternativeEmail?: string;
  emergencyContact?: EmergencyContact;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

export interface FileUpload {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  organizationId: string;
  changes: Record<string, any>;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  description: string;
  metadata?: Record<string, any>;
  timestamp: string;
  organizationId: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  userId: string;
  read: boolean;
  actionUrl?: string;
  actionLabel?: string;
  createdAt: string;
  readAt?: string;
  organizationId: string;
}

export type NotificationType = 
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'attendance'
  | 'leave'
  | 'announcement'
  | 'system';

export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
  fill?: boolean;
}

export interface Statistics {
  current: number;
  previous: number;
  change: number;
  changePercent: number;
  trend: 'up' | 'down' | 'stable';
}

export interface TimeSeriesData {
  timestamp: string;
  value: number;
  label?: string;
}

export interface LocationData {
  name: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  address?: string;
  radius?: number; // in meters
}

export interface WorkingHours {
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
  workingDays: number[]; // 0-6 (Sunday-Saturday)
  timezone: string;
  breakDuration?: number; // minutes
  flexibleHours?: boolean;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  type: 'national' | 'regional' | 'company';
  description?: string;
  organizationId: string;
  isRecurring: boolean;
}

export interface ColorTheme {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  error: string;
  warning: string;
  info: string;
  success: string;
}

export interface AppConfig {
  appName: string;
  version: string;
  environment: 'development' | 'staging' | 'production';
  features: {
    [key: string]: boolean;
  };
  theme: ColorTheme;
  defaultLanguage: string;
  supportedLanguages: string[];
}

// Utility types
export type EntityStatus = 'active' | 'inactive' | 'pending' | 'suspended';
export type UserRole = 'EMPLOYEE' | 'MANAGER' | 'HR' | 'ADMIN';
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'working' | 'completed';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type RequestStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'cancelled';

// Generic response wrapper
export interface ServiceResponse<T = any> {
  data?: T;
  error?: string;
  loading?: boolean;
  success?: boolean;
}