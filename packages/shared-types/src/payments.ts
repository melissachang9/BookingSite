import type { BookingDraftSummary, DepositStatus } from "./bookings";
import type { ActorSummary, AuditFields, ISODateString, TenantScoped, UUID } from "./common";

export type PaymentStatus =
  | "pending"
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "refunded"
  | "canceled";

export type PaymentMethodType = "card" | "cash" | "external_pos" | "wallet_credit" | "manual";

export type CheckoutSessionKind = "deposit" | "booking_balance" | "manual_payment_link";
export type DepositPaymentLinkState = "open" | "expired" | "missing";

export type PaymentEventKind =
  | "checkout_started"
  | "checkout_completed"
  | "checkout_expired"
  | "checkout_reminder_sent"
  | "payment_recorded"
  | "refund_recorded"
  | "deposit_forfeited"
  | "manual_credit_applied";

export type PaymentEvent = {
  id: UUID;
  kind: PaymentEventKind;
  occurredAt: ISODateString;
  actor: ActorSummary;
  amountCents?: number;
  notes?: string;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
};

export type PaymentSummary = AuditFields &
  TenantScoped & {
    bookingId?: UUID | null;
    bookingDraftId?: UUID | null;
    customerId: UUID;
    status: PaymentStatus;
    depositStatus: DepositStatus;
    amountCents: number;
    currency: string;
    paymentMethodType: PaymentMethodType;
    checkoutSessionKind?: CheckoutSessionKind | null;
    stripeSessionId?: string | null;
    stripePaymentIntentId?: string | null;
    latestEvent?: PaymentEvent | null;
    events: PaymentEvent[];
  };

export type CreateCheckoutSessionRequest = {
  tenantSlug: string;
  bookingDraftId?: UUID;
  bookingId?: UUID;
  kind: CheckoutSessionKind;
  successUrl: string;
  cancelUrl: string;
};

export type CreateCheckoutSessionResponse = {
  checkoutUrl: string;
  sessionId: string;
  expiresAt?: ISODateString;
};

export type DepositPaymentFollowUpItem = {
  bookingDraft: BookingDraftSummary;
  paymentId?: UUID | null;
  paymentStatus?: PaymentStatus | null;
  checkoutSessionId?: string | null;
  checkoutUrl?: string | null;
  checkoutExpiresAt?: ISODateString | null;
  linkState: DepositPaymentLinkState;
};

export type DepositPaymentFollowUpListResponse = {
  items: DepositPaymentFollowUpItem[];
};

export type SendPaymentReminderResponse = {
  bookingDraftId: UUID;
  paymentId: UUID;
  checkoutSessionId: string;
  checkoutUrl: string;
  recipientEmail: string;
  provider: string;
  providerMessageId: string;
  sentAt: ISODateString;
};

export type RecordManualPaymentRequest = {
  amountCents: number;
  paymentMethodType: string;
  notes?: string;
};