import "server-only";

import { ApiClientError, createApiClient, createPlatformApi } from "@booking/api-client";

import { apiBaseUrl } from "./platform-api";

export const storefrontApi = createPlatformApi(
  createApiClient({
    baseUrl: apiBaseUrl,
  }),
);

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function isApiNotFoundError(error: unknown): boolean {
  return isApiClientError(error) && error.status === 404;
}
