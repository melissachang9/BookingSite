import { useEffect, useState, type FormEvent } from "react";
import type {
  AuthenticatedUser,
  CreateResourceRequest,
  ResourceListResponse,
  ResourceSummary,
  UpdateResourceRequest,
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
  | { kind: "edit"; resource: ResourceSummary };

const KIND_LABELS: Record<string, string> = {
  room: "Room",
  chair: "Chair",
  equipment: "Equipment",
  other: "Other",
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

export function ResourcesPage({
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
  const [resources, setResources] = useState<ResourceSummary[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [status, setStatus] = useState<string | null>(null);

  const loadResources = async () => {
    try {
      const response: ResourceListResponse = await platformApi.listResources(tenantSlug);
      setResources(response.items);
      setLoadState({ kind: "ready" });
    } catch (error) {
      setLoadState({
        kind: "error",
        message: readErrorMessage(error, "Unable to load resources."),
      });
    }
  };

  useEffect(() => {
    if (!canView || !tenantSlug) return;
    void loadResources();
  }, [tenantSlug, canView]);

  const selectedResource =
    resources.find((r) => r.id === selectedResourceId) ?? null;

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
            <p>You do not have permission to view resources.</p>
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
          <aside className="staff-list-rail" aria-label="Resource list">
            <div className="staff-list-rail-header">
              <h4>Resources</h4>
              {canManage ? (
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => setModal({ kind: "add" })}
                >
                  + Add resource
                </button>
              ) : null}
            </div>
            {resources.length === 0 ? (
              <p className="staff-list-empty">No resources yet.</p>
            ) : (
              <ul className="staff-list">
                {resources.map((resource) => (
                  <li key={resource.id}>
                    <button
                      type="button"
                      className={`staff-list-item${
                        selectedResourceId === resource.id ? " is-active" : ""
                      }`}
                      onClick={() => setSelectedResourceId(resource.id)}
                    >
                      <div>
                        <strong>{resource.name}</strong>
                        <span>
                          {KIND_LABELS[resource.kind] ?? resource.kind}
                          {" · "}
                          {resource.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="staff-detail-panel" aria-label="Resource details">
            {selectedResource ? (
              <div className="customer-profile">
                <header className="customer-profile-header">
                  <div>
                    <h4>{selectedResource.name}</h4>
                    <p className="customer-profile-since">
                      {KIND_LABELS[selectedResource.kind] ?? selectedResource.kind}
                      {" · "}
                      {selectedResource.isActive ? "Active" : "Inactive"}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="staff-detail-actions">
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() =>
                          setModal({ kind: "edit", resource: selectedResource })
                        }
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() =>
                          handleToggleActive(selectedResource)
                        }
                      >
                        {selectedResource.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  ) : null}
                </header>

                {selectedResource.notes ? (
                  <section className="customer-profile-section">
                    <p className="rail-section-kicker">Notes</p>
                    <p className="customer-profile-notes">
                      {selectedResource.notes}
                    </p>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="staff-detail-empty">
                <p>Select a resource to view details.</p>
              </div>
            )}
          </section>
        </div>
      </section>

      {modal.kind !== "none" ? (
        <ResourceModal
          tenantSlug={tenantSlug}
          modal={modal}
          onClose={() => setModal({ kind: "none" })}
          onSaved={async (msg) => {
            await loadResources();
            setStatus(msg);
            setModal({ kind: "none" });
          }}
          onStatus={setStatus}
        />
      ) : null}
    </main>
  );

  async function handleToggleActive(resource: ResourceSummary) {
    if (!canManage) return;
    try {
      await platformApi.updateResource(tenantSlug, resource.id, {
        isActive: !resource.isActive,
      });
      setStatus(`"${resource.name}" ${resource.isActive ? "deactivated" : "activated"}.`);
      await loadResources();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to update resource."));
    }
  }
}

function ResourceModal({
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
  const [name, setName] = useState(isEdit ? modal.resource.name : "");
  const [kind, setKind] = useState(isEdit ? modal.resource.kind : "room");
  const [notes, setNotes] = useState(isEdit ? (modal.resource.notes ?? "") : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Resource name is required.");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        const body: UpdateResourceRequest = {
          name: trimmedName,
          kind,
          notes: notes.trim() || null,
        };
        await platformApi.updateResource(tenantSlug, modal.resource.id, body);
        await onSaved(`"${trimmedName}" updated.`);
      } else {
        const body: CreateResourceRequest = {
          name: trimmedName,
          kind,
          notes: notes.trim() || undefined,
        };
        await platformApi.createResource(tenantSlug, body);
        await onSaved(`"${trimmedName}" created.`);
      }
    } catch (err) {
      onStatus(readErrorMessage(err, "Unable to save resource."));
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
      aria-label={isEdit ? "Edit resource" : "Add resource"}
    >
      <div className="modal-panel">
        <header className="modal-header">
          <h4>{isEdit ? "Edit resource" : "Add resource"}</h4>
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
              placeholder="e.g. Treatment Room A, Laser Device 1"
              autoFocus
            />
          </label>
          <label>
            <span>Kind</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="room">Room</option>
              <option value="chair">Chair</option>
              <option value="equipment">Equipment</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            <span>Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Optional notes about this resource"
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="ghost-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create resource"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
