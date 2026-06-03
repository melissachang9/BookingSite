import type { AuditFields, TenantScoped, UUID } from "./common";

export type ServiceCatalogMode = "flat" | "categories";

export type TenantBranding = {
  logoUrl?: string;
  homepageUrl?: string;
  primaryColor?: string;
  accentColor?: string;
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
    headline?: string | null;
    body?: string | null;
    imageUrl?: string | null;
    imageAltText?: string | null;
  } | null;
};

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
  country: string;
  currency: string;
  smsPhone: string | null;
};

export type UpdateTenantSettingsRequest = {
  calendarDisplayStartHour?: number;
  calendarDisplayEndHour?: number;
};

export type UpdateTenantBusinessRequest = {
  name?: string;
  homepageUrl?: string;
  country?: string;
  currency?: string;
  smsPhone?: string | null;
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