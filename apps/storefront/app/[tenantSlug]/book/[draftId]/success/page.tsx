import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../../lib/storefront-api";
import { formatCurrency, formatInTenantTime, pathWithQuery, slugify, titleFromSlug } from "../../../../lib/storefront-shell";

type BookingSuccessPageProps = {
  params: Promise<{ tenantSlug: string; draftId: string }>;
  searchParams: Promise<{ bookingId?: string; sessionId?: string }>;
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

export default async function BookingSuccessPage({ params, searchParams }: BookingSuccessPageProps) {
  const [{ tenantSlug, draftId }, { bookingId, sessionId }] = await Promise.all([params, searchParams]);
  const successPath = (resolvedBookingId: string) => `/${tenantSlug}/book/${draftId}/success?bookingId=${resolvedBookingId}`;
  const redirectToConfirmedBooking = async () => {
    const booking = await storefrontApi.confirmBookingDraft(tenantSlug, draftId);
    redirect(successPath(booking.id));
  };

  try {
    if ((typeof bookingId !== "string" || bookingId.length === 0) && typeof sessionId === "string" && sessionId.length > 0) {
      const booking = await storefrontApi.completeCheckoutSession(tenantSlug, sessionId);
      redirect(successPath(booking.id));
    }

    const tenant = await storefrontApi.getTenantBySlug(tenantSlug);

    if (typeof bookingId === "string" && bookingId.length > 0) {
      let booking;
      try {
        booking = await storefrontApi.getBooking(tenantSlug, bookingId);
      } catch (error) {
        if (isApiNotFoundError(error)) {
          await redirectToConfirmedBooking();
        }
        throw error;
      }
      const paymentSummaryValue =
        booking.depositStatus === "not_required" ? "Not required" : formatCurrency(booking.service.depositCents);
      const paymentSummaryDetail =
        booking.depositStatus === "not_required"
          ? "No payment was required to confirm this appointment."
          : booking.depositStatus === "paid_in_full"
            ? "Paid in full and confirmed."
            : booking.depositStatus === "paid"
              ? "Deposit recorded today. Any remaining balance is handled with the studio."
              : booking.depositStatus === "refunded"
                ? "This deposit was later refunded."
                : booking.depositStatus === "forfeited"
                  ? "This deposit was retained under the studio cancellation policy."
                  : "Payment details stay attached to this appointment.";
      const manageLinkDetail =
        booking.intakePlan?.completionTiming === "before_visit"
          ? "Use this secure link to review the visit, cancel if needed, and keep any required pre-visit follow-up tied to the appointment."
          : "Use this secure link to review the visit or cancel if your plans change.";

      return (
        <main className="page-stack">
          <section className="state-panel state-panel--success">
            <p className="store-eyebrow">Booking confirmed</p>
            <h2>Your appointment is confirmed.</h2>
            <span className="panel-badge">{booking.status.replaceAll("_", " ")}</span>
          </section>

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
                <p>{booking.locationId ? "Location selected" : "Location to be confirmed"}</p>
              </article>
              <article className="summary-card">
                <span>Deposit</span>
                <strong>{paymentSummaryValue}</strong>
                <p>{paymentSummaryDetail}</p>
              </article>
            </div>
          </section>

          <section className="support-panel">
            <div>
              <p className="store-eyebrow">Need to update this visit?</p>
              <h3>Open your private appointment link.</h3>
              <p>{manageLinkDetail}</p>
            </div>
            <div className="hero-actions">
              <Link href={`/cancel/${booking.customerManageToken}`} className="store-button">
                Manage booking
              </Link>
              <Link href={`/${tenantSlug}/services/${slugify(booking.service.name)}`} className="ghost-link">
                Back to openings
              </Link>
            </div>
          </section>
        </main>
      );
    }

    const draft = await storefrontApi.getBookingDraft(tenantSlug, draftId);

    if ((draft.status as string) === "confirmed") {
      await redirectToConfirmedBooking();
    }

    return (
      <main className="page-stack">
        <section className="state-panel state-panel--success">
          <p className="store-eyebrow">Booking status</p>
          <h2>We are checking your appointment confirmation.</h2>
          <p>When the booking is confirmed, this page will show the final visit details and customer manage link.</p>
          <span className="panel-badge">{draft.status.replaceAll("_", " ")}</span>
        </section>

        <section className="store-section">
          <div className="section-header">
            <div>
              <p className="store-eyebrow">Visit details</p>
              <h2>{draft.service.name}</h2>
            </div>
            <span className="panel-badge">{formatCurrency(draft.priceCents)}</span>
          </div>

          <div className="summary-grid summary-grid--three">
            <article className="summary-card">
              <span>When</span>
              <strong>{formatInTenantTime(draft.startsAt, tenant.timezone)}</strong>
              <p>{tenant.timezone}</p>
            </article>
            <article className="summary-card">
              <span>Provider</span>
              <strong>{draft.provider.name}</strong>
              <p>{draft.locationId ? "Location selected" : "Location to be confirmed"}</p>
            </article>
            <article className="summary-card">
              <span>Deposit</span>
              <strong>{draft.depositCents > 0 ? formatCurrency(draft.depositCents) : "Not required"}</strong>
              <p>Attached to this booking draft.</p>
            </article>
          </div>
        </section>

        <section className="support-panel">
          <div>
            <p className="store-eyebrow">Need a different time?</p>
            <h3>Choose another opening for this service.</h3>
          </div>
          <Link href={`/${tenantSlug}/services/${slugify(draft.service.name)}`} className="ghost-link">
            Back to openings
          </Link>
        </section>
      </main>
    );
  } catch (error) {
    if (isNextNavigationSignal(error)) {
      throw error;
    }

    const shouldRecoverConfirmedBooking =
      ((typeof bookingId === "string" && bookingId.length > 0 && isApiNotFoundError(error)) ||
        ((typeof bookingId !== "string" || bookingId.length === 0) &&
          typeof sessionId !== "string" &&
          isApiClientError(error) &&
          error.status === 409 &&
          error.payload?.error.code === "conflict"));

    if (shouldRecoverConfirmedBooking) {
      try {
        await redirectToConfirmedBooking();
      } catch (recoveryError) {
        if (isNextNavigationSignal(recoveryError)) {
          throw recoveryError;
        }

        if (isApiNotFoundError(recoveryError)) {
          notFound();
        }
      }
    }

    if (isApiNotFoundError(error)) {
      notFound();
    }

    const isCheckoutPending =
      isApiClientError(error) &&
      error.status === 409 &&
      error.payload?.error.code === "conflict" &&
      error.message === CHECKOUT_PENDING_MESSAGE;
    const isCheckoutExpired =
      isApiClientError(error) &&
      error.status === 409 &&
      error.payload?.error.code === "conflict" &&
      error.message === CHECKOUT_EXPIRED_MESSAGE;

    if ((isCheckoutPending || isCheckoutExpired) && typeof sessionId === "string" && sessionId.length > 0) {
      try {
        const [tenant, draft] = await Promise.all([
          storefrontApi.getTenantBySlug(tenantSlug),
          storefrontApi.getBookingDraft(tenantSlug, draftId),
        ]);
        const retryHref = pathWithQuery(`/${tenantSlug}/book/${draftId}/success`, { sessionId });
        const paymentHref = pathWithQuery(`/${tenantSlug}/book/${draftId}/payment`, { sessionId });

        return (
          <main className="page-stack">
            <section className="state-panel state-panel--checkout">
              <p className="store-eyebrow">{isCheckoutPending ? "Returning from checkout" : "Checkout expired"}</p>
              <h2>{isCheckoutPending ? "We are finishing your appointment confirmation." : "This checkout session expired before confirmation."}</h2>
              <p>
                {isCheckoutPending
                  ? "If you just completed payment, the processor may still be reporting the final status. Check again in a moment and this page will load the confirmed visit details and private manage link."
                  : "The deposit step did not finish before the checkout session expired. Return to your booking review to open a fresh payment step if this time is still available."}
              </p>
              <span className="panel-badge">{isCheckoutPending ? "Waiting for confirmation" : "Payment step expired"}</span>
            </section>

            <section className="store-section">
              <div className="section-header">
                <div>
                  <p className="store-eyebrow">Visit details</p>
                  <h2>{draft.service.name}</h2>
                </div>
                <span className="panel-badge">{draft.status.replaceAll("_", " ")}</span>
              </div>

              <div className="status-banner">
                <strong>{isCheckoutPending ? "Current status" : "Next step"}</strong>
                <span>
                  {isCheckoutPending
                    ? "Your booking draft still shows awaiting payment while confirmation finishes. Use the check button below if you already completed the payment step."
                    : "Start payment again from the booking review page. If the hold has already released, choose another opening for this service."}
                </span>
              </div>

              <div className="summary-grid summary-grid--three">
                <article className="summary-card">
                  <span>When</span>
                  <strong>{formatInTenantTime(draft.startsAt, tenant.timezone)}</strong>
                  <p>{tenant.timezone}</p>
                </article>
                <article className="summary-card">
                  <span>Provider</span>
                  <strong>{draft.provider.name}</strong>
                  <p>{draft.locationId ? "Location selected" : "Location to be confirmed"}</p>
                </article>
                <article className="summary-card">
                  <span>Deposit</span>
                  <strong>{draft.depositCents > 0 ? formatCurrency(draft.depositCents) : "Not required"}</strong>
                  <p>{isCheckoutPending ? "Attached to the checkout return still being confirmed." : "A new payment step is required to confirm this appointment."}</p>
                </article>
              </div>
            </section>

            <section className="support-panel">
              <div>
                <p className="store-eyebrow">Return actions</p>
                <h3>{isCheckoutPending ? "Check the confirmation again." : "Reopen payment or choose another time."}</h3>
              </div>
              <div className="hero-actions">
                {isCheckoutPending ? (
                  <Link href={retryHref} className="store-button">
                    Check confirmation again
                  </Link>
                ) : (
                  <Link href={`/${tenantSlug}/book/${draftId}`} className="store-button">
                    Return to booking review
                  </Link>
                )}
                <Link href={isCheckoutPending ? paymentHref : `/${tenantSlug}/services/${slugify(draft.service.name)}`} className="ghost-link">
                  {isCheckoutPending ? "Back to payment step" : "Choose another time"}
                </Link>
              </div>
            </section>
          </main>
        );
      } catch (recoveryError) {
        if (isApiNotFoundError(recoveryError)) {
          notFound();
        }
      }
    }

    const tenantName = titleFromSlug(tenantSlug);
    const detail = isApiClientError(error) ? error.message : "The confirmation state could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Confirmation unavailable</p>
          <h2>{tenantName}</h2>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}
