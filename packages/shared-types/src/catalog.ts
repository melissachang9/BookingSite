import type { AuditFields, TenantScoped, UUID } from "./common";

export type LocationSummary = AuditFields &
  TenantScoped & {
    name: string;
    timeZone: string;
    isActive: boolean;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };

export type ServiceSummary = AuditFields &
  TenantScoped & {
    name: string;
    description?: string;
    durationMinutes: number;
    priceCents: number;
    depositCents: number;
    isActive: boolean;
    imageUrl?: string | null;
    imageAltText?: string | null;
    locationIds: UUID[];
    formIds: UUID[];
  };

export type ProviderSummary = AuditFields &
  TenantScoped & {
    userId?: UUID | null;
    name: string;
    email?: string | null;
    isActive: boolean;
    serviceIds: UUID[];
    locationIds: UUID[];
  };

export type ServiceListResponse = {
  services: ServiceSummary[];
};

export type ProviderListResponse = {
  providers: ProviderSummary[];
};

export type LocationListResponse = {
  locations: LocationSummary[];
};