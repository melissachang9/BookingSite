import { useCallback, useEffect, useState } from "react";
import type {
  FormAnswers,
  FormField,
  InternalFormOption,
  InternalFormResponseEntry,
} from "@booking/shared-types";

import { FormResponseViewer } from "./form-response-viewer";
import { platformApi } from "./platform-api";

type Props = {
  tenantSlug: string;
  customerId: string;
  canView: boolean;
  canSubmit: boolean;
};

type ListState =
  | { kind: "loading" }
  | { kind: "ready"; items: InternalFormResponseEntry[] }
  | { kind: "error"; message: string };

type FormsState =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "ready"; options: InternalFormOption[] }
  | { kind: "error"; message: string };

// Files and signatures need an upload step that internal forms do not have yet.
const UNSUPPORTED_TYPES = new Set(["file_upload", "signature"]);

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isFilled(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

export function ClientInternalForms({ tenantSlug, customerId, canView, canSubmit }: Props) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [formsState, setFormsState] = useState<FormsState>({ kind: "closed" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadResponses = useCallback(async () => {
    if (!canView) return;
    try {
      const response = await platformApi.listCustomerInternalFormResponses(tenantSlug, customerId);
      setList({ kind: "ready", items: response.items });
    } catch (error) {
      setList({ kind: "error", message: errorText(error, "Unable to load internal forms.") });
    }
  }, [canView, tenantSlug, customerId]);

  useEffect(() => {
    setList({ kind: "loading" });
    setFormsState({ kind: "closed" });
    void loadResponses();
  }, [loadResponses]);

  const openPicker = async () => {
    setFormsState({ kind: "loading" });
    try {
      const response = await platformApi.listInternalForms(tenantSlug);
      setFormsState({ kind: "ready", options: response.items });
    } catch (error) {
      setFormsState({ kind: "error", message: errorText(error, "Unable to load internal forms.") });
    }
  };

  if (!canView && !canSubmit) return null;

  return (
    <section className="cs-internal-forms" aria-label="Internal forms">
      <header className="cs-internal-forms__header">
        <div>
          <h4>Internal forms</h4>
          <p className="cs-settings-help">Private to your team. Clients never see these.</p>
        </div>
        {canSubmit && formsState.kind === "closed" ? (
          <button type="button" className="cs-btn cs-btn--sm" onClick={() => void openPicker()}>
            Fill in a form
          </button>
        ) : null}
      </header>

      {formsState.kind === "loading" ? <p className="cs-empty">Loading forms…</p> : null}
      {formsState.kind === "error" ? (
        <div className="cs-banner cs-banner--error" role="alert">
          {formsState.message}
        </div>
      ) : null}
      {formsState.kind === "ready" ? (
        <InternalFormFiller
          tenantSlug={tenantSlug}
          customerId={customerId}
          options={formsState.options}
          onCancel={() => setFormsState({ kind: "closed" })}
          onSaved={async () => {
            setFormsState({ kind: "closed" });
            await loadResponses();
          }}
        />
      ) : null}

      {!canView ? null : list.kind === "loading" ? (
        <p className="cs-empty">Loading internal forms…</p>
      ) : list.kind === "error" ? (
        <div className="cs-banner cs-banner--error" role="alert">
          {list.message}
        </div>
      ) : list.items.length === 0 ? (
        <p className="cs-empty">No internal forms filled in yet.</p>
      ) : (
        <ul className="cs-internal-forms__list">
          {list.items.map((response) => {
            const isOpen = expanded.has(response.id);
            return (
              <li key={response.id} className="cs-internal-forms__item">
                <div className="cs-internal-forms__item-head">
                  <strong>{response.formName}</strong>
                  <span className="cs-internal-forms__meta">
                    {dateTimeFormatter.format(new Date(response.submittedAt))} · v{response.formVersionNumber}
                    {response.submittedByName ? ` · ${response.submittedByName}` : ""}
                  </span>
                  <button
                    type="button"
                    className="cs-customer-form-response-row__toggle"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setExpanded((previous) => {
                        const next = new Set(previous);
                        if (next.has(response.id)) next.delete(response.id);
                        else next.add(response.id);
                        return next;
                      })
                    }
                  >
                    {isOpen ? "Hide answers" : "View answers"}
                  </button>
                  {isOpen ? (
                    <div className="cs-customer-form-response-row__viewer">
                      <FormResponseViewer response={response} />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function InternalFormFiller({
  tenantSlug,
  customerId,
  options,
  onCancel,
  onSaved,
}: {
  tenantSlug: string;
  customerId: string;
  options: InternalFormOption[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string>(options[0]?.id ?? "");
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = options.find((option) => option.id === selectedId) ?? null;

  if (options.length === 0) {
    return (
      <div className="cs-internal-forms__filler">
        <p className="cs-empty">
          There are no active internal forms. Create one under Forms, with the audience set to internal.
        </p>
        <button type="button" className="cs-btn cs-btn--sm" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  const fields = selected?.schema.fields ?? [];
  const blockedField = fields.find((field) => UNSUPPORTED_TYPES.has(field.type) && field.required);

  const submit = async () => {
    if (!selected) return;
    const missing = fields.find(
      (field) => field.required && !UNSUPPORTED_TYPES.has(field.type) && field.type !== "section" && field.type !== "static_text" && !isFilled(answers[field.id]),
    );
    if (missing) {
      setError(`${missing.label || "A required question"} is required.`);
      return;
    }
    const cleaned: FormAnswers = {};
    for (const field of fields) {
      if (isFilled(answers[field.id])) cleaned[field.id] = answers[field.id];
    }
    setSubmitting(true);
    setError(null);
    try {
      await platformApi.submitInternalForm(tenantSlug, customerId, selected.id, { answers: cleaned });
      await onSaved();
    } catch (caught) {
      setError(errorText(caught, "Unable to save this form."));
      setSubmitting(false);
    }
  };

  return (
    <div className="cs-internal-forms__filler">
      <label className="fm-preview__group">
        <span className="fm-preview__label">Form</span>
        <span className="cs-input cs-input--select">
          <select
            aria-label="Form"
            value={selectedId}
            disabled={submitting}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setAnswers({});
              setError(null);
            }}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </span>
      </label>

      {selected?.description ? <p className="cs-settings-help">{selected.description}</p> : null}

      <div className="fm-preview__fields">
        {fields.map((field) => (
          <div key={field.id} className="fm-preview__field">
            <InternalFieldInput
              field={field}
              value={answers[field.id]}
              disabled={submitting}
              onChange={(value) => {
                setError(null);
                setAnswers((previous) => ({ ...previous, [field.id]: value }));
              }}
            />
          </div>
        ))}
      </div>

      {blockedField ? (
        <div className="cs-banner cs-banner--error" role="alert">
          “{blockedField.label}” needs a file or signature, which internal forms can’t take yet. Make it optional in the form
          builder to use this form.
        </div>
      ) : null}
      {error ? (
        <div className="cs-banner cs-banner--error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="cs-internal-forms__actions">
        <button type="button" className="cs-btn cs-btn--sm" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          className="cs-btn cs-btn--sm cs-btn--primary"
          onClick={() => void submit()}
          disabled={submitting || Boolean(blockedField)}
        >
          {submitting ? "Saving…" : "Save form"}
        </button>
      </div>
    </div>
  );
}

function InternalFieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: FormField;
  value: FormAnswers[string] | undefined;
  disabled: boolean;
  onChange: (value: FormAnswers[string]) => void;
}) {
  const label = (
    <span className="fm-preview__label">
      {field.label}
      {field.required ? <span className="fm-preview__req"> Required</span> : null}
    </span>
  );
  const help = field.helpText ? <span className="fm-preview__help">{field.helpText}</span> : null;

  switch (field.type) {
    case "section":
      return (
        <div className="fm-preview__section">
          <h4>{field.label}</h4>
          {field.content ? <p>{field.content}</p> : null}
        </div>
      );
    case "static_text":
      return (
        <div className="fm-preview__static">
          {field.label ? <h4>{field.label}</h4> : null}
          <p>{field.content}</p>
        </div>
      );
    case "long_text":
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <textarea
            className="cs-input"
            rows={3}
            disabled={disabled}
            placeholder={field.placeholder}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      );
    case "select":
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <span className="cs-input cs-input--select">
            <select
              aria-label={field.label}
              disabled={disabled}
              value={typeof value === "string" ? value : ""}
              onChange={(event) => onChange(event.target.value)}
            >
              <option value="">Select…</option>
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>
        </label>
      );
    case "multi_select": {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="fm-preview__group">
          <legend>{label}</legend>
          {help}
          {(field.options ?? []).map((option) => (
            <label key={option.value} className="fm-preview__choice">
              <input
                type="checkbox"
                disabled={disabled}
                checked={chosen.includes(option.value)}
                onChange={(event) =>
                  onChange(event.target.checked ? [...chosen, option.value] : chosen.filter((entry) => entry !== option.value))
                }
              />{" "}
              {option.label}
            </label>
          ))}
        </fieldset>
      );
    }
    case "checkbox":
      return (
        <label className="fm-preview__choice">
          <input type="checkbox" disabled={disabled} checked={value === true} onChange={(event) => onChange(event.target.checked)} />{" "}
          {label}
        </label>
      );
    case "yes_no":
      return (
        <fieldset className="fm-preview__group">
          <legend>{label}</legend>
          {help}
          {[
            ["Yes", true],
            ["No", false],
          ].map(([text, answer]) => (
            <label key={String(text)} className="fm-preview__choice">
              <input
                type="radio"
                name={field.id}
                disabled={disabled}
                checked={value === answer}
                onChange={() => onChange(answer as boolean)}
              />{" "}
              {text as string}
            </label>
          ))}
        </fieldset>
      );
    case "date":
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <input
            className="cs-input"
            type="date"
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      );
    case "number":
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <input
            className="cs-input"
            type="number"
            disabled={disabled}
            value={typeof value === "number" ? value : ""}
            onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
          />
        </label>
      );
    case "file_upload":
    case "signature":
      return (
        <div className="fm-preview__group">
          {label}
          <span className="fm-preview__help">Not available on internal forms yet.</span>
        </div>
      );
    default:
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <input
            className="cs-input"
            type="text"
            disabled={disabled}
            placeholder={field.placeholder}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      );
  }
}
