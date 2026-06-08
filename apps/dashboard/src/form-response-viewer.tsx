import type { ReactElement } from "react";
import type { BookingFormResponseEntry, FormField, FormSchema } from "@booking/shared-types";

type FormResponseViewerProps = {
  response: BookingFormResponseEntry;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${dateFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

function formatDateValue(value: string): string {
  return dateFormatter.format(new Date(value));
}

function formatAnswerValue(value: unknown, field: FormField): string {
  if (value === null || value === undefined) {
    return "\u2014";
  }

  switch (field.type) {
    case "yes_no":
      return value ? "Yes" : "No";
    case "checkbox":
      return value ? "Yes" : "No";
    case "multi_select": {
      if (Array.isArray(value)) {
        return value.length === 0 ? "\u2014" : value.map((entry) => String(entry)).join(", ");
      }
      return String(value);
    }
    case "date":
      if (typeof value === "string" && value.trim().length > 0) {
        return formatDateValue(value);
      }
      return String(value);
    case "number":
      return String(value);
    case "file_upload":
    case "signature":
      return "Attachment preview coming soon";
    case "section":
    case "static_text":
      return "";
    default:
      if (typeof value === "string") {
        return value.trim().length === 0 ? "\u2014" : value;
      }
      return String(value);
  }
}

function getPromptableFields(schema: FormSchema | null | undefined): FormField[] {
  if (!schema?.fields) return [];
  return schema.fields.filter(
    (field) => field.type !== "section" && field.type !== "static_text",
  );
}

function getSectionFields(schema: FormSchema | null | undefined): FormField[] {
  if (!schema?.fields) return [];
  return schema.fields.filter((field) => field.type === "section");
}

export function FormResponseViewer({ response }: FormResponseViewerProps): ReactElement {
  const schema = response.schema;
  const promptableFields = getPromptableFields(schema);
  const sectionFields = getSectionFields(schema);
  const hasSchema = schema && schema.fields.length > 0;

  const timingLabel = response.customerPromptTiming?.replaceAll("_", " ") ?? response.scope;

  return (
    <div className="form-response-viewer">
      <header className="form-response-viewer__header">
        <div>
          <strong className="form-response-viewer__title">{response.formName}</strong>
          <span className="form-response-viewer__version">v{response.formVersionNumber}</span>
        </div>
        <p className="form-response-viewer__meta">
          {formatDateTime(response.submittedAt)} &middot; {timingLabel}
        </p>
      </header>

      {!hasSchema ? (
        <div className="form-response-viewer__answers">
          {Object.keys(response.answers).length === 0 ? (
            <p className="form-response-viewer__empty">No answers recorded.</p>
          ) : (
            <dl className="form-response-viewer__dl">
              {Object.entries(response.answers).map(([key, value]) => (
                <div key={key} className="form-response-viewer__answer">
                  <dt className="form-response-viewer__label">{key}</dt>
                  <dd className="form-response-viewer__value">
                    {value === null || value === undefined
                      ? "\u2014"
                      : typeof value === "string"
                        ? value
                        : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : (
        <div className="form-response-viewer__answers">
          {promptableFields.length === 0 && sectionFields.length === 0 ? (
            <p className="form-response-viewer__empty">No answers recorded.</p>
          ) : (
            <dl className="form-response-viewer__dl">
              {schema.fields.map((field) => {
                if (field.type === "section") {
                  return (
                    <div key={field.id} className="form-response-viewer__section-divider">
                      <dt className="form-response-viewer__section-label">{field.label}</dt>
                    </div>
                  );
                }
                if (field.type === "static_text") {
                  return (
                    <div key={field.id} className="form-response-viewer__answer">
                      <dd className="form-response-viewer__static-text">{field.content ?? field.label}</dd>
                    </div>
                  );
                }
                const answer = response.answers[field.id];
                return (
                  <div key={field.id} className="form-response-viewer__answer">
                    <dt className="form-response-viewer__label">{field.label}</dt>
                    <dd className="form-response-viewer__value">
                      {formatAnswerValue(answer, field)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
