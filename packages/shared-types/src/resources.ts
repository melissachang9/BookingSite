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

/** A confirmed booking that already holds the resource during an unavailable time. */
export type ResourceBlockConflict = {
  bookingId: UUID;
  startsAt: string;
  endsAt: string;
  customerName: string;
  serviceName: string;
};

/** A window when a resource is out of service. It stops new bookings; existing ones stay and are listed as conflicts. */
export type ResourceBlock = {
  id: UUID;
  resourceId: UUID;
  startsAt: string;
  endsAt: string;
  reason?: string | null;
  createdByName?: string | null;
  createdAt: string;
  conflicts: ResourceBlockConflict[];
};

export type ResourceBlockListResponse = {
  items: ResourceBlock[];
};

export type CreateResourceBlockRequest = {
  startsAt: string;
  endsAt: string;
  reason?: string | null;
};
