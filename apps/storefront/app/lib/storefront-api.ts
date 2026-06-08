import "server-only";

import { ApiClientError, createApiClient, createPlatformApi } from "@booking/api-client";
import type { FormAttachment } from "@booking/shared-types";

import { apiBaseUrl } from "./platform-api";

export const storefrontApi = createPlatformApi(
  createApiClient({
    baseUrl: apiBaseUrl,
  }),
);

export async function uploadFormFile(
  file: File,
  tenantId: string,
): Promise<FormAttachment> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("tenant_id", tenantId);

  const url = `${apiBaseUrl}/forms/upload`;
  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`File upload failed (${response.status}): ${detail}`);
  }

  return response.json() as Promise<FormAttachment>;
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function isApiNotFoundError(error: unknown): boolean {
  return isApiClientError(error) && error.status === 404;
}
