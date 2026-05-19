import type { AuditFields, TenantScoped, UUID } from "./common";

export type ServiceCatalogMode = "flat" | "categories";

export type TenantBranding = {
  logoUrl?: string;
  homepageUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  serviceCatalogMode?: ServiceCatalogMode;
  serviceCategories?: string[];
};

export type TenantSettings = {
  cancellationWindowHours: number;
  refundInsideWindow: boolean;
  reminderHoursBefore: number;
  minLeadTimeMinutes: number;
  maxAdvanceBookingDays: number;
  defaultDepositCents: number;
  noShowFeeCents: number;
  autoChargeNoShowFee?: boolean;
};

export type TenantSummary = AuditFields &
  TenantScoped & {
    slug: string;
    name: string;
    timezone: string;
    defaultLocationId?: UUID | null;
    branding: TenantBranding;
    settings: TenantSettings;
  };