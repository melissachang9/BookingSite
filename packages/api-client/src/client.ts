import type { ErrorResponse } from "@booking/shared-types";

export type ApiClientOptions = {
  baseUrl: string;
  getAccessToken?: () => string | null | Promise<string | null>;
  refreshAccessToken?: () => string | null | Promise<string | null>;
  defaultHeaders?: HeadersInit;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined | null>;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly payload?: ErrorResponse;

  constructor(message: string, status: number, payload?: ErrorResponse) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.payload = payload;
  }
}

const isDefinedQueryValue = (
  value: string | number | boolean | undefined | null,
): value is string | number | boolean => value !== undefined && value !== null;

const buildUrl = (
  baseUrl: string,
  path: string,
  query?: RequestOptions["query"],
): string => {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(normalizedPath || ".", normalizedBaseUrl);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (isDefinedQueryValue(value)) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
};

const buildHeaders = async (
  client: ApiClientOptions,
  options?: RequestOptions,
): Promise<Headers> => {
  const headers = new Headers(client.defaultHeaders);
  headers.set("Accept", "application/json");

  if (options?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (options?.headers) {
    for (const [key, value] of new Headers(options.headers).entries()) {
      headers.set(key, value);
    }
  }

  const token = await client.getAccessToken?.();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
};

const parseJsonSafely = async <TValue>(response: Response): Promise<TValue | undefined> => {
  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return undefined;
  }

  return (await response.json()) as TValue;
};

export const createApiClient = (options: ApiClientOptions) => {
  const executeRequest = async (path: string, requestOptions?: RequestOptions): Promise<Response> =>
    fetch(buildUrl(options.baseUrl, path, requestOptions?.query), {
      method: requestOptions?.method ?? "GET",
      headers: await buildHeaders(options, requestOptions),
      body: requestOptions?.body !== undefined ? JSON.stringify(requestOptions.body) : undefined,
      signal: requestOptions?.signal,
    });

  const request = async <TResponse>(
    path: string,
    requestOptions?: RequestOptions,
    allowRefresh = true,
  ): Promise<TResponse> => {
    let response = await executeRequest(path, requestOptions);

    if (response.status === 401 && allowRefresh && options.refreshAccessToken !== undefined) {
      const refreshedToken = await options.refreshAccessToken();
      if (refreshedToken) {
        response = await executeRequest(path, requestOptions);
      }
    }

    if (!response.ok) {
      const payload = await parseJsonSafely<ErrorResponse>(response);
      throw new ApiClientError(
        payload?.error?.message ?? `Request failed with status ${response.status}`,
        response.status,
        payload,
      );
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    const payload = await parseJsonSafely<TResponse>(response);
    return payload as TResponse;
  };

  return {
    request,
    get: <TResponse>(path: string, requestOptions?: Omit<RequestOptions, "body" | "method">) =>
      request<TResponse>(path, { ...requestOptions, method: "GET" }),
    post: <TResponse, TBody>(path: string, body: TBody, requestOptions?: Omit<RequestOptions, "body" | "method">) =>
      request<TResponse>(path, { ...requestOptions, method: "POST", body }),
    patch: <TResponse, TBody>(path: string, body: TBody, requestOptions?: Omit<RequestOptions, "body" | "method">) =>
      request<TResponse>(path, { ...requestOptions, method: "PATCH", body }),
    put: <TResponse, TBody>(path: string, body: TBody, requestOptions?: Omit<RequestOptions, "body" | "method">) =>
      request<TResponse>(path, { ...requestOptions, method: "PUT", body }),
    delete: <TResponse>(path: string, requestOptions?: Omit<RequestOptions, "body" | "method">) =>
      request<TResponse>(path, { ...requestOptions, method: "DELETE" }),
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;