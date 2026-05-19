import { createApiClient, createPlatformApi } from "@booking/api-client";

export const apiBaseUrl =
  import.meta.env.VITE_PUBLIC_API_BASE_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:8000/api/v1";

export const platformApi = createPlatformApi(
  createApiClient({
    baseUrl: apiBaseUrl,
  }),
);