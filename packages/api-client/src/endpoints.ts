import type {
  ApiRootResponse,
  AvailabilityRequest,
  AvailabilityResponse,
  BookingDraftSummary,
  BookingListQuery,
  BookingListResponse,
  BookingSummary,
  CancelManageBookingRequest,
  CustomerManageBooking,
  CreateServiceRequest,
  CreateTenantRequest,
  CreateTenantResponse,
  CreateBookingDraftRequest,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  DepositPaymentFollowUpListResponse,
  RecordManualPaymentRequest,
  SendPaymentReminderResponse,
  CustomerLookupQuery,
  CustomerLookupResponse,
  FormResponseSummary,
  HealthResponse,
  LocationListResponse,
  ProviderListResponse,
  SaveFormDraftRequest,
  ServiceListResponse,
  ServiceSummary,
  SessionResponse,
  SubmitFormRequirementRequest,
  SubmitFormResponseRequest,
  TenantSummary,
  UpdateBookingStatusRequest,
  UpdateBookingDraftRequest,
  UpsertCustomerRequest,
} from "@booking/shared-types";
import type { ApiClient } from "./client";

export const createPlatformApi = (client: ApiClient) => ({
  getApiRoot: () => client.get<ApiRootResponse>(""),
  getHealth: () => client.get<HealthResponse>("health/live"),
  login: (body: { email: string; password: string }) =>
    client.post<SessionResponse, typeof body>("auth/login", body),
  refreshSession: (body: { refreshToken: string }) =>
    client.post<SessionResponse, typeof body>("auth/refresh", body),
  createTenant: (body: CreateTenantRequest) => client.post<CreateTenantResponse, CreateTenantRequest>("tenants", body),
  getTenantBySlug: (tenantSlug: string) => client.get<TenantSummary>(`tenants/${tenantSlug}`),
  listServices: (tenantSlug: string) => client.get<ServiceListResponse>(`tenants/${tenantSlug}/services`),
  createService: (tenantSlug: string, body: CreateServiceRequest) =>
    client.post<ServiceSummary, CreateServiceRequest>(`tenants/${tenantSlug}/services`, body),
  listLocations: (tenantSlug: string) => client.get<LocationListResponse>(`tenants/${tenantSlug}/locations`),
  listServiceProviders: (tenantSlug: string, serviceId: string, query: { locationId?: string } = {}) =>
    client.get<ProviderListResponse>(`tenants/${tenantSlug}/services/${serviceId}/providers`, {
      query: {
        locationId: query.locationId,
      },
    }),
  getAvailability: (query: AvailabilityRequest) =>
    client.get<AvailabilityResponse>(`tenants/${query.tenantSlug}/availability`, {
      query: {
        serviceId: query.serviceId,
        providerId: query.providerId,
        locationId: query.locationId,
        date: query.date,
        windowDays: query.windowDays,
      },
    }),
  createBookingDraft: (body: CreateBookingDraftRequest) =>
    client.post<BookingDraftSummary, CreateBookingDraftRequest>(`tenants/${body.tenantSlug}/booking-drafts`, body),
  getBookingDraft: (tenantSlug: string, bookingDraftId: string) =>
    client.get<BookingDraftSummary>(`tenants/${tenantSlug}/booking-drafts/${bookingDraftId}`),
  confirmBookingDraft: (tenantSlug: string, bookingDraftId: string) =>
    client.request<BookingSummary>(`tenants/${tenantSlug}/booking-drafts/${bookingDraftId}/confirm`, {
      method: "POST",
    }),
  updateBookingDraft: (tenantSlug: string, bookingDraftId: string, body: UpdateBookingDraftRequest) =>
    client.patch<BookingDraftSummary, UpdateBookingDraftRequest>(
      `tenants/${tenantSlug}/booking-drafts/${bookingDraftId}`,
      body,
    ),
  getBooking: (tenantSlug: string, bookingId: string) =>
    client.get<BookingSummary>(`tenants/${tenantSlug}/bookings/${bookingId}`),
  getManageBooking: (token: string) => client.get<CustomerManageBooking>(`bookings/manage/${token}`),
  cancelManageBooking: (token: string, body: CancelManageBookingRequest) =>
    client.post<CustomerManageBooking, CancelManageBookingRequest>(`bookings/manage/${token}/cancel`, body),
  saveBookingFormDraft: (bookingDraftId: string, body: SaveFormDraftRequest) =>
    client.post<BookingDraftSummary, SaveFormDraftRequest>(`booking-drafts/${bookingDraftId}/forms/draft`, body),
  submitBookingForm: (bookingDraftId: string, body: SubmitFormResponseRequest) =>
    client.post<FormResponseSummary, SubmitFormResponseRequest>(`booking-drafts/${bookingDraftId}/forms/submit`, body),
  submitBookingFormRequirement: (
    tenantSlug: string,
    bookingDraftId: string,
    requirementId: string,
    body: SubmitFormRequirementRequest,
  ) =>
    client.post<FormResponseSummary, SubmitFormRequirementRequest>(
      `tenants/${tenantSlug}/booking-drafts/${bookingDraftId}/form-requirements/${requirementId}/submit`,
      body,
    ),
  createCheckoutSession: (body: CreateCheckoutSessionRequest) =>
    client.post<CreateCheckoutSessionResponse, CreateCheckoutSessionRequest>(
      `tenants/${body.tenantSlug}/payments/checkout-sessions`,
      body,
    ),
  listPaymentFollowUp: (tenantSlug: string) =>
    client.get<DepositPaymentFollowUpListResponse>(`tenants/${tenantSlug}/payments/follow-up`),
  sendPaymentReminder: (tenantSlug: string, bookingDraftId: string) =>
    client.request<SendPaymentReminderResponse>(`tenants/${tenantSlug}/payments/follow-up/${bookingDraftId}/send-reminder`, {
      method: "POST",
    }),
  completeCheckoutSession: (tenantSlug: string, sessionId: string) =>
    client.request<BookingSummary>(`tenants/${tenantSlug}/payments/checkout-sessions/${sessionId}/complete`, {
      method: "POST",
    }),
  lookupCustomers: (query: CustomerLookupQuery) =>
    client.get<CustomerLookupResponse>("customers", {
      query: {
        search: query.search,
        limit: query.limit,
      },
    }),
  createOrUpdateCustomer: (body: UpsertCustomerRequest) =>
    client.post<{ customerId: string }, UpsertCustomerRequest>("customers", body),
  listBookings: (tenantSlug: string, query: BookingListQuery = {}) =>
    client.get<BookingListResponse>(`tenants/${tenantSlug}/bookings`, {
      query: {
        status: query.status?.join(","),
        startsAtGte: query.startsAtGte,
        startsAtLte: query.startsAtLte,
        providerId: query.providerId,
        customerId: query.customerId,
        locationId: query.locationId,
        limit: query.limit,
        offset: query.offset,
      },
    }),
  recordManualPayment: (tenantSlug: string, bookingId: string, body: RecordManualPaymentRequest) =>
    client.post<BookingSummary, RecordManualPaymentRequest>(
      `tenants/${tenantSlug}/bookings/${bookingId}/payments/manual`,
      body,
    ),
  updateBookingStatus: (tenantSlug: string, bookingId: string, body: UpdateBookingStatusRequest) =>
    client.post<BookingSummary, UpdateBookingStatusRequest>(`tenants/${tenantSlug}/bookings/${bookingId}/status`, body),
});