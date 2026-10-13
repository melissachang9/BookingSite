import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { CloverApiKeysRequest, PaymentCapabilities } from "@booking/shared-types";

import { platformApi } from "./platform-api";

/**
 * Settings → Payments & checkout → Card processor. Connects the business's own
 * Clover account. Only owners can connect or disconnect: it decides where
 * every payment is deposited.
 */

type PaymentsApi = Pick<
  typeof platformApi,
  | "getPaymentCapabilities"
  | "getCloverAuthorizeUrl"
  | "completeCloverOAuth"
  | "connectCloverWithApiKeys"
  | "disconnectClover"
>;

type Props = {
  tenantSlug: string;
  canConfigure: boolean;
  api?: PaymentsApi;
  /** Starts the browser redirect to Clover (replaced in tests). */
  redirectTo?: (url: string) => void;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; capabilities: PaymentCapabilities }
  | { kind: "error"; message: string };

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function statusLabel(capabilities: PaymentCapabilities): { text: string; tone: "ok" | "warn" | "off" } {
  if (capabilities.needsReauth) return { text: "Needs reconnecting", tone: "warn" };
  if (capabilities.status === "connected") return { text: "Connected", tone: "ok" };
  return { text: "Not connected", tone: "off" };
}

const EMPTY_KEYS: CloverApiKeysRequest = {
  environment: "production",
  merchantId: "",
  platformApiToken: "",
  ecommercePublicKey: "",
  ecommercePrivateKey: "",
};

export function PaymentsSettingsSection({
  tenantSlug,
  canConfigure,
  api = platformApi,
  redirectTo = (url) => window.location.assign(url),
}: Props): ReactElement {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState<"connect" | "keys" | "disconnect" | null>(null);
  const [actionError, setActionError] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [keys, setKeys] = useState<CloverApiKeysRequest>(EMPTY_KEYS);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoad({ kind: "ready", capabilities: await api.getPaymentCapabilities(tenantSlug) });
    } catch (error) {
      setLoad({ kind: "error", message: messageFrom(error, "Unable to load payment settings.") });
    }
  }, [api, tenantSlug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleConnect = async () => {
    setBusy("connect");
    setActionError("");
    try {
      const { authorizeUrl } = await api.getCloverAuthorizeUrl(tenantSlug);
      redirectTo(authorizeUrl);
    } catch (error) {
      setActionError(messageFrom(error, "Unable to start the Clover connection."));
      setBusy(null);
    }
  };

  const handleKeys = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("keys");
    setActionError("");
    try {
      const capabilities = await api.connectCloverWithApiKeys(tenantSlug, {
        ...keys,
        merchantId: keys.merchantId.trim(),
        platformApiToken: keys.platformApiToken.trim(),
        ecommercePublicKey: keys.ecommercePublicKey.trim(),
        ecommercePrivateKey: keys.ecommercePrivateKey.trim(),
      });
      setKeys(EMPTY_KEYS); // never keep secrets in memory longer than needed
      setShowKeys(false);
      setLoad({ kind: "ready", capabilities });
    } catch (error) {
      setActionError(messageFrom(error, "Unable to connect with these keys."));
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    setBusy("disconnect");
    setActionError("");
    try {
      const capabilities = await api.disconnectClover(tenantSlug);
      setConfirmDisconnect(false);
      setLoad({ kind: "ready", capabilities });
    } catch (error) {
      setActionError(messageFrom(error, "Unable to disconnect Clover."));
    } finally {
      setBusy(null);
    }
  };

  if (load.kind === "loading") {
    return <p className="cs-empty">Loading payment settings…</p>;
  }
  if (load.kind === "error") {
    return (
      <div role="alert" className="cs-banner cs-banner--error">
        {load.message}{" "}
        <button type="button" className="cs-btn cs-btn--sm" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  }

  const capabilities = load.capabilities;
  const status = statusLabel(capabilities);
  const connected = capabilities.status === "connected" || capabilities.needsReauth;
  const disabled = !canConfigure || busy !== null;

  return (
    <div className="cs-payments-settings">
      <div className="cs-payments-settings__row">
        <div>
          <div className="cs-payments-settings__name">Clover</div>
          <p className="cs-field-help">
            Card payments, deposit links and refunds go through your own Clover account, so everything
            appears in your normal Clover reports.
          </p>
        </div>
        <span className={`cs-pill cs-pill--${status.tone === "ok" ? "ok" : status.tone === "warn" ? "warn" : "quiet"}`}>
          {status.text}
        </span>
      </div>

      {connected ? (
        <dl className="cs-payments-settings__facts">
          <div>
            <dt>Clover account</dt>
            <dd>{capabilities.merchantName ?? "Connected account"}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>
              {capabilities.environment === "sandbox" ? "Test mode (sandbox)" : "Live"} ·{" "}
              {capabilities.authMode === "api_keys" ? "API keys" : "Clover app"}
            </dd>
          </div>
          <div>
            <dt>Match payments from the Clover device</dt>
            <dd>{capabilities.canLinkDevicePayments ? "On" : "Off"}</dd>
          </div>
          <div>
            <dt>Online and phone card payments</dt>
            <dd>{capabilities.canChargeCards ? "On" : "Off — not enabled on this Clover account"}</dd>
          </div>
        </dl>
      ) : null}

      {capabilities.needsReauth ? (
        <div role="alert" className="cs-banner cs-banner--error">
          Clover stopped accepting our connection. Reconnect to keep taking card payments.
        </div>
      ) : null}
      {capabilities.currencyMismatch ? (
        <div role="alert" className="cs-banner cs-banner--error">
          The Clover account uses a different currency than this business. Card features are off until they match.
        </div>
      ) : null}
      {actionError ? (
        <div role="alert" className="cs-banner cs-banner--error">
          {actionError}
        </div>
      ) : null}
      {!canConfigure ? (
        <p className="cs-permission-note">Only the business owner can connect or disconnect Clover.</p>
      ) : null}

      <div className="cs-actions">
        {!connected || capabilities.needsReauth ? (
          <button type="button" className="cs-btn cs-btn--primary cs-btn--sm" onClick={() => void handleConnect()} disabled={disabled}>
            {busy === "connect" ? "Opening Clover…" : capabilities.needsReauth ? "Reconnect Clover" : "Connect Clover"}
          </button>
        ) : null}
        {!connected ? (
          <button type="button" className="cs-btn cs-btn--sm" onClick={() => setShowKeys((open) => !open)} disabled={disabled}>
            Connect with API keys
          </button>
        ) : null}
        {connected && !confirmDisconnect ? (
          <button type="button" className="cs-btn cs-btn--sm" onClick={() => setConfirmDisconnect(true)} disabled={disabled}>
            Disconnect
          </button>
        ) : null}
      </div>

      {confirmDisconnect ? (
        <div role="alertdialog" aria-label="Confirm disconnect" className="cs-banner">
          <p>
            Disconnecting turns off Clover card payments for this business. Existing bookings and their
            payments are not changed.
          </p>
          <div className="cs-actions">
            <button type="button" className="cs-btn cs-btn--sm" onClick={() => setConfirmDisconnect(false)} disabled={busy !== null}>
              Keep connected
            </button>
            <button type="button" className="cs-btn cs-btn--primary cs-btn--sm" onClick={() => void handleDisconnect()} disabled={busy !== null}>
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect Clover"}
            </button>
          </div>
        </div>
      ) : null}

      {showKeys && !connected ? (
        <form className="cs-form" onSubmit={handleKeys} aria-label="Connect with Clover API keys">
          <p className="cs-field-help">
            Use this until your Clover app is approved. In your Clover dashboard, open Ecommerce → API Tokens
            and copy the keys. They are stored encrypted and are never shown again.
          </p>
          <label className="cs-field">
            <span>Mode</span>
            <select
              value={keys.environment}
              onChange={(event) => setKeys((current) => ({ ...current, environment: event.target.value as CloverApiKeysRequest["environment"] }))}
              disabled={busy !== null}
            >
              <option value="production">Live</option>
              <option value="sandbox">Test (sandbox)</option>
            </select>
          </label>
          {(
            [
              ["merchantId", "Merchant ID", "text"],
              ["platformApiToken", "Clover API token", "password"],
              ["ecommercePublicKey", "Ecommerce public key", "text"],
              ["ecommercePrivateKey", "Ecommerce private key", "password"],
            ] as const
          ).map(([field, label, type]) => (
            <label key={field} className="cs-field">
              <span>{label}</span>
              <input
                type={type}
                value={keys[field]}
                onChange={(event) => setKeys((current) => ({ ...current, [field]: event.target.value }))}
                autoComplete="off"
                required
                disabled={busy !== null}
              />
            </label>
          ))}
          <div className="cs-actions">
            <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={busy !== null}>
              {busy === "keys" ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Where Clover sends the owner after they approve access. Finishes the
 * connection, then returns to Settings. An App Market launch arrives without
 * a state token, so it restarts the authorize step instead.
 */
export function CloverCallbackPage({
  tenantSlug,
  api = platformApi,
  redirectTo = (url) => window.location.assign(url),
}: {
  tenantSlug: string;
  api?: PaymentsApi;
  redirectTo?: (url: string) => void;
}): ReactElement {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState("Finishing the Clover connection…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const code = params.get("code");
    const merchantId = params.get("merchant_id");
    const state = params.get("state");
    let cancelled = false;

    const run = async () => {
      try {
        if (!code || !merchantId || !state) {
          // Launched from the Clover App Market or dashboard with no state:
          // begin a fresh, signed authorize step.
          const { authorizeUrl } = await api.getCloverAuthorizeUrl(tenantSlug);
          if (!cancelled) redirectTo(authorizeUrl);
          return;
        }
        await api.completeCloverOAuth(tenantSlug, { code, merchantId, state });
        if (!cancelled) navigate("/settings#payments", { replace: true });
      } catch (error) {
        if (cancelled) return;
        setFailed(true);
        setMessage(messageFrom(error, "Unable to finish connecting Clover."));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [api, navigate, params, redirectTo, tenantSlug]);

  return (
    <main className="cs-page">
      <div className={failed ? "cs-banner cs-banner--error" : "cs-empty"} role={failed ? "alert" : "status"}>
        {message}
      </div>
      {failed ? (
        <button type="button" className="cs-btn cs-btn--sm" onClick={() => navigate("/settings#payments", { replace: true })}>
          Back to settings
        </button>
      ) : null}
    </main>
  );
}
