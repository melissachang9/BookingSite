import type { AuditFields, TenantScoped, UUID } from "./common";

export type ServiceCatalogMode = "flat" | "categories";

export type TenantBranding = {
  logoUrl?: string | null;
  faviconUrl?: string | null;
  homepageUrl?: string;
  primaryColor?: string | null;
  accentColor?: string | null;
  photos?: string[];
  serviceCatalogMode?: ServiceCatalogMode;
  serviceCategories?: string[];
  bookingScreening?: {
    enabled: boolean;
    title: string;
    options: Array<{
      id: string;
      label: string;
      description?: string | null;
    }>;
  } | null;
  bookingAd?: {
    enabled?: boolean;
    headline?: string | null;
    body?: string | null;
    imageUrl?: string | null;
    imageAltText?: string | null;
  } | null;
};

export type BusinessHoursDay = {
  open: string;
  close: string;
  closed: boolean;
};

export type BusinessHoursWeek = {
  mon: BusinessHoursDay;
  tue: BusinessHoursDay;
  wed: BusinessHoursDay;
  thu: BusinessHoursDay;
  fri: BusinessHoursDay;
  sat: BusinessHoursDay;
  sun: BusinessHoursDay;
};

export const BUSINESS_HOURS_WEEKDAY_KEYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export type BusinessHoursWeekdayKey = (typeof BUSINESS_HOURS_WEEKDAY_KEYS)[number];

export type TenantSettings = {
  cancellationWindowHours: number;
  refundInsideWindow: boolean;
  reminderHoursBefore: number;
  minLeadTimeMinutes: number;
  maxAdvanceBookingDays: number;
  defaultDepositCents: number;
  noShowFeeCents: number;
  taxRatePercent: number;
  autoChargeNoShowFee?: boolean;
  calendarDisplayStartHour: number;
  calendarDisplayEndHour: number;
  weekStartsOn: number;  // 0=Sunday, 1=Monday, ..., 6=Saturday
  country: string;
  currency: string;
  smsPhone: string | null;
  businessHoursEnabled: boolean;
  restrictProvidersToBusinessHours: boolean;
  businessHours: BusinessHoursWeek;
  clientOwnershipEnabled: boolean;
  onlineBookingOwnerAssignmentEnabled: boolean;
  customEmail: CustomEmailSettings;
  walletEnabled: boolean;
  walletExpirationMonths: number | null;
  membershipEnabled: boolean;
  customPaymentMethods: CustomPaymentMethod[];
};

export type CustomPaymentMethod = {
  id: string;
  label: string;
};

export type CustomEmailSettings = {
  fromAddress: string | null;
  domain: string | null;
  verified: boolean;
};

export type UpdateTenantSettingsRequest = {
  calendarDisplayStartHour?: number;
  calendarDisplayEndHour?: number;
  weekStartsOn?: number;
  reminderHoursBefore?: number;
  cancellationWindowHours?: number;
  refundInsideWindow?: boolean;
  minLeadTimeMinutes?: number;
  maxAdvanceBookingDays?: number;
  defaultDepositCents?: number;
  noShowFeeCents?: number;
  taxRatePercent?: number;
  autoChargeNoShowFee?: boolean;
  customPaymentMethods?: CustomPaymentMethod[];
};

export type UpdateTenantBusinessRequest = {
  name?: string;
  homepageUrl?: string;
  country?: string;
  currency?: string;
  smsPhone?: string | null;
};

export type UpdateTenantBusinessHoursRequest = {
  businessHoursEnabled?: boolean;
  restrictProvidersToBusinessHours?: boolean;
  businessHours?: BusinessHoursWeek;
};

export type UpdateTenantBrandingRequest = {
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  photos?: string[];
  bookingAd?: {
    enabled?: boolean;
    headline?: string | null;
    body?: string | null;
    imageUrl?: string | null;
    imageAltText?: string | null;
  } | null;
};

export type UpdateTenantClientOwnershipRequest = {
  clientOwnershipEnabled?: boolean;
  onlineBookingOwnerAssignmentEnabled?: boolean;
};

export type UpdateTenantCustomEmailRequest = {
  fromAddress?: string | null;
  domain?: string | null;
};

export type EmailDnsRecord = {
  type: string;
  host: string;
  value: string;
};

export type EmailDnsResponse = {
  domain: string | null;
  records: EmailDnsRecord[];
  verified: boolean;
};

export type UpdateTenantWalletMembershipRequest = {
  walletEnabled?: boolean;
  walletExpirationMonths?: number | null;
  membershipEnabled?: boolean;
};

export const SUPPORTED_CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "MXN"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export type TenantSummary = AuditFields &
  TenantScoped & {
    slug: string;
    name: string;
    timezone: string;
    defaultLocationId?: UUID | null;
    branding: TenantBranding;
    settings: TenantSettings;
  };

export type CreateTenantRequest = {
  name: string;
  slug: string;
  timezone: string;
  locationName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  homepageUrl?: string;
  primaryColor?: string;
  accentColor?: string;
};

export type CreateTenantResponse = {
  tenant: TenantSummary;
  ownerEmail: string;
  locationId: UUID;
};