import type { AuditFields, ISODateString, PaginatedResponse, TenantScoped, UUID } from "./common";

export type CustomerSummary = AuditFields &
  TenantScoped & {
    name: string;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
    acquiredAt?: ISODateString | null;
    sourceChannel?: string | null;
    ownerUserId?: UUID | null;
  };

export type CustomerProfile = CustomerSummary & {
  upcomingBookingIds: UUID[];
  pastBookingIds: UUID[];
};

export type CustomerLookupQuery = {
  search: string;
  limit?: number;
};

export type CustomerLookupResponse = PaginatedResponse<CustomerSummary>;

export type CustomerListResponse = PaginatedResponse<CustomerSummary>;

export type CustomerBookingEntry = {
  id: UUID;
  serviceName: string;
  providerName: string;
  status: string;
  startsAt: ISODateString;
  endsAt: ISODateString;
  priceCents: number;
  depositCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
};

export type CustomerPaymentEntry = {
  id: string;
  bookingId: string;
  amountCents: number;
  paymentMethodType: string;
  status: string;
  recordedAt: string;
  notes?: string | null;
};

export type CustomerProfileResponse = {
  customer: CustomerSummary;
  bookings: CustomerBookingEntry[];
  payments: CustomerPaymentEntry[];
  lifetimeSpendCents: number;
  outstandingBalanceCents: number;
};

export type UpdateCustomerRequest = {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  ownerUserId?: UUID | null;
};

export type UpsertCustomerRequest = {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
};