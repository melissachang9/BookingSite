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
  tipCents?: number;
  paymentMethodType: string;
  notes?: string;
  /** Receipt/approval number or card last 4; required for external_pos. */
  externalReference?: string;
};
// --- Card processor connection (Clover) ---------------------------------

export type PaymentProcessorKind = "clover" | "stripe" | "simulated" | "none";

/** What a business can do with card payments right now. Never contains secrets. */
export type PaymentCapabilities = {
  processor: PaymentProcessorKind;
  environment?: "sandbox" | "production" | "fake" | null;
  /** null = never connected. */
  status?: "connected" | "needs_reauth" | "disconnected" | null;
  authMode?: "oauth" | "api_keys" | null;
  merchantName?: string | null;
  /** Staff can match payments taken on the Clover device to a booking. */
  canLinkDevicePayments: boolean;
  /** Online / phone card payments (the Clover card form). */
  canChargeCards: boolean;
  /** Staff can text/email a deposit link. Also true for the simulated checkout in development. */
  canSendPaymentLink: boolean;
  canRefundCards: boolean;
  /** The Clover account's currency differs from the business currency. */
  currencyMismatch: boolean;
  needsReauth: boolean;
  connectedAt?: ISODateString | null;
};

export type PublicPaymentConfig = {
  processor: PaymentProcessorKind;
  currency: string;
  clover?: {
    merchantId: string;
    publicKey: string;
    sdkUrl: string;
    locale: string;
    environment: string;
  } | null;
};

export type CloverAuthorizeUrlResponse = { authorizeUrl: string };

export type CloverOAuthCompleteRequest = { code: string; merchantId: string; state: string };

export type CloverApiKeysRequest = {
  environment: "sandbox" | "production";
  merchantId: string;
  platformApiToken: string;
  ecommercePublicKey: string;
  ecommercePrivateKey: string;
};

// --- Payments taken on the Clover device ---------------------------------

/** A payment taken on the Clover device, offered to staff to match to a booking. */
export type CloverDevicePayment = {
  id: string;
  /** Amount before tip. */
  amountCents: number;
  tipCents: number;
  totalCents: number;
  cardBrand?: string | null;
  cardLast4?: string | null;
  authCode?: string | null;
  employeeId?: string | null;
  createdAt: ISODateString;
  /** Which amount for the booking being paid it equals, if any. */
  matches?: "deposit" | "full" | "balance" | null;
};

export type CloverDevicePaymentList = { items: CloverDevicePayment[] };

export type ConfirmWithCloverPaymentRequest = {
  cloverPaymentId: string;
  amountMode: "deposit" | "full";
  notes?: string;
};

export type RecordCloverDevicePaymentRequest = {
  cloverPaymentId: string;
  notes?: string;
};


// --- Card payments through Clover's secure card form -----------------------

/** A card typed into Clover's secure form, already tokenized in the browser. */
export type CardChargeRequest = {
  sourceToken: string;
  /** New for each card entry; reused when retrying "we couldn't confirm" so it can't charge twice. */
  attemptId: string;
};

export type StaffDraftCardChargeRequest = CardChargeRequest & {
  amountMode: "deposit" | "full";
  tipCents?: number;
};

export type StaffBalanceCardChargeRequest = CardChargeRequest & { tipCents?: number };

/** What the payment page shows. No customer details. */
export type CheckoutSessionView = {
  sessionId: string;
  kind: "deposit" | "booking_balance" | string;
  /** "expired" when the hold ran out before payment. */
  status: "pending" | "processing" | "succeeded" | "canceled" | "refunded" | "expired" | string;
  amountCents: number;
  currency: string;
  expiresAt?: ISODateString | null;
  processor: "clover" | "stripe" | "simulated";
  serviceName: string;
  startsAt: ISODateString;
  bookingId?: UUID | null;
  bookingDraftId?: UUID | null;
};

export type PaymentLinkRequest = {
  channels: Array<"sms" | "email">;
  /** Staff confirm the client asked for a text. */
  smsConsentConfirmed?: boolean;
};

export type DeliveryResult = {
  channel: "sms" | "email" | string;
  status: "sent" | "failed" | "skipped" | string;
  recipient?: string | null;
  error?: string | null;
};

export type PaymentLinkResponse = {
  bookingDraft: BookingDraftSummary;
  paymentUrl: string;
  holdExpiresAt: ISODateString;
  deliveries: DeliveryResult[];
};

export type BookingDraftList = { items: BookingDraftSummary[] };
