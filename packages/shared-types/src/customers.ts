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
    /** ISO date (YYYY-MM-DD). */
    birthday?: string | null;
    blockedFromOnlineBooking?: boolean;
    stripeCustomerId?: string | null;
    walletBalanceCents?: number;
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

/** A booking the client started online but never finished, kept for follow-up. */
export type CustomerBookingAttempt = {
  id: UUID;
  /** financing_started: opened the financing page; abandoned: hold lapsed unpaid; in_progress: still held. */
  outcome: "financing_started" | "abandoned" | "in_progress";
  serviceName: string;
  providerName: string;
  startsAt: ISODateString;
  createdAt: ISODateString;
  financingStartedAt?: ISODateString | null;
  /** The client has since booked this service. */
  bookedSince: boolean;
  bookingMethod: string;
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
  bookingAttempts?: CustomerBookingAttempt[];
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
  /** ISO date (YYYY-MM-DD); empty string clears. */
  birthday?: string;
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