import type { SessionResponse } from "@booking/shared-types";
import { ApiClientError, createApiClient, createPlatformApi } from "@booking/api-client";

export type DashboardAuthNotice = "session-expired";

export const apiBaseUrl =
  import.meta.env.VITE_PUBLIC_API_BASE_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:8000/api/v1";

const dashboardSessionStorageKey = "booking.dashboard.session";
const dashboardAuthNoticeStorageKey = "booking.dashboard.auth-notice";
const dashboardRedirectPathStorageKey = "booking.dashboard.redirect-path";
const dashboardSessionEventName = "booking-dashboard-session-change";
const sessionRefreshBufferMs = 30_000;

let sessionRefreshPromise: Promise<SessionResponse | null> | null = null;

const sessionApi = createPlatformApi(
  createApiClient({
    baseUrl: apiBaseUrl,
  }),
);

function dispatchSessionChangeEvent(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(dashboardSessionEventName));
}

function isSessionExpiringSoon(session: SessionResponse): boolean {
  return Date.parse(session.expiresAt) - Date.now() <= sessionRefreshBufferMs;
}

export function readStoredSession(): SessionResponse | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(dashboardSessionStorageKey);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as SessionResponse;
  } catch {
    window.localStorage.removeItem(dashboardSessionStorageKey);
    return null;
  }
}

export function writeStoredSession(session: SessionResponse): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(dashboardAuthNoticeStorageKey);
  window.localStorage.setItem(dashboardSessionStorageKey, JSON.stringify(session));
  dispatchSessionChangeEvent();
}

export function readStoredAuthNotice(): DashboardAuthNotice | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(dashboardAuthNoticeStorageKey);
  return rawValue === "session-expired" ? rawValue : null;
}

export function clearStoredAuthNotice(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(dashboardAuthNoticeStorageKey);
}

function isValidDashboardRedirectPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && path !== "/login" && path !== "/onboarding";
}

export function writeStoredRedirectPath(path: string): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!isValidDashboardRedirectPath(path)) {
    return;
  }

  window.localStorage.setItem(dashboardRedirectPathStorageKey, path);
}

export function readStoredRedirectPath(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(dashboardRedirectPathStorageKey);
  if (!rawValue || !isValidDashboardRedirectPath(rawValue)) {
    return null;
  }

  return rawValue;
}

export function consumeStoredRedirectPath(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const redirectPath = readStoredRedirectPath();
  window.localStorage.removeItem(dashboardRedirectPathStorageKey);
  return redirectPath;
}

export function clearStoredRedirectPath(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(dashboardRedirectPathStorageKey);
}

export function clearStoredSession(options?: { notice?: DashboardAuthNotice }): void {
  if (typeof window === "undefined") {
    return;
  }

  if (options?.notice) {
    window.localStorage.setItem(dashboardAuthNoticeStorageKey, options.notice);
  } else {
    window.localStorage.removeItem(dashboardAuthNoticeStorageKey);
  }

  window.localStorage.removeItem(dashboardSessionStorageKey);
  dispatchSessionChangeEvent();
}

export function subscribeToStoredSession(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleChange = () => callback();
  window.addEventListener(dashboardSessionEventName, handleChange);
  window.addEventListener("storage", handleChange);
  return () => {
    window.removeEventListener(dashboardSessionEventName, handleChange);
    window.removeEventListener("storage", handleChange);
  };
}

async function refreshStoredSession(): Promise<SessionResponse | null> {
  const currentSession = readStoredSession();
  if (currentSession?.refreshToken === undefined) {
    clearStoredSession();
    return null;
  }

  if (sessionRefreshPromise !== null) {
    return sessionRefreshPromise;
  }

  sessionRefreshPromise = sessionApi
    .refreshSession({ refreshToken: currentSession.refreshToken })
    .then((nextSession) => {
      writeStoredSession(nextSession);
      return nextSession;
    })
    .catch((error: unknown) => {
      if (error instanceof ApiClientError && error.status === 401) {
        clearStoredSession({ notice: "session-expired" });
        return null;
      }

      return currentSession;
    })
    .finally(() => {
      sessionRefreshPromise = null;
    });

  return sessionRefreshPromise;
}

export async function ensureActiveStoredSession(): Promise<SessionResponse | null> {
  const currentSession = readStoredSession();
  if (currentSession === null) {
    return null;
  }

  if (!isSessionExpiringSoon(currentSession)) {
    return currentSession;
  }

  return refreshStoredSession();
}

async function getSessionAccessToken(): Promise<string | null> {
  const activeSession = await ensureActiveStoredSession();
  return activeSession?.accessToken ?? null;
}

export const platformApi = createPlatformApi(
  createApiClient({
    baseUrl: apiBaseUrl,
    getAccessToken: getSessionAccessToken,
    refreshAccessToken: async () => (await refreshStoredSession())?.accessToken ?? null,
  }),
);