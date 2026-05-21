import type {
  ApiRootResponse,
  AvailabilityRequest,
  AvailabilityResponse,
  BookingDraftSummary,
  BookingListQuery,
  BookingListResponse,
  CreateBookingDraftRequest,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  CustomerLookupQuery,
  CustomerLookupResponse,
  FormResponseSummary,
  HealthResponse,
  LocationListResponse,
  ProviderListResponse,
  SaveFormDraftRequest,
  ServiceListResponse,
  SessionResponse,
  SubmitFormResponseRequest,
  TenantSummary,
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
  getTenantBySlug: (tenantSlug: string) => client.get<TenantSummary>(`tenants/${tenantSlug}`),
  listServices: (tenantSlug: string) => client.get<ServiceListResponse>(`tenants/${tenantSlug}/services`),
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
  updateBookingDraft: (tenantSlug: string, bookingDraftId: string, body: UpdateBookingDraftRequest) =>
    client.patch<BookingDraftSummary, UpdateBookingDraftRequest>(
      `tenants/${tenantSlug}/booking-drafts/${bookingDraftId}`,
      body,
    ),
  saveBookingFormDraft: (bookingDraftId: string, body: SaveFormDraftRequest) =>
    client.post<BookingDraftSummary, SaveFormDraftRequest>(`booking-drafts/${bookingDraftId}/forms/draft`, body),
  submitBookingForm: (bookingDraftId: string, body: SubmitFormResponseRequest) =>
    client.post<FormResponseSummary, SubmitFormResponseRequest>(`booking-drafts/${bookingDraftId}/forms/submit`, body),
  createCheckoutSession: (body: CreateCheckoutSessionRequest) =>
    client.post<CreateCheckoutSessionResponse, CreateCheckoutSessionRequest>("payments/checkout-sessions", body),
  lookupCustomers: (query: CustomerLookupQuery) =>
    client.get<CustomerLookupResponse>("customers", {
      query: {
        search: query.search,
        limit: query.limit,
      },
    }),
  createOrUpdateCustomer: (body: UpsertCustomerRequest) =>
    client.post<{ customerId: string }, UpsertCustomerRequest>("customers", body),
  listBookings: (query: BookingListQuery = {}) =>
    client.get<BookingListResponse>("bookings", {
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
});