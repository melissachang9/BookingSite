import type { CustomerProfile, CustomerSummary } from "./customers";
import type { FormRequirement } from "./forms";
import type { ProviderSummary, ServiceSummary } from "./catalog";
import type { ActorSummary, AuditFields, ISODateString, PaginatedResponse, TenantScoped, UUID } from "./common";

export type BookingState =
  | "draft"
  | "slot_held"
  | "awaiting_form"
  | "awaiting_payment"
  | "confirmed"
  | "completed"
  | "canceled"
  | "no_show";

export type BookingMethod = "public_online" | "staff_entered" | "admin_checkout";

export type DepositStatus =
  | "not_required"
  | "unpaid"
  | "paid"
  | "paid_in_full"
  | "refunded"
  | "forfeited"
  | "follow_up";

export type PaymentResolution = "pending" | "collected" | "follow_up" | "waived";

export type SlotAvailability = {
  startAt: ISODateString;
  endAt: ISODateString;
  providerId: UUID;
  providerName: string;
  locationId?: UUID;
  isNextAvailable?: boolean;
};

export type AvailabilityDay = {
  date: string;
  slotCount: number;
};

export type AvailabilityRequest = {
  tenantSlug: string;
  serviceId: UUID;
  providerId?: UUID;
  locationId?: UUID;
  date: string;
  windowDays?: number;
};

export type AvailabilityResponse = {
  days: AvailabilityDay[];
  slots: SlotAvailability[];
  nextAvailableSlot?: SlotAvailability | null;
};

export type BookingDraftSummary = AuditFields &
  TenantScoped & {
    customerId?: UUID | null;
    serviceId: UUID;
    providerId: UUID;
    locationId?: UUID | null;
    status: Extract<BookingState, "draft" | "slot_held" | "awaiting_form" | "awaiting_payment">;
    bookingMethod: BookingMethod;
    startsAt: ISODateString;
    endsAt: ISODateString;
    expiresAt: ISODateString;
    priceCents: number;
    depositCents: number;
    durationMinutes: number;
    service: ServiceSummary;
    provider: ProviderSummary;
    customer?: CustomerSummary | null;
    formRequirements: FormRequirement[];
  };

export type BookingSummary = AuditFields &
  TenantScoped & {
    customerId: UUID;
    serviceId: UUID;
    providerId: UUID;
    locationId?: UUID | null;
    status: Exclude<BookingState, "draft" | "slot_held" | "awaiting_form" | "awaiting_payment">;
    bookingMethod: BookingMethod;
    depositStatus: DepositStatus;
    paymentResolution: PaymentResolution;
    startsAt: ISODateString;
    endsAt: ISODateString;
    completedAt?: ISODateString | null;
    canceledAt?: ISODateString | null;
    notes?: string | null;
    service: ServiceSummary;
    provider: ProviderSummary;
    customer: CustomerProfile | CustomerSummary;
  };

export type BookingListQuery = {
  status?: BookingState[];
  startsAtGte?: ISODateString;
  startsAtLte?: ISODateString;
  providerId?: UUID;
  customerId?: UUID;
  locationId?: UUID;
  limit?: number;
  offset?: number;
};

export type BookingListResponse = PaginatedResponse<BookingSummary>;

export type CreateBookingDraftRequest = {
  tenantSlug: string;
  serviceId: UUID;
  providerId: UUID;
  locationId?: UUID;
  startsAt: ISODateString;
  customer?: {
    name: string;
    email?: string;
    phone?: string;
  };
  bookingMethod?: BookingMethod;
};

export type UpdateBookingDraftRequest = {
  customerId?: UUID;
  customer?: {
    name: string;
    email?: string;
    phone?: string;
  };
};

export type BookingStatusTransition = {
  bookingId: UUID;
  fromStatus: BookingState;
  toStatus: BookingState;
  actor: ActorSummary;
  occurredAt: ISODateString;
  notes?: string;
};

export type UpdateBookingStatusRequest = {
  status: Extract<BookingState, "confirmed" | "completed" | "canceled" | "no_show">;
  notes?: string;
  paymentResolution?: PaymentResolution;
};