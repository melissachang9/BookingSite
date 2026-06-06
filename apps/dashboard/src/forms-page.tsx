import { useEffect, useState, type FormEvent } from "react";
import type {
  AuthenticatedUser,
  CreateFormRequest,
  FormField,
  FormFieldType,
  FormListResponse,
  FormSchema,
  FormSummaryResponse,
  ServiceSummary,
  UpdateFormRequest,
} from "@booking/shared-types";

import { platformApi } from "./platform-api";

type RouteDefinitionLike = {
  title: string;
  eyebrow: string;
  description: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

type BuilderModal =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; form: FormSummaryResponse };

const SCOPE_LABELS: Record<string, string> = {
  customer: "Customer-facing",
  internal: "Internal",
};

const TIMING_LABELS: Record<string, string> = {
  pre_booking: "Pre-booking",
  pre_visit: "Pre-visit",
  post_visit: "Post-visit",
};

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  select: "Single select",
  multi_select: "Multi select",
  checkbox: "Checkbox",
  yes_no: "Yes / No",
  date: "Date",
  number: "Number",
  file_upload: "File upload",
  signature: "Signature",
  section: "Section header",
  static_text: "Static text",
};

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((p) => p.key === key && p.allowed);
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function generateFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function FormsPage({
  definition,
  currentUser,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser | null;
}) {
  const tenantSlug = currentUser?.tenantSlug ?? "";
  const canManage = currentUser !== null && hasPermission(currentUser, "settings.manage");
  const canView = currentUser !== null && hasPermission(currentUser, "settings.view");

  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [forms, setForms] = useState<FormSummaryResponse[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [builder, setBuilder] = useState<BuilderModal>({ kind: "none" });
  const [status, setStatus] = useState<string | null>(null);

  const loadForms = async () => {
    try {
      const response: FormListResponse = await platformApi.listForms(tenantSlug);
      setForms(response.items);
      setLoadState({ kind: "ready" });
    } catch (error) {
      setLoadState({ kind: "error", message: readErrorMessage(error, "Unable to load forms.") });
    }
  };

  useEffect(() => {
    if (!canView || !tenantSlug) return;
    void loadForms();
  }, [tenantSlug, canView]);

  const selectedForm = forms.find((f) => f.id === selectedFormId) ?? null;

  if (!currentUser) {
    return <main className="ops-page-stack"><section className="ops-hero ops-hero--compact"><div className="ops-hero-copy"><h3>Sign in required</h3></div></section></main>;
  }
  if (!canView) {
    return <main className="ops-page-stack"><section className="ops-hero ops-hero--compact"><div className="ops-hero-copy"><p className="eyebrow">{definition.eyebrow}</p><h3>{definition.title}</h3><p>You do not have permission to view forms.</p></div></section></main>;
  }
  if (loadState.kind === "loading") {
    return <main className="ops-page-stack"><section className="ops-hero ops-hero--compact"><div className="ops-hero-copy"><p className="eyebrow">{definition.eyebrow}</p><h3>{definition.title}</h3></div></section></main>;
  }
  if (loadState.kind === "error") {
    return <main className="ops-page-stack"><section className="ops-hero ops-hero--compact"><div className="ops-hero-copy"><p className="eyebrow">{definition.eyebrow}</p><h3>{definition.title}</h3><p>{loadState.message}</p></div></section></main>;
  }

  return (
    <main className="ops-page-stack">
      {status ? (
        <div className="message-banner" role="status">
          {status}
          <button type="button" className="ghost-action" onClick={() => setStatus(null)}>Dismiss</button>
        </div>
      ) : null}

      <h3>{definition.title}</h3>

      <section className="staff-master-detail">
        <div className="staff-grid">
          <aside className="staff-list-rail" aria-label="Form list">
            <div className="staff-list-rail-header">
              <h4>Forms</h4>
              {canManage ? (
                <button type="button" className="ghost-action" onClick={() => setBuilder({ kind: "add" })}>
                  + Build form
                </button>
              ) : null}
            </div>
            {forms.length === 0 ? (
              <p className="staff-list-empty">No forms yet. Click "Build form" to create one.</p>
            ) : (
              <ul className="staff-list">
                {forms.map((form) => (
                  <li key={form.id}>
                    <button
                      type="button"
                      className={`staff-list-item${selectedFormId === form.id ? " is-active" : ""}`}
                      onClick={() => setSelectedFormId(form.id)}
                    >
                      <div>
                        <strong>{form.name}</strong>
                        <span>
                          {SCOPE_LABELS[form.scope] ?? form.scope}
                          {form.customerPromptTiming ? ` · ${TIMING_LABELS[form.customerPromptTiming] ?? form.customerPromptTiming}` : ""}
                          {form.reviewRequired ? " · Review req." : ""}
                          {" · "}{form.isActive ? "Active" : "Inactive"}
                          {form.currentVersionNumber ? ` · v${form.currentVersionNumber}` : ""}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="staff-detail-panel" aria-label="Form details">
            {selectedForm ? (
              <div className="customer-profile">
                <header className="customer-profile-header">
                  <div>
                    <h4>{selectedForm.name}</h4>
                    <p className="customer-profile-since">
                      {SCOPE_LABELS[selectedForm.scope] ?? selectedForm.scope}
                      {selectedForm.customerPromptTiming ? ` · ${TIMING_LABELS[selectedForm.customerPromptTiming] ?? selectedForm.customerPromptTiming}` : ""}
                      {selectedForm.reviewRequired ? " · Review required" : ""}
                      {" · "}{selectedForm.isActive ? "Active" : "Inactive"}
                      {selectedForm.currentVersionNumber ? ` · v${selectedForm.currentVersionNumber}` : ""}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="staff-detail-actions">
                      <button type="button" className="ghost-action" onClick={() => setBuilder({ kind: "edit", form: selectedForm })}>
                        Edit
                      </button>
                      <button type="button" className="ghost-action" onClick={() => handleToggleActive(selectedForm)}>
                        {selectedForm.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  ) : null}
                </header>

                {selectedForm.schema ? (
                  <section className="customer-profile-section">
                    <p className="rail-section-kicker">Schema · {selectedForm.schema.fields.length} fields</p>
                    {selectedForm.schema.description ? (
                      <p className="customer-profile-notes" style={{ fontStyle: "normal" }}>{selectedForm.schema.description}</p>
                    ) : null}
                    {selectedForm.schema.fields.length === 0 ? (
                      <p className="staff-list-empty">No fields defined. Edit to add fields.</p>
                    ) : (
                      <ul className="form-field-preview-list">
                        {selectedForm.schema.fields.map((field) => (
                          <li key={field.id} className="form-field-preview-item">
                            <span className="form-field-preview-type">{field.type.replace(/_/g, " ")}</span>
                            <span className="form-field-preview-label">{field.label}{field.required ? " *" : ""}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : (
                  <section className="customer-profile-section">
                    <p className="staff-list-empty">No schema defined. Edit to add fields.</p>
                  </section>
                )}

                {selectedForm.serviceIds.length > 0 ? (
                  <section className="customer-profile-section">
                    <p className="rail-section-kicker">Attached to {selectedForm.serviceIds.length} service{selectedForm.serviceIds.length > 1 ? "s" : ""}</p>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="staff-detail-empty">
                <p>Select a form to view details, or click "Build form" to create one.</p>
              </div>
            )}
          </section>
        </div>
      </section>

      {builder.kind !== "none" ? (
        <FormBuilderModal
          tenantSlug={tenantSlug}
          builder={builder}
          onClose={() => setBuilder({ kind: "none" })}
          onSaved={async (msg) => {
            await loadForms();
            setStatus(msg);
            setBuilder({ kind: "none" });
          }}
          onStatus={setStatus}
        />
      ) : null}
    </main>
  );

  async function handleToggleActive(form: FormSummaryResponse) {
    if (!canManage) return;
    try {
      await platformApi.updateForm(tenantSlug, form.id, { isActive: !form.isActive });
      setStatus(`"${form.name}" ${form.isActive ? "deactivated" : "activated"}.`);
      await loadForms();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to update form."));
    }
  }
}

// ===========================================================================
// Form Builder Modal
// ===========================================================================

function FormBuilderModal({
  tenantSlug,
  builder,
  onClose,
  onSaved,
  onStatus,
}: {
  tenantSlug: string;
  builder: BuilderModal;
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
  onStatus: (msg: string) => void;
}) {
  const isEdit = builder.kind === "edit";
  const existingForm = isEdit ? builder.form : null;

  const [name, setName] = useState(existingForm?.name ?? "");
  const [scope, setScope] = useState<string>(existingForm?.scope ?? "customer");
  const [timing, setTiming] = useState(existingForm?.customerPromptTiming ?? "");
  const [reviewRequired, setReviewRequired] = useState(existingForm?.reviewRequired ?? false);
  const [description, setDescription] = useState(existingForm?.schema?.description ?? "");
  const [fields, setFields] = useState<FormField[]>(existingForm?.schema?.fields ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [servicesLoaded, setServicesLoaded] = useState(false);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(existingForm?.serviceIds ?? []);

  useEffect(() => {
    platformApi.listServices(tenantSlug).then((resp) => {
      setServices(resp.services.filter((s) => s.isActive));
      setServicesLoaded(true);
    }).catch(() => setServicesLoaded(true));
  }, [tenantSlug]);

  const handleAddField = (type: FormFieldType) => {
    const newField: FormField = {
      id: generateFieldId(),
      type,
      label: "",
      required: false,
    };
    if (type === "select" || type === "multi_select") {
      newField.options = [];
    }
    setFields((prev) => [...prev, newField]);
  };

  const handleUpdateField = (index: number, patch: Partial<FormField>) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const handleRemoveField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMoveField = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= fields.length) return;
    setFields((prev) => {
      const next = [...prev];
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Form name is required."); return; }

    const schema: FormSchema = {
      title: trimmedName,
      description: description.trim() || undefined,
      fields,
    };

    setSaving(true);
    try {
      if (isEdit && existingForm) {
        const body: UpdateFormRequest = {
          name: trimmedName,
          scope,
          customerPromptTiming: timing || null,
          reviewRequired,
          schema,
        };
        await platformApi.updateForm(tenantSlug, existingForm.id, body);
        await onSaved(`"${trimmedName}" updated.`);
      } else {
        const body: CreateFormRequest = {
          name: trimmedName,
          scope,
          customerPromptTiming: timing || undefined,
          reviewRequired,
          schema,
        };
        await platformApi.createForm(tenantSlug, body);
        await onSaved(`"${trimmedName}" created.`);
      }
    } catch (err) {
      onStatus(readErrorMessage(err, "Unable to save form."));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={isEdit ? "Edit form" : "Build form"}>
      <div className="modal-panel modal-panel--wide" style={{ maxWidth: "min(720px, 100%)" }}>
        <header className="modal-header">
          <h4>{isEdit ? "Edit form" : "Build form"}</h4>
          <button type="button" className="ghost-action" onClick={onClose}>Close</button>
        </header>
        <form className="modal-form" onSubmit={handleSubmit} style={{ gap: "1rem" }}>
          {error ? <div className="message-banner message-banner--error">{error}</div> : null}

          {/* Basics */}
          <div className="staff-detail-grid">
            <label>
              <span>Form name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Health History, Consent Form" autoFocus />
            </label>
            <label>
              <span>Scope</span>
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="customer">Customer-facing</option>
                <option value="internal">Internal</option>
              </select>
            </label>
            <label>
              <span>Prompt timing</span>
              <select value={timing} onChange={(e) => setTiming(e.target.value)}>
                <option value="">None</option>
                <option value="pre_booking">Pre-booking</option>
                <option value="pre_visit">Pre-visit</option>
                <option value="post_visit">Post-visit</option>
              </select>
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={reviewRequired} onChange={(e) => setReviewRequired(e.target.checked)} />
              <span>Requires staff review</span>
            </label>
            <label className="staff-detail-grid-wide">
              <span>Description</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Instructions shown to the customer at the top of the form" />
            </label>
          </div>

          {/* Service attachments */}
          {servicesLoaded && services.length > 0 ? (
            <fieldset className="staff-fieldset">
              <legend>Appointment types</legend>
              <p className="settings-form-help">Attach this form to specific services so it appears during booking.</p>
              <div className="staff-checkbox-grid">
                {services.map((svc) => (
                  <label key={svc.id} className="settings-toggle" style={{ fontSize: "0.85rem" }}>
                    <input
                      type="checkbox"
                      checked={selectedServiceIds.includes(svc.id)}
                      onChange={(e) => {
                        setSelectedServiceIds((prev) =>
                          e.target.checked ? [...prev, svc.id] : prev.filter((id) => id !== svc.id),
                        );
                      }}
                    />
                    <span>{svc.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {/* Field builder */}
          <fieldset className="staff-fieldset">
            <legend>Fields</legend>
            <div className="form-builder-toolbar">
              {(Object.keys(FIELD_TYPE_LABELS) as FormFieldType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="filter-chip"
                  onClick={() => handleAddField(type)}
                >
                  + {FIELD_TYPE_LABELS[type]}
                </button>
              ))}
            </div>

            {fields.length === 0 ? (
              <p className="settings-form-help">No fields yet. Click a field type above to add one.</p>
            ) : (
              <ul className="form-builder-field-list">
                {fields.map((field, index) => (
                  <FieldEditor
                    key={field.id}
                    field={field}
                    index={index}
                    total={fields.length}
                    onUpdate={(patch) => handleUpdateField(index, patch)}
                    onRemove={() => handleRemoveField(index)}
                    onMove={(dir) => handleMoveField(index, dir)}
                  />
                ))}
              </ul>
            )}
          </fieldset>

          <div className="modal-actions">
            <button type="button" className="ghost-action" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-action" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create form"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===========================================================================
// Field Editor
// ===========================================================================

function FieldEditor({
  field,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
}: {
  field: FormField;
  index: number;
  total: number;
  onUpdate: (patch: Partial<FormField>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const isLayout = field.type === "section" || field.type === "static_text";
  const hasOptions = field.type === "select" || field.type === "multi_select";

  return (
    <li className="form-builder-field">
      <div className="form-builder-field__header">
        <span className="form-builder-field__type">{FIELD_TYPE_LABELS[field.type]}</span>
        <div className="form-builder-field__controls">
          <button type="button" className="ghost-action" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" className="ghost-action" disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
          <button type="button" className="ghost-action" onClick={onRemove}>✕</button>
        </div>
      </div>

      <div className="form-builder-field__body">
        <label>
          <span>Label</span>
          <input
            value={field.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            placeholder={isLayout ? "Section heading" : "Field label"}
          />
        </label>

        {field.type === "static_text" || field.type === "section" ? (
          <label>
            <span>Content</span>
            <textarea
              value={field.content ?? ""}
              onChange={(e) => onUpdate({ content: e.target.value })}
              rows={2}
              placeholder={field.type === "section" ? "Optional description below the heading" : "Static text content"}
            />
          </label>
        ) : null}

        {!isLayout ? (
          <div className="form-builder-field__row">
            <label className="settings-toggle">
              <input type="checkbox" checked={field.required ?? false} onChange={(e) => onUpdate({ required: e.target.checked })} />
              <span>Required</span>
            </label>
            <label style={{ flex: 1 }}>
              <span>Help text</span>
              <input
                value={field.helpText ?? ""}
                onChange={(e) => onUpdate({ helpText: e.target.value || undefined })}
                placeholder="Optional hint"
              />
            </label>
            <label style={{ flex: 1 }}>
              <span>Placeholder</span>
              <input
                value={field.placeholder ?? ""}
                onChange={(e) => onUpdate({ placeholder: e.target.value || undefined })}
                placeholder="Placeholder text"
              />
            </label>
          </div>
        ) : null}

        {hasOptions ? (
          <div className="form-builder-field__options">
            <span className="form-builder-field__options-label">Options</span>
            {(field.options ?? []).map((opt, optIdx) => (
              <div key={optIdx} className="form-builder-field__option-row">
                <input
                  value={opt.label}
                  onChange={(e) => {
                    const next = [...(field.options ?? [])];
                    next[optIdx] = { ...next[optIdx], label: e.target.value, value: e.target.value.toLowerCase().replace(/\s+/g, "_") };
                    onUpdate({ options: next });
                  }}
                  placeholder="Option label"
                />
                <button type="button" className="ghost-action" onClick={() => {
                  onUpdate({ options: (field.options ?? []).filter((_, i) => i !== optIdx) });
                }}>✕</button>
              </div>
            ))}
            <button type="button" className="ghost-action" onClick={() => {
              onUpdate({ options: [...(field.options ?? []), { label: "", value: "" }] });
            }}>+ Add option</button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
