"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

/**
 * Clover's secure card form (storefront copy of the dashboard component). The card number never touches our servers or our
 * page: Clover's script mounts its own iframes, and we only receive a one-time
 * token. Used for staff phone orders ("Take card now") and balances at checkout.
 *
 * Idempotency: each new card entry gets its own `attemptId`. When the server
 * says it could not confirm whether the charge went through, the SAME token and
 * attemptId are re-sent, so Clover can never charge twice.
 */

type CloverElement = { mount: (selector: string) => void; destroy?: () => void };
type CloverInstance = {
  elements: () => { create: (type: string, styles?: Record<string, unknown>) => CloverElement };
  createToken: () => Promise<{ token?: string; errors?: Record<string, string> }>;
};
type CloverConstructor = new (publicKey: string, options: { merchantId: string; locale?: string }) => CloverInstance;

declare global {
  interface Window {
    Clover?: CloverConstructor;
  }
}

export type CloverCardConfig = {
  merchantId: string;
  publicKey: string;
  sdkUrl: string;
  locale: string;
};

type Props = {
  config: CloverCardConfig;
  /** e.g. "Charge $35.00". */
  submitLabel: string;
  disabled?: boolean;
  /** Throws when the payment fails; the message is shown under the card fields. */
  onSubmit: (token: string, attemptId: string) => Promise<void>;
};

const scriptLoads = new Map<string, Promise<void>>();

function loadCloverScript(url: string): Promise<void> {
  if (typeof window !== "undefined" && window.Clover) return Promise.resolve();
  const existing = scriptLoads.get(url);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoads.delete(url);
      reject(new Error("Couldn't load the secure card form. Check the connection and try again."));
    };
    document.head.appendChild(script);
  });
  scriptLoads.set(url, promise);
  return promise;
}

function newAttemptId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function errorDetails(error: unknown): { message: string; code: string | null } {
  const message = error instanceof Error && error.message ? error.message : "The payment didn't go through.";
  const payload = (error as { payload?: { error?: { code?: string } } } | null)?.payload;
  return { message, code: payload?.error?.code ?? null };
}

const FIELD_STYLES = { body: { fontFamily: "inherit", fontSize: "14px" } };

export function CloverCardForm({ config, submitLabel, disabled = false, onSubmit }: Props): ReactElement {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cloverRef = useRef<CloverInstance | null>(null);
  // Held only after "we couldn't confirm": re-sent as-is so the charge is idempotent.
  const retryRef = useRef<{ token: string; attemptId: string } | null>(null);
  const idPrefix = useRef(`clover-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    let cancelled = false;
    const mounted: CloverElement[] = [];
    loadCloverScript(config.sdkUrl)
      .then(() => {
        if (cancelled) return;
        if (!window.Clover) throw new Error("The secure card form isn't available.");
        const clover = new window.Clover(config.publicKey, { merchantId: config.merchantId, locale: config.locale });
        const elements = clover.elements();
        for (const [type, suffix] of [
          ["CARD_NUMBER", "number"],
          ["CARD_DATE", "date"],
          ["CARD_CVV", "cvv"],
          ["CARD_POSTAL_CODE", "postal"],
        ] as const) {
          const element = elements.create(type, FIELD_STYLES);
          element.mount(`#${idPrefix}-${suffix}`);
          mounted.push(element);
        }
        cloverRef.current = clover;
        setState("ready");
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setLoadError(errorDetails(failure).message);
        setState("failed");
      });
    return () => {
      cancelled = true;
      for (const element of mounted) element.destroy?.();
      cloverRef.current = null;
    };
  }, [config.locale, config.merchantId, config.publicKey, config.sdkUrl, idPrefix]);

  const handleSubmit = async () => {
    if (busy || disabled || state !== "ready") return;
    setBusy(true);
    setError("");
    try {
      let attempt = retryRef.current;
      if (!attempt) {
        const result = await cloverRef.current!.createToken();
        if (!result.token) {
          const first = Object.values(result.errors ?? {})[0];
          throw new Error(first ?? "Check the card details and try again.");
        }
        attempt = { token: result.token, attemptId: newAttemptId() };
      }
      try {
        await onSubmit(attempt.token, attempt.attemptId);
        retryRef.current = null;
      } catch (failure) {
        const { code } = errorDetails(failure);
        // Unknown outcome: keep token + attempt so "try again" can't double charge.
        retryRef.current = code === "payment_outcome_unknown" ? attempt : null;
        throw failure;
      }
    } catch (failure) {
      setError(errorDetails(failure).message);
    } finally {
      setBusy(false);
    }
  };

  const unresolved = retryRef.current !== null;

  return (
    <div className="store-clover-form">
      {state === "loading" ? <p className="store-card-note" role="status">Loading the secure card form…</p> : null}
      {state === "failed" ? (
        <div role="alert" className="store-card-error">{loadError}</div>
      ) : null}
      <div className="store-clover-form__fields" hidden={state !== "ready"}>
        <label>
          <span>Card number</span>
          <div id={`${idPrefix}-number`} className="store-clover-form__field" />
        </label>
        <div className="store-clover-form__row">
          <label>
            <span>Expiry</span>
            <div id={`${idPrefix}-date`} className="store-clover-form__field" />
          </label>
          <label>
            <span>CVV</span>
            <div id={`${idPrefix}-cvv`} className="store-clover-form__field" />
          </label>
          <label>
            <span>Postal code</span>
            <div id={`${idPrefix}-postal`} className="store-clover-form__field" />
          </label>
        </div>
      </div>
      {error ? <div role="alert" className="store-card-error">{error}</div> : null}
      <button
        type="button"
        className="store-button"
        onClick={() => void handleSubmit()}
        disabled={disabled || busy || state !== "ready"}
      >
        {busy ? "Processing…" : unresolved ? "Check payment again" : submitLabel}
      </button>
    </div>
  );
}
