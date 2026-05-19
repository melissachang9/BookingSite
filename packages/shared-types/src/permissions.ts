export type UserRole = "owner" | "manager" | "staff" | "provider";

export type PermissionKey =
  | "dashboard.view"
  | "calendar.view"
  | "calendar.create_booking"
  | "bookings.view"
  | "bookings.manage"
  | "bookings.complete"
  | "bookings.cancel"
  | "bookings.collect_payment"
  | "payments.view"
  | "payments.manage"
  | "customers.view"
  | "customers.manage"
  | "forms.view"
  | "forms.manage"
  | "services.view"
  | "services.manage"
  | "providers.view"
  | "providers.manage"
  | "locations.view"
  | "locations.manage"
  | "settings.view"
  | "settings.manage"
  | "users.manage";

export type PermissionGrant = {
  key: PermissionKey;
  allowed: boolean;
};

export type AuthenticatedUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  permissions: PermissionGrant[];
};

export type SessionResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  user: AuthenticatedUser;
};