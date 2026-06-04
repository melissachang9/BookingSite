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
    phone?: string | null;
  };

export type CreateLocationRequest = {
  name: string;
  timeZone: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string | null;
};

export type UpdateLocationRequest = {
  name?: string;
  timeZone?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  isActive?: boolean;
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

export type CreateServiceRequest = {
  name: string;
  description?: string;
  durationMinutes: number;
  priceCents: number;
  depositCents: number;
  locationIds: UUID[];
  isActive?: boolean;
};

export type ProviderSummary = AuditFields &
  TenantScoped & {
    userId?: UUID | null;
    name: string;
    email?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    imageAltText?: string | null;
    availabilityLabel?: string | null;
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

export type TenantUserSummary = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};

export type TenantUserListResponse = {
  users: TenantUserSummary[];
};