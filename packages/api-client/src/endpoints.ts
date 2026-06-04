import type {
  ApiRootResponse,
  AvailabilityRequest,
  AvailabilityResponse,
  BookingDraftSummary,
  BookingFormResponseList,
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
  CreateLocationRequest,
  DepositPaymentFollowUpListResponse,
  RecordManualPaymentRequest,
  SendPaymentReminderResponse,
  CustomerLookupQuery,
  CustomerLookupResponse,
  EmailDnsResponse,
  FormResponseSummary,
  HealthResponse,
  LocationListResponse,
  TenantUserListResponse,
  LocationSummary,
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
  UpdateLocationRequest,
  UpdateTenantBrandingRequest,
  UpdateTenantBusinessHoursRequest,
  UpdateTenantBusinessRequest,
  UpdateTenantClientOwnershipRequest,
  UpdateTenantCustomEmailRequest,
  UpdateTenantSettingsRequest,
  UpdateTenantWalletMembershipRequest,
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
  updateTenantSettings: (tenantSlug: string, body: UpdateTenantSettingsRequest) =>
    client.patch<TenantSummary, UpdateTenantSettingsRequest>(`tenants/${tenantSlug}/settings`, body),
  updateTenantBusiness: (tenantSlug: string, body: UpdateTenantBusinessRequest) =>
    client.patch<TenantSummary, UpdateTenantBusinessRequest>(`tenants/${tenantSlug}/business`, body),
  updateTenantBusinessHours: (tenantSlug: string, body: UpdateTenantBusinessHoursRequest) =>
    client.patch<TenantSummary, UpdateTenantBusinessHoursRequest>(`tenants/${tenantSlug}/hours`, body),
  updateTenantBranding: (tenantSlug: string, body: UpdateTenantBrandingRequest) =>
    client.patch<TenantSummary, UpdateTenantBrandingRequest>(`tenants/${tenantSlug}/branding`, body),
  updateTenantClientOwnership: (tenantSlug: string, body: UpdateTenantClientOwnershipRequest) =>
    client.patch<TenantSummary, UpdateTenantClientOwnershipRequest>(
      `tenants/${tenantSlug}/client-ownership`,
      body,
    ),
  updateTenantCustomEmail: (tenantSlug: string, body: UpdateTenantCustomEmailRequest) =>
    client.patch<TenantSummary, UpdateTenantCustomEmailRequest>(
      `tenants/${tenantSlug}/custom-email`,
      body,
    ),
  getTenantEmailDns: (tenantSlug: string) =>
    client.get<EmailDnsResponse>(`tenants/${tenantSlug}/email-dns`),
  updateTenantWalletMembership: (tenantSlug: string, body: UpdateTenantWalletMembershipRequest) =>
    client.patch<TenantSummary, UpdateTenantWalletMembershipRequest>(
      `tenants/${tenantSlug}/wallet-membership`,
      body,
    ),
  listServices: (tenantSlug: string) => client.get<ServiceListResponse>(`tenants/${tenantSlug}/services`),
  createService: (tenantSlug: string, body: CreateServiceRequest) =>
    client.post<ServiceSummary, CreateServiceRequest>(`tenants/${tenantSlug}/services`, body),
  listLocations: (tenantSlug: string) => client.get<LocationListResponse>(`tenants/${tenantSlug}/locations`),
  listLocationsAdmin: (tenantSlug: string) =>
    client.get<LocationListResponse>(`tenants/${tenantSlug}/locations/manage`),
  listTenantUsers: (tenantSlug: string) =>
    client.get<TenantUserListResponse>(`tenants/${tenantSlug}/users`),
  createLocation: (tenantSlug: string, body: CreateLocationRequest) =>
    client.post<LocationSummary, CreateLocationRequest>(`tenants/${tenantSlug}/locations`, body),
  updateLocation: (tenantSlug: string, locationId: string, body: UpdateLocationRequest) =>
    client.patch<LocationSummary, UpdateLocationRequest>(`tenants/${tenantSlug}/locations/${locationId}`, body),
  deactivateLocation: (tenantSlug: string, locationId: string) =>
    client.delete<LocationSummary>(`tenants/${tenantSlug}/locations/${locationId}`),
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
  listBookingFormResponses: (tenantSlug: string, bookingId: string) =>
    client.get<BookingFormResponseList>(`tenants/${tenantSlug}/bookings/${bookingId}/form-responses`),
});