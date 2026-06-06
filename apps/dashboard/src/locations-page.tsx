import { useEffect, useState, type FormEvent } from "react";
import type {
  AuthenticatedUser,
  CreateLocationRequest,
  LocationSummary,
  UpdateLocationRequest,
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
  | { kind: "edit"; location: LocationSummary };

type FormState = {
  name: string;
  timeZone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
};

const TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
];

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some(
    (permission) => permission.key === key && permission.allowed,
  );
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function emptyForm(): FormState {
  return {
    name: "",
    timeZone: "America/Los_Angeles",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    phone: "",
  };
}

function formFromLocation(location: LocationSummary): FormState {
  return {
    name: location.name,
    timeZone: location.timeZone,
    addressLine1: location.addressLine1 ?? "",
    addressLine2: location.addressLine2 ?? "",
    city: location.city ?? "",
    state: location.state ?? "",
    postalCode: location.postalCode ?? "",
    phone: location.phone ?? "",
  };
}

function formatAddress(location: LocationSummary): string {
  const parts = [
    location.addressLine1,
    location.addressLine2,
    [location.city, location.state, location.postalCode].filter(Boolean).join(", "),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "No address on file.";
}

export function LocationsPage({
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
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [status, setStatus] = useState<string | null>(null);

  const loadLocations = async () => {
    try {
      const response = await platformApi.listLocationsAdmin(tenantSlug);
      setLocations(response.locations);
      setLoadState({ kind: "ready" });
    } catch (error) {
      setLoadState({
        kind: "error",
        message: readErrorMessage(error, "Unable to load locations."),
      });
    }
  };

  useEffect(() => {
    if (!canView || !tenantSlug) return;
    void loadLocations();
  }, [tenantSlug, canView]);

  const selectedLocation =
    locations.find((loc) => loc.id === selectedLocationId) ?? null;

  if (!currentUser) {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <h3>Sign in required</h3>
          </div>
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
            <p>You do not have permission to view locations.</p>
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
          <aside className="staff-list-rail" aria-label="Location list">
            <div className="staff-list-rail-header">
              <h4>Locations</h4>
              {canManage ? (
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => setModal({ kind: "add" })}
                >
                  + Add location
                </button>
              ) : null}
            </div>
            {locations.length === 0 ? (
              <p className="staff-list-empty">No locations yet.</p>
            ) : (
              <ul className="staff-list">
                {locations.map((location) => (
                  <li key={location.id}>
                    <button
                      type="button"
                      className={`staff-list-item${
                        selectedLocationId === location.id ? " is-active" : ""
                      }`}
                      onClick={() => setSelectedLocationId(location.id)}
                    >
                      <div>
                        <strong>{location.name}</strong>
                        <span>
                          {location.isActive ? "Active" : "Inactive"} · {location.timeZone}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="staff-detail-panel" aria-label="Location details">
            {selectedLocation ? (
              <div className="customer-profile">
                <header className="customer-profile-header">
                  <div>
                    <h4>{selectedLocation.name}</h4>
                    <p className="customer-profile-since">
                      {selectedLocation.isActive ? "Active" : "Inactive"} · {selectedLocation.timeZone}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="staff-detail-actions">
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() =>
                          setModal({ kind: "edit", location: selectedLocation })
                        }
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() =>
                          handleToggleActive(selectedLocation)
                        }
                      >
                        {selectedLocation.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  ) : null}
                </header>

                <section className="customer-profile-section">
                  <p className="rail-section-kicker">Address</p>
                  <p className="customer-profile-notes" style={{ fontStyle: "normal" }}>
                    {formatAddress(selectedLocation)}
                  </p>
                </section>

                {selectedLocation.phone ? (
                  <section className="customer-profile-section">
                    <p className="rail-section-kicker">Phone</p>
                    <p className="customer-profile-notes" style={{ fontStyle: "normal" }}>
                      {selectedLocation.phone}
                    </p>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="staff-detail-empty">
                <p>Select a location to view details.</p>
              </div>
            )}
          </section>
        </div>
      </section>

      {modal.kind !== "none" ? (
        <LocationModal
          tenantSlug={tenantSlug}
          modal={modal}
          onClose={() => setModal({ kind: "none" })}
          onSaved={async (msg) => {
            await loadLocations();
            setStatus(msg);
            setModal({ kind: "none" });
          }}
          onStatus={setStatus}
        />
      ) : null}
    </main>
  );

  async function handleToggleActive(location: LocationSummary) {
    if (!canManage) return;
    try {
      if (location.isActive) {
        await platformApi.deactivateLocation(tenantSlug, location.id);
        setStatus(`"${location.name}" deactivated.`);
      } else {
        await platformApi.updateLocation(tenantSlug, location.id, { isActive: true });
        setStatus(`"${location.name}" activated.`);
      }
      await loadLocations();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to update location."));
    }
  }
}

function LocationModal({
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
  const [form, setForm] = useState<FormState>(
    isEdit ? formFromLocation(modal.location) : emptyForm(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const name = form.name.trim();
    if (!name) {
      setError("Location name is required.");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        const body: UpdateLocationRequest = {
          name,
          timeZone: form.timeZone,
          addressLine1: form.addressLine1.trim() || null,
          addressLine2: form.addressLine2.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
          postalCode: form.postalCode.trim() || null,
          phone: form.phone.trim() || null,
        };
        await platformApi.updateLocation(tenantSlug, modal.location.id, body);
        await onSaved(`"${name}" updated.`);
      } else {
        const body: CreateLocationRequest = {
          name,
          timeZone: form.timeZone,
          addressLine1: form.addressLine1.trim() || undefined,
          addressLine2: form.addressLine2.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          postalCode: form.postalCode.trim() || undefined,
          phone: form.phone.trim() || null,
        };
        await platformApi.createLocation(tenantSlug, body);
        await onSaved(`"${name}" created.`);
      }
    } catch (err) {
      onStatus(readErrorMessage(err, "Unable to save location."));
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
      aria-label={isEdit ? "Edit location" : "Add location"}
    >
      <div className="modal-panel modal-panel--wide">
        <header className="modal-header">
          <h4>{isEdit ? "Edit location" : "Add location"}</h4>
          <button type="button" className="ghost-action" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="modal-form" onSubmit={handleSubmit}>
          {error ? (
            <div className="message-banner message-banner--error">{error}</div>
          ) : null}
          <div className="staff-detail-grid">
            <label>
              <span>Name</span>
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                autoFocus
              />
            </label>
            <label>
              <span>Time zone</span>
              <select
                value={form.timeZone}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, timeZone: event.target.value }))
                }
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
            <label className="staff-detail-grid-wide">
              <span>Address line 1</span>
              <input
                value={form.addressLine1}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, addressLine1: event.target.value }))
                }
                placeholder="123 Main St"
              />
            </label>
            <label className="staff-detail-grid-wide">
              <span>Address line 2</span>
              <input
                value={form.addressLine2}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, addressLine2: event.target.value }))
                }
                placeholder="Suite 200"
              />
            </label>
            <label>
              <span>City</span>
              <input
                value={form.city}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, city: event.target.value }))
                }
              />
            </label>
            <label>
              <span>State</span>
              <input
                value={form.state}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, state: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Postal code</span>
              <input
                value={form.postalCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, postalCode: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Phone</span>
              <input
                value={form.phone}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, phone: event.target.value }))
                }
                placeholder="(555) 123-4567"
              />
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="ghost-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create location"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
