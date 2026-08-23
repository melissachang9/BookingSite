import type { AuditFields, ISODateString, PaginatedResponse, TenantScoped, UUID } from "./common";

export type CustomerSummary = AuditFields &
  TenantScoped & {
    name: string;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
    acquiredAt?: ISODateString | null;
    sourceChannel?: string | null;
    referredBy?: string | null;
    ownerUserId?: UUID | null;
    ownerName?: string | null;
    smsConsent?: boolean;
    smsPhone?: string | null;
    addressStreet?: string | null;
    addressCity?: string | null;
    addressState?: string | null;
    addressZip?: string | null;
    blockedFromOnlineBooking?: boolean;
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
  referredBy?: string | null;
  ownerUserId?: UUID | null;
  smsConsent?: boolean;
  smsPhone?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  blockedFromOnlineBooking?: boolean;
};

export type UpsertCustomerRequest = {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  blockedFromOnlineBooking?: boolean;
};