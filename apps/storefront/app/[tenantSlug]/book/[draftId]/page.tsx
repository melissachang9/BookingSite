import Link from "next/link";
import { notFound } from "next/navigation";

import type { FormField, FormRequirement } from "@booking/shared-types";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../lib/storefront-api";
import {
  bookingJourney,
  formatCurrency,
  formatDuration,
  formatExpiryWindow,
  formatInTenantTime,
  slugify,
  titleFromSlug,
} from "../../../lib/storefront-shell";
import {
  confirmBookingDraftAction,
  saveContactDetailsAction,
  startDepositCheckoutAction,
  submitBookingRequirementAction,
} from "./actions";
import { PendingSubmitButton } from "./pending-submit-button";

type BookingDraftPageProps = {
  params: Promise<{ tenantSlug: string; draftId: string }>;
};

export const dynamic = "force-dynamic";

function renderRequirementField(field: FormField) {
  if (field.type === "section") {
    return (
      <div key={field.id} className="requirement-copy-block">
        <strong>{field.label}</strong>
        {field.content ? <p>{field.content}</p> : null}
      </div>
    );
  }

  if (field.type === "static_text") {
    return (
      <div key={field.id} className="requirement-copy-block">
        <p>{field.content ?? field.label}</p>
      </div>
    );
  }

  if (field.type === "yes_no") {
    return (
      <fieldset key={field.id} className="requirement-choice-fieldset">
        <legend>
          {field.label}
          {field.required ? " *" : ""}
        </legend>
        {field.helpText ? <small>{field.helpText}</small> : null}
        <div className="requirement-choice-row">
          <label className="requirement-choice-option">
            <input type="radio" name={field.id} value="true" required={field.required} />
            <span>Yes</span>
          </label>
          <label className="requirement-choice-option">
            <input type="radio" name={field.id} value="false" required={field.required} />
            <span>No</span>
          </label>
        </div>
      </fieldset>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label key={field.id} className="requirement-checkbox-field">
        <input type="checkbox" name={field.id} required={field.required} />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === "long_text") {
    return (
      <label key={field.id} className="requirement-form-field">
        <span>
          {field.label}
          {field.required ? " *" : ""}
        </span>
        {field.helpText ? <small>{field.helpText}</small> : null}
        <textarea name={field.id} rows={4} placeholder={field.placeholder} required={field.required} />
      </label>
    );
  }
  if (field.type === "file_upload") {
    return (
      <label key={field.id} className="requirement-form-field">
        <span>
          {field.label}
          {field.required ? " *" : ""}
        </span>
        {field.helpText ? <small>{field.helpText}</small> : null}
        <input name={field.id} type="file" required={field.required} />
      </label>
    );
  }
  return (
    <label key={field.id} className="requirement-form-field">
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {field.helpText ? <small>{field.helpText}</small> : null}
      <input name={field.id} type="text" placeholder={field.placeholder} required={field.required} />
    </label>
  );
}

function renderRequirementPanel(
  requirement: FormRequirement,
  tenantSlug: string,
  bookingDraftId: string,
  lockedUntilContactDetails: boolean,
  tenantId: string,
) {
  const timingLabel = requirement.customerPromptTiming?.replaceAll("_", " ") ?? requirement.scope;
  const title = requirement.formTitle ?? `Required form ${requirement.formVersionId}`;
  const description = requirement.formDescription ?? `Version ${requirement.formVersionId}`;

  if (requirement.status !== "pending" || lockedUntilContactDetails || !requirement.schema) {
    return (
      <article key={requirement.id} className="requirement-card">
        <span>{timingLabel}</span>
        <strong>{title}</strong>
        <p>
          {lockedUntilContactDetails && requirement.status === "pending"
            ? "Add contact details before completing this form."
            : requirement.status.replaceAll("_", " ")}
        </p>
      </article>
    );
  }

  return (
    <section key={requirement.id} className="requirement-form-card">
      <div className="section-header">
        <div>
          <p className="store-eyebrow">{timingLabel}</p>
          <h3>{title}</h3>
        </div>
        <span className="panel-badge">Pending</span>
      </div>

      <p className="requirement-form-description">{description}</p>

      <form action={submitBookingRequirementAction} className="requirement-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="bookingDraftId" value={bookingDraftId} />
        <input type="hidden" name="requirementId" value={requirement.id} />
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="schemaJson" value={JSON.stringify(requirement.schema)} />

        {requirement.schema.fields.map((field) => renderRequirementField(field))}

        <button type="submit" className="store-button">
          Submit form
        </button>
      </form>
    </section>
  );
}

export default async function BookingDraftPage({ params }: BookingDraftPageProps) {
  const { tenantSlug, draftId } = await params;

  try {
    const [tenant, draft] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.getBookingDraft(tenantSlug, draftId),
    ]);
    const activeState = draft.status;
    const pendingRequirements = draft.formRequirements.filter((requirement) => requirement.status === "pending");
    const needsContactDetails = draft.customer == null;
    const deferredIntakeSelected = draft.intakePlan?.completionTiming === "before_visit";
    const hasBlockingForms = pendingRequirements.length > 0;
    const canConfirmWithoutPayment = !needsContactDetails && !hasBlockingForms && draft.depositCents === 0;
    const canStartDepositCheckout = !needsContactDetails && !hasBlockingForms && draft.depositCents > 0;
    const paymentHandoffTitle = draft.status === "awaiting_payment" ? "Ready to resume" : "Next step";
    const paymentHandoffDetail =
      draft.depositCents > 0
        ? draft.status === "awaiting_payment"
          ? "Your deposit checkout is already open. Finish that payment step to confirm the visit."
          : "The next step opens checkout for this deposit. If secure online payment is enabled, you will be redirected there and brought back automatically."
        : null;
    const paymentCtaLabel = needsContactDetails
      ? "Add contact details first"
      : hasBlockingForms
        ? "Complete forms first"
        : draft.depositCents > 0
          ? draft.status === "awaiting_payment"
            ? "Resume payment"
            : "Continue to payment"
          : "Confirm booking";
    const paymentPendingLabel = draft.status === "awaiting_payment" ? "Reopening checkout..." : "Opening secure checkout...";
    const bookingAd = tenant.branding.bookingAd;
    const bookingAdImageUrl = bookingAd?.imageUrl ?? "/manage-hero.png";
    const bookingAdImageAlt = bookingAd?.imageAltText ?? `${tenant.name} booking highlight`;
    const bookingAdHeadline = bookingAd?.headline ?? "Booking held while you review";
    const bookingAdBody =
      bookingAd?.body ?? "Businesses can configure this artwork and message for the booking review step.";
    const holdStatusLabel = `${formatExpiryWindow(draft.expiresAt)} remaining`;

    return (
      <main className="page-stack">
        <section className="store-section visit-review-panel">
          <div className="visit-review-panel__header">
            <div className="visit-review-panel__copy">
              <p className="store-eyebrow">Selected visit</p>
              <h1>{draft.service.name}</h1>
            </div>
            <div className="visit-review-panel__status">
              <span className="panel-badge panel-badge--visit">Slot held</span>
              <p>{holdStatusLabel}</p>
            </div>
          </div>

          <div className="summary-grid summary-grid--visit">
            <article className="summary-card summary-card--visit">
              <span>Provider</span>
              <strong>{draft.provider.name}</strong>
              <p>{formatDuration(draft.durationMinutes)}</p>
            </article>
            <article className="summary-card summary-card--visit">
              <span>When</span>
              <strong>{formatInTenantTime(draft.startsAt, tenant.timezone)}</strong>
              <p>{tenant.timezone}</p>
            </article>
            <article className="summary-card summary-card--visit">
              <span>Payment</span>
              <strong>{draft.depositCents > 0 ? `${formatCurrency(draft.depositCents)} deposit` : "No deposit"}</strong>
              <p>Total service value {formatCurrency(draft.priceCents)}</p>
            </article>
            <article className="summary-card summary-card--visit">
              <span>Contact</span>
              <strong>{draft.customer?.name ?? "Contact details needed"}</strong>
              <p>{draft.customer?.email ?? "Email will be attached to this appointment."}</p>
            </article>
          </div>
        </section>

        <section className="checkout-layout">
          <div className="checkout-main">
            {needsContactDetails ? (
              <section className="store-section contact-details-panel">
                <div className="section-header">
                  <div>
                    <p className="store-eyebrow">Required details</p>
                    <h2>Add your contact details</h2>
                  </div>
                  <span className="panel-badge">Required</span>
                </div>

                <form action={saveContactDetailsAction} className="contact-details-form">
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="bookingDraftId" value={draft.id} />

                  <label>
                    <span>Full name</span>
                    <input name="name" type="text" autoComplete="name" required />
                  </label>
                  <label>
                    <span>Email</span>
                    <input name="email" type="email" autoComplete="email" required />
                  </label>
                  <label>
                    <span>Phone number</span>
                    <input name="phone" type="tel" autoComplete="tel" required />
                  </label>

                  <fieldset className="intake-timing-fieldset">
                    <legend>Intake forms</legend>
                    <label className="intake-timing-option">
                      <input type="radio" name="intakeCompletionTiming" value="before_booking" required />
                      <span>
                        <strong>Complete before booking</strong>
                        <small>Finish required intake before moving to payment.</small>
                      </span>
                    </label>
                    <label className="intake-timing-option">
                      <input type="radio" name="intakeCompletionTiming" value="before_visit" defaultChecked required />
                      <span>
                        <strong>Complete later</strong>
                        <small>Email and text reminders will be scheduled before the appointment.</small>
                      </span>
                    </label>
                  </fieldset>

                  <button type="submit" className="store-button contact-details-submit">
                    Save contact details
                  </button>
                </form>
              </section>
            ) : null}

            <section className="store-section">
              <div className="section-header">
                <div>
                  <p className="store-eyebrow">Required intake</p>
                  <h2>Forms and consent</h2>
                </div>
                <span className="panel-badge">{pendingRequirements.length} pending</span>
              </div>

              {draft.formRequirements.length > 0 ? (
                <div className="requirement-stack">
                  {draft.formRequirements.map((requirement) =>
                    renderRequirementPanel(requirement, tenantSlug, draft.id, needsContactDetails, tenant.id),
                  )}
                </div>
              ) : (
                <div className="empty-panel empty-panel--compact">
                  <strong>No intake forms are required for this service.</strong>
                  <span>
                    {draft.intakePlan
                      ? deferredIntakeSelected
                        ? `Reminder email and text scheduled ${draft.intakePlan.reminderHoursBefore} hours before the appointment.`
                        : "Intake is marked to complete before booking."
                      : "You can choose when to complete intake after adding contact details."}
                  </span>
                </div>
              )}
            </section>
          </div>

          <aside className="checkout-rail">
            <section className="booking-ad-panel booking-ad-panel--checkout" aria-label="Studio booking highlight">
              <img src={bookingAdImageUrl} alt={bookingAdImageAlt} />
              <div>
                <p className="store-eyebrow">Studio highlight</p>
                <strong>{bookingAdHeadline}</strong>
                <p>{bookingAdBody}</p>
              </div>
            </section>

            <section className="payment-card">
              <p className="store-eyebrow">Due now</p>
              <strong>{draft.depositCents > 0 ? formatCurrency(draft.depositCents) : "$0"}</strong>
              <span>{draft.depositCents > 0 ? "Deposit required to confirm" : "No payment required to confirm"}</span>
              {paymentHandoffDetail ? (
                <div className="payment-handoff-note">
                  <strong>{paymentHandoffTitle}</strong>
                  <p>{paymentHandoffDetail}</p>
                </div>
              ) : null}
              {canConfirmWithoutPayment ? (
                <form action={confirmBookingDraftAction}>
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="bookingDraftId" value={draft.id} />
                  <button type="submit">{paymentCtaLabel}</button>
                </form>
              ) : canStartDepositCheckout ? (
                <form action={startDepositCheckoutAction}>
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="bookingDraftId" value={draft.id} />
                  <PendingSubmitButton label={paymentCtaLabel} pendingLabel={paymentPendingLabel} />
                </form>
              ) : (
                <button type="button" disabled>
                  {paymentCtaLabel}
                </button>
              )}
            </section>

            <section className="stepper-card" aria-label="Booking progress">
              {bookingJourney.map((step, index) => (
                <article key={step.state} className={step.state === activeState ? "stepper-item stepper-item--active" : "stepper-item"}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <p>{step.detail}</p>
                  </div>
                </article>
              ))}
            </section>

            <Link href={`/${tenantSlug}/services/${slugify(draft.service.name)}`} className="ghost-link">
              Choose another time
            </Link>
          </aside>
        </section>
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const tenantName = titleFromSlug(tenantSlug);
    const detail = isApiClientError(error) ? error.message : "The booking draft could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Booking unavailable</p>
          <h2>{tenantName}</h2>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}
