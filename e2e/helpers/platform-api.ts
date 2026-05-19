import { expect, type APIRequestContext } from "@playwright/test";
import type { BookingDraftSummary, ErrorResponse, ServiceListResponse, TenantSummary } from "@booking/shared-types";

export const e2eTenantSlug = process.env.E2E_TENANT_SLUG ?? "brow-beauty-lab";
export const e2eApiBaseURL = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";

const apiURL = (path: string) => {
  const normalizedBaseURL = e2eApiBaseURL.endsWith("/") ? e2eApiBaseURL : `${e2eApiBaseURL}/`;
  return new URL(path.replace(/^\/+/, ""), normalizedBaseURL).toString();
};

async function getApiJSON<TPayload>(request: APIRequestContext, path: string): Promise<TPayload> {
  const response = await request.get(apiURL(path));
  await expect(response, `GET ${path}`).toBeOK();
  return (await response.json()) as TPayload;
}

export const getTenant = (request: APIRequestContext, tenantSlug = e2eTenantSlug) =>
  getApiJSON<TenantSummary>(request, `tenants/${tenantSlug}`);

export const listServices = (request: APIRequestContext, tenantSlug = e2eTenantSlug) =>
  getApiJSON<ServiceListResponse>(request, `tenants/${tenantSlug}/services`);

export const getBookingDraft = (
  request: APIRequestContext,
  tenantSlug: string,
  bookingDraftId: string,
) => getApiJSON<BookingDraftSummary>(request, `tenants/${tenantSlug}/booking-drafts/${bookingDraftId}`);

export async function expectSlotConflict(
  request: APIRequestContext,
  tenantSlug: string,
  draft: BookingDraftSummary,
) {
  const response = await request.post(apiURL(`tenants/${tenantSlug}/booking-drafts`), {
    data: {
      tenantSlug,
      serviceId: draft.serviceId,
      providerId: draft.providerId,
      locationId: draft.locationId ?? undefined,
      startsAt: draft.startsAt,
    },
  });

  expect(response.status()).toBe(409);
  const payload = (await response.json()) as ErrorResponse;
  expect(payload.error.code).toBe("conflict");
}