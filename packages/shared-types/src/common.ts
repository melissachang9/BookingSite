export type ISODateString = string;

export type UUID = string;

export type EnvironmentName = "development" | "test" | "staging" | "production";

export type AuditFields = {
  id: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type TenantScoped = {
  tenantId: UUID;
};

export type PaginationMeta = {
  limit: number;
  offset: number;
  total: number;
};

export type PaginatedResponse<TItem> = {
  items: TItem[];
  meta: PaginationMeta;
};

export type ValidationIssue = {
  field: string;
  message: string;
  code?: string;
};

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "rate_limited"
  | "internal_error";

export type ErrorResponse = {
  error: {
    code: ErrorCode;
    message: string;
    issues?: ValidationIssue[];
    requestId?: string;
  };
};

export type ApiListQuery = {
  limit?: number;
  offset?: number;
  search?: string;
};

export type SortDirection = "asc" | "desc";

export type ActorType = "anonymous" | "customer" | "user" | "system";

export type ActorSummary = {
  actorType: ActorType;
  actorId?: UUID;
  displayName?: string;
};