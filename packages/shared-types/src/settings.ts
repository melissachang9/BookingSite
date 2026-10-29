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
    /** The small line above each panel's headline, e.g. "This season". */
    label?: string | null;
    /** Background of the first screen's marketing card (#RGB / #RRGGBB). Empty means the default. */
    panelColor?: string | null;
    serviceLabel?: string | null;
    locationLabel?: string | null;
    headline?: string | null;
    body?: string | null;
    imageUrl?: string | null;
    imageAltText?: string | null;
    serviceImageUrl?: string | null;
    serviceImageAltText?: string | null;
    locationImageUrl?: string | null;
    locationImageAltText?: string | null;
    serviceHeadline?: string | null;
    serviceBody?: string | null;
    locationHeadline?: string | null;
    locationBody?: string | null;
    reviewHeadline?: string | null;
    reviewBody?: string | null;
  } | null;
  financing?: TenantFinancing | null;
};

/** A studio-wide financing link shown beside each service price on the booking site. */
export type TenantFinancing = {
  enabled: boolean;
  /** The button's label; empty falls back to "See financing options". */
  buttonText?: string | null;
  linkUrl?: string | null;
  /** Instalments the monthly figure is spread over (2-84). */
  months?: number | null;
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

export type CancellationRefundMethod = "original_payment" | "wallet_credit";

export type TenantSettings = {
  cancellationWindowHours: number;
  refundInsideWindow: boolean;
  /** Where a deposit goes when a client cancels with enough notice. Late cancellations keep the deposit. */
  cancellationRefundMethod?: CancellationRefundMethod;
  reminderHoursBefore: number;
  appointmentReminderHours?: number;
  appointmentReminderChannels?: string[];
  minLeadTimeMinutes: number;
  maxAdvanceBookingDays: number;
  noShowFeeCents: number;
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
  /** How long a held slot waits for a payment link to be paid (30–1440 min). */
  paymentLinkExpiryMinutes?: number;
  /** Set by connecting/disconnecting a processor; null = legacy behaviour. */
  paymentProcessor?: "clover" | "stripe" | "none" | null;
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
  appointmentReminderHours?: number;
  appointmentReminderChannels?: string[];
  cancellationWindowHours?: number;
  refundInsideWindow?: boolean;
  cancellationRefundMethod?: CancellationRefundMethod;
  minLeadTimeMinutes?: number;
  maxAdvanceBookingDays?: number;
  noShowFeeCents?: number;
  autoChargeNoShowFee?: boolean;
  paymentLinkExpiryMinutes?: number;
  customPaymentMethods?: CustomPaymentMethod[];
};

export type UpdateTenantBusinessRequest = {
  name?: string;
  homepageUrl?: string;
  country?: string;
  currency?: string;
  smsPhone?: string | null;
  /** IANA name, e.g. "America/Vancouver". Changes how times and weekly hours are read, not stored instants. */
  timezone?: string;
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
    /** The small line above each panel's headline, e.g. "This season". */
    label?: string | null;
    /** Background of the first screen's marketing card (#RGB / #RRGGBB). Empty means the default. */
    panelColor?: string | null;
    serviceLabel?: string | null;
    locationLabel?: string | null;
    headline?: string | null;
    body?: string | null;
    imageUrl?: string | null;
    imageAltText?: string | null;
    serviceImageUrl?: string | null;
    serviceImageAltText?: string | null;
    locationImageUrl?: string | null;
    locationImageAltText?: string | null;
    serviceHeadline?: string | null;
    serviceBody?: string | null;
    locationHeadline?: string | null;
    locationBody?: string | null;
    reviewHeadline?: string | null;
    reviewBody?: string | null;
  } | null;
  financing?: TenantFinancing | null;
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
  cancellationWindowHours?: number;
  cancellationRefundMethod?: CancellationRefundMethod;
};

export type CreateTenantResponse = {
  tenant: TenantSummary;
  ownerEmail: string;
  locationId: UUID;
};