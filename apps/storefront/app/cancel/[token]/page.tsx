import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../lib/storefront-api";
import { formatCurrency, formatInTenantTime, slugify } from "../../lib/storefront-shell";
import { cancelManageBookingAction, rescheduleManageBookingAction } from "./actions";

type ManageRouteProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ canceled?: string; error?: string; paid?: string; rescheduled?: string; sessionId?: string }>;
};

export const dynamic = "force-dynamic";

const CHECKOUT_PENDING_MESSAGE = "The payment processor has not completed this checkout yet.";
const CHECKOUT_EXPIRED_MESSAGE = "The checkout session expired before payment completed.";

const isNextNavigationSignal = (error: unknown): error is { digest: string } =>
  typeof error === "object" &&
  error !== null &&
  "digest" in error &&
  typeof error.digest === "string" &&
  (error.digest.startsWith("NEXT_REDIRECT") || error.digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));

export default async function ManageBookingPage({ params, searchParams }: ManageRouteProps) {
  const [{ token }, { canceled, error, paid, rescheduled, sessionId }] = await Promise.all([params, searchParams]);

  try {
    const manageBooking = await storefrontApi.getManageBooking(token);

    if (typeof sessionId === "string" && sessionId.length > 0) {
      try {
        await storefrontApi.completeCheckoutSession(manageBooking.tenant.slug, sessionId);
        redirect(`/cancel/${token}?paid=1`);
      } catch (checkoutError) {
        if (isNextNavigationSignal(checkoutError)) {
          throw checkoutError;
        }

        const checkoutErrorCode =
          isApiClientError(checkoutError) && checkoutError.status === 409
            ? checkoutError.message === CHECKOUT_PENDING_MESSAGE
              ? "payment-pending"
              : checkoutError.message === CHECKOUT_EXPIRED_MESSAGE
                ? "payment-expired"
                : "payment-unavailable"
            : "payment-unavailable";
        redirect(`/cancel/${token}?error=${checkoutErrorCode}`);
      }
    }

    const { booking, cancellationDeadlineAt, cancellationWindowHours, isInsideCancellationWindow, refundInsideWindow, tenant } =
      manageBooking;
    const isCanceled = booking.status === "canceled";
    const hasPaidDeposit = booking.depositStatus === "paid";
    const depositAmountLabel = formatCurrency(booking.service.depositCents);
    const paymentAmountLabel =
      booking.balanceDueCents > 0
        ? formatCurrency(booking.balanceDueCents)
        : booking.amountPaidCents > 0
          ? formatCurrency(booking.amountPaidCents)
          : booking.depositStatus === "not_required"
            ? "Not required"
            : depositAmountLabel;
    const paymentDetail =
      booking.balanceDueCents > 0
        ? `${formatCurrency(booking.amountPaidCents)} collected so far, ${formatCurrency(booking.balanceDueCents)} still due.`
        : booking.paymentResolution === "collected"
          ? "Payment is fully collected for this appointment."
          : booking.depositStatus === "not_required"
            ? "No payment was required for this appointment."
            : "Payment details remain attached to this appointment.";
    const policyTitle = isInsideCancellationWindow ? "Inside cancellation window" : "Outside cancellation window";
    const policyDetail = isInsideCancellationWindow
      ? refundInsideWindow
        ? `Changes are now inside the ${cancellationWindowHours}-hour window. This studio can still refund inside that window when policy allows.`
        : `Changes are now inside the ${cancellationWindowHours}-hour window. Refunds are not automatic once that window starts.`
      : `Changes made before ${formatInTenantTime(cancellationDeadlineAt, tenant.timezone)} stay outside the ${cancellationWindowHours}-hour cancellation window.`;
    const followUpTitle = booking.intakePlan?.completionTiming === "before_visit" ? "Pre-visit reminder scheduled" : "Booking complete";
    const followUpDetail =
      booking.intakePlan?.completionTiming === "before_visit"
        ? "Your required forms stay attached to this appointment and reminders will go out before the visit."
        : "No remaining pre-visit forms are scheduled for this appointment.";
    const cancellationOutcomeTitle =
      booking.depositStatus === "refunded"
        ? `Deposit refunded: ${depositAmountLabel}`
        : booking.depositStatus === "forfeited"
          ? `Deposit retained: ${depositAmountLabel}`
          : booking.depositStatus === "not_required"
            ? "No deposit was attached to this visit"
            : "No additional payment action is pending";
    const cancellationOutcomeDetail =
      booking.depositStatus === "refunded"
        ? "The studio canceled this appointment and returned the deposit under the tenant cancellation policy."
        : booking.depositStatus === "forfeited"
          ? "The appointment was canceled inside the tenant cancellation window, so the deposit was retained."
          : booking.depositStatus === "not_required"
            ? "This appointment did not require a deposit, so the time was simply released back to the schedule."
            : "This appointment no longer has an active payment action attached to it.";
    const cancellationActionTitle =
      hasPaidDeposit && !isInsideCancellationWindow
        ? `Cancel now and refund ${depositAmountLabel}`
        : hasPaidDeposit && refundInsideWindow
          ? `Cancel now and return ${depositAmountLabel}`
          : hasPaidDeposit
            ? `Cancel now and keep the ${depositAmountLabel} deposit policy`
            : "Cancel this appointment";
    const cancellationActionDetail =
      hasPaidDeposit && !isInsideCancellationWindow
        ? `Because this is outside the ${cancellationWindowHours}-hour window, the ${depositAmountLabel} deposit will be refunded.`
        : hasPaidDeposit && refundInsideWindow
          ? `This studio still allows refunds inside the ${cancellationWindowHours}-hour window, so the ${depositAmountLabel} deposit can be returned.`
          : hasPaidDeposit
            ? `This request is inside the ${cancellationWindowHours}-hour window, so the ${depositAmountLabel} deposit will be retained.`
            : "No deposit is attached to this appointment, so canceling will only release the time.";
    const cancellationErrorMessage =
      error === "cancel-unavailable"
        ? "This appointment can no longer be canceled from the private booking link."
        : error === "cancel-error"
          ? "The cancellation could not be completed. Please contact the studio directly."
          : error === "reschedule-unavailable"
            ? "The selected time is no longer available. Please try a different time."
          : error === "reschedule-error"
            ? "The reschedule could not be completed. Please contact the studio directly."
          : error === "payment-pending"
            ? "The payment processor is still finishing the balance checkout. Refresh this page in a moment."
            : error === "payment-expired"
              ? "That balance checkout link expired before payment finished. Contact the studio if you need a fresh link."
              : error === "payment-unavailable"
                ? "The balance checkout could not be completed from this link. Contact the studio if you still need help with payment."
          : null;
    const paymentBannerTitle = paid === "1" ? "Balance payment received." : null;
    const paymentBannerDetail =
      paid === "1"
        ? booking.status === "completed"
          ? "Your remaining balance was recorded and this completed visit now shows as paid in full."
          : "Your remaining balance was recorded. The studio will keep the visit details available in this private link."
        : null;

    return (
      <main className="manage-page page-stack">
        <section className="state-panel state-panel--manage">
          <p className="store-eyebrow">Manage booking</p>
          <h1>{isCanceled ? "Your appointment is canceled." : "Manage your appointment."}</h1>
          <p>
            {isCanceled
              ? cancellationOutcomeDetail
              : "Your private booking link keeps visit details, cancellation timing, and payment context in one secure place."}
          </p>
          <span className="panel-badge">{booking.status.replaceAll("_", " ")}</span>
        </section>

        {paymentBannerTitle !== null && paymentBannerDetail !== null ? (
          <section className="status-banner" aria-live="polite">
            <strong>{paymentBannerTitle}</strong>
            <span>{paymentBannerDetail}</span>
          </section>
        ) : null}

        {canceled === "1" ? (
          <section className="status-banner" aria-live="polite">
            <strong>Appointment canceled.</strong>
            <span>{cancellationOutcomeTitle}</span>
          </section>
        ) : null}

        {rescheduled === "1" ? (
          <section className="status-banner" aria-live="polite">
            <strong>Appointment rescheduled.</strong>
            <span>Your appointment has been moved to {formatInTenantTime(booking.startsAt, tenant.timezone)}.</span>
          </section>
        ) : null}

        <section className="store-section">
          <div className="section-header">
            <div>
              <p className="store-eyebrow">Visit details</p>
              <h2>{booking.service.name}</h2>
            </div>
            <span className="panel-badge">{booking.depositStatus.replaceAll("_", " ")}</span>
          </div>

          <div className="summary-grid summary-grid--three">
            <article className="summary-card">
              <span>When</span>
              <strong>{formatInTenantTime(booking.startsAt, tenant.timezone)}</strong>
              <p>{tenant.timezone}</p>
            </article>
            <article className="summary-card">
              <span>Provider</span>
              <strong>{booking.provider.name}</strong>
              <p>{tenant.name}</p>
            </article>
            <article className="summary-card">
              <span>Payment</span>
              <strong>{paymentAmountLabel}</strong>
              <p>{paymentDetail}</p>
            </article>
            {booking.walletBalanceCents != null && booking.walletBalanceCents > 0 ? (
              <article className="summary-card">
                <span>Wallet credit</span>
                <strong>{formatCurrency(booking.walletBalanceCents)}</strong>
                <p>Available credit on your account. Applied automatically to future bookings.</p>
              </article>
            ) : null}
          </div>
          {booking.balanceDueCents > 0 && booking.status === "confirmed" ? (
            <div style={{ marginTop: "1rem" }}>
              <Link href={`/cancel/${token}/payment`} className="store-button">
                Pay remaining balance
              </Link>
            </div>
          ) : null}
        </section>

        {booking.status === "confirmed" ? (
          <section className="store-section">
            <div className="section-header">
              <div>
                <p className="store-eyebrow">Reschedule</p>
                <h2>Change your appointment time</h2>
              </div>
            </div>
            <form action={rescheduleManageBookingAction} className="requirement-form">
              <input type="hidden" name="token" value={token} />
              <div className="requirement-copy-block">
                <strong>Pick a new date and time</strong>
                <p>Your current appointment is {formatInTenantTime(booking.startsAt, tenant.timezone)}. Choose a new time below.</p>
              </div>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <label className="requirement-form-field" style={{ flex: "1", minWidth: "180px" }}>
                  <span>New date</span>
                  <input type="date" name="date" required min={new Date().toISOString().slice(0, 10)} />
                </label>
                <label className="requirement-form-field" style={{ flex: "1", minWidth: "180px" }}>
                  <span>New time</span>
                  <input type="time" name="time" required />
                </label>
              </div>
              <label className="requirement-form-field">
                <span>Reason for rescheduling</span>
                <small>Optional note for the studio.</small>
                <textarea name="reason" maxLength={500} placeholder="Schedule conflict, need a different time, etc." />
              </label>
              <button type="submit" className="store-button">
                Reschedule appointment
              </button>
            </form>
          </section>
        ) : null}

        <section className="store-section">
          <div className="section-header">
            <div>
              <p className="store-eyebrow">Cancellation policy</p>
              <h2>{policyTitle}</h2>
            </div>
          </div>

          <div className="requirement-grid">
            <article className="requirement-card">
              <span>Deadline</span>
              <strong>{formatInTenantTime(cancellationDeadlineAt, tenant.timezone)}</strong>
              <p>{policyDetail}</p>
            </article>
            <article className="requirement-card">
              <span>Refund guidance</span>
              <strong>{refundInsideWindow ? "Studio may refund inside the window" : "Refunds stop inside the window"}</strong>
              <p>{`This tenant uses a ${cancellationWindowHours}-hour cancellation window.`}</p>
            </article>
            <article className="requirement-card">
              <span>Follow-up</span>
              <strong>{followUpTitle}</strong>
              <p>{followUpDetail}</p>
            </article>
          </div>
        </section>

        <section className="store-section">
          <div className="section-header">
            <div>
              <p className="store-eyebrow">Cancel appointment</p>
              <h2>{isCanceled ? "Cancellation complete" : cancellationActionTitle}</h2>
            </div>
          </div>

          {cancellationErrorMessage ? (
            <section className="status-banner" aria-live="polite">
              <strong>We could not cancel this appointment.</strong>
              <span>{cancellationErrorMessage}</span>
            </section>
          ) : null}

          {isCanceled ? (
            <section className="status-banner" aria-live="polite">
              <strong>{cancellationOutcomeTitle}</strong>
              <span>{cancellationOutcomeDetail}</span>
            </section>
          ) : booking.status === "confirmed" ? (
            <form action={cancelManageBookingAction} className="requirement-form">
              <input type="hidden" name="token" value={token} />
              <div className="requirement-copy-block">
                <strong>{cancellationActionTitle}</strong>
                <p>{cancellationActionDetail}</p>
              </div>
              <label className="requirement-form-field">
                <span>Reason for cancellation</span>
                <small>Optional note for the studio. This is recorded with the cancellation audit trail.</small>
                <textarea name="reason" maxLength={500} placeholder="Need another time, feeling unwell, travel conflict, and so on." />
              </label>
              <button type="submit" className="store-button">
                Cancel appointment
              </button>
            </form>
          ) : (
            <section className="status-banner" aria-live="polite">
              <strong>This appointment can no longer be changed online.</strong>
              <span>Contact the studio directly if you still need help with this visit.</span>
            </section>
          )}
        </section>

        <section className="support-panel">
          <div>
            <p className="store-eyebrow">Need another appointment?</p>
            <h3>Return to online booking.</h3>
          </div>
          <div className="hero-actions">
            <Link href={`/forms/${token}`} className="store-button">
              Complete forms
            </Link>
            <Link href={`/cancel/${token}/bookings`} className="ghost-link">
              View all bookings
            </Link>
            <Link href={`/${tenant.slug}/services/${slugify(booking.service.name)}`} className="ghost-link">
              Book with {tenant.name}
            </Link>
          </div>
        </section>
      </main>
    );
  } catch (error) {
    if (isNextNavigationSignal(error)) {
      throw error;
    }

    if (isApiNotFoundError(error)) {
      notFound();
    }

    const detail = isApiClientError(error) ? error.message : "The appointment link could not be loaded.";

    return (
      <main className="manage-page page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Manage booking unavailable</p>
          <h1>We could not load this appointment.</h1>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}
