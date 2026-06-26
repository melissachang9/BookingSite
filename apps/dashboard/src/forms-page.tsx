import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  AuthenticatedUser,
  CreateFormRequest,
  CustomerPromptTiming,
  FormField,
  FormFieldType,
  FormListResponse,
  FormSchema,
  FormScope,
  FormSummaryResponse,
  ServiceCategorySummary,
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
  pre_booking: "Required to confirm",
  pre_visit: "Complete before appointment",
  post_visit: "Complete after appointment",
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

      {builder.kind !== "none" ? (
        <FormBuilderEditor
          tenantSlug={tenantSlug}
          builder={builder}
          onClose={() => setBuilder({ kind: "none" })}
          onSaved={async (msg) => {
            await loadForms();
            setStatus(msg);
          }}
          onStatus={setStatus}
        />
      ) : (
        <>
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
                          <button
                            type="button"
                            className="ghost-action ghost-action--danger"
                            onClick={() => {
                              if (window.confirm(`Delete "${selectedForm.name}"? This cannot be undone.`)) {
                                handleDeleteForm(selectedForm);
                              }
                            }}
                          >
                            Delete
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
        </>
      )}
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

  async function handleDeleteForm(form: FormSummaryResponse) {
    if (!canManage) return;
    try {
      await platformApi.deleteForm(tenantSlug, form.id);
      setStatus(`"${form.name}" deleted.`);
      if (selectedFormId === form.id) {
        setSelectedFormId(null);
      }
      await loadForms();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to delete form."));
    }
  }
}

// ===========================================================================
// Form Builder Editor (full-page, step-nav)
// ===========================================================================

type EditorStep = "details" | "fields" | "preview" | "advanced";

function FormBuilderEditor({
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
  const [formId, setFormId] = useState<string | null>(existingForm?.id ?? null);

  const [name, setName] = useState(existingForm?.name ?? "");
  const [scope, setScope] = useState<FormScope>(existingForm?.scope ?? "customer");
  const [timing, setTiming] = useState<CustomerPromptTiming | "">(existingForm?.customerPromptTiming ?? "");
  const [reviewRequired, setReviewRequired] = useState(existingForm?.reviewRequired ?? false);
  const [description, setDescription] = useState(existingForm?.schema?.description ?? "");
  const [fields, setFields] = useState<FormField[]>(existingForm?.schema?.fields ?? []);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(existingForm?.serviceIds ?? []);
  const [serviceMode, setServiceMode] = useState<"all" | "specific">(
    existingForm?.serviceIds && existingForm.serviceIds.length > 0 ? "specific" : "all",
  );
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [categories, setCategories] = useState<ServiceCategorySummary[]>([]);
  const [servicesLoaded, setServicesLoaded] = useState(false);
  const [selectKey, setSelectKey] = useState(0); // force re-mount after selection

  const [step, setStep] = useState<EditorStep>("details");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      platformApi.listServices(tenantSlug),
      platformApi.listServiceCategories(tenantSlug).catch(() => ({ categories: [] })),
    ]).then(([serviceResp, catResp]) => {
      setServices(serviceResp.services.filter((s) => s.isActive));
      setCategories(catResp.categories);
      setServicesLoaded(true);
    }).catch(() => setServicesLoaded(true));
  }, [tenantSlug]);

  const saveForm = async (msg: string) => {
    setError(null);
    setSaving(true);
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Form name is required."); setSaving(false); return; }

    const schema: FormSchema = {
      title: trimmedName,
      description: description.trim() || undefined,
      fields,
    };

    try {
      if (formId) {
        const body: UpdateFormRequest = {
          name: trimmedName,
          scope,
          customerPromptTiming: timing || null,
          reviewRequired,
          schema,
          serviceIds: selectedServiceIds,
        };
        await platformApi.updateForm(tenantSlug, formId, body);
      } else {
        const body: CreateFormRequest = {
          name: trimmedName,
          scope,
          customerPromptTiming: timing || undefined,
          reviewRequired,
          schema,
          serviceIds: selectedServiceIds,
        };
        const created = await platformApi.createForm(tenantSlug, body);
        setFormId(created.id);
      }
      await onSaved(msg);
    } catch (err) {
      onStatus(readErrorMessage(err, "Unable to save form."));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const steps: Array<{ key: EditorStep; label: string; disabled: boolean }> = [
    { key: "details", label: "Details", disabled: false },
    { key: "fields", label: "Form Fields", disabled: !formId },
    { key: "preview", label: "Preview", disabled: !formId },
    { key: "advanced", label: "Advanced", disabled: true },
  ];

  return (
    <div className="form-editor">
      <nav className="form-editor__steps" aria-label="Form builder steps">
        <button type="button" className="ghost-action form-editor__back" onClick={onClose}>
          ← Back to Forms
        </button>
        <ul>
          {steps.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className={`form-editor__step${step === s.key ? " is-active" : ""}`}
                disabled={s.disabled}
                onClick={() => setStep(s.key)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="form-editor__content">
        {step === "details" ? (
          <DetailsStep
            name={name} setName={setName}
            description={description} setDescription={setDescription}
            scope={scope} setScope={setScope}
            timing={timing} setTiming={setTiming}
            reviewRequired={reviewRequired} setReviewRequired={setReviewRequired}
            services={services} categories={categories} servicesLoaded={servicesLoaded}
            selectedServiceIds={selectedServiceIds} setSelectedServiceIds={setSelectedServiceIds}
            serviceMode={serviceMode} setServiceMode={setServiceMode}
            selectKey={selectKey} setSelectKey={setSelectKey}
            saving={saving} error={error}
            onSave={() => saveForm(formId ? `"${name.trim()}" updated.` : `"${name.trim()}" created.`)}
          />
        ) : null}

        {step === "fields" ? (
          <FormFieldsStep
            fields={fields} setFields={setFields}
            saving={saving} error={error}
            onSave={() => saveForm(`"${name.trim()}" updated.`)}
          />
        ) : null}

        {step === "preview" ? (
          <PreviewStep
            name={name} description={description} fields={fields}
          />
        ) : null}

        {step === "advanced" ? (
          <div className="form-editor__card">
            <h4>Advanced</h4>
            <p className="settings-form-help">Advanced settings coming soon.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ===========================================================================
// Details Step — question cards
// ===========================================================================

function DetailsStep({
  name, setName,
  description, setDescription,
  scope, setScope,
  timing, setTiming,
  reviewRequired, setReviewRequired,
  services, categories, servicesLoaded,
  selectedServiceIds, setSelectedServiceIds,
  serviceMode, setServiceMode,
  selectKey, setSelectKey,
  saving, error,
  onSave,
}: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  scope: FormScope; setScope: (v: FormScope) => void;
  timing: CustomerPromptTiming | ""; setTiming: (v: CustomerPromptTiming | "") => void;
  reviewRequired: boolean; setReviewRequired: (v: boolean) => void;
  services: ServiceSummary[]; categories: ServiceCategorySummary[]; servicesLoaded: boolean;
  selectedServiceIds: string[]; setSelectedServiceIds: (v: string[]) => void;
  serviceMode: "all" | "specific"; setServiceMode: (v: "all" | "specific") => void;
  selectKey: number; setSelectKey: (v: number) => void;
  saving: boolean; error: string | null;
  onSave: () => void;
}) {
  // Group services by category
  const categoryMap = new Map<string | null, ServiceSummary[]>();
  for (const svc of services) {
    const key = svc.categoryId ?? null;
    const list = categoryMap.get(key) ?? [];
    list.push(svc);
    categoryMap.set(key, list);
  }
  const uncategorized = categoryMap.get(null) ?? [];
  categoryMap.delete(null);

  const handleAddService = (id: string) => {
    setSelectedServiceIds([...selectedServiceIds, id]);
    setSelectKey(selectKey + 1);
  };

  const handleAddAllInCategory = (catId: string) => {
    const ids = (categoryMap.get(catId) ?? []).map((s) => s.id);
    setSelectedServiceIds([...new Set([...selectedServiceIds, ...ids])]);
    setSelectKey(selectKey + 1);
  };
  return (
    <div className="form-editor__cards">
      {error ? <div className="message-banner message-banner--error">{error}</div> : null}

      {/* Name & Description */}
      <div className="form-editor__card">
        <h4>Name &amp; description</h4>
        <label>
          <span>Form name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Health History, Consent Form" autoFocus />
        </label>
        <label>
          <span>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Instructions shown at the top of the form" />
        </label>
        <div className="form-editor__card-actions">
          <button type="button" className="primary-action" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Scope */}
      <div className="form-editor__card">
        <h4>Who fills out this form?</h4>
        <div className="form-editor__radio-group">
          <label className="settings-toggle">
            <input type="radio" name="scope" checked={scope === "customer"} onChange={() => setScope("customer")} />
            <span>Clients who book an appointment</span>
          </label>
          <label className="settings-toggle">
            <input type="radio" name="scope" checked={scope === "internal"} onChange={() => setScope("internal")} />
            <span>Staff members</span>
          </label>
        </div>
        <div className="form-editor__card-actions">
          <button type="button" className="primary-action" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Timing */}
      <div className="form-editor__card">
        <h4>When should clients fill this out?</h4>
        <div className="form-editor__radio-group">
          <label className="settings-toggle">
            <input type="radio" name="timing" checked={timing === "pre_booking"} onChange={() => setTiming("pre_booking")} />
            <span>Before booking (required to confirm)</span>
          </label>
          <label className="settings-toggle">
            <input type="radio" name="timing" checked={timing === "pre_visit"} onChange={() => setTiming("pre_visit")} />
            <span>Before the appointment</span>
          </label>
          <label className="settings-toggle">
            <input type="radio" name="timing" checked={timing === "post_visit"} onChange={() => setTiming("post_visit")} />
            <span>After the appointment</span>
          </label>
          <label className="settings-toggle">
            <input type="radio" name="timing" checked={timing === ""} onChange={() => setTiming("")} />
            <span>No specific timing</span>
          </label>
        </div>
        <div className="form-editor__card-actions">
          <button type="button" className="primary-action" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Services */}
      {servicesLoaded && services.length > 0 ? (
        <div className="form-editor__card">
          <h4>Which appointments is it for?</h4>
          <div className="form-editor__radio-group">
            <label className="settings-toggle">
              <input type="radio" name="services" checked={serviceMode === "all"} onChange={() => { setServiceMode("all"); setSelectedServiceIds([]); }} />
              <span>For all appointments</span>
            </label>
            <label className="settings-toggle">
              <input type="radio" name="services" checked={serviceMode === "specific"} onChange={() => setServiceMode("specific")} />
              <span>Only for appointments with specific services</span>
            </label>
          </div>
          {serviceMode === "specific" ? (
            <div className="form-editor__service-list">
              {/* Selected services */}
              {selectedServiceIds.length > 0 ? (
                <div className="form-editor__service-selected">
                  {services.filter((s) => selectedServiceIds.includes(s.id)).map((svc) => (
                    <div key={svc.id} className="form-editor__service-row">
                      <span>{svc.name}</span>
                      <button type="button" className="ghost-action" onClick={() => setSelectedServiceIds(selectedServiceIds.filter((id: string) => id !== svc.id))}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="settings-form-help">No services selected yet. Add one below.</p>
              )}

              {/* Add a service dropdown */}
              {services.filter((s) => !selectedServiceIds.includes(s.id)).length > 0 ? (
                <label>
                  <span>Add a service</span>
                  <select
                    key={selectKey}
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) handleAddService(e.target.value);
                    }}
                  >
                    <option value="" disabled>Select…</option>
                    {services.filter((s) => !selectedServiceIds.includes(s.id)).map((svc) => (
                      <option key={svc.id} value={svc.id}>{svc.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              {/* Category quick-add */}
              {categories.length > 0 ? (
                <div className="form-editor__category-actions">
                  <span className="form-editor__category-label">Add all services in a category</span>
                  {categories.map((cat) => {
                    const catServices = (categoryMap.get(cat.id) ?? []).filter((s) => !selectedServiceIds.includes(s.id));
                    if (catServices.length === 0) return null;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        className="ghost-action"
                        onClick={() => handleAddAllInCategory(cat.id)}
                      >
                        + All in {cat.name} ({catServices.length})
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="form-editor__card-actions">
            <button type="button" className="primary-action" disabled={saving} onClick={onSave}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Review */}
      <div className="form-editor__card">
        <h4>Does this form require review?</h4>
        <div className="form-editor__radio-group">
          <label className="settings-toggle">
            <input type="radio" name="review" checked={!reviewRequired} onChange={() => setReviewRequired(false)} />
            <span>No review needed</span>
          </label>
          <label className="settings-toggle">
            <input type="radio" name="review" checked={reviewRequired} onChange={() => setReviewRequired(true)} />
            <span>Review required</span>
          </label>
        </div>
        <div className="form-editor__card-actions">
          <button type="button" className="primary-action" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Form Fields Step
// ===========================================================================

function FormFieldsStep({
  fields, setFields,
  saving, error,
  onSave,
}: {
  fields: FormField[]; setFields: (v: FormField[]) => void;
  saving: boolean; error: string | null;
  onSave: () => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

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
    const next = [...fields, newField];
    setFields(next);
    setExpandedIndex(next.length - 1);
    setPaletteOpen(false);
  };

  const handleUpdateField = (index: number, patch: Partial<FormField>) => {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const handleRemoveField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(null);
    else if (expandedIndex !== null && expandedIndex > index) setExpandedIndex(expandedIndex - 1);
  };

  const handleMoveField = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= fields.length) return;
    const next = [...fields];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    setFields(next);
    if (expandedIndex === index) setExpandedIndex(newIndex);
    else if (expandedIndex === newIndex) setExpandedIndex(index);
  };

  return (
    <div className="form-editor__cards">
      {error ? <div className="message-banner message-banner--error">{error}</div> : null}

      <div className="form-editor__card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <h4 style={{ margin: 0 }}>Form fields</h4>
          <button type="button" className="primary-action" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {fields.length === 0 ? (
          <p className="settings-form-help">No fields yet. Add your first field below.</p>
        ) : (
          <ul className="form-editor__field-list">
            {fields.map((field, index) => (
              <li key={field.id}>
                <div
                  className={`form-editor__field-card${expandedIndex === index ? " is-expanded" : ""}`}
                >
                  <div
                    className="form-editor__field-card-header"
                    onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedIndex(expandedIndex === index ? null : index); } }}
                  >
                    <span className="form-editor__field-card-icon" aria-hidden="true">
                      {FIELD_TYPE_ICONS[field.type] ?? "?"}
                    </span>
                    <span className="form-editor__field-card-label">
                      {field.label || FIELD_TYPE_LABELS[field.type]}
                    </span>
                    <span className="form-editor__field-card-type">{FIELD_TYPE_LABELS[field.type]}</span>
                    <div className="form-editor__field-card-menu" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ghost-action" disabled={index === 0} onClick={() => handleMoveField(index, -1)}>↑</button>
                      <button type="button" className="ghost-action" disabled={index === fields.length - 1} onClick={() => handleMoveField(index, 1)}>↓</button>
                      <button type="button" className="ghost-action" onClick={() => handleRemoveField(index)}>✕</button>
                    </div>
                  </div>
                  {expandedIndex === index ? (
                    <FieldInlineEditor
                      field={field}
                      onUpdate={(patch) => handleUpdateField(index, patch)}
                      onDone={() => setExpandedIndex(null)}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div style={{ marginTop: "0.75rem" }}>
          <button type="button" className="ghost-action" onClick={() => setPaletteOpen(true)}>
            + Add a new field
          </button>
        </div>
      </div>

      {paletteOpen ? (
        <FieldPaletteModal
          onSelect={handleAddField}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ===========================================================================
// Field Palette Modal
// ===========================================================================

const FIELD_TYPE_ICONS: Partial<Record<FormFieldType, string>> = {
  short_text: "Aa",
  long_text: "¶",
  select: "☰",
  multi_select: "☑",
  checkbox: "✓",
  yes_no: "⇄",
  date: "📅",
  number: "#",
  file_upload: "↑",
  signature: "✎",
  section: "§",
  static_text: "¶",
};

function FieldPaletteModal({
  onSelect,
  onClose,
}: {
  onSelect: (type: FormFieldType) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-label="Add a field">
      <div className="modal-panel" style={{ maxWidth: "min(480px, 100%)" }}>
        <div className="modal-header">
          <h4>Add a field</h4>
          <button type="button" className="ghost-action" onClick={onClose}>Cancel</button>
        </div>
        <div className="modal-form">
          <div className="field-palette">
            {(Object.keys(FIELD_TYPE_LABELS) as FormFieldType[]).map((type) => (
              <button
                key={type}
                type="button"
                className="field-palette__item"
                onClick={() => onSelect(type)}
              >
                <span className="field-palette__icon" aria-hidden="true">{FIELD_TYPE_ICONS[type] ?? "?"}</span>
                <span className="field-palette__label">{FIELD_TYPE_LABELS[type]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Field Inline Editor (expanded inside a field card)
// ===========================================================================

function FieldInlineEditor({
  field,
  onUpdate,
  onDone,
}: {
  field: FormField;
  onUpdate: (patch: Partial<FormField>) => void;
  onDone: () => void;
}) {
  const isLayout = field.type === "section" || field.type === "static_text";
  const hasOptions = field.type === "select" || field.type === "multi_select";

  return (
    <div className="form-editor__field-editor">
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
        <div className="form-editor__field-row">
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
        <div className="form-editor__field-options">
          <span className="form-editor__field-options-label">Options</span>
          {(field.options ?? []).map((opt, optIdx) => (
            <div key={optIdx} className="form-editor__field-option-row">
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

      <div className="form-editor__field-editor-actions">
        <button type="button" className="primary-action" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

// ===========================================================================
// Preview Step
// ===========================================================================

function PreviewStep({
  name,
  description,
  fields,
}: {
  name: string;
  description: string;
  fields: FormField[];
}) {
  return (
    <div className="form-editor__cards">
      <div className="form-editor__card">
        <h4>Preview</h4>
        <p className="settings-form-help">This is how the form will appear to the person filling it out.</p>

        <div className="form-preview">
          <h4 className="form-preview__title">{name || "Untitled form"}</h4>
          {description ? <p className="form-preview__desc">{description}</p> : null}

          {fields.length === 0 ? (
            <p className="settings-form-help">No fields defined yet.</p>
          ) : (
            <div className="form-preview__fields">
              {fields.map((field) => (
                <div key={field.id} className="form-preview__field">
                  <FieldPreview field={field} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldPreview({ field }: { field: FormField }) {
  const label = (
    <span className="form-preview__label">
      {field.label || FIELD_TYPE_LABELS[field.type]}
      {field.required ? <span className="form-preview__required"> *</span> : null}
    </span>
  );

  const help = field.helpText ? (
    <span className="form-preview__help">{field.helpText}</span>
  ) : null;

  switch (field.type) {
    case "section":
      return (
        <div className="form-preview__section">
          <h5>{field.label || "Section"}</h5>
          {field.content ? <p>{field.content}</p> : null}
        </div>
      );

    case "static_text":
      return (
        <div className="form-preview__static">
          {field.label ? <h5>{field.label}</h5> : null}
          <p>{field.content || "Static text content"}</p>
        </div>
      );

    case "short_text":
      return (
        <label className="form-preview__input-label">
          {label}
          {help}
          <input type="text" disabled placeholder={field.placeholder || "Short answer"} />
        </label>
      );

    case "long_text":
      return (
        <label className="form-preview__input-label">
          {label}
          {help}
          <textarea disabled rows={3} placeholder={field.placeholder || "Long answer"} />
        </label>
      );

    case "select":
      return (
        <label className="form-preview__input-label">
          {label}
          {help}
          <select disabled>
            <option value="">{field.placeholder || "Select…"}</option>
            {(field.options ?? []).map((opt, i) => (
              <option key={i} value={opt.value}>{opt.label || `Option ${i + 1}`}</option>
            ))}
          </select>
        </label>
      );

    case "multi_select":
      return (
        <fieldset className="form-preview__check-group">
          <legend>{field.label || "Multi select"}{field.required ? " *" : ""}</legend>
          {help}
          {(field.options ?? []).length === 0 ? (
            <p className="settings-form-help">No options defined.</p>
          ) : (
            (field.options ?? []).map((opt, i) => (
              <label key={i} className="settings-toggle" style={{ fontWeight: 400 }}>
                <input type="checkbox" disabled />
                <span>{opt.label || `Option ${i + 1}`}</span>
              </label>
            ))
          )}
        </fieldset>
      );

    case "checkbox":
      return (
        <label className="settings-toggle" style={{ fontWeight: 400 }}>
          <input type="checkbox" disabled />
          <span>{field.label || "Checkbox"}{field.required ? " *" : ""}</span>
        </label>
      );

    case "yes_no":
      return (
        <fieldset className="form-preview__radio-group">
          <legend>{field.label || "Yes / No"}{field.required ? " *" : ""}</legend>
          {help}
          <label className="settings-toggle" style={{ fontWeight: 400 }}>
            <input type="radio" name={field.id} disabled />
            <span>Yes</span>
          </label>
          <label className="settings-toggle" style={{ fontWeight: 400 }}>
            <input type="radio" name={field.id} disabled />
            <span>No</span>
          </label>
        </fieldset>
      );

    case "date":
      return (
        <label className="form-preview__input-label">
          {label}
          {help}
          <input type="date" disabled />
        </label>
      );

    case "number":
      return (
        <label className="form-preview__input-label">
          {label}
          {help}
          <input type="number" disabled placeholder={field.placeholder || "0"} />
        </label>
      );

    case "file_upload":
      return (
        <label className="form-preview__input-label">
          {label}
          {help}
          <input type="file" disabled />
        </label>
      );

    case "signature":
      return (
        <div className="form-preview__signature">
          {label}
          {help}
          <div className="form-preview__signature-pad">Signature pad</div>
        </div>
      );

    default:
      return (
        <label className="form-preview__input-label">
          {label}
          {help}
          <input type="text" disabled placeholder={field.placeholder || ""} />
        </label>
      );
  }
}
