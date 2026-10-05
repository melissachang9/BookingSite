import type { AuditFields, TenantScoped, UUID } from "./common";

export type ResourceSummary = AuditFields &
  TenantScoped & {
    name: string;
    kind: string;
    isActive: boolean;
    locationId?: UUID | null;
    notes?: string | null;
    /** Units the studio owns (a room is one unit). */
    quantity: number;
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
