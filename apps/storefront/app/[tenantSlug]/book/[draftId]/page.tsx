import { BookingSteps } from "../../../components/booking-steps";
import { notFound } from "next/navigation";

import type { FormAnswers, FormField, FormRequirement } from "@booking/shared-types";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../lib/storefront-api";
import {
  financingMonthlyCents,
  formatCurrency,
  formatDuration,
  formatExpiryWindow,
  formatInTenantTime,
  titleFromSlug,
} from "../../../lib/storefront-shell";
import {
  confirmBookingDraftAction,
  saveBookingRequirementDraftAction,
  startDepositCheckoutAction,
  submitBookingRequirementAction,
} from "./actions";
import ContactDetailsForm from "./contact-details-form";
import DateFieldInput from "./date-field-input";
import DeferrableFormCard from "./deferrable-form-card";
import HoldCountdown from "./hold-countdown";
import { PaymentChoice } from "./payment-choice";
import { PendingSubmitButton } from "./pending-submit-button";
import ProgressSteps from "./progress-steps";
import SignatureField from "./signature-field";

type BookingDraftPageProps = {
  params: Promise<{ tenantSlug: string; draftId: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export const dynamic = "force-dynamic";

function formatTimingLabel(timing: string | null | undefined): string {
  switch (timing) {
    case "pre_booking":
      return "Required to confirm";
    case "pre_visit":
      return "Complete before appointment";
    case "post_visit":
      return "Complete after appointment";
    default:
      return timing?.replaceAll("_", " ") ?? "Required";
  }
}

function stringDefaultValue(defaultValue: unknown): string | undefined {
  if (defaultValue === undefined || defaultValue === null || Array.isArray(defaultValue) || typeof defaultValue === "object") {
    return undefined;
  }
  return String(defaultValue);
}

function selectedDefaultValues(defaultValue: unknown): string[] {
  return Array.isArray(defaultValue) ? defaultValue.map(String) : [];
}

function renderRequirementField(field: FormField, defaultValue?: unknown) {
  const defaultText = stringDefaultValue(defaultValue);

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
    const selectedValue = defaultValue === true || defaultText === "true" ? "true" : defaultValue === false || defaultText === "false" ? "false" : undefined;
    return (
      <fieldset key={field.id} className="requirement-choice-fieldset">
        <legend>
          {field.label}
          {field.required ? " *" : ""}
        </legend>
        {field.helpText ? <small>{field.helpText}</small> : null}
        <div className="requirement-choice-row">
          <label className="requirement-choice-option">
            <input type="radio" name={field.id} value="true" required={field.required} defaultChecked={selectedValue === "true"} />
            <span>Yes</span>
          </label>
          <label className="requirement-choice-option">
            <input type="radio" name={field.id} value="false" required={field.required} defaultChecked={selectedValue === "false"} />
            <span>No</span>
          </label>
        </div>
      </fieldset>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label key={field.id} className="requirement-checkbox-field">
        <input type="checkbox" name={field.id} required={field.required} defaultChecked={defaultValue === true || defaultText === "true"} />
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
        <textarea name={field.id} rows={4} placeholder={field.placeholder} required={field.required} defaultValue={defaultText} />
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
        <input name={field.id} type="file" accept="image/*" required={field.required} />
      </label>
    );
  }

  if (field.type === "signature") {
    return (
      <SignatureField
        key={field.id}
        name={field.id}
        label={field.label}
        required={field.required}
        helpText={field.helpText}
      />
    );
  }

  if (field.type === "date") {
    return (
      <label key={field.id} className="requirement-form-field">
        <span>
          {field.label}
          {field.required ? " *" : ""}
        </span>
        {field.helpText ? <small>{field.helpText}</small> : null}
        <DateFieldInput name={field.id} required={field.required} defaultValue={defaultText} />
      </label>
    );
  }

  if (field.type === "number") {
    return (
      <label key={field.id} className="requirement-form-field">
        <span>
          {field.label}
          {field.required ? " *" : ""}
        </span>
        {field.helpText ? <small>{field.helpText}</small> : null}
        <input name={field.id} type="number" required={field.required} defaultValue={defaultText} />
      </label>
    );
  }

  if (field.type === "select" || field.type === "multi_select") {
    const selectedValues = selectedDefaultValues(defaultValue);
    return (
      <label key={field.id} className="requirement-form-field">
        <span>
          {field.label}
          {field.required ? " *" : ""}
        </span>
        {field.helpText ? <small>{field.helpText}</small> : null}
        <select
          name={field.id}
          required={field.required}
          multiple={field.type === "multi_select"}
          defaultValue={field.type === "multi_select" ? selectedValues : defaultText ?? ""}
        >
          {field.type === "select" ? (
            <option value="" disabled>
              Choose an option
            </option>
          ) : null}
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
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
      <input name={field.id} type="text" placeholder={field.placeholder} required={field.required} defaultValue={defaultText} />
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
  const timingLabel = formatTimingLabel(requirement.customerPromptTiming);
  const title = requirement.formTitle?.trim() ? requirement.formTitle : "Required form";
  const description = requirement.formDescription?.trim() ? requirement.formDescription : null;
  const draftAnswers = requirement.draftAnswers as FormAnswers | null | undefined;

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

      {description ? <p className="requirement-form-description">{description}</p> : null}

      <form action={submitBookingRequirementAction} className="requirement-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="bookingDraftId" value={bookingDraftId} />
        <input type="hidden" name="requirementId" value={requirement.id} />
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="schemaJson" value={JSON.stringify(requirement.schema)} />

        {requirement.schema.fields.map((field) => renderRequirementField(field, draftAnswers?.[field.id]))}

        <div className="requirement-form-actions">
          {requirement.customerPromptTiming !== "pre_booking" ? (
            <button type="submit" className="ghost-link" formAction={saveBookingRequirementDraftAction} formNoValidate>
              Save draft
            </button>
          ) : null}
          <button type="submit" className="store-button">
            Submit form
          </button>
        </div>
      </form>
    </section>
  );
}

export default async function BookingDraftPage({ params, searchParams }: BookingDraftPageProps) {
  const [{ tenantSlug, draftId }, { saved }] = await Promise.all([params, searchParams]);

  try {
    const [tenant, draft] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.getBookingDraft(tenantSlug, draftId),
    ]);
    const activeState = draft.status;
    const pendingRequirements = draft.formRequirements.filter((requirement) => requirement.status === "pending");
    const blockingRequirements = pendingRequirements.filter(
      (r) => r.customerPromptTiming === "pre_booking",
    );
    const deferrableRequirements = pendingRequirements.filter(
      (r) => r.customerPromptTiming !== "pre_booking",
    );
    const needsContactDetails = draft.customer == null;
    const deferredIntakeSelected = draft.intakePlan?.completionTiming === "before_visit";
    const hasBlockingForms = blockingRequirements.length > 0;
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
      ? "Fill in your details to continue"
      : hasBlockingForms
        ? blockingRequirements.length > 1
          ? "Complete the required forms to continue"
          : "Complete the required form to continue"
        : draft.depositCents > 0
          ? draft.status === "awaiting_payment"
            ? "Resume payment"
            : "Continue to payment"
          : "Confirm booking";
    const paymentPendingLabel = draft.status === "awaiting_payment" ? "Reopening checkout..." : "Opening secure checkout...";
    const bookingAd = tenant.branding.bookingAd;
    const bookingAdImageUrl = bookingAd?.imageUrl ?? "/manage-hero.png";
    const bookingAdImageAlt = bookingAd?.imageAltText ?? `${tenant.name} booking highlight`;
    const bookingAdHeadline = bookingAd?.reviewHeadline ?? null;
    const bookingAdBody = bookingAd?.reviewBody ?? null;
    const holdStatusLabel = `${formatExpiryWindow(draft.expiresAt)} remaining`;

    const money = (cents: number) => formatCurrency(cents, tenant.settings.currency);
    const location = draft.locationId
      ? (await storefrontApi.listLocations(tenantSlug)).locations.find((l) => l.id === draft.locationId)
      : undefined;
    const visitTotalCents = draft.fullAmountCents ?? draft.priceCents + (draft.addOnsTotalCents ?? 0);
    const remainingCents = Math.max(0, visitTotalCents - draft.depositCents);
    const cancellationHours = tenant.settings.cancellationWindowHours;
    const completedRequirements = draft.formRequirements.filter((r) => r.status !== "pending");
    const [firstName, ...restName] = (draft.customer?.name ?? "").split(" ");
    const whenLabel = formatInTenantTime(draft.startsAt, tenant.timezone, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });

    const requiredForms = draft.formRequirements.filter((r) => r.customerPromptTiming === "pre_booking");
    const otherForms = draft.formRequirements.filter((r) => r.customerPromptTiming !== "pre_booking");
    const lockedFormRow = (id: string, title: string, hint: string) => (
      <div key={id} className="sf-formrow sf-formrow--locked">
        <span className="sf-formrow__icon sf-formrow__icon--peach" aria-hidden="true">▤</span>
        <span className="sf-formrow__text">
          <strong>{title}</strong>
          <small>{hint}</small>
        </span>
        <span className="sf-formrow__cta sf-formrow__cta--locked">Fill in your details first</span>
      </div>
    );
    const completedFormRow = (id: string, title: string, status: string) => (
      <div key={id} className="sf-formrow">
        <span className="sf-formrow__icon" aria-hidden="true">✓</span>
        <span className="sf-formrow__text">
          <strong>{title}</strong>
          <small>{status.replaceAll("_", " ")}</small>
        </span>
      </div>
    );

    const summaryCta = canConfirmWithoutPayment ? (
      <form action={confirmBookingDraftAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="bookingDraftId" value={draft.id} />
        <button type="submit" className="sf-btn sf-btn--dark sf-summary__cta">{paymentCtaLabel}</button>
      </form>
    ) : canStartDepositCheckout ? (
      <form action={startDepositCheckoutAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="bookingDraftId" value={draft.id} />
        <PendingSubmitButton
          label={`${paymentCtaLabel} · ${money(draft.depositCents)}`}
          pendingLabel={paymentPendingLabel}
          className="sf-btn sf-btn--dark sf-summary__cta"
        />
      </form>
    ) : (
      <button type="button" className="sf-btn sf-btn--dark sf-summary__cta" disabled>
        {paymentCtaLabel}
      </button>
    );

    const summaryRows = (
      <>
        <div><dt>When</dt><dd>{whenLabel}</dd></div>
        <div><dt>With</dt><dd>{draft.provider.name}</dd></div>
        {location ? <div><dt>Where</dt><dd>{location.addressLine1 ?? location.name}</dd></div> : null}
        {(draft.addOns ?? []).map((item, index) => (
          <div key={`${item.addOnId ?? item.name}-${index}`}>
            <dt>+ {item.name}</dt>
            <dd>{money(item.priceCents)}</dd>
          </div>
        ))}
      </>
    );
    const summaryNote = `${cancellationHours ? `Free cancellation up to ${cancellationHours} hours before. ` : ""}${
      draft.depositCents > 0 && remainingCents > 0 ? `The remaining ${money(remainingCents)} is paid at the studio.` : ""
    }`;
    // Financing is offered next to a deposit: the client picks one way to pay for the visit.
    const serviceFinancing = draft.service.effectiveFinancing;
    const financingMonthly = serviceFinancing ? financingMonthlyCents(visitTotalCents, serviceFinancing.months) : 0;
    const financingOffer =
      serviceFinancing && draft.depositCents > 0 && financingMonthly > 0
        ? {
            linkUrl: serviceFinancing.linkUrl,
            buttonText: serviceFinancing.buttonText,
            termsUrl: serviceFinancing.termsUrl ?? null,
            aprLabel: serviceFinancing.aprLabel ?? null,
            disclosure: serviceFinancing.disclosure ?? null,
            months: serviceFinancing.months,
            monthlyLabel: money(financingMonthly),
            totalLabel: money(visitTotalCents),
          }
        : null;

    return (
      <main className="sf-flow">
        <BookingSteps current={4} />
        <div className="sf-flow__grid sf-flow__grid--aside">
          <div className="sf-details">
            <header className="sf-head sf-head--stack">
              <div>
                <p className="sf-eyebrow">Step 4</p>
                <h1 className="sf-title sf-title--page">A few details</h1>
              </div>
            </header>

            <section className="sf-card sf-details__card" aria-labelledby="contact-title">
              <h2 id="contact-title" className="sf-card__title">Your contact details</h2>
              <ContactDetailsForm
                tenantSlug={tenantSlug}
                bookingDraftId={draft.id}
                initial={
                  draft.customer
                    ? {
                        firstName,
                        lastName: restName.join(" "),
                        email: draft.customer.email ?? "",
                        phone: draft.customer.phone ?? "",
                        smsConsent: Boolean(draft.customer.smsConsent),
                      }
                    : null
                }
              />
            </section>

            {draft.formRequirements.length > 0 ? (
              <>
                {requiredForms.length > 0 ? (
                  <section className="sf-card sf-details__card" aria-labelledby="forms-title">
                    <div className="sf-details__cardhead">
                      <h2 id="forms-title" className="sf-card__title">Required before booking</h2>
                      {blockingRequirements.length > 0 ? (
                        <span className="sf-tag sf-tag--peach">{blockingRequirements.length} required</span>
                      ) : (
                        <span className="sf-tag sf-tag--sage">Complete</span>
                      )}
                    </div>
                    <div className="requirement-stack">
                      {requiredForms.map((requirement) => {
                        const title = requirement.formTitle?.trim() || "Required form";
                        if (requirement.status !== "pending") return completedFormRow(requirement.id, title, requirement.status);
                        if (needsContactDetails) return lockedFormRow(requirement.id, title, "Must be completed before payment");
                        const fieldCount = (requirement.schema?.fields ?? []).filter(
                          (f) => f.type !== "section" && f.type !== "static_text",
                        ).length;
                        const minutes = Math.max(1, Math.ceil(fieldCount / 2));
                        return (
                          <details key={requirement.id} className="sf-formitem">
                            <summary className="sf-formrow sf-formrow--action">
                              <span className="sf-formrow__icon sf-formrow__icon--peach" aria-hidden="true">▤</span>
                              <span className="sf-formrow__text">
                                <strong>{title}</strong>
                                <small>About {minutes} {minutes === 1 ? "minute" : "minutes"} · must be completed before payment</small>
                              </span>
                              <span className="sf-formrow__cta sf-formrow__cta--start">Start form</span>
                              <span className="sf-formrow__cta sf-formrow__cta--close">Close</span>
                            </summary>
                            <div className="sf-formitem__body">
                              {renderRequirementPanel(requirement, tenantSlug, draft.id, false, tenant.id)}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {otherForms.length > 0 ? (
                  <section className="sf-card sf-details__card" aria-labelledby="other-forms-title">
                    <div className="sf-details__cardhead">
                      <h2 id="other-forms-title" className="sf-card__title">Other forms</h2>
                      {deferrableRequirements.length > 0 ? (
                        <span className="sf-tag">{deferrableRequirements.length} optional now</span>
                      ) : (
                        <span className="sf-tag sf-tag--sage">Complete</span>
                      )}
                    </div>
                    <p className="sf-help">You can fill these in now or later. We&rsquo;ll remind you before your appointment.</p>
                    {saved === "1" ? (
                      <p className="sf-note" role="status">
                        Draft saved. You can come back and finish this form before your appointment.
                      </p>
                    ) : null}
                    <div className="requirement-stack">
                      {otherForms.map((requirement) => {
                        const title = requirement.formTitle?.trim() || "Form";
                        if (requirement.status !== "pending") return completedFormRow(requirement.id, title, requirement.status);
                        if (needsContactDetails) return lockedFormRow(requirement.id, title, "Complete now or before your appointment");
                        return (
                          <DeferrableFormCard
                            key={requirement.id}
                            requirement={requirement}
                            tenantSlug={tenantSlug}
                            bookingDraftId={draft.id}
                            tenantId={tenant.id}
                          />
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </>
            ) : !needsContactDetails ? (
              <section className="sf-card sf-details__card">
                <h2 className="sf-card__title">Forms</h2>
                <p className="sf-help">
                  {draft.intakePlan && deferredIntakeSelected
                    ? `No forms are required to book. We'll remind you ${draft.intakePlan.reminderHoursBefore} hours before the appointment.`
                    : "No forms are required for this service."}
                </p>
              </section>
            ) : null}
          </div>

          <aside className="sf-card sf-summary" aria-label="Booking summary">
            <div className="sf-summary__hold">
              <span>We&rsquo;re holding this time</span>
              <HoldCountdown expiresAt={draft.expiresAt} />
            </div>

            <div className="sf-summary__service">
              <span className="sf-summary__initial" aria-hidden="true">{draft.service.name.slice(0, 1)}</span>
              <span>
                <strong>{draft.service.name}</strong>
                <small>{money(draft.priceCents)} · {formatDuration(draft.durationMinutes)}</small>
              </span>
            </div>

            {financingOffer ? (
              <PaymentChoice
                staticRows={summaryRows}
                dueLabel="Deposit due today"
                dueAmount={money(draft.depositCents)}
                depositTitle={`Pay ${money(draft.depositCents)} deposit today`}
                depositDetail={remainingCents > 0 ? `${money(remainingCents)} balance paid at the studio` : "Nothing more to pay at the studio"}
                financing={financingOffer}
                depositCta={summaryCta}
                canStartFinancing={canStartDepositCheckout}
                disabledLabel={paymentCtaLabel}
                note={summaryNote}
              />
            ) : (
              <>
                <dl className="sf-summary__rows">
                  {summaryRows}
                  <div>
                    <dt>{draft.depositCents > 0 ? "Deposit due today" : "Due today"}</dt>
                    <dd>{money(draft.depositCents)}</dd>
                  </div>
                </dl>

                {summaryCta}

                <p className="sf-summary__note">{summaryNote}</p>
              </>
            )}
          </aside>
        </div>
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
