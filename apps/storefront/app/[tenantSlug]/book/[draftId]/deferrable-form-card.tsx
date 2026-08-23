"use client";

import { useState } from "react";
import type { FormAnswers, FormField, FormRequirement } from "@booking/shared-types";
import { saveBookingRequirementDraftAction, submitBookingRequirementAction } from "./actions";
import DateFieldInput from "./date-field-input";
import SignatureField from "./signature-field";

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

type DeferrableFormCardProps = {
  requirement: FormRequirement;
  tenantSlug: string;
  bookingDraftId: string;
  tenantId: string;
};

export default function DeferrableFormCard({
  requirement,
  tenantSlug,
  bookingDraftId,
  tenantId,
}: DeferrableFormCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [skipped, setSkipped] = useState(false);

  const timingLabel = formatTimingLabel(requirement.customerPromptTiming);
  const title = requirement.formTitle?.trim() ? requirement.formTitle : "Required form";
  const description = requirement.formDescription?.trim() ? requirement.formDescription : null;
  const draftAnswers = requirement.draftAnswers as FormAnswers | null | undefined;

  if (requirement.status !== "pending" || !requirement.schema) {
    return (
      <article className="requirement-card">
        <span>{timingLabel}</span>
        <strong>{title}</strong>
        <p>{requirement.status.replaceAll("_", " ")}</p>
      </article>
    );
  }

  if (skipped) {
    return (
      <article className="requirement-card">
        <span>{timingLabel}</span>
        <strong>{title}</strong>
        <p>Will complete later</p>
      </article>
    );
  }

  if (!expanded) {
    return (
      <article className="requirement-card requirement-card--deferrable">
        <span>{timingLabel}</span>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
        <div className="deferrable-actions">
          <button type="button" className="store-button" onClick={() => setExpanded(true)}>
            Complete now
          </button>
          <button type="button" className="ghost-link" onClick={() => setSkipped(true)}>
            Complete later
          </button>
        </div>
      </article>
    );
  }

  return (
    <section className="requirement-form-card">
      <div className="section-header">
        <div>
          <p className="store-eyebrow">{timingLabel}</p>
          <h3>{title}</h3>
        </div>
        <span className="panel-badge">Optional</span>
      </div>

      {description ? <p className="requirement-form-description">{description}</p> : null}

      <form action={submitBookingRequirementAction} className="requirement-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="bookingDraftId" value={bookingDraftId} />
        <input type="hidden" name="requirementId" value={requirement.id} />
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="schemaJson" value={JSON.stringify(requirement.schema)} />

        {requirement.schema.fields.map((field) => renderRequirementField(field, draftAnswers?.[field.id]))}

        <div className="deferrable-actions">
          <button type="submit" className="ghost-link" formAction={saveBookingRequirementDraftAction} formNoValidate>
            Save draft
          </button>
          <button type="submit" className="store-button">
            Submit form
          </button>
          <button type="button" className="ghost-link" onClick={() => setExpanded(false)}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
