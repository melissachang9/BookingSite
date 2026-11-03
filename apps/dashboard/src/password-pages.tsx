import { useState, type FormEvent } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";

import { platformApi } from "./platform-api";

type Status = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string } | { kind: "done" };

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Asks for an email address and sends a reset link. It answers the same whether or not the address has an account. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus({ kind: "submitting" });
    try {
      await platformApi.forgotPassword({ email: email.trim().toLowerCase() });
      setStatus({ kind: "done" });
    } catch (error) {
      setStatus({ kind: "error", message: message(error, "Unable to send the reset email.") });
    }
  };

  return (
    <main className="cs-login">
      <section className="cs-login__panel">
        <span className="cs-login__brand">BB</span>
        <p className="cs-eyebrow">Account access</p>
        <h2>Reset your password</h2>
        {status.kind === "done" ? (
          <>
            <div className="cs-banner cs-banner--muted" role="status">
              If that email has an account, a reset link is on its way. It works for 1 hour.
            </div>
            <div className="cs-action-row">
              <NavLink to="/login" className="cs-btn cs-btn--sm">Back to sign in</NavLink>
            </div>
          </>
        ) : (
          <>
            <p>Enter the email you sign in with and we'll send you a link to choose a new password.</p>
            {status.kind === "error" ? <div className="cs-banner cs-banner--error" role="alert">{status.message}</div> : null}
            <form className="cs-login__form" onSubmit={submit}>
              <label>
                <span>Email</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
              </label>
              <div className="cs-action-row">
                <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={status.kind === "submitting"}>
                  {status.kind === "submitting" ? "Sending..." : "Send reset link"}
                </button>
                <NavLink to="/login" className="cs-btn cs-btn--sm">Back to sign in</NavLink>
              </div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

/** Opened from an emailed link: sets a new password, or the first one for an invited staff member. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const invited = params.get("invite") === "1";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const mismatch = confirm.length > 0 && password !== confirm;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirm) {
      setStatus({ kind: "error", message: "The two passwords don't match." });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      await platformApi.resetPassword({ token, newPassword: password });
      setStatus({ kind: "done" });
    } catch (error) {
      setStatus({ kind: "error", message: message(error, "Unable to set the password.") });
    }
  };

  return (
    <main className="cs-login">
      <section className="cs-login__panel">
        <span className="cs-login__brand">BB</span>
        <p className="cs-eyebrow">Account access</p>
        <h2>{invited ? "Welcome — choose a password" : "Choose a new password"}</h2>

        {token === "" ? (
          <>
            <div className="cs-banner cs-banner--error" role="alert">
              This link is incomplete. Open the link from your email again, or request a new one.
            </div>
            <div className="cs-action-row">
              <NavLink to="/forgot-password" className="cs-btn cs-btn--sm">Request a new link</NavLink>
            </div>
          </>
        ) : status.kind === "done" ? (
          <>
            <div className="cs-banner cs-banner--muted" role="status">
              {invited ? "Your password is set." : "Your password was changed."} You can sign in now.
            </div>
            <div className="cs-action-row">
              <button type="button" className="cs-btn cs-btn--primary cs-btn--sm" onClick={() => navigate("/login")}>
                Go to sign in
              </button>
            </div>
          </>
        ) : (
          <>
            <p>Use at least 8 characters.</p>
            {status.kind === "error" ? (
              <div className="cs-banner cs-banner--error" role="alert">
                {status.message}{" "}
                <NavLink to="/forgot-password">Request a new link</NavLink>
              </div>
            ) : null}
            <form className="cs-login__form" onSubmit={submit}>
              <label>
                <span>New password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                  autoFocus
                />
              </label>
              <label>
                <span>Confirm password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
                {mismatch ? <small className="cs-error">The two passwords don't match.</small> : null}
              </label>
              <div className="cs-action-row">
                <button
                  type="submit"
                  className="cs-btn cs-btn--primary cs-btn--sm"
                  disabled={status.kind === "submitting" || password.length < 8 || mismatch}
                >
                  {status.kind === "submitting" ? "Saving..." : invited ? "Set password" : "Change password"}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
