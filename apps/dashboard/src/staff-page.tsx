import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AuthenticatedUser,
  CreateProviderRequest,
  CreateProviderTimeOffRequest,
  CreateStaffRequest,
  LocationSummary,
  PermissionCatalogResponse,
  PermissionDefinition,
  PermissionKey,
  ProviderSchedule,
  ProviderScheduleEntry,
  ProviderSummary,
  ProviderTimeOffEntry,
  ReplaceProviderScheduleRequest,
  ReplaceUserPermissionsRequest,
  ServiceSummary,
  TenantUserSummary,
  UpdateProviderRequest,
  UpdateTenantUserRequest,
  UserPermissionOverrideEntry,
  UserPermissionsResponse,
} from "@booking/shared-types";

import { apiBaseUrl, platformApi } from "./platform-api";

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
  | { kind: "password"; user: TenantUserSummary }
  | { kind: "addProviderFor"; user: TenantUserSummary };

type TabKey = "details" | "services" | "schedule" | "timeOff" | "permissions";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  provider: "Provider",
};

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "staff", label: "Staff" },
  { value: "provider", label: "Provider" },
];

const storefrontBaseUrl =
  import.meta.env.VITE_PUBLIC_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

async function uploadAvatarFile(tenantSlug: string, file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  body.append("tenant_id", tenantSlug);
  const response = await fetch(`${apiBaseUrl}/forms/upload`, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    let detail = "Unable to upload photo.";
    try {
      const data = (await response.json()) as { detail?: string };
      if (typeof data.detail === "string" && data.detail.trim()) {
        detail = data.detail;
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const data = (await response.json()) as { url?: string };
  if (!data.url) {
    throw new Error("Upload did not return a URL.");
  }
  return data.url;
}

function CropModal({
  file,
  onSave,
  onCancel,
}: {
  file: File;
  onSave: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1); // multiplier on top of fitScale; 1 = full photo visible
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const suppressClickRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Load file as data URL
  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => setDataUrl(reader.result as string);
    reader.readAsDataURL(file);
    return () => { reader.abort(); };
  }, [file]);

  // Keep offset ref in sync so document-level handlers read fresh values
  useEffect(() => {
    offsetRef.current = { x: offsetX, y: offsetY };
  }, [offsetX, offsetY]);

  // When image loads, compute the fit scale so the shorter side fills the circle
  const onImageLoad = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    setNaturalSize({ w: nw, h: nh });
    const fs = maskSize / Math.min(nw, nh);
    setFitScale(fs);
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
  }, []);

  const maskSize = 260; // px — the crop circle diameter

  // Effective scale = fitScale × zoom multiplier
  const scale = fitScale * zoom;

  // Derived image display size at current scale
  const imgW = naturalSize ? naturalSize.w * scale : maskSize;
  const imgH = naturalSize ? naturalSize.h * scale : maskSize;

  const startDrag = useCallback((clientX: number, clientY: number) => {
    setDragging(true);
    dragStartRef.current = {
      x: clientX,
      y: clientY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
    };
  }, []);

  // Bind move/up to document so drag continues even when the pointer leaves the mask
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      e.preventDefault();
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setOffsetX(dragStartRef.current.ox + dx);
      setOffsetY(dragStartRef.current.oy + dy);
    };
    const onUp = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = true;
      setDragging(false);
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - dragStartRef.current.x;
      const dy = t.clientY - dragStartRef.current.y;
      setOffsetX(dragStartRef.current.ox + dx);
      setOffsetY(dragStartRef.current.oy + dy);
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      suppressClickRef.current = true;
      setDragging(false);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [dragging]);

  // Always-on click guard: the browser synthesizes a click after mouseup.
  // If a drag just ended, suppress that click so it doesn't hit Cancel/Save.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (suppressClickRef.current) {
        e.preventDefault();
        e.stopPropagation();
        suppressClickRef.current = false;
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const handleSave = useCallback(() => {
    if (!imageRef.current) return;
    const img = imageRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = maskSize;
    canvas.height = maskSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clip to circle
    ctx.beginPath();
    ctx.arc(maskSize / 2, maskSize / 2, maskSize / 2, 0, Math.PI * 2);
    ctx.clip();

    // Draw image at its natural-aspect display size, centered + offset
    const drawX = (maskSize - imgW) / 2 + offsetX;
    const drawY = (maskSize - imgH) / 2 + offsetY;
    ctx.drawImage(img, drawX, drawY, imgW, imgH);

    canvas.toBlob((blob) => {
      if (blob) onSave(blob);
    }, "image/png");
  }, [offsetX, offsetY, imgW, imgH, onSave]);

  if (!dataUrl) {
    return (
      <div className="modal-backdrop" role="dialog" aria-label="Crop photo">
        <div className="modal-panel crop-modal">
          <div className="modal-header">
            <h4>Crop photo</h4>
            <button type="button" className="ghost-action" onClick={onCancel}>Cancel</button>
          </div>
          <div className="modal-form" style={{ alignItems: "center", padding: "2rem" }}>
            <p className="settings-form-help">Loading image…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-label="Crop photo">
      <div className="modal-panel crop-modal">
        <div className="modal-header">
          <h4>Crop photo</h4>
          <button type="button" className="ghost-action" onClick={onCancel}>Cancel</button>
        </div>
        <div className="crop-modal__body">
          <div
            className="crop-modal__mask"
            onMouseDown={(e) => { e.preventDefault(); startDrag(e.clientX, e.clientY); }}
            onTouchStart={(e) => {
              e.preventDefault();
              const t = e.touches[0];
              if (t) startDrag(t.clientX, t.clientY);
            }}
            style={{ cursor: dragging ? "grabbing" : "grab" }}
          >
            <img
              ref={imageRef}
              src={dataUrl}
              alt=""
              onLoad={onImageLoad}
              draggable={false}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: `${imgW}px`,
                height: `${imgH}px`,
                transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`,
                pointerEvents: "none",
              }}
            />
          </div>
          <div className="crop-modal__controls">
            <label className="crop-modal__zoom-label">
              <span>Zoom</span>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
              />
            </label>
          </div>
        </div>
        <div className="modal-actions" style={{ padding: "0 1.25rem 1.25rem" }}>
          <button type="button" className="ghost-action" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary-action" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

function AvatarUploader({
  tenantSlug,
  value,
  name,
  onChange,
  inputId,
}: {
  tenantSlug: string;
  value: string;
  name: string;
  onChange: (next: string) => void;
  inputId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setCropFile(file);
  };

  const handleCropSave = async (blob: Blob) => {
    setCropFile(null);
    setUploading(true);
    try {
      const croppedFile = new File([blob], "avatar.png", { type: "image/png" });
      const url = await uploadAvatarFile(tenantSlug, croppedFile);
      onChange(url);
    } catch (err) {
      setError(readErrorMessage(err, "Unable to upload photo."));
    } finally {
      setUploading(false);
    }
  };

  const handleCropCancel = () => {
    setCropFile(null);
  };

  return (
    <>
      {cropFile ? (
        <CropModal file={cropFile} onSave={handleCropSave} onCancel={handleCropCancel} />
      ) : null}
      <div className="staff-avatar-uploader">
        <div className="staff-avatar-uploader__preview" aria-hidden="true">
          {value ? <img src={value} alt="" /> : <span>{initialsOf(name) || "?"}</span>}
        </div>
        <div className="staff-avatar-uploader__controls">
          <input
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void handleFile(file);
              event.target.value = "";
            }}
            disabled={uploading}
          />
          {value ? (
            <button
              type="button"
              className="ghost-action"
              onClick={() => onChange("")}
              disabled={uploading}
            >
              Remove
            </button>
          ) : null}
          {uploading ? <small className="settings-form-help">Uploading…</small> : null}
          {error ? (
            <small role="alert" className="settings-error">
              {error}
            </small>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function StaffPage({
  definition,
  currentUser,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser;
}) {
  const canManage = hasPermission(currentUser, "settings.manage");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [users, setUsers] = useState<TenantUserSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all([
      platformApi.listTenantUsers(currentUser.tenantSlug),
      platformApi.listProvidersAdmin(currentUser.tenantSlug),
      platformApi.listLocationsAdmin(currentUser.tenantSlug),
      platformApi.listServices(currentUser.tenantSlug),
    ])
      .then(([usersRes, providersRes, locationsRes, servicesRes]) => {
        if (cancelled) return;
        setUsers(usersRes.users);
        setProviders(providersRes.providers);
        setLocations(locationsRes.locations);
        setServices(servicesRes.services);
        setState({ kind: "ready" });
        setSelectedUserId((prev) => prev ?? usersRes.users[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: readErrorMessage(error, "Unable to load team roster."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, currentUser.tenantSlug, refreshKey]);

  const handleSaved = () => {
    setModal({ kind: "none" });
    setRefreshKey((value) => value + 1);
  };

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );
  const selectedProvider = useMemo(
    () => (selectedUser ? providers.find((p) => p.userId === selectedUser.id) ?? null : null),
    [providers, selectedUser],
  );

  if (!canManage) {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <p className="eyebrow">{definition.eyebrow}</p>
            <h3>{definition.title}</h3>
            <p>You do not have permission to view the team roster.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="ops-page-stack">
      <section className="ops-panel staff-master-detail">
        {state.kind === "loading" ? <p>Loading roster…</p> : null}
        {state.kind === "error" ? (
          <p role="alert" className="settings-error">
            {state.message}
          </p>
        ) : null}
        {state.kind === "ready" ? (
          <div className="staff-grid">
            <aside className="staff-list-rail">
              <header className="staff-list-rail-header">
                <h4>Team</h4>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => setModal({ kind: "add" })}
                >
                  Add staff
                </button>
              </header>
              {users.length === 0 ? (
                <p className="settings-form-help">No users configured yet.</p>
              ) : (
                <ul className="staff-list">
                  {users.map((user) => {
                    const provider = providers.find((p) => p.userId === user.id);
                    const isActive = user.id === selectedUserId;
                    return (
                      <li key={user.id}>
                        <button
                          type="button"
                          className={`staff-list-item${isActive ? " is-active" : ""}`}
                          onClick={() => {
                            setSelectedUserId(user.id);
                            setActiveTab("details");
                          }}
                        >
                          {user.avatarUrl ? (
                            <img
                              className="staff-avatar"
                              src={user.avatarUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="staff-avatar staff-avatar--initials" aria-hidden>
                              {initialsOf(user.name)}
                            </span>
                          )}
                          <span className="staff-list-meta">
                            <span className="staff-list-name">{user.name}</span>
                            <span className="staff-list-role">
                              {ROLE_LABELS[user.role] ?? user.role}
                              {provider ? " · Provider" : ""}
                              {!user.isActive ? " · Inactive" : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            <div className="staff-detail">
              {selectedUser === null ? (
                <p className="settings-form-help">Select a team member to view details.</p>
              ) : (
                <StaffDetail
                  tenantSlug={currentUser.tenantSlug}
                  user={selectedUser}
                  provider={selectedProvider}
                  locations={locations}
                  services={services}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  onResetPassword={() => setModal({ kind: "password", user: selectedUser })}
                  onLinkProvider={() => setModal({ kind: "addProviderFor", user: selectedUser })}
                  onSaved={handleSaved}
                />
              )}
            </div>
          </div>
        ) : null}
      </section>

      {modal.kind === "add" ? (
        <AddStaffModal
          tenantSlug={currentUser.tenantSlug}
          locations={locations}
          services={services}
          onClose={() => setModal({ kind: "none" })}
          onSaved={handleSaved}
        />
      ) : null}
      {modal.kind === "password" ? (
        <ResetPasswordModal
          tenantSlug={currentUser.tenantSlug}
          user={modal.user}
          onClose={() => setModal({ kind: "none" })}
          onSaved={handleSaved}
        />
      ) : null}
      {modal.kind === "addProviderFor" ? (
        <AddProviderModal
          tenantSlug={currentUser.tenantSlug}
          user={modal.user}
          locations={locations}
          services={services}
          onClose={() => setModal({ kind: "none" })}
          onSaved={handleSaved}
        />
      ) : null}
    </main>
  );
}

function StaffDetail({
  tenantSlug,
  user,
  provider,
  locations,
  services,
  activeTab,
  onTabChange,
  onResetPassword,
  onLinkProvider,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  provider: ProviderSummary | null;
  locations: LocationSummary[];
  services: ServiceSummary[];
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onResetPassword: () => void;
  onLinkProvider: () => void;
  onSaved: () => void;
}) {
  const tabs: Array<{ key: TabKey; label: string; disabled?: boolean }> = [
    { key: "details", label: "Details" },
    { key: "services", label: "Services", disabled: !provider },
    { key: "schedule", label: "Work hours", disabled: !provider },
    { key: "timeOff", label: "Time off", disabled: !provider },
    { key: "permissions", label: "Permissions" },
  ];

  const directBookingLink = provider
    ? `${storefrontBaseUrl}/${tenantSlug}?providerId=${provider.id}`
    : null;

  return (
    <div className="staff-detail-inner">
      <header className="staff-detail-header">
        <div>
          <p className="eyebrow">{ROLE_LABELS[user.role] ?? user.role}</p>
          <h4>{user.name}</h4>
          <p className="settings-form-help">
            {user.email}
            {user.phone ? ` · ${user.phone}` : ""}
            {!user.isActive ? " · Inactive" : ""}
          </p>
        </div>
        <div className="staff-detail-actions">
          <button type="button" className="ghost-action" onClick={onResetPassword}>
            Reset password
          </button>
          {provider === null ? (
            <button type="button" className="ghost-action" onClick={onLinkProvider}>
              Make service provider
            </button>
          ) : null}
        </div>
      </header>

      <nav className="staff-detail-tabs" role="tablist" aria-label="Staff sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            disabled={tab.disabled}
            className={`staff-detail-tab${activeTab === tab.key ? " is-active" : ""}`}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "details" ? (
        <DetailsTab
          tenantSlug={tenantSlug}
          user={user}
          directBookingLink={directBookingLink}
          onSaved={onSaved}
        />
      ) : null}
      {activeTab === "services" && provider ? (
        <ServicesTab
          tenantSlug={tenantSlug}
          provider={provider}
          locations={locations}
          services={services}
          onSaved={onSaved}
        />
      ) : null}
      {activeTab === "schedule" && provider ? (
        <ScheduleTab tenantSlug={tenantSlug} provider={provider} locations={locations} />
      ) : null}
      {activeTab === "timeOff" && provider ? (
        <TimeOffTab tenantSlug={tenantSlug} provider={provider} />
      ) : null}
      {activeTab === "permissions" ? (
        <PermissionsTab tenantSlug={tenantSlug} user={user} />
      ) : null}
    </div>
  );
}

function DetailsTab({
  tenantSlug,
  user,
  directBookingLink,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  directBookingLink: string | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    phone: user.phone ?? "",
    avatarUrl: user.avatarUrl ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      phone: user.phone ?? "",
      avatarUrl: user.avatarUrl ?? "",
    });
  }, [user]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload: UpdateTenantUserRequest = {};
    if (form.name.trim() !== user.name) payload.name = form.name.trim();
    if (form.role !== user.role) payload.role = form.role;
    if (form.isActive !== user.isActive) payload.isActive = form.isActive;
    const phone = form.phone.trim();
    if (phone !== (user.phone ?? "")) payload.phone = phone || null;
    const avatar = form.avatarUrl.trim();
    if (avatar !== (user.avatarUrl ?? "")) payload.avatarUrl = avatar || null;
    if (Object.keys(payload).length === 0) {
      setSubmitting(false);
      return;
    }
    try {
      await platformApi.updateTenantUser(tenantSlug, user.id, payload);
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to update user."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="staff-detail-form" onSubmit={submit}>
      <div className="staff-detail-grid">
        <label>
          <span>Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={user.email} disabled readOnly />
        </label>
        <label>
          <span>Role</span>
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Phone</span>
          <input
            type="text"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            placeholder="+1 555-555-1212"
          />
        </label>
        <label className="staff-detail-grid-wide">
          <span>Profile photo</span>
          <AvatarUploader
            tenantSlug={tenantSlug}
            value={form.avatarUrl}
            name={form.name}
            inputId={`user-${user.id}-avatar-upload`}
            onChange={(next) => setForm({ ...form, avatarUrl: next })}
          />
          <small className="settings-form-help">
            JPG, PNG, GIF, WEBP, or HEIC up to 10&nbsp;MB.
          </small>
        </label>
        <label className="settings-toggle staff-detail-grid-wide">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />
          <span>Active (can sign in)</span>
        </label>
        <label>
          <span>Joined</span>
          <input
            type="text"
            value={DATE_FORMAT.format(new Date(user.createdAt))}
            disabled
            readOnly
          />
        </label>
      </div>

      {directBookingLink ? (
        <div className="staff-booking-link">
          <p className="eyebrow">Direct booking link</p>
          <code>{directBookingLink}</code>
          <a className="ghost-action" href={directBookingLink} target="_blank" rel="noreferrer">
            Open
          </a>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="settings-error">
          {error}
        </p>
      ) : null}

      <div className="modal-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function ServicesTab({
  tenantSlug,
  provider,
  locations,
  services,
  onSaved,
}: {
  tenantSlug: string;
  provider: ProviderSummary;
  locations: LocationSummary[];
  services: ServiceSummary[];
  onSaved: () => void;
}) {
  const [locationIds, setLocationIds] = useState<string[]>(provider.locationIds);
  const [serviceIds, setServiceIds] = useState<string[]>(provider.serviceIds);
  const [isBookableOnline, setIsBookableOnline] = useState(provider.isBookableOnline);
  const [isActive, setIsActive] = useState(provider.isActive);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");

  useEffect(() => {
    setLocationIds(provider.locationIds);
    setServiceIds(provider.serviceIds);
    setIsBookableOnline(provider.isBookableOnline);
    setIsActive(provider.isActive);
  }, [provider]);

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const filteredLocations = useMemo(() => {
    const q = locationQuery.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter((loc) => loc.name.toLowerCase().includes(q));
  }, [locations, locationQuery]);

  const filteredServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    if (!q) return services;
    return services.filter((svc) => svc.name.toLowerCase().includes(q));
  }, [services, serviceQuery]);

  const selectAll = (ids: string[], setter: (next: string[]) => void, filtered: { id: string }[]) => {
    const next = new Set(ids);
    for (const item of filtered) next.add(item.id);
    setter(Array.from(next));
  };
  const clearFiltered = (
    ids: string[],
    setter: (next: string[]) => void,
    filtered: { id: string }[],
  ) => {
    const drop = new Set(filtered.map((item) => item.id));
    setter(ids.filter((id) => !drop.has(id)));
  };

  const isDirty =
    !sameIds(locationIds, provider.locationIds) ||
    !sameIds(serviceIds, provider.serviceIds) ||
    isBookableOnline !== provider.isBookableOnline ||
    isActive !== provider.isActive;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload: UpdateProviderRequest = {
      locationIds,
      serviceIds,
      isBookableOnline,
      isActive,
    };
    try {
      await platformApi.updateProvider(tenantSlug, provider.id, payload);
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to update provider."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="staff-detail-form" onSubmit={submit}>
      <fieldset className="staff-fieldset">
        <legend>
          Locations <span className="staff-fieldset-count">{locationIds.length} of {locations.length}</span>
        </legend>
        {locations.length === 0 ? (
          <p className="settings-form-help">No locations configured.</p>
        ) : (
          <>
            <div className="staff-list-toolbar">
              <input
                type="search"
                className="staff-list-search"
                placeholder="Search locations…"
                value={locationQuery}
                onChange={(event) => setLocationQuery(event.target.value)}
                aria-label="Search locations"
              />
              <button
                type="button"
                className="ghost-action"
                onClick={() => selectAll(locationIds, setLocationIds, filteredLocations)}
                disabled={filteredLocations.length === 0}
              >
                Select all{locationQuery ? " shown" : ""}
              </button>
              <button
                type="button"
                className="ghost-action"
                onClick={() => clearFiltered(locationIds, setLocationIds, filteredLocations)}
                disabled={filteredLocations.length === 0}
              >
                Clear{locationQuery ? " shown" : ""}
              </button>
            </div>
            {filteredLocations.length === 0 ? (
              <p className="settings-form-help">No locations match that search.</p>
            ) : (
              <div className="staff-checkbox-grid">
                {filteredLocations.map((loc) => (
                  <label
                    key={loc.id}
                    className={`settings-toggle staff-pickable${loc.isActive ? "" : " is-inactive"}`}
                  >
                    <input
                      type="checkbox"
                      checked={locationIds.includes(loc.id)}
                      onChange={() => setLocationIds(toggle(locationIds, loc.id))}
                    />
                    <span>
                      <strong>{loc.name}</strong>
                      <span className="staff-pickable-meta">
                        {loc.timeZone}
                        {loc.isActive ? "" : " · Inactive"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="staff-fieldset">
        <legend>
          Services performed <span className="staff-fieldset-count">{serviceIds.length} of {services.length}</span>
        </legend>
        {services.length === 0 ? (
          <p className="settings-form-help">No services configured.</p>
        ) : (
          <>
            <div className="staff-list-toolbar">
              <input
                type="search"
                className="staff-list-search"
                placeholder="Search services…"
                value={serviceQuery}
                onChange={(event) => setServiceQuery(event.target.value)}
                aria-label="Search services"
              />
              <button
                type="button"
                className="ghost-action"
                onClick={() => selectAll(serviceIds, setServiceIds, filteredServices)}
                disabled={filteredServices.length === 0}
              >
                Select all{serviceQuery ? " shown" : ""}
              </button>
              <button
                type="button"
                className="ghost-action"
                onClick={() => clearFiltered(serviceIds, setServiceIds, filteredServices)}
                disabled={filteredServices.length === 0}
              >
                Clear{serviceQuery ? " shown" : ""}
              </button>
            </div>
            {filteredServices.length === 0 ? (
              <p className="settings-form-help">No services match that search.</p>
            ) : (
              <div className="staff-checkbox-grid">
                {filteredServices.map((svc) => (
                  <label
                    key={svc.id}
                    className={`settings-toggle staff-pickable${svc.isActive ? "" : " is-inactive"}`}
                  >
                    <input
                      type="checkbox"
                      checked={serviceIds.includes(svc.id)}
                      onChange={() => setServiceIds(toggle(serviceIds, svc.id))}
                    />
                    <span>
                      <strong>{svc.name}</strong>
                      <span className="staff-pickable-meta">
                        {formatDurationMinutes(svc.durationMinutes)} · {formatPriceCents(svc.priceCents)}
                        {svc.isActive ? "" : " · Inactive"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="staff-fieldset">
        <legend>Visibility</legend>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={isBookableOnline}
            onChange={(event) => setIsBookableOnline(event.target.checked)}
          />
          <span>Bookable online (shows on storefront)</span>
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <span>Active provider</span>
        </label>
      </fieldset>

      {error ? (
        <p role="alert" className="settings-error">
          {error}
        </p>
      ) : null}

      <div className="modal-actions">
        {isDirty ? <span className="settings-form-help">Unsaved changes</span> : null}
        <button type="submit" className="primary-action" disabled={submitting || !isDirty}>
          {submitting ? "Saving…" : "Save provider"}
        </button>
      </div>
    </form>
  );
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const id of b) if (!setA.has(id)) return false;
  return true;
}

function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function formatPriceCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type ScheduleTabProps = {
  tenantSlug: string;
  provider: ProviderSummary;
  locations: LocationSummary[];
};

function ScheduleTab({ tenantSlug, provider, locations }: ScheduleTabProps) {
  const providerLocations = useMemo(
    () => locations.filter((loc) => provider.locationIds.includes(loc.id)),
    [locations, provider.locationIds],
  );

  const [entries, setEntries] = useState<ProviderScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStatus(null);
    platformApi
      .getProviderSchedule(tenantSlug, provider.id)
      .then((schedule: ProviderSchedule) => {
        if (!cancelled) {
          setEntries(schedule.entries);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load schedule");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, provider.id]);

  function updateEntry(index: number, patch: Partial<ProviderScheduleEntry>) {
    setEntries((current) =>
      current.map((entry, idx) => (idx === index ? { ...entry, ...patch } : entry)),
    );
  }

  function removeEntry(index: number) {
    setEntries((current) => current.filter((_, idx) => idx !== index));
  }

  function addEntry(weekday: number) {
    const defaultLocationId = providerLocations[0]?.id;
    if (!defaultLocationId) {
      return;
    }
    setEntries((current) => [
      ...current,
      { weekday, locationId: defaultLocationId, startTime: "09:00", endTime: "17:00" },
    ]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const payload: ReplaceProviderScheduleRequest = { entries };
      const result = await platformApi.replaceProviderSchedule(tenantSlug, provider.id, payload);
      setEntries(result.entries);
      setStatus("Schedule saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="staff-detail-form">
        <p className="settings-form-help">Loading schedule…</p>
      </div>
    );
  }

  if (providerLocations.length === 0) {
    return (
      <div className="staff-detail-form">
        <p className="settings-form-help">
          Assign this provider to at least one location before setting work hours.
        </p>
      </div>
    );
  }

  return (
    <form className="staff-detail-form schedule-week" onSubmit={handleSubmit}>
      {WEEKDAY_LABELS.map((label, weekday) => {
        const dayEntries = entries
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.weekday === weekday);
        return (
          <div key={weekday} className="schedule-day-row">
            <div className="schedule-day-header">
              <h4>{label}</h4>
              <button
                type="button"
                className="link-button"
                onClick={() => addEntry(weekday)}
              >
                + Add time window
              </button>
            </div>
            {dayEntries.length === 0 ? (
              <p className="settings-form-help schedule-day-empty">No hours.</p>
            ) : (
              <ul className="schedule-entry-list">
                {dayEntries.map(({ entry, index }) => (
                  <li key={index} className="schedule-entry">
                    <label className="schedule-entry-field">
                      <span>Location</span>
                      <select
                        value={entry.locationId}
                        onChange={(event) =>
                          updateEntry(index, { locationId: event.target.value })
                        }
                      >
                        {providerLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="schedule-entry-field">
                      <span>Start</span>
                      <input
                        type="time"
                        value={entry.startTime}
                        onChange={(event) =>
                          updateEntry(index, { startTime: event.target.value })
                        }
                      />
                    </label>
                    <label className="schedule-entry-field">
                      <span>End</span>
                      <input
                        type="time"
                        value={entry.endTime}
                        onChange={(event) =>
                          updateEntry(index, { endTime: event.target.value })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="link-button schedule-entry-remove"
                      onClick={() => removeEntry(index)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {error ? (
        <p role="alert" className="settings-error">
          {error}
        </p>
      ) : null}
      {status ? <p className="settings-form-help">{status}</p> : null}

      <div className="modal-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          {submitting ? "Saving…" : "Save schedule"}
        </button>
      </div>
    </form>
  );
}

function ModalShell({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal-panel${wide ? " modal-panel--wide" : ""}`}>
        <header className="modal-header">
          <h4>{title}</h4>
          <button type="button" className="ghost-action" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function AddStaffModal({
  tenantSlug,
  locations,
  services,
  onClose,
  onSaved,
}: {
  tenantSlug: string;
  locations: LocationSummary[];
  services: ServiceSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "staff",
    initialPassword: "",
    phone: "",
    avatarUrl: "",
    isProvider: false,
    isBookableOnline: true,
    locationIds: [] as string[],
    serviceIds: [] as string[],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = useMemo(
    () =>
      submitting ||
      !form.email.trim() ||
      !form.name.trim() ||
      form.initialPassword.length < 8,
    [form, submitting],
  );

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateStaffRequest = {
        email: form.email.trim(),
        name: form.name.trim(),
        role: form.role,
        initialPassword: form.initialPassword,
        phone: form.phone.trim() || null,
        avatarUrl: form.avatarUrl.trim() || null,
      };
      if (form.isProvider) {
        payload.provider = {
          locationIds: form.locationIds,
          serviceIds: form.serviceIds,
          isBookableOnline: form.isBookableOnline,
        };
      }
      await platformApi.createTenantStaff(tenantSlug, payload);
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to create staff member."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Add staff" onClose={onClose} wide>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Role</span>
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Phone</span>
          <input
            type="text"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            placeholder="+1 555-555-1212"
          />
        </label>
        <label>
          <span>Initial password</span>
          <input
            type="text"
            value={form.initialPassword}
            onChange={(event) => setForm({ ...form, initialPassword: event.target.value })}
            minLength={8}
            required
          />
          <small className="settings-form-help">Minimum 8 characters. Share securely.</small>
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={form.isProvider}
            onChange={(event) => setForm({ ...form, isProvider: event.target.checked })}
          />
          <span>This person is a service provider</span>
        </label>

        {form.isProvider ? (
          <>
            <fieldset className="staff-fieldset">
              <legend>Locations</legend>
              {locations.length === 0 ? (
                <p className="settings-form-help">No locations configured.</p>
              ) : (
                <div className="staff-checkbox-grid">
                  {locations.map((loc) => (
                    <label key={loc.id} className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={form.locationIds.includes(loc.id)}
                        onChange={() =>
                          setForm({ ...form, locationIds: toggle(form.locationIds, loc.id) })
                        }
                      />
                      <span>{loc.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <fieldset className="staff-fieldset">
              <legend>Services performed</legend>
              {services.length === 0 ? (
                <p className="settings-form-help">No services configured.</p>
              ) : (
                <div className="staff-checkbox-grid">
                  {services.map((svc) => (
                    <label key={svc.id} className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={form.serviceIds.includes(svc.id)}
                        onChange={() =>
                          setForm({ ...form, serviceIds: toggle(form.serviceIds, svc.id) })
                        }
                      />
                      <span>{svc.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={form.isBookableOnline}
                onChange={(event) =>
                  setForm({ ...form, isBookableOnline: event.target.checked })
                }
              />
              <span>Bookable online</span>
            </label>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-action" disabled={disabled}>
            {submitting ? "Saving…" : "Create staff"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function AddProviderModal({
  tenantSlug,
  user,
  locations,
  services,
  onClose,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  locations: LocationSummary[];
  services: ServiceSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [isBookableOnline, setIsBookableOnline] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateProviderRequest = {
        name: user.name,
        email: user.email,
        userId: user.id,
        locationIds,
        serviceIds,
        isBookableOnline,
      };
      await platformApi.createProvider(tenantSlug, payload);
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to create provider."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={`Make ${user.name} a service provider`} onClose={onClose} wide>
      <form className="modal-form" onSubmit={submit}>
        <fieldset className="staff-fieldset">
          <legend>Locations</legend>
          <div className="staff-checkbox-grid">
            {locations.map((loc) => (
              <label key={loc.id} className="settings-toggle">
                <input
                  type="checkbox"
                  checked={locationIds.includes(loc.id)}
                  onChange={() => setLocationIds(toggle(locationIds, loc.id))}
                />
                <span>{loc.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="staff-fieldset">
          <legend>Services performed</legend>
          <div className="staff-checkbox-grid">
            {services.map((svc) => (
              <label key={svc.id} className="settings-toggle">
                <input
                  type="checkbox"
                  checked={serviceIds.includes(svc.id)}
                  onChange={() => setServiceIds(toggle(serviceIds, svc.id))}
                />
                <span>{svc.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={isBookableOnline}
            onChange={(event) => setIsBookableOnline(event.target.checked)}
          />
          <span>Bookable online</span>
        </label>

        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-action" disabled={submitting}>
            {submitting ? "Saving…" : "Create provider"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ResetPasswordModal({
  tenantSlug,
  user,
  onClose,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await platformApi.resetTenantUserPassword(tenantSlug, user.id, { newPassword: password });
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to reset password."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={`Reset password for ${user.name}`} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>New password</span>
          <input
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
          <small className="settings-form-help">
            Minimum 8 characters. Share securely with the user.
          </small>
        </label>
        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-action"
            disabled={submitting || password.length < 8}
          >
            {submitting ? "Saving…" : "Save new password"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

type TimeOffTabProps = {
  tenantSlug: string;
  provider: ProviderSummary;
};

function _toInputValue(iso: string): string {
  // ISO -> YYYY-MM-DDTHH:MM for datetime-local input
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function _fromInputValue(value: string): string {
  // datetime-local (local time, no tz) -> ISO with local offset preserved
  if (!value) return value;
  return new Date(value).toISOString();
}

function _formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  return `${start.toLocaleString(undefined, opts)} → ${end.toLocaleString(undefined, opts)}`;
}

function TimeOffTab({ tenantSlug, provider }: TimeOffTabProps) {
  const [items, setItems] = useState<ProviderTimeOffEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");

  function refresh() {
    setLoading(true);
    setError(null);
    return platformApi
      .listProviderTimeOff(tenantSlug, provider.id)
      .then((list) => setItems(list.items))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load time off"),
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setError(null);
    setLoading(true);
    platformApi
      .listProviderTimeOff(tenantSlug, provider.id)
      .then((list) => {
        if (!cancelled) setItems(list.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load time off");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, provider.id]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startsAt || !endsAt) {
      setError("Pick a start and end time");
      return;
    }
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const payload: CreateProviderTimeOffRequest = {
        startsAt: _fromInputValue(startsAt),
        endsAt: _fromInputValue(endsAt),
        reason: reason.trim() || null,
      };
      await platformApi.createProviderTimeOff(tenantSlug, provider.id, payload);
      setStartsAt("");
      setEndsAt("");
      setReason("");
      setStatus("Time off added");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add time off");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(entry: ProviderTimeOffEntry) {
    setError(null);
    setStatus(null);
    try {
      await platformApi.deleteProviderTimeOff(tenantSlug, provider.id, entry.id);
      setStatus("Time off removed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove time off");
    }
  }

  return (
    <div className="staff-detail-form time-off-tab">
      <section className="time-off-list">
        <h4>Scheduled time off</h4>
        {loading ? (
          <p className="settings-form-help">Loading…</p>
        ) : items.length === 0 ? (
          <p className="settings-form-help">No time off scheduled.</p>
        ) : (
          <ul className="time-off-entries">
            {items.map((entry) => (
              <li key={entry.id} className="time-off-entry">
                <div>
                  <strong>{_formatRange(entry.startsAt, entry.endsAt)}</strong>
                  {entry.reason ? <span className="time-off-reason"> — {entry.reason}</span> : null}
                </div>
                <button
                  type="button"
                  className="link-button time-off-remove"
                  onClick={() => handleDelete(entry)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="time-off-form" onSubmit={handleSubmit}>
        <h4>Add time off</h4>
        <div className="time-off-form-row">
          <label>
            <span>Starts</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
            />
          </label>
          <label>
            <span>Ends</span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              required
            />
          </label>
        </div>
        <label className="time-off-reason-field">
          <span>Reason (optional)</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Vacation, training, etc."
          />
        </label>
        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        {status ? <p className="settings-form-help">{status}</p> : null}
        <div className="modal-actions">
          <button type="submit" className="primary-action" disabled={submitting}>
            {submitting ? "Saving…" : "Add time off"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissions tab (Phase E)
// ---------------------------------------------------------------------------

type PermissionsTabProps = {
  tenantSlug: string;
  user: TenantUserSummary;
};

type PermissionTriState = "inherit" | "allow" | "deny";

function PermissionsTab({ tenantSlug, user }: PermissionsTabProps) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [catalog, setCatalog] = useState<PermissionCatalogResponse | null>(null);
  const [permissions, setPermissions] = useState<UserPermissionsResponse | null>(null);
  const [overrides, setOverrides] = useState<Record<string, PermissionTriState>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (user.role === "owner") {
      setLoadState({ kind: "ready" });
      return;
    }
    let cancelled = false;
    setLoadState({ kind: "loading" });
    Promise.all([
      platformApi.getPermissionsCatalog(),
      platformApi.getUserPermissions(tenantSlug, user.id),
    ])
      .then(([catalogResp, permsResp]) => {
        if (cancelled) return;
        setCatalog(catalogResp);
        setPermissions(permsResp);
        const next: Record<string, PermissionTriState> = {};
        for (const entry of permsResp.overrides) {
          next[entry.key] = entry.allowed ? "allow" : "deny";
        }
        setOverrides(next);
        setLoadState({ kind: "ready" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load permissions.";
        setLoadState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, user.id]);

  if (user.role === "owner") {
    return (
      <div className="permissions-tab">
        <p className="settings-form-help">
          Owners have full access to every permission. Customize permissions on managers, staff,
          and providers instead.
        </p>
      </div>
    );
  }

  if (loadState.kind === "loading") {
    return <p className="settings-form-help">Loading permissions…</p>;
  }
  if (loadState.kind === "error") {
    return <p className="error-message">{loadState.message}</p>;
  }
  if (!catalog || !permissions) return null;

  const roleDefaults = new Set<string>(permissions.roleDefaults);

  const handleChange = (key: PermissionKey, next: PermissionTriState) => {
    setOverrides((prev) => {
      const copy = { ...prev };
      if (next === "inherit") {
        delete copy[key];
      } else {
        copy[key] = next;
      }
      return copy;
    });
    setStatus(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    const payload: ReplaceUserPermissionsRequest = {
      overrides: Object.entries(overrides).map(
        ([key, value]): UserPermissionOverrideEntry => ({
          key: key as PermissionKey,
          allowed: value === "allow",
        }),
      ),
    };
    try {
      const updated = await platformApi.replaceUserPermissions(tenantSlug, user.id, payload);
      setPermissions(updated);
      const next: Record<string, PermissionTriState> = {};
      for (const entry of updated.overrides) {
        next[entry.key] = entry.allowed ? "allow" : "deny";
      }
      setOverrides(next);
      setStatus("Permissions saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save permissions.";
      setStatus(message);
    } finally {
      setSaving(false);
    }
  };

  const grouped = new Map<string, PermissionDefinition[]>();
  for (const def of catalog.permissions) {
    const arr = grouped.get(def.category) ?? [];
    arr.push(def);
    grouped.set(def.category, arr);
  }

  return (
    <div className="permissions-tab">
      <p className="settings-form-help">
        Role defaults grant a baseline. Per-user overrides add or remove specific permissions on
        top of the role.
      </p>
      <div className="permissions-groups">
        {Array.from(grouped.entries()).map(([category, defs]) => (
          <section key={category} className="permissions-group">
            <h5>{category}</h5>
            <ul className="permissions-list">
              {defs.map((def) => {
                const current: PermissionTriState = overrides[def.key] ?? "inherit";
                const inheritedAllowed = roleDefaults.has(def.key);
                return (
                  <li key={def.key} className="permissions-row">
                    <div className="permissions-row-label">
                      <strong>{def.label}</strong>
                      <span className="settings-form-help">{def.description}</span>
                    </div>
                    <div className="permissions-row-controls" role="radiogroup" aria-label={def.label}>
                      <label>
                        <input
                          type="radio"
                          name={`perm-${def.key}`}
                          checked={current === "inherit"}
                          onChange={() => handleChange(def.key, "inherit")}
                        />
                        Inherit ({inheritedAllowed ? "allow" : "deny"})
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`perm-${def.key}`}
                          checked={current === "allow"}
                          onChange={() => handleChange(def.key, "allow")}
                        />
                        Allow
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`perm-${def.key}`}
                          checked={current === "deny"}
                          onChange={() => handleChange(def.key, "deny")}
                        />
                        Deny
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <div className="permissions-actions">
        <button type="button" className="primary-action" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save permissions"}
        </button>
        {status ? <span className="settings-form-help">{status}</span> : null}
      </div>
    </div>
  );
}
