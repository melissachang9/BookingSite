import type { AuditFields, TenantScoped, UUID } from "./common";

export type ResourceServiceUse = {
  serviceId: UUID;
  serviceName: string;
  isActive: boolean;
  /** Units one booking of the service uses. */
  quantity: number;
};

export type ResourceSummary = AuditFields &
  TenantScoped & {
    name: string;
    kind: string;
    isActive: boolean;
    locationId?: UUID | null;
    notes?: string | null;
    /** Units the studio owns (a room is one unit). */
    quantity: number;
    /** Services that require this resource. */
    usedBy: ResourceServiceUse[];
  };

export type ResourceListResponse = {
  items: ResourceSummary[];
};

export type CreateResourceRequest = {
  name: string;
  kind?: string;
  locationId?: string | null;
  notes?: string | null;
  quantity?: number;
};

export type UpdateResourceRequest = {
  name?: string;
  kind?: string;
  isActive?: boolean;
  locationId?: string | null;
  notes?: string | null;
  quantity?: number;
};
