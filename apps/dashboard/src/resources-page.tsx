import { useEffect, useState } from "react";
import type {
  AuthenticatedUser,
  LocationSummary,
  ResourceBlock,
  ResourceSummary,
} from "@booking/shared-types";

import { OverflowMenu } from "./overflow-menu";
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

type ResourceForm = {
  name: string;
  kind: string;
  quantity: string;
  locationId: string;
  notes: string;
};

const KIND_LABELS: Record<string, string> = {
  room: "Room",
  chair: "Chair",
  equipment: "Equipment",
  other: "Other",
};

const emptyForm: ResourceForm = { name: "", kind: "room", quantity: "1", locationId: "", notes: "" };

function toForm(resource: ResourceSummary): ResourceForm {
  return {
    name: resource.name,
    kind: resource.kind,
    quantity: String(resource.quantity),
    locationId: resource.locationId ?? "",
    notes: resource.notes ?? "",
  };
}

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some(
    (permission) => permission.key === key && permission.allowed,
  );
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function formatWindow(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  const time: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${start.toLocaleDateString(undefined, day)}, ${start.toLocaleTimeString(undefined, time)} – ${end.toLocaleTimeString(undefined, time)}`
    : `${start.toLocaleDateString(undefined, day)} ${start.toLocaleTimeString(undefined, time)} – ${end.toLocaleDateString(undefined, day)} ${end.toLocaleTimeString(undefined, time)}`;
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
  // "new" while adding a resource, otherwise a resource id.
  const [selection, setSelection] = useState<string | null>(null);
  const [form, setForm] = useState<ResourceForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [blocks, setBlocks] = useState<ResourceBlock[]>([]);
  const [blocksError, setBlocksError] = useState<string | null>(null);
  const [addingBlock, setAddingBlock] = useState(false);
  const [blockDraft, setBlockDraft] = useState({ startsAt: "", endsAt: "", reason: "" });
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);

  const loadResources = async () => {
    try {
      const response = await platformApi.listResources(tenantSlug);
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

  const selected = resources.find((r) => r.id === selection) ?? null;

  // Open the chosen resource's details and unavailable times.
  useEffect(() => {
    setFormError(null);
    setAddingBlock(false);
    setBlockError(null);
    setBlocks([]);
    setBlocksError(null);
    if (!selected) return;
    setForm(toForm(selected));
    let current = true;
    platformApi.listResourceBlocks(tenantSlug, selected.id)
      .then((response) => { if (current) setBlocks(response.items); })
      .catch((error) => { if (current) setBlocksError(readErrorMessage(error, "Unable to load unavailable times.")); });
    return () => { current = false; };
    // Re-run only when a different resource is opened, not after every save.
  }, [selected?.id, tenantSlug]);

  const locationName = (locationId?: string | null) =>
    locationId ? (locations.find((loc) => loc.id === locationId)?.name ?? "One location") : "All locations";

  if (!currentUser) {
    return <main className="cs-page-stack"><p className="cs-empty">Sign in required</p></main>;
  }

  if (!canView) {
    return <main className="cs-page-stack"><p className="cs-empty">You do not have permission to view resources.</p></main>;
  }

  if (loadState.kind === "error") {
    return <main className="cs-page-stack"><div className="cs-banner cs-banner--error" role="alert">{loadState.message}</div></main>;
  }

  const startNew = () => {
    setSelection("new");
    setForm(emptyForm);
    setFormError(null);
  };

  const isNew = selection === "new";
  const original = selected ? toForm(selected) : emptyForm;
  const isDirty = isNew
    ? form.name.trim() !== ""
    : selected !== null && (Object.keys(form) as Array<keyof ResourceForm>).some((key) => form[key] !== original[key]);
  const tracksUnits = form.kind !== "room";

  const handleSave = async () => {
    if (!canManage) return;
    const name = form.name.trim();
    if (!name) { setFormError("Give the resource a name."); return; }
    // A room is always one unit; other kinds are pooled (e.g. 2 LED panels).
    const units = tracksUnits ? Number(form.quantity) : 1;
    if (!Number.isInteger(units) || units < 1 || units > 100) {
      setFormError("Units owned must be a whole number from 1 to 100.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        name,
        kind: form.kind,
        quantity: units,
        locationId: form.locationId || null,
        notes: form.notes.trim() || null,
      };
      if (isNew) {
        const created = await platformApi.createResource(tenantSlug, body);
        await loadResources();
        setSelection(created.id);
        setStatus(`"${name}" created.`);
      } else if (selected) {
        await platformApi.updateResource(tenantSlug, selected.id, body);
        await loadResources();
        setStatus(`"${name}" updated.`);
      }
    } catch (error) {
      setFormError(readErrorMessage(error, "Unable to save resource."));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (resource: ResourceSummary) => {
    if (!canManage) return;
    if (resource.isActive && resource.usedBy.length > 0) {
      const names = resource.usedBy.map((use) => use.serviceName).join(", ");
      if (!window.confirm(
        `"${resource.name}" is needed by ${names}. While it's inactive those services will be offered without it. Deactivate anyway?`,
      )) return;
    }
    try {
      await platformApi.updateResource(tenantSlug, resource.id, { isActive: !resource.isActive });
      setStatus(`"${resource.name}" ${resource.isActive ? "deactivated" : "activated"}.`);
      await loadResources();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to update resource."));
    }
  };

  const handleAddBlock = async () => {
    if (!selected) return;
    const start = new Date(blockDraft.startsAt);
    const end = new Date(blockDraft.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setBlockError("Choose when it becomes unavailable and when it's back.");
      return;
    }
    if (end <= start) { setBlockError("The end time must be after the start time."); return; }
    setBlockBusy(true);
    setBlockError(null);
    try {
      const created = await platformApi.createResourceBlock(tenantSlug, selected.id, {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        reason: blockDraft.reason.trim() || null,
      });
      setBlocks((prev) => [...prev, created].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
      setBlockDraft({ startsAt: "", endsAt: "", reason: "" });
      setAddingBlock(false);
    } catch (error) {
      setBlockError(readErrorMessage(error, "Unable to save unavailable time."));
    } finally {
      setBlockBusy(false);
    }
  };

  const handleRemoveBlock = async (block: ResourceBlock) => {
    if (!selected) return;
    if (!window.confirm("Remove this unavailable time? The slots it blocked will open up again.")) return;
    try {
      await platformApi.removeResourceBlock(tenantSlug, selected.id, block.id);
      setBlocks((prev) => prev.filter((item) => item.id !== block.id));
    } catch (error) {
      setBlocksError(readErrorMessage(error, "Unable to remove unavailable time."));
    }
  };

  const groups = [
    { title: "Rooms", items: resources.filter((r) => r.kind === "room") },
    { title: "Equipment & other", items: resources.filter((r) => r.kind !== "room") },
  ].filter((group) => group.items.length > 0);

  const renderItem = (resource: ResourceSummary) => {
    const isSelected = selection === resource.id;
    return (
      <li key={resource.id}>
        <button
          type="button"
          className={`cs-svc-rail-item${isSelected ? " is-selected" : ""}${resource.isActive ? "" : " is-hidden"}`}
          aria-current={isSelected ? "true" : undefined}
          onClick={() => setSelection(resource.id)}
        >
          <span className="cs-svc-rail-item__text">
            <span className="cs-svc-rail-item__name">{resource.name}</span>
            <span className="cs-svc-rail-item__meta">
              {resource.kind !== "room" ? `${resource.quantity} ${resource.quantity === 1 ? "unit" : "units"} · ` : ""}
              {locationName(resource.locationId)}
            </span>
          </span>
          {!resource.isActive ? <span className="cs-svc-rail-item__flag">Inactive</span> : null}
        </button>
      </li>
    );
  };

  const renderDetail = () => (
    <div className="cs-md-detail__inner">
      <header className="cs-md-detail__header cs-svc-detail-head">
        <div className="cs-svc-detail-head__text">
          <p className="cs-svc-detail-head__eyebrow">{KIND_LABELS[form.kind] ?? form.kind}</p>
          <h4 className="cs-svc-detail-head__name">{form.name.trim() || (isNew ? "New resource" : selected?.name)}</h4>
        </div>
        {canManage ? (
          <div className="cs-svc-detail-head__actions">
            {selected ? (
              <label className="cs-svc-active-toggle">
                <input
                  type="checkbox"
                  className="cs-switch__input"
                  checked={selected.isActive}
                  onChange={() => void handleToggleActive(selected)}
                />
                <span className={`cs-switch${selected.isActive ? "" : " cs-switch--off"}`} aria-hidden="true" />
                Active
              </label>
            ) : null}
            <button
              type="button"
              className="cs-svc-pill-btn cs-svc-pill-btn--primary"
              onClick={() => void handleSave()}
              disabled={saving || !isDirty}
            >
              {saving ? "Saving…" : isNew ? "Add resource" : "Save"}
            </button>
            {isNew ? (
              <OverflowMenu label="More resource actions" items={[{ label: "Cancel", onSelect: () => setSelection(null) }]} />
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="cs-svc-detail-form">
        <div className="cs-svc-card">
          <section className="cs-svc-section" aria-label="Details">
            <h3 className="cs-svc-card__title">Details</h3>
            <div className="cs-svc-inline-form cs-svc-inline-form--flat">
              <label className="cs-svc-details__field cs-svc-inline-form__wide">
                <span className="cs-svc-details__label">Name</span>
                <input
                  className="cs-svc-details__input"
                  value={form.name}
                  disabled={!canManage}
                  autoFocus={isNew}
                  placeholder="e.g. Treatment Room A, Laser Device 1"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="cs-svc-details__field">
                <span className="cs-svc-details__label">Kind</span>
                <select
                  className="cs-svc-details__input"
                  value={form.kind}
                  disabled={!canManage}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                >
                  <option value="room">Room</option>
                  <option value="chair">Chair</option>
                  <option value="equipment">Equipment</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {tracksUnits ? (
                <label className="cs-svc-details__field">
                  <span className="cs-svc-details__label">Units owned</span>
                  <input
                    className="cs-svc-details__input"
                    type="number"
                    min={1}
                    max={100}
                    value={form.quantity}
                    disabled={!canManage}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                </label>
              ) : null}
              <label className="cs-svc-details__field">
                <span className="cs-svc-details__label">Location</span>
                <select
                  className="cs-svc-details__input"
                  value={form.locationId}
                  disabled={!canManage}
                  onChange={(e) => setForm({ ...form, locationId: e.target.value })}
                >
                  <option value="">All locations</option>
                  {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                </select>
              </label>
              <label className="cs-svc-details__field cs-svc-inline-form__full">
                <span className="cs-svc-details__label">{form.kind === "room" ? "Features" : "Notes"}</span>
                <input
                  className="cs-svc-details__input"
                  value={form.notes}
                  disabled={!canManage}
                  placeholder={form.kind === "room" ? "e.g. Sink, steamer, LED panel" : "Optional"}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
            </div>
            <p className="cs-svc-helper">
              {tracksUnits
                ? "Bookings that need this stop once every unit is in use."
                : "A room is one space; a booking uses one of the rooms its service lists."}
              {" "}Pinned to a location, it is only offered for bookings there.
            </p>
            {formError ? <p role="alert" className="cs-svc-helper cs-svc-helper--error">{formError}</p> : null}
          </section>
        </div>

        {selected ? (
          <>
            <div className="cs-svc-card">
              <section className="cs-svc-section" aria-label="Used by">
                <h3 className="cs-svc-card__title">
                  Used by <span className="cs-svc-card__count">{selected.usedBy.length}</span>
                </h3>
                {selected.usedBy.length === 0 ? (
                  <p className="cs-svc-helper">
                    No service needs this yet, so it doesn&apos;t affect availability. Tick it on a service&apos;s
                    Resources tab to start using it.
                  </p>
                ) : (
                  <div className="cs-svc-rows">
                    {selected.usedBy.map((use) => (
                      <div key={use.serviceId} className={`cs-svc-row${use.isActive ? "" : " cs-svc-row--off"}`}>
                        <span className="cs-svc-row__main">
                          <span className="cs-svc-row__name">{use.serviceName}</span>
                          {use.isActive ? null : <span className="cs-svc-row__tag">Inactive</span>}
                        </span>
                        <span className="cs-svc-row__side">
                          {selected.kind !== "room" ? `Uses ${use.quantity} of ${selected.quantity}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="cs-svc-card">
              <section className="cs-svc-section" aria-label="Unavailable times">
                <div className="cs-svc-section__head">
                  <h3 className="cs-svc-card__title">Unavailable times</h3>
                  {canManage && !addingBlock ? (
                    <button type="button" className="cs-link-btn" onClick={() => setAddingBlock(true)}>
                      + Add unavailable time
                    </button>
                  ) : null}
                </div>
                <p className="cs-svc-section__lead">
                  Block it for maintenance, cleaning or repairs. No new bookings are offered in these times;
                  appointments already booked stay and are flagged here.
                </p>
                {blocksError ? <p role="alert" className="cs-svc-helper cs-svc-helper--error">{blocksError}</p> : null}
                {addingBlock ? (
                  <div className="cs-svc-inline-form" role="group" aria-label="New unavailable time">
                    <label className="cs-svc-details__field cs-svc-inline-form__wide">
                      <span className="cs-svc-details__label">From</span>
                      <input
                        className="cs-svc-details__input"
                        type="datetime-local"
                        value={blockDraft.startsAt}
                        onChange={(e) => setBlockDraft({ ...blockDraft, startsAt: e.target.value })}
                      />
                    </label>
                    <label className="cs-svc-details__field cs-svc-inline-form__wide">
                      <span className="cs-svc-details__label">Until</span>
                      <input
                        className="cs-svc-details__input"
                        type="datetime-local"
                        value={blockDraft.endsAt}
                        onChange={(e) => setBlockDraft({ ...blockDraft, endsAt: e.target.value })}
                      />
                    </label>
                    <label className="cs-svc-details__field cs-svc-inline-form__full">
                      <span className="cs-svc-details__label">Reason</span>
                      <input
                        className="cs-svc-details__input"
                        value={blockDraft.reason}
                        placeholder="e.g. Annual servicing (optional)"
                        onChange={(e) => setBlockDraft({ ...blockDraft, reason: e.target.value })}
                      />
                    </label>
                    <div className="cs-svc-inline-form__actions">
                      {blockError ? <span role="alert" className="cs-svc-helper cs-svc-helper--error">{blockError}</span> : null}
                      <button type="button" className="cs-svc-pill-btn" onClick={() => setAddingBlock(false)} disabled={blockBusy}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="cs-svc-pill-btn cs-svc-pill-btn--primary"
                        onClick={() => void handleAddBlock()}
                        disabled={blockBusy}
                      >
                        {blockBusy ? "Saving…" : "Block this time"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {blocks.length === 0 && !addingBlock && !blocksError ? (
                  <p className="cs-svc-helper">Nothing scheduled.</p>
                ) : (
                  <div className="cs-svc-rows">
                    {blocks.map((block) => (
                      <div key={block.id} className="cs-svc-row cs-svc-row--stack">
                        <div className="cs-svc-row__line">
                          <span className="cs-svc-row__main">
                            <span className="cs-svc-row__text">
                              <span className="cs-svc-row__name">{formatWindow(block.startsAt, block.endsAt)}</span>
                              {block.reason ? <span className="cs-svc-row__sub">{block.reason}</span> : null}
                            </span>
                          </span>
                          {canManage ? (
                            <span className="cs-svc-row__side">
                              <OverflowMenu
                                label="Unavailable time actions"
                                items={[{ label: "Remove", onSelect: () => void handleRemoveBlock(block), danger: true }]}
                              />
                            </span>
                          ) : null}
                        </div>
                        {block.conflicts.length > 0 ? (
                          <div className="cs-svc-warning" role="alert">
                            <strong>
                              {block.conflicts.length === 1
                                ? "1 booked appointment overlaps this time"
                                : `${block.conflicts.length} booked appointments overlap this time`}
                            </strong>
                            <ul>
                              {block.conflicts.map((conflict) => (
                                <li key={conflict.bookingId}>
                                  {conflict.customerName} · {conflict.serviceName} · {formatWindow(conflict.startsAt, conflict.endsAt)}
                                </li>
                              ))}
                            </ul>
                            <span>They are still booked. Reschedule or contact them from the calendar.</span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );

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

      <section className="cs-md-shell" aria-label={definition.title}>
        <div className="cs-md-grid">
          <aside className="cs-md-rail cs-svc-rail" aria-label="Resource list">
            <header className="cs-svc-rail__header">
              <h4 className="cs-svc-rail__title">Resources</h4>
              {canManage ? (
                <button type="button" className="cs-svc-new-btn" aria-label="New resource" onClick={startNew}>
                  New
                  <span className="cs-svc-new-btn__icon" aria-hidden="true">+</span>
                </button>
              ) : null}
            </header>
            <div className="cs-svc-rail__groups">
              {loadState.kind === "loading" ? (
                <p className="cs-svc-rail__empty">Loading…</p>
              ) : groups.length === 0 ? (
                <p className="cs-svc-rail__empty">No resources yet.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.title} className="cs-svc-rail__group">
                    <div className="cs-svc-rail__group-head">
                      <p className="cs-svc-rail__group-label">{group.title}</p>
                    </div>
                    <ul className="cs-svc-rail__list">{group.items.map(renderItem)}</ul>
                  </div>
                ))
              )}
            </div>
          </aside>

          <div className="cs-md-detail" aria-label="Resource details">
            {isNew || selected ? (
              renderDetail()
            ) : (
              <div className="cs-md-detail-panel__empty">
                <p>Select a resource to view details.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
