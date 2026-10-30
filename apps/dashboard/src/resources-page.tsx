import { useEffect, useState, type FormEvent } from "react";
import type {
  AuthenticatedUser,
  CreateResourceRequest,
  LocationSummary,
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
  const [locations, setLocations] = useState<LocationSummary[]>([]);
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
    // Locations only label and pin resources; the page still works without them.
    platformApi.listLocations(tenantSlug)
      .then((response) => setLocations(response.locations))
      .catch(() => setLocations([]));
  }, [tenantSlug, canView]);

  const locationName = (locationId?: string | null) =>
    locationId ? (locations.find((loc) => loc.id === locationId)?.name ?? "One location") : "All locations";

  const selectedResource =
    resources.find((r) => r.id === selectedResourceId) ?? null;

  if (!currentUser) {
    return <main className="cs-page-stack"><p className="cs-empty">Sign in required</p></main>;
  }

  if (!canView) {
    return <main className="cs-page-stack"><p className="cs-empty">You do not have permission to view resources.</p></main>;
  }

  if (loadState.kind === "error") {
    return <main className="cs-page-stack"><div className="cs-banner cs-banner--error" role="alert">{loadState.message}</div></main>;
  }

  return (
    <main className="cs-page-stack">
      {status ? (
        <div className="cs-banner" role="status">
          {status}
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={() => setStatus(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <h3>{definition.title}</h3>

      <section className="cs-md-shell">
        <div className="cs-md-grid">
          <aside className="cs-md-rail" aria-label="Resource list">
            <div className="cs-md-rail__header">
              <h4>Resources</h4>
              {canManage ? (
                <button
                  type="button"
                  className="cs-btn cs-btn--ghost cs-btn--sm"
                  onClick={() => setModal({ kind: "add" })}
                >
                  + Add resource
                </button>
              ) : null}
            </div>
            {resources.length === 0 ? (
              <p className="cs-empty">No resources yet.</p>
            ) : (
              <>
                {[
                  { title: "Rooms", items: resources.filter((r) => r.kind === "room") },
                  { title: "Equipment & other", items: resources.filter((r) => r.kind !== "room") },
                ]
                  .filter((group) => group.items.length > 0)
                  .map((group) => (
                    <div key={group.title}>
                      <p className="cs-kicker">{group.title}</p>
                      <ul className="cs-md-list">
                        {group.items.map((resource) => (
                          <li key={resource.id}>
                            <button
                              type="button"
                              className={`cs-md-list__item${
                                selectedResourceId === resource.id ? " is-active" : ""
                              }`}
                              onClick={() => setSelectedResourceId(resource.id)}
                            >
                              <div>
                                <strong>{resource.name}</strong>
                                <span>
                                  {KIND_LABELS[resource.kind] ?? resource.kind}
                                  {resource.kind !== "room" ? ` · ${resource.quantity} ${resource.quantity === 1 ? "unit" : "units"}` : ""}
                                  {" · "}
                                  {locationName(resource.locationId)}
                                  {resource.isActive ? "" : " · Inactive"}
                                </span>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </>
            )}
          </aside>

          <section className="cs-md-detail-panel" aria-label="Resource details">
            {selectedResource ? (
              <div className="cs-md-detail-panel__body">
                <header className="cs-md-detail-panel__header">
                  <div>
                    <h4>{selectedResource.name}</h4>
                    <p className="cs-md-detail-panel__meta">
                      {KIND_LABELS[selectedResource.kind] ?? selectedResource.kind}
                      {selectedResource.kind !== "room"
                        ? ` · ${selectedResource.quantity} ${selectedResource.quantity === 1 ? "unit" : "units"}`
                        : ""}
                      {" · "}
                      {locationName(selectedResource.locationId)}
                      {" · "}
                      {selectedResource.isActive ? "Active" : "Inactive"}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="cs-md-detail__actions">
                      <button
                        type="button"
                        className="cs-btn cs-btn--ghost cs-btn--sm"
                        onClick={() =>
                          setModal({ kind: "edit", resource: selectedResource })
                        }
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="cs-btn cs-btn--ghost cs-btn--sm"
                        onClick={() =>
                          handleToggleActive(selectedResource)
                        }
                      >
                        {selectedResource.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  ) : null}
                </header>

                <section className="cs-md-detail-panel__section" aria-label="Used by">
                  <p className="cs-kicker">Used by</p>
                  {selectedResource.usedBy.length === 0 ? (
                    <p className="cs-md-detail-panel__notes">
                      No service needs this yet, so it doesn&apos;t affect availability. Tick it on a
                      service&apos;s Resources tab to start using it.
                    </p>
                  ) : (
                    <ul className="cs-md-detail-panel__list">
                      {selectedResource.usedBy.map((use) => (
                        <li key={use.serviceId}>
                          <strong>{use.serviceName}</strong>
                          {use.isActive ? "" : " (inactive)"}
                          {selectedResource.kind !== "room"
                            ? ` · uses ${use.quantity} of ${selectedResource.quantity}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {selectedResource.notes ? (
                  <section className="cs-md-detail-panel__section">
                    <p className="cs-kicker">Notes</p>
                    <p className="cs-md-detail-panel__notes">
                      {selectedResource.notes}
                    </p>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="cs-md-detail-panel__empty">
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
          locations={locations}
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
  locations,
  onClose,
  onSaved,
  onStatus,
}: {
  tenantSlug: string;
  modal: ModalState;
  locations: LocationSummary[];
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
  onStatus: (msg: string) => void;
}) {
  const isEdit = modal.kind === "edit";
  const [name, setName] = useState(isEdit ? modal.resource.name : "");
  const [kind, setKind] = useState(isEdit ? modal.resource.kind : "room");
  const [notes, setNotes] = useState(isEdit ? (modal.resource.notes ?? "") : "");
  const [quantity, setQuantity] = useState(String(isEdit ? modal.resource.quantity : 1));
  const [locationId, setLocationId] = useState(isEdit ? (modal.resource.locationId ?? "") : "");
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
    // A room is always one unit; other kinds are pooled (e.g. 2 LED panels).
    const units = kind === "room" ? 1 : Number(quantity);
    if (!Number.isInteger(units) || units < 1 || units > 100) {
      setError("Units owned must be a whole number from 1 to 100.");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        const body: UpdateResourceRequest = {
          name: trimmedName,
          kind,
          notes: notes.trim() || null,
          quantity: units,
          locationId: locationId || null,
        };
        await platformApi.updateResource(tenantSlug, modal.resource.id, body);
        await onSaved(`"${trimmedName}" updated.`);
      } else {
        const body: CreateResourceRequest = {
          name: trimmedName,
          kind,
          notes: notes.trim() || undefined,
          quantity: units,
          locationId: locationId || null,
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
      className="cs-modal"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit resource" : "Add resource"}
    >
      <div className="cs-modal__panel">
        <header className="cs-modal__header">
          <h4>{isEdit ? "Edit resource" : "Add resource"}</h4>
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="cs-modal__form" onSubmit={handleSubmit}>
          {error ? (
            <div className="cs-banner cs-banner--error">{error}</div>
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
          {kind !== "room" ? (
            <label>
              <span>Units owned</span>
              <input
                type="number"
                min={1}
                max={100}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              <small className="cs-settings-form-help">
                Bookings that need this stop once every unit is in use.
              </small>
            </label>
          ) : null}
          <label>
            <span>Location</span>
            <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">All locations</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
            <small className="cs-settings-form-help">
              {kind === "room"
                ? "A room pinned to a location is only offered for bookings there."
                : "Equipment pinned to a location is only available for bookings there."}
            </small>
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
          <div className="cs-modal__actions">
            <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create resource"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
