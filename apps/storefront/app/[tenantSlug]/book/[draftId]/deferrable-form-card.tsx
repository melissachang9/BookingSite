"use client";

import { useState } from "react";
import type { FormField, FormRequirement } from "@booking/shared-types";
import { submitBookingRequirementAction } from "./actions";

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

  if (field.type === "file_upload" || field.type === "signature") {
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

  const timingLabel = requirement.customerPromptTiming?.replaceAll("_", " ") ?? requirement.scope;
  const title = requirement.formTitle ?? `Required form ${requirement.formVersionId}`;
  const description = requirement.formDescription ?? `Version ${requirement.formVersionId}`;

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
        <p>{description}</p>
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

      <p className="requirement-form-description">{description}</p>

      <form action={submitBookingRequirementAction} className="requirement-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="bookingDraftId" value={bookingDraftId} />
        <input type="hidden" name="requirementId" value={requirement.id} />
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="schemaJson" value={JSON.stringify(requirement.schema)} />

        {requirement.schema.fields.map((field) => renderRequirementField(field))}

        <div className="deferrable-actions">
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
