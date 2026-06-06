import { useEffect, useState, type FormEvent } from "react";
import type {
  AuthenticatedUser,
  CreateFormRequest,
  FormListResponse,
  FormSchema,
  FormSummaryResponse,
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

type ModalState =
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

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some(
    (permission) => permission.key === key && permission.allowed,
  );
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

export function FormsPage({
  definition,
  currentUser,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser | null;
}) {
  const tenantSlug = currentUser?.tenantSlug ?? "";
  const canManage =
    currentUser !== null && hasPermission(currentUser, "settings.manage");
  const canView =
    currentUser !== null && hasPermission(currentUser, "settings.view");

  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [forms, setForms] = useState<FormSummaryResponse[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [status, setStatus] = useState<string | null>(null);

  const loadForms = async () => {
    try {
      const response: FormListResponse = await platformApi.listForms(tenantSlug);
      setForms(response.items);
      setLoadState({ kind: "ready" });
    } catch (error) {
      setLoadState({
        kind: "error",
        message: readErrorMessage(error, "Unable to load forms."),
      });
    }
  };

  useEffect(() => {
    if (!canView || !tenantSlug) return;
    void loadForms();
  }, [tenantSlug, canView]);

  const selectedForm = forms.find((f) => f.id === selectedFormId) ?? null;

  if (!currentUser) {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy"><h3>Sign in required</h3></div>
        </section>
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <p className="eyebrow">{definition.eyebrow}</p>
            <h3>{definition.title}</h3>
            <p>You do not have permission to view forms.</p>
          </div>
        </section>
      </main>
    );
  }

  if (loadState.kind === "loading") {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <p className="eyebrow">{definition.eyebrow}</p>
            <h3>{definition.title}</h3>
          </div>
        </section>
      </main>
    );
  }

  if (loadState.kind === "error") {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <p className="eyebrow">{definition.eyebrow}</p>
            <h3>{definition.title}</h3>
            <p>{loadState.message}</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="ops-page-stack">
      {status ? (
        <div className="message-banner" role="status">
          {status}
          <button type="button" className="ghost-action" onClick={() => setStatus(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <h3>{definition.title}</h3>

      <section className="staff-master-detail">
        <div className="staff-grid">
          <aside className="staff-list-rail" aria-label="Form list">
            <div className="staff-list-rail-header">
              <h4>Forms</h4>
              {canManage ? (
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => setModal({ kind: "add" })}
                >
                  + Add form
                </button>
              ) : null}
            </div>
            {forms.length === 0 ? (
              <p className="staff-list-empty">No forms yet.</p>
            ) : (
              <ul className="staff-list">
                {forms.map((form) => (
                  <li key={form.id}>
                    <button
                      type="button"
                      className={`staff-list-item${
                        selectedFormId === form.id ? " is-active" : ""
                      }`}
                      onClick={() => setSelectedFormId(form.id)}
                    >
                      <div>
                        <strong>{form.name}</strong>
                        <span>
                          {SCOPE_LABELS[form.scope] ?? form.scope}
                          {form.customerPromptTiming
                            ? ` · ${TIMING_LABELS[form.customerPromptTiming] ?? form.customerPromptTiming}`
                            : ""}
                          {" · "}
                          {form.isActive ? "Active" : "Inactive"}
                          {form.currentVersionNumber
                            ? ` · v${form.currentVersionNumber}`
                            : ""}
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
                      {selectedForm.customerPromptTiming
                        ? ` · ${TIMING_LABELS[selectedForm.customerPromptTiming] ?? selectedForm.customerPromptTiming}`
                        : ""}
                      {" · "}
                      {selectedForm.isActive ? "Active" : "Inactive"}
                      {selectedForm.currentVersionNumber
                        ? ` · v${selectedForm.currentVersionNumber}`
                        : ""}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="staff-detail-actions">
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() =>
                          setModal({ kind: "edit", form: selectedForm })
                        }
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() =>
                          handleToggleActive(selectedForm)
                        }
                      >
                        {selectedForm.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  ) : null}
                </header>

                {selectedForm.schema ? (
                  <section className="customer-profile-section">
                    <p className="rail-section-kicker">
                      Schema · {selectedForm.schema.fields.length} fields
                    </p>
                    {selectedForm.schema.description ? (
                      <p className="customer-profile-notes" style={{ fontStyle: "normal" }}>
                        {selectedForm.schema.description}
                      </p>
                    ) : null}
                    {selectedForm.schema.fields.length === 0 ? (
                      <p className="staff-list-empty">No fields defined yet.</p>
                    ) : (
                      <ul className="form-field-preview-list">
                        {selectedForm.schema.fields.map((field) => (
                          <li key={field.id} className="form-field-preview-item">
                            <span className="form-field-preview-type">
                              {field.type.replace(/_/g, " ")}
                            </span>
                            <span className="form-field-preview-label">
                              {field.label}
                              {field.required ? " *" : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : (
                  <section className="customer-profile-section">
                    <p className="staff-list-empty">No schema defined. Edit the form to add fields.</p>
                  </section>
                )}
              </div>
            ) : (
              <div className="staff-detail-empty">
                <p>Select a form to view details.</p>
              </div>
            )}
          </section>
        </div>
      </section>

      {modal.kind !== "none" ? (
        <FormModal
          tenantSlug={tenantSlug}
          modal={modal}
          onClose={() => setModal({ kind: "none" })}
          onSaved={async (msg) => {
            await loadForms();
            setStatus(msg);
            setModal({ kind: "none" });
          }}
          onStatus={setStatus}
        />
      ) : null}
    </main>
  );

  async function handleToggleActive(form: FormSummaryResponse) {
    if (!canManage) return;
    try {
      await platformApi.updateForm(tenantSlug, form.id, {
        isActive: !form.isActive,
      });
      setStatus(`"${form.name}" ${form.isActive ? "deactivated" : "activated"}.`);
      await loadForms();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to update form."));
    }
  }
}

function FormModal({
  tenantSlug,
  modal,
  onClose,
  onSaved,
  onStatus,
}: {
  tenantSlug: string;
  modal: ModalState;
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
  onStatus: (msg: string) => void;
}) {
  const isEdit = modal.kind === "edit";
  const [name, setName] = useState(isEdit ? modal.form.name : "");
  const [scope, setScope] = useState(isEdit ? modal.form.scope : "customer");
  const [timing, setTiming] = useState(
    isEdit ? (modal.form.customerPromptTiming ?? "") : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Form name is required.");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        const body: UpdateFormRequest = {
          name: trimmedName,
          scope,
          customerPromptTiming: timing || null,
        };
        await platformApi.updateForm(tenantSlug, modal.form.id, body);
        await onSaved(`"${trimmedName}" updated.`);
      } else {
        const body: CreateFormRequest = {
          name: trimmedName,
          scope,
          customerPromptTiming: timing || undefined,
          schema: { title: trimmedName, fields: [] },
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
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit form" : "Add form"}
    >
      <div className="modal-panel">
        <header className="modal-header">
          <h4>{isEdit ? "Edit form" : "Add form"}</h4>
          <button type="button" className="ghost-action" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="modal-form" onSubmit={handleSubmit}>
          {error ? (
            <div className="message-banner message-banner--error">{error}</div>
          ) : null}
          <label>
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Health History, Consent Form"
              autoFocus
            />
          </label>
          <label>
            <span>Scope</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="customer">Customer-facing</option>
              <option value="internal">Internal</option>
            </select>
          </label>
          <label>
            <span>Prompt timing</span>
            <select
              value={timing}
              onChange={(event) => setTiming(event.target.value)}
            >
              <option value="">None</option>
              <option value="pre_booking">Pre-booking</option>
              <option value="pre_visit">Pre-visit</option>
              <option value="post_visit">Post-visit</option>
            </select>
          </label>
          <div className="modal-actions">
            <button type="button" className="ghost-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create form"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
