import Link from "next/link";
import { notFound } from "next/navigation";

import type { BookingFormRequirementSummary, FormField } from "@booking/shared-types";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../lib/storefront-api";
import { formatInTenantTime, slugify } from "../../lib/storefront-shell";
import { submitManageBookingFormRequirementAction } from "./actions";

type FormCompletionRouteProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ submitted?: string }>;
};

export const dynamic = "force-dynamic";

const isNextNavigationSignal = (error: unknown): error is { digest: string } =>
  typeof error === "object" &&
  error !== null &&
  "digest" in error &&
  typeof error.digest === "string" &&
  (error.digest.startsWith("NEXT_REDIRECT") || error.digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));

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

  if (field.type === "select" && Array.isArray(field.options) && field.options.length > 0) {
    return (
      <label key={field.id} className="requirement-form-field">
        <span>
          {field.label}
          {field.required ? " *" : ""}
        </span>
        {field.helpText ? <small>{field.helpText}</small> : null}
        <select name={field.id} required={field.required} defaultValue="">
          <option value="" disabled>
            Choose an option
          </option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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
        <input name={field.id} type="date" required={field.required} />
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
        <input name={field.id} type="number" placeholder={field.placeholder} required={field.required} />
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

function renderRequirementPanel(token: string, requirement: BookingFormRequirementSummary) {
  const timingLabel = requirement.customerPromptTiming?.replaceAll("_", " ") ?? requirement.scope;
  const title = requirement.formName;
  const description = requirement.formDescription ?? null;

  if (!requirement.schema) {
    return (
      <article key={requirement.id} className="requirement-card">
        <span>{timingLabel}</span>
        <strong>{title}</strong>
        <p>This form is not ready to fill out yet. Please contact the studio if you need help.</p>
      </article>
    );
  }

  return (
    <article key={requirement.id} className="requirement-card">
      <span>{timingLabel}</span>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      <form action={submitManageBookingFormRequirementAction} className="requirement-form">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="requirementId" value={requirement.id} />
        <input type="hidden" name="schemaJson" value={JSON.stringify(requirement.schema)} />
        {requirement.schema.fields.map((field) => renderRequirementField(field))}
        <button type="submit" className="store-button">
          Submit form
        </button>
      </form>
    </article>
  );
}

export default async function ManageBookingFormsPage({ params, searchParams }: FormCompletionRouteProps) {
  const [{ token }, { submitted }] = await Promise.all([params, searchParams]);

  try {
    const [manageBooking, requirements] = await Promise.all([
      storefrontApi.getManageBooking(token),
      storefrontApi.listManageBookingFormRequirements(token),
    ]);

    const { booking, tenant } = manageBooking;
    const pendingRequirements = requirements.filter((requirement) => requirement.status === "pending");
    const hasPending = pendingRequirements.length > 0;

    return (
      <main className="manage-page page-stack">
        <section className="state-panel state-panel--manage">
          <p className="store-eyebrow">Pre-visit forms</p>
          <h1>{hasPending ? "Complete your forms for this visit." : "All forms are complete."}</h1>
          <p>
            {hasPending
              ? "Submit any required forms below. Your responses are attached to your customer profile and this appointment."
              : "Thanks for completing your forms. There is nothing else to do here before your visit."}
          </p>
          <span className="panel-badge">{booking.status.replaceAll("_", " ")}</span>
        </section>

        {submitted === "1" ? (
          <section className="status-banner" aria-live="polite">
            <strong>Form submitted.</strong>
            <span>Your response is saved to this appointment and your customer profile.</span>
          </section>
        ) : null}

        <section className="store-section">
          <div className="section-header">
            <div>
              <p className="store-eyebrow">Visit details</p>
              <h2>{booking.service.name}</h2>
            </div>
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
              <span>Forms</span>
              <strong>
                {hasPending
                  ? `${pendingRequirements.length} pending`
                  : "All complete"}
              </strong>
              <p>
                {hasPending
                  ? "Submit the forms below before your visit."
                  : "No more forms to fill out before your visit."}
              </p>
            </article>
          </div>
        </section>

        {hasPending ? (
          <section className="store-section">
            <div className="section-header">
              <div>
                <p className="store-eyebrow">Forms to complete</p>
                <h2>Required information</h2>
              </div>
            </div>
            <div className="requirement-grid">
              {pendingRequirements.map((requirement) => renderRequirementPanel(token, requirement))}
            </div>
          </section>
        ) : null}

        <section className="support-panel">
          <div>
            <p className="store-eyebrow">Need to change this appointment?</p>
            <h3>Manage your booking.</h3>
          </div>
          <Link href={`/cancel/${token}`} className="ghost-link">
            Manage with {tenant.name}
          </Link>
        </section>

        <section className="support-panel">
          <div>
            <p className="store-eyebrow">Need another appointment?</p>
            <h3>Book again with {tenant.name}.</h3>
          </div>
          <Link href={`/${tenant.slug}/services/${slugify(booking.service.name)}`} className="ghost-link">
            Book another visit
          </Link>
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

    const detail = isApiClientError(error) ? error.message : "The form link could not be loaded.";

    return (
      <main className="manage-page page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Forms unavailable</p>
          <h1>We could not load your forms.</h1>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}
