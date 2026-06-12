import type {
  ApiRootResponse,
  AvailabilityRequest,
  AvailabilityResponse,
  BookingDraftSummary,
  BookingFormResponseList,
  BookingListQuery,
  BookingListResponse,
  BookingSummary,
  CancelBookingRequest,
  CancelManageBookingRequest,
  CustomerManageBooking,
  CreateServiceCategoryRequest,
  CreateServiceRequest,
  CreateTenantRequest,
  CreateTenantResponse,
  CreateBookingDraftRequest,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  CreateFormRequest,
  CreateLocationRequest,
  CreateResourceRequest,
  CustomerListResponse,
  CustomerProfileResponse,
  DashboardReport,
  DepositPaymentFollowUpListResponse,
  FormListResponse,
  FormSummaryResponse,
  RecordManualPaymentRequest,
  SendPaymentReminderResponse,
  CustomerLookupQuery,
  CustomerLookupResponse,
  EmailDnsResponse,
  FormResponseSummary,
  HealthResponse,
  LocationListResponse,
  TenantUserListResponse,
  TenantUserSummary,
  CreateTenantUserRequest,
  UpdateTenantUserRequest,
  ResetTenantUserPasswordRequest,
  CreateProviderRequest,
  UpdateProviderRequest,
  CreateProviderTimeOffRequest,
  CreateStaffRequest,
  CreateStaffResponse,
  PermissionCatalogResponse,
  ProviderSchedule,
  ProviderServiceVariantListResponse,
  ProviderSummary,
  ProviderTimeOffEntry,
  ProviderTimeOffList,
  PublicCategoryPayload,
  ReorderRequest,
  ReplaceProviderServiceVariantsRequest,
  ReplaceUserPermissionsRequest,
  ResourceListResponse,
  ResourceSummary,
  UpdateFormRequest,
  UserPermissionsResponse,
  LocationSummary,
  ProviderListResponse,
  ReplaceProviderScheduleRequest,
  SaveFormDraftRequest,
  ServiceCategoryListResponse,
  ServiceCategorySummary,
  ServiceListResponse,
  ServiceSummary,
  SessionResponse,
  SubmitFormRequirementRequest,
  SubmitFormResponseRequest,
  TenantSummary,
  UpdateBookingRequest,
  UpdateBookingStatusRequest,
  UpdateBookingDraftRequest,
  UpdateLocationRequest,
  UpdateResourceRequest,
  UpdateServiceCategoryRequest,
  UpdateServiceRequest,
  UpdateTenantBrandingRequest,
  UpdateTenantBusinessHoursRequest,
  UpdateTenantBusinessRequest,
  UpdateTenantClientOwnershipRequest,
  UpdateTenantCustomEmailRequest,
  UpdateTenantSettingsRequest,
  UpdateTenantWalletMembershipRequest,
  UpdateCustomerRequest,
  UpsertCustomerRequest,
  BookingFormRequirementSummary,
  SendFormReminderResponse,
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
  getDashboardReport: (tenantSlug: string) => client.get<DashboardReport>(`tenants/${tenantSlug}/report`),
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
  updateService: (tenantSlug: string, serviceId: string, body: UpdateServiceRequest) =>
    client.patch<ServiceSummary, UpdateServiceRequest>(
      `tenants/${tenantSlug}/services/${serviceId}`,
      body,
    ),
  duplicateService: (tenantSlug: string, serviceId: string) =>
    client.post<ServiceSummary, Record<string, never>>(
      `tenants/${tenantSlug}/services/${serviceId}/duplicate`,
      {},
    ),
  reorderServices: (tenantSlug: string, body: ReorderRequest) =>
    client.put<ServiceListResponse, ReorderRequest>(
      `tenants/${tenantSlug}/services/reorder`,
      body,
    ),
  listServiceCategories: (tenantSlug: string) =>
    client.get<ServiceCategoryListResponse>(`tenants/${tenantSlug}/service-categories`),
  createServiceCategory: (tenantSlug: string, body: CreateServiceCategoryRequest) =>
    client.post<ServiceCategorySummary, CreateServiceCategoryRequest>(
      `tenants/${tenantSlug}/service-categories`,
      body,
    ),
  updateServiceCategory: (
    tenantSlug: string,
    categoryId: string,
    body: UpdateServiceCategoryRequest,
  ) =>
    client.patch<ServiceCategorySummary, UpdateServiceCategoryRequest>(
      `tenants/${tenantSlug}/service-categories/${categoryId}`,
      body,
    ),
  deleteServiceCategory: (tenantSlug: string, categoryId: string) =>
    client.delete<void>(`tenants/${tenantSlug}/service-categories/${categoryId}`),
  reorderServiceCategories: (tenantSlug: string, body: ReorderRequest) =>
    client.put<ServiceCategoryListResponse, ReorderRequest>(
      `tenants/${tenantSlug}/service-categories/reorder`,
      body,
    ),
  getPublicCategory: (tenantSlug: string, categorySlug: string) =>
    client.get<PublicCategoryPayload>(`tenants/${tenantSlug}/c/${categorySlug}`),
  getServiceProviderVariants: (tenantSlug: string, serviceId: string) =>
    client.get<ProviderServiceVariantListResponse>(
      `tenants/${tenantSlug}/services/${serviceId}/provider-variants`,
    ),
  replaceServiceProviderVariants: (
    tenantSlug: string,
    serviceId: string,
    body: ReplaceProviderServiceVariantsRequest,
  ) =>
    client.put<ProviderServiceVariantListResponse, ReplaceProviderServiceVariantsRequest>(
      `tenants/${tenantSlug}/services/${serviceId}/provider-variants`,
      body,
    ),
  listLocations: (tenantSlug: string) => client.get<LocationListResponse>(`tenants/${tenantSlug}/locations`),
  listLocationsAdmin: (tenantSlug: string) =>
    client.get<LocationListResponse>(`tenants/${tenantSlug}/locations/manage`),
  listTenantUsers: (tenantSlug: string) =>
    client.get<TenantUserListResponse>(`tenants/${tenantSlug}/users`),
  createTenantUser: (tenantSlug: string, body: CreateTenantUserRequest) =>
    client.post<TenantUserSummary, CreateTenantUserRequest>(`tenants/${tenantSlug}/users`, body),
  updateTenantUser: (tenantSlug: string, userId: string, body: UpdateTenantUserRequest) =>
    client.patch<TenantUserSummary, UpdateTenantUserRequest>(`tenants/${tenantSlug}/users/${userId}`, body),
  resetTenantUserPassword: (
    tenantSlug: string,
    userId: string,
    body: ResetTenantUserPasswordRequest,
  ) =>
    client.post<TenantUserSummary, ResetTenantUserPasswordRequest>(
      `tenants/${tenantSlug}/users/${userId}/password`,
      body,
    ),
  listProvidersAdmin: (tenantSlug: string) =>
    client.get<ProviderListResponse>(`tenants/${tenantSlug}/providers/manage`),
  createProvider: (tenantSlug: string, body: CreateProviderRequest) =>
    client.post<ProviderSummary, CreateProviderRequest>(`tenants/${tenantSlug}/providers`, body),
  updateProvider: (tenantSlug: string, providerId: string, body: UpdateProviderRequest) =>
    client.patch<ProviderSummary, UpdateProviderRequest>(
      `tenants/${tenantSlug}/providers/${providerId}`,
      body,
    ),
  deactivateProvider: (tenantSlug: string, providerId: string) =>
    client.delete<ProviderSummary>(`tenants/${tenantSlug}/providers/${providerId}`),
  getProviderSchedule: (tenantSlug: string, providerId: string) =>
    client.get<ProviderSchedule>(`tenants/${tenantSlug}/providers/${providerId}/schedule`),
  replaceProviderSchedule: (
    tenantSlug: string,
    providerId: string,
    body: ReplaceProviderScheduleRequest,
  ) =>
    client.put<ProviderSchedule, ReplaceProviderScheduleRequest>(
      `tenants/${tenantSlug}/providers/${providerId}/schedule`,
      body,
    ),
  listProviderTimeOff: (tenantSlug: string, providerId: string) =>
    client.get<ProviderTimeOffList>(
      `tenants/${tenantSlug}/providers/${providerId}/time-off`,
    ),
  createProviderTimeOff: (
    tenantSlug: string,
    providerId: string,
    body: CreateProviderTimeOffRequest,
  ) =>
    client.post<ProviderTimeOffEntry, CreateProviderTimeOffRequest>(
      `tenants/${tenantSlug}/providers/${providerId}/time-off`,
      body,
    ),
  deleteProviderTimeOff: (
    tenantSlug: string,
    providerId: string,
    timeOffId: string,
  ) =>
    client.delete<void>(
      `tenants/${tenantSlug}/providers/${providerId}/time-off/${timeOffId}`,
    ),
  createTenantStaff: (tenantSlug: string, body: CreateStaffRequest) =>
    client.post<CreateStaffResponse, CreateStaffRequest>(`tenants/${tenantSlug}/staff`, body),
  getPermissionsCatalog: () => client.get<PermissionCatalogResponse>("auth/permissions/catalog"),
  getUserPermissions: (tenantSlug: string, userId: string) =>
    client.get<UserPermissionsResponse>(`tenants/${tenantSlug}/users/${userId}/permissions`),
  replaceUserPermissions: (
    tenantSlug: string,
    userId: string,
    body: ReplaceUserPermissionsRequest,
  ) =>
    client.put<UserPermissionsResponse, ReplaceUserPermissionsRequest>(
      `tenants/${tenantSlug}/users/${userId}/permissions`,
      body,
    ),
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
  listManageBookingFormRequirements: (token: string) =>
    client.get<BookingFormRequirementSummary[]>(`bookings/manage/${token}/form-requirements`),
  submitManageBookingFormRequirement: (
    token: string,
    requirementId: string,
    body: SubmitFormRequirementRequest,
  ) =>
    client.post<FormResponseSummary, SubmitFormRequirementRequest>(
      `bookings/manage/${token}/form-requirements/${requirementId}/submit`,
      body,
    ),
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
  sendBookingFormReminder: (tenantSlug: string, bookingId: string) =>
    client.request<SendFormReminderResponse>(`tenants/${tenantSlug}/bookings/${bookingId}/form-reminder`, {
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
  updateBooking: (tenantSlug: string, bookingId: string, body: UpdateBookingRequest) =>
    client.patch<BookingSummary, UpdateBookingRequest>(`tenants/${tenantSlug}/bookings/${bookingId}`, body),
  cancelBooking: (tenantSlug: string, bookingId: string, body: CancelBookingRequest) =>
    client.post<BookingSummary, CancelBookingRequest>(`tenants/${tenantSlug}/bookings/${bookingId}/cancel`, body),
  listBookingFormResponses: (tenantSlug: string, bookingId: string) =>
    client.get<BookingFormResponseList>(`tenants/${tenantSlug}/bookings/${bookingId}/form-responses`),
  listCustomers: (tenantSlug: string, search?: string) =>
    client.get<CustomerListResponse>(`tenants/${tenantSlug}/customers`, {
      query: search ? { search } : undefined,
    }),
  getCustomerProfile: (tenantSlug: string, customerId: string) =>
    client.get<CustomerProfileResponse>(`tenants/${tenantSlug}/customers/${customerId}`),
  updateCustomer: (tenantSlug: string, customerId: string, body: UpdateCustomerRequest) =>
    client.patch<CustomerProfileResponse, UpdateCustomerRequest>(`tenants/${tenantSlug}/customers/${customerId}`, body),
  listCustomerFormResponses: (tenantSlug: string, customerId: string) =>
    client.get<BookingFormResponseList>(`tenants/${tenantSlug}/customers/${customerId}/form-responses`),
  listForms: (tenantSlug: string) =>
    client.get<FormListResponse>(`tenants/${tenantSlug}/forms`),
  createForm: (tenantSlug: string, body: CreateFormRequest) =>
    client.post<FormSummaryResponse, CreateFormRequest>(`tenants/${tenantSlug}/forms`, body),
  updateForm: (tenantSlug: string, formId: string, body: UpdateFormRequest) =>
    client.patch<FormSummaryResponse, UpdateFormRequest>(`tenants/${tenantSlug}/forms/${formId}`, body),
  deleteForm: (tenantSlug: string, formId: string) =>
    client.delete<void>(`tenants/${tenantSlug}/forms/${formId}`),
  listResources: (tenantSlug: string) =>
    client.get<ResourceListResponse>(`tenants/${tenantSlug}/resources`),
  createResource: (tenantSlug: string, body: CreateResourceRequest) =>
    client.post<ResourceSummary, CreateResourceRequest>(`tenants/${tenantSlug}/resources`, body),
  updateResource: (tenantSlug: string, resourceId: string, body: UpdateResourceRequest) =>
    client.patch<ResourceSummary, UpdateResourceRequest>(`tenants/${tenantSlug}/resources/${resourceId}`, body),
});