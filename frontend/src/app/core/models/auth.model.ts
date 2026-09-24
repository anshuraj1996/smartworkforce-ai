import { User } from './user.model';
import { UserRole } from './common.model';

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
  twoFactorCode?: string;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  permissions: string[];
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface TwoFactorAuthRequest {
  code: string;
  remember?: boolean;
}

export interface TwoFactorSetupResponse {
  qrCodeUrl: string;
  backupCodes: string[];
  secret: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  permissions: string[];
  loading: boolean;
  error: string | null;
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description: string;
}

export interface Role {
  id: string;
  name: UserRole;
  displayName: string;
  description: string;
  permissions: Permission[];
  level: number;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  organizationId: string;
  permissions: string[];
  iat: number;
  exp: number;
}

export interface SessionInfo {
  userId: string;
  sessionId: string;
  ipAddress: string;
  userAgent: string;
  loginAt: string;
  lastActivity: string;
  isActive: boolean;
}