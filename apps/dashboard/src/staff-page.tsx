import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  WorkHoursSummary,
  UpdateTenantUserRequest,
  UserPermissionOverrideEntry,
  UserPermissionsResponse,
} from "@booking/shared-types";

import { apiBaseUrl, ensureActiveStoredSession, platformApi } from "./platform-api";

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

type TabKey = "details" | "services" | "workHours" | "permissions" | "compensation";

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

export function CropModal({
  file,
  onSave,
  onCancel,
  maskShape = "circle",
}: {
  file: File;
  onSave: (blob: Blob) => void;
  onCancel: () => void;
  maskShape?: "circle" | "rectangle";
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

  const maskW = maskShape === "rectangle" ? 450 : 260;
  const maskH = maskShape === "rectangle" ? 300 : 260;

  // When image loads, compute the fit scale so the shorter side fills the mask
  const onImageLoad = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    setNaturalSize({ w: nw, h: nh });
    const fs = Math.max(maskW / nw, maskH / nh);
    setFitScale(fs);
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
  }, [maskW, maskH]);

  // Effective scale = fitScale × zoom multiplier
  const scale = fitScale * zoom;

  // Derived image display size at current scale
  const imgW = naturalSize ? naturalSize.w * scale : maskW;
  const imgH = naturalSize ? naturalSize.h * scale : maskH;

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
    const outputScale = 3; // render at 3x for retina-quality output
    const canvas = document.createElement("canvas");
    canvas.width = maskW * outputScale;
    canvas.height = maskH * outputScale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.scale(outputScale, outputScale);

    if (maskShape === "circle") {
      // Clip to circle
      ctx.beginPath();
      ctx.arc(maskW / 2, maskH / 2, maskW / 2, 0, Math.PI * 2);
      ctx.clip();
    }

    // Draw image at its natural-aspect display size, centered + offset
    const drawX = (maskW - imgW) / 2 + offsetX;
    const drawY = (maskH - imgH) / 2 + offsetY;
    ctx.drawImage(img, drawX, drawY, imgW, imgH);

    canvas.toBlob((blob) => {
      if (blob) onSave(blob);
    }, "image/png");
  }, [offsetX, offsetY, imgW, imgH, maskW, maskH, maskShape, onSave]);

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
            className={`crop-modal__mask${maskShape === "rectangle" ? " crop-modal__mask--rect" : ""}`}
            onMouseDown={(e) => { e.preventDefault(); startDrag(e.clientX, e.clientY); }}
            onTouchStart={(e) => {
              e.preventDefault();
              const t = e.touches[0];
              if (t) startDrag(t.clientX, t.clientY);
            }}
            style={{
              width: `${maskW}px`,
              height: `${maskH}px`,
              cursor: dragging ? "grabbing" : "grab",
            }}
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
    return <main className="ops-page-stack"><p className="staff-list-empty">You do not have permission to view the team roster.</p></main>;
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
    { key: "workHours", label: "Work hours", disabled: !provider },
    { key: "compensation", label: "Compensation", disabled: !provider },
    { key: "permissions", label: "Permissions" },
  ];

  const bookingLinkBase = `${storefrontBaseUrl}/${tenantSlug}/p/`;

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
          provider={provider}
          bookingLinkBase={bookingLinkBase}
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
      {activeTab === "workHours" && provider ? (
        <WorkHoursTab tenantSlug={tenantSlug} provider={provider} locations={locations} services={services} />
      ) : null}
      {activeTab === "compensation" && provider ? (
        <CompensationTab tenantSlug={tenantSlug} provider={provider} onSaved={onSaved} />
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
  provider,
  bookingLinkBase,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  provider: ProviderSummary | null;
  bookingLinkBase: string;
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
  const [bookingSlug, setBookingSlug] = useState(provider?.bookingSlug ?? "");
  const [slugSubmitting, setSlugSubmitting] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [slugCopied, setSlugCopied] = useState(false);

  useEffect(() => {
    setBookingSlug(provider?.bookingSlug ?? "");
    setSlugError(null);
    setSlugCopied(false);
  }, [provider?.id, provider?.bookingSlug]);

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

      {provider ? (
        <div className="staff-booking-link">
          <p className="eyebrow">Direct booking link</p>
          <div className="staff-booking-link-editor">
            <span className="staff-booking-link-prefix">{bookingLinkBase}</span>
            <input
              type="text"
              value={bookingSlug}
              onChange={(event) => {
                setBookingSlug(event.target.value);
                setSlugError(null);
                setSlugCopied(false);
              }}
              placeholder={provider.id}
              maxLength={100}
              spellCheck={false}
              autoCapitalize="off"
            />
          </div>
          <div className="staff-booking-link-actions">
            <button
              type="button"
              className="ghost-action"
              disabled={slugSubmitting || (bookingSlug.trim() === (provider.bookingSlug ?? ""))}
              onClick={async () => {
                const trimmed = bookingSlug.trim();
                if (trimmed && !/^[a-z0-9-]+$/i.test(trimmed)) {
                  setSlugError("Use letters, numbers, and hyphens only.");
                  return;
                }
                setSlugSubmitting(true);
                setSlugError(null);
                try {
                  await platformApi.updateProvider(tenantSlug, provider.id, {
                    bookingSlug: trimmed || null,
                  });
                  onSaved();
                } catch (err) {
                  setSlugError(readErrorMessage(err, "Unable to update booking link."));
                } finally {
                  setSlugSubmitting(false);
                }
              }}
            >
              {slugSubmitting ? "Saving…" : "Save link"}
            </button>
            {provider.bookingUrl ? (
              <>
                <button
                  type="button"
                  className="ghost-action"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(provider.bookingUrl!);
                      setSlugCopied(true);
                      setTimeout(() => setSlugCopied(false), 2000);
                    } catch {
                      // ignore
                    }
                  }}
                >
                  {slugCopied ? "Copied!" : "Copy link"}
                </button>
                <a
                  className="ghost-action"
                  href={provider.bookingUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open
                </a>
              </>
            ) : null}
          </div>
          {slugError ? (
            <p role="alert" className="settings-error">
              {slugError}
            </p>
          ) : null}
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

/** Normalize a time string to HH:MM format (e.g. "9" → "09:00", "9:30" → "09:30", "14" → "14:00"). */
function normalizeTime(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "09:00";
  // Already HH:MM
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [h, m] = trimmed.split(":");
    return `${h.padStart(2, "0")}:${m}`;
  }
  // Just an hour number, e.g. "9" or "14"
  if (/^\d{1,2}$/.test(trimmed)) {
    return `${trimmed.padStart(2, "0")}:00`;
  }
  // AM/PM format, e.g. "9am", "2:30pm"
  const ampm = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] || "00";
    const period = ampm[3].toLowerCase();
    if (period === "pm" && h < 12) h += 12;
    if (period === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${m}`;
  }
  // Fallback: return as-is
  return trimmed;
}


// ===========================================================================
// Work Hours tab (unified schedule + time off)
// ===========================================================================

type WorkHoursTabProps = {
  tenantSlug: string;
  provider: ProviderSummary;
  locations: LocationSummary[];
};

function WorkHoursTab({ tenantSlug, provider, locations, services }: WorkHoursTabProps & { services: ServiceSummary[] }) {
  const providerLocations = useMemo(
    () => locations.filter((loc) => provider.locationIds.includes(loc.id)),
    [locations, provider.locationIds],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Map<number, ProviderScheduleEntry[]>>(new Map());
  const [overrides, setOverrides] = useState<ProviderTimeOffEntry[]>([]);
  const [summary, setSummary] = useState<WorkHoursSummary>({ hoursPerWeek: 0, workingDays: 0, upcomingOverridesCount: 0 });
  const [warnings, setWarnings] = useState<Array<{ type: string; weekday: number; message: string }>>([]);

  const [newOverride, setNewOverride] = useState<{
    startDate: string; endDate: string; reason: string;
    overrideType: "closed" | "custom_hours"; startTime: string; endTime: string;
  }>({ startDate: "", endDate: "", reason: "", overrideType: "closed", startTime: "09:00", endTime: "17:00" });
  const [blockedServiceIds, setBlockedServiceIds] = useState<string[]>([]);
  const [dayBlockedServices, setDayBlockedServices] = useState<Map<number, string[]>>(new Map());

  const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null);
  const [editOverride, setEditOverride] = useState<{
    startDate: string; endDate: string; reason: string;
    overrideType: "closed" | "custom_hours"; startTime: string; endTime: string;
  }>({ startDate: "", endDate: "", reason: "", overrideType: "closed", startTime: "09:00", endTime: "17:00" });
  const [editBlockedServiceIds, setEditBlockedServiceIds] = useState<string[]>([]);

  // Add shift modal
  const [addShiftModal, setAddShiftModal] = useState<{ weekday: number } | null>(null);
  const [addShiftDate, setAddShiftDate] = useState("");
  const [addShiftStart, setAddShiftStart] = useState("09:00");
  const [addShiftEnd, setAddShiftEnd] = useState("17:00");

  // Week navigation for vertical calendar (0 = current week, +1 next, -1 previous)
  const [weekOffset, setWeekOffset] = useState(0);

  // Day editor drawer (opens when tapping a day card)
  const [dayEditor, setDayEditor] = useState<{ dateStr: string; weekday: number } | null>(null);

  // Time-off drawer (opens from "Block time off" button)
  const [timeOffOpen, setTimeOffOpen] = useState(false);

  // Regular hours drawer (opens from "Set regular hours" button — bulk 7-day template)
  const [regularHoursOpen, setRegularHoursOpen] = useState(false);

  // Sub-tab within Work Hours: "regular" | "overrides"
  const [workHoursSubTab, setWorkHoursSubTab] = useState<"regular" | "overrides">("regular");

  // Expanded override in the overrides list
  const [expandedOverrideId, setExpandedOverrideId] = useState<string | null>(null);

  // Week offset for regular hours date labels (0 = this week, +1 = next, -1 = previous)
  const [regularHoursWeekOffset, setRegularHoursWeekOffset] = useState(0);

  const latestLocationRef = useRef(selectedLocationId);
  latestLocationRef.current = selectedLocationId;

  useEffect(() => {
    let cancelled = false;
    const locId = selectedLocationId;
    setShifts(new Map());
    setOverrides([]);
    const doLoad = async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await platformApi.getProviderWorkHours(tenantSlug, provider.id, locId);
        if (cancelled || latestLocationRef.current !== locId) return;
        const byDay = new Map<number, ProviderScheduleEntry[]>();
        for (const entry of resp.regularHours) {
          const list = byDay.get(entry.weekday) || [];
          list.push(entry);
          byDay.set(entry.weekday, list);
        }
        setShifts(byDay);
        setOverrides(resp.dateOverrides);
        setSummary(resp.summary);
        setWarnings(resp.warnings || []);
        // Load per-day blocked services from schedule entries
        const dayBlocks = new Map<number, string[]>();
        for (const entry of resp.regularHours) {
          if (entry.blockedServiceIds && entry.blockedServiceIds.length > 0) {
            dayBlocks.set(entry.weekday, entry.blockedServiceIds);
          }
        }
        setDayBlockedServices(dayBlocks);
      } catch (err) {
        if (cancelled || latestLocationRef.current !== locId) return;
        setError(err instanceof Error ? err.message : "Failed to load work hours");
      } finally {
        if (!cancelled && latestLocationRef.current === locId) setLoading(false);
      }
    };
    void doLoad();
    return () => { cancelled = true; };
  }, [tenantSlug, provider.id, selectedLocationId, reloadKey]);

  const toggleDayBlockedService = (weekday: number, serviceId: string) => {
    setDayBlockedServices((prev) => {
      const next = new Map(prev);
      const current = next.get(weekday) || [];
      if (current.includes(serviceId)) {
        next.set(weekday, current.filter((id) => id !== serviceId));
      } else {
        next.set(weekday, [...current, serviceId]);
      }
      return next;
    });
  };

  const toggleDay = (weekday: number) => {
    setShifts((prev) => {
      const next = new Map(prev);
      const existing = next.get(weekday) || [];
      if (existing.length > 0 && existing[0].isActive) {
        next.set(weekday, existing.map((s) => ({ ...s, isActive: false })));
      } else if (existing.length > 0) {
        next.set(weekday, existing.map((s) => ({ ...s, isActive: true })));
      } else {
        const locId = selectedLocationId || null;
        next.set(weekday, [{
          id: "", weekday, locationId: locId, startTime: "09:00", endTime: "17:00", isActive: true,
        }]);
      }
      return next;
    });
  };

  const updateShift = (weekday: number, shiftIndex: number, patch: Partial<ProviderScheduleEntry>) => {
    setShifts((prev) => {
      const next = new Map(prev);
      const list = [...(next.get(weekday) || [])];
      list[shiftIndex] = { ...list[shiftIndex], ...patch };
      next.set(weekday, list);
      return next;
    });
  };

  const addShift = (weekday: number) => {
    setShifts((prev) => {
      const next = new Map(prev);
      const list = [...(next.get(weekday) || [])];
      const locId = selectedLocationId || null;
      list.push({ id: "", weekday, locationId: locId, startTime: "09:00", endTime: "17:00", isActive: true });
      next.set(weekday, list);
      return next;
    });
  };

  const removeShift = (weekday: number, shiftIndex: number) => {
    setShifts((prev) => {
      const next = new Map(prev);
      const list = [...(next.get(weekday) || [])];
      list.splice(shiftIndex, 1);
      if (list.length === 0) next.delete(weekday);
      else next.set(weekday, list);
      return next;
    });
  };

  const handleSave = async () => {
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const entries: ProviderScheduleEntry[] = [];
      for (const [weekday, dayShifts] of shifts) {
        for (const s of dayShifts) {
          entries.push({
            id: s.id || "",
            weekday,
            locationId: s.locationId,
            startTime: s.startTime,
            endTime: s.endTime,
            isActive: s.isActive,
            blockedServiceIds: dayBlockedServices.get(weekday) || null,
          });
        }
      }
      await platformApi.replaceProviderSchedule(tenantSlug, provider.id, { entries, locationId: selectedLocationId });
      setStatus("Schedule saved");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyMonday = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await platformApi.copyProviderDay(tenantSlug, provider.id, {
        sourceDay: 1, targetDays: [2, 3, 4, 5], locationId: selectedLocationId,
      });
      setStatus("Copied Monday to Tue-Fri");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddShiftAsOverride = async () => {
    if (!addShiftModal || !addShiftDate) return;
    setSubmitting(true);
    setError(null);
    try {
      await platformApi.createProviderTimeOff(tenantSlug, provider.id, {
        startsAt: new Date(addShiftDate).toISOString(),
        endsAt: new Date(addShiftDate + "T23:59:59").toISOString(),
        reason: null,
        overrideType: "custom_hours",
        startTime: addShiftStart,
        endTime: addShiftEnd,
        locationId: selectedLocationId,
      });
      setAddShiftModal(null);
      setAddShiftDate("");
      setStatus("Override added for " + new Date(addShiftDate).toLocaleDateString());
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add override");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddShiftAsRepeating = () => {
    if (!addShiftModal) return;
    addShift(addShiftModal.weekday);
    setAddShiftModal(null);
  };

  const handleAddOverride = async () => {
    if (!newOverride.startDate || !newOverride.endDate) {
      setError("Select start and end dates");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await platformApi.createProviderTimeOff(tenantSlug, provider.id, {
        startsAt: new Date(newOverride.startDate).toISOString(),
        endsAt: new Date(newOverride.endDate + "T23:59:59").toISOString(),
        reason: newOverride.reason.trim() || null,
        overrideType: newOverride.overrideType,
        startTime: newOverride.overrideType === "custom_hours" ? newOverride.startTime : null,
        endTime: newOverride.overrideType === "custom_hours" ? newOverride.endTime : null,
        locationId: selectedLocationId,
        blockedServiceIds: blockedServiceIds.length > 0 ? blockedServiceIds : null,
      });
      setNewOverride({ startDate: "", endDate: "", reason: "", overrideType: "closed", startTime: "09:00", endTime: "17:00" });
      setBlockedServiceIds([]);
      setStatus("Override added");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add override");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEditOverride = (ov: ProviderTimeOffEntry) => {
    setEditingOverrideId(ov.id);
    setEditOverride({
      startDate: new Date(ov.startsAt).toISOString().split("T")[0],
      endDate: new Date(ov.endsAt).toISOString().split("T")[0],
      reason: ov.reason || "",
      overrideType: (ov.overrideType as "closed" | "custom_hours") || "closed",
      startTime: ov.startTime || "09:00",
      endTime: ov.endTime || "17:00",
    });
    setEditBlockedServiceIds(ov.blockedServiceIds || []);
  };

  const handleCancelEditOverride = () => {
    setEditingOverrideId(null);
  };

  const handleSaveEditOverride = async () => {
    if (!editingOverrideId) return;
    setSubmitting(true);
    setError(null);
    try {
      await platformApi.updateProviderTimeOff(tenantSlug, provider.id, editingOverrideId, {
        startsAt: new Date(editOverride.startDate).toISOString(),
        endsAt: new Date(editOverride.endDate + "T23:59:59").toISOString(),
        reason: editOverride.reason.trim() || null,
        overrideType: editOverride.overrideType,
        startTime: editOverride.overrideType === "custom_hours" ? editOverride.startTime : null,
        endTime: editOverride.overrideType === "custom_hours" ? editOverride.endTime : null,
        locationId: selectedLocationId,
        blockedServiceIds: editBlockedServiceIds.length > 0 ? editBlockedServiceIds : null,
      });
      setEditingOverrideId(null);
      setStatus("Override updated");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update override");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOverride = async (overrideId: string) => {
    try {
      await platformApi.deleteProviderTimeOff(tenantSlug, provider.id, overrideId);
      setStatus("Override removed");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove override");
    }
  };

  // Save a date-specific override (custom_hours or closed) for a single date or range.
  const handleSaveDateOverride = async (
    dateStr: string,
    payload: {
      closedAllDay: boolean;
      startTime: string;
      endTime: string;
      blockedServiceIds: string[];
      existingOverrideId: string | null;
      startDate?: string;
      endDate?: string;
      reason?: string;
    },
  ) => {
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const start = payload.startDate || dateStr;
      const end = payload.endDate || dateStr;
      const body: CreateProviderTimeOffRequest = {
        startsAt: `${start}T00:00:00.000Z`,
        endsAt: `${end}T23:59:59.000Z`,
        reason: payload.reason?.trim() || null,
        overrideType: payload.closedAllDay ? "closed" : "custom_hours",
        startTime: payload.closedAllDay ? null : normalizeTime(payload.startTime),
        endTime: payload.closedAllDay ? null : normalizeTime(payload.endTime),
        locationId: selectedLocationId,
        blockedServiceIds: payload.blockedServiceIds.length > 0 ? payload.blockedServiceIds : null,
      };
      if (payload.existingOverrideId) {
        await platformApi.updateProviderTimeOff(tenantSlug, provider.id, payload.existingOverrideId, body);
      } else {
        await platformApi.createProviderTimeOff(tenantSlug, provider.id, body);
      }
      setStatus("Saved override for " + new Date(start + "T00:00:00").toLocaleDateString());
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save override");
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  // Update recurring hours for a single weekday, then replace the schedule.
  const handleSaveRecurringDay = async (
    weekday: number,
    payload: {
      shifts: Array<{ startTime: string; endTime: string; isActive: boolean }>;
      blockedServiceIds: string[];
    },
  ) => {
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      // Reload from the API to get ground-truth schedule, then modify only the target weekday.
      const fresh = await platformApi.getProviderWorkHours(tenantSlug, provider.id, selectedLocationId);
      const nextShifts = new Map<number, ProviderScheduleEntry[]>();
      for (const entry of fresh.regularHours) {
        const list = nextShifts.get(entry.weekday) || [];
        list.push(entry);
        nextShifts.set(entry.weekday, list);
      }
      const nextBlocked = new Map(dayBlockedServices);
      for (const entry of fresh.regularHours) {
        if (entry.blockedServiceIds && entry.blockedServiceIds.length > 0) {
          nextBlocked.set(entry.weekday, entry.blockedServiceIds);
        }
      }

      // Apply the change for the target weekday
      if (payload.shifts.length === 0) {
        nextShifts.delete(weekday);
        nextBlocked.delete(weekday);
      } else {
        nextShifts.set(
          weekday,
          payload.shifts.map((s) => ({
            id: "",
            weekday,
            locationId: selectedLocationId || null,
            startTime: normalizeTime(s.startTime),
            endTime: normalizeTime(s.endTime),
            isActive: s.isActive,
          })),
        );
        if (payload.blockedServiceIds.length > 0) {
          nextBlocked.set(weekday, payload.blockedServiceIds);
        } else {
          nextBlocked.delete(weekday);
        }
      }

      const entries: ProviderScheduleEntry[] = [];
      for (const [wd, dayShifts] of nextShifts) {
        for (const s of dayShifts) {
          entries.push({
            id: s.id || "",
            weekday: wd,
            locationId: s.locationId,
            startTime: s.startTime,
            endTime: s.endTime,
            isActive: s.isActive,
            blockedServiceIds: nextBlocked.get(wd) || null,
          });
        }
      }
      await platformApi.replaceProviderSchedule(tenantSlug, provider.id, {
        entries,
        locationId: selectedLocationId,
      });
      setStatus(`Updated every ${WEEKDAY_LABELS[weekday]}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save recurring hours");
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  // Bulk replace the full 7-day recurring schedule (used by RegularHoursDrawer).
  const handleSaveBulkRecurring = async (
    nextShifts: Map<number, Array<{ startTime: string; endTime: string; isActive: boolean }>>,
    nextBlocked: Map<number, string[]>,
  ) => {
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const entries: ProviderScheduleEntry[] = [];
      for (const [wd, dayShifts] of nextShifts) {
        for (const s of dayShifts) {
          entries.push({
            id: "",
            weekday: wd,
            locationId: selectedLocationId || null,
            startTime: normalizeTime(s.startTime),
            endTime: normalizeTime(s.endTime),
            isActive: s.isActive,
            blockedServiceIds: nextBlocked.get(wd) || null,
          });
        }
      }
      await platformApi.replaceProviderSchedule(tenantSlug, provider.id, {
        entries,
        locationId: selectedLocationId,
      });
      setStatus("Regular hours saved");
      setRegularHoursOpen(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save regular hours");
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  // Save a multi-day closed time-off block (vacation).
  const handleSaveTimeOff = async (payload: {
    startDate: string;
    endDate: string;
    reason: string;
    blockedServiceIds: string[];
  }) => {
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      await platformApi.createProviderTimeOff(tenantSlug, provider.id, {
        startsAt: `${payload.startDate}T00:00:00.000Z`,
        endsAt: `${payload.endDate}T23:59:59.000Z`,
        reason: payload.reason.trim() || null,
        overrideType: "closed",
        startTime: null,
        endTime: null,
        locationId: selectedLocationId,
        blockedServiceIds: payload.blockedServiceIds.length > 0 ? payload.blockedServiceIds : null,
      });
      setStatus("Time off added");
      setTimeOffOpen(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save time off");
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="staff-detail-form"><p className="settings-form-help">Loading work hours...</p></div>;
  }

  if (providerLocations.length === 0) {
    return <div className="staff-detail-form"><p className="settings-form-help">Assign this provider to at least one location first.</p></div>;
  }

  return (
    <div className="staff-detail-form">
      <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
        <div className="svc-card" style={{ flex: 1, padding: "10px 14px" }}>
          <div className="eyebrow">Hours per week</div>
          <div className="serif" style={{ fontSize: "18px", fontWeight: 500, marginTop: "2px" }}>{summary.hoursPerWeek} hrs</div>
        </div>
        <div className="svc-card" style={{ flex: 1, padding: "10px 14px" }}>
          <div className="eyebrow">Working days</div>
          <div className="serif" style={{ fontSize: "18px", fontWeight: 500, marginTop: "2px" }}>{summary.workingDays} of 7</div>
        </div>
        <div className="svc-card" style={{ flex: 1, padding: "10px 14px" }}>
          <div className="eyebrow">Upcoming overrides</div>
          <div className="serif" style={{ fontSize: "18px", fontWeight: 500, marginTop: "2px" }}>{summary.upcomingOverridesCount}</div>
        </div>
      </div>

      {warnings.length > 0 ? (
        <div style={{ marginBottom: "12px" }}>
          {warnings.map((w, i) => (
            <div key={i} style={{
              background: "#FFF8E7", border: "1px solid #E5D7BB",
              borderRadius: "6px", padding: "8px 12px", marginBottom: "6px",
              fontSize: "12px", color: "#6B5A47", display: "flex", alignItems: "center", gap: "8px"
            }}>
              <span style={{ fontSize: "14px" }}>&#9888;</span>
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="svc-card" style={{ marginBottom: "12px" }}>
        {/* Sub-tab bar */}
        <div style={{
          display: "flex", gap: "0", marginBottom: "16px",
          borderBottom: "1px solid #E5D7BB",
        }}>
          <button type="button" onClick={() => setWorkHoursSubTab("regular")} style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600,
            background: "transparent", border: "none",
            borderBottom: workHoursSubTab === "regular" ? "2px solid #D4A574" : "2px solid transparent",
            color: workHoursSubTab === "regular" ? "#1F1612" : "#8B7960",
            cursor: "pointer",
          }}>Regular hours</button>
          <button type="button" onClick={() => setWorkHoursSubTab("overrides")} style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600,
            background: "transparent", border: "none",
            borderBottom: workHoursSubTab === "overrides" ? "2px solid #D4A574" : "2px solid transparent",
            color: workHoursSubTab === "overrides" ? "#1F1612" : "#8B7960",
            cursor: "pointer",
          }}>Overrides &amp; time off</button>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: "8px", alignItems: "center", paddingRight: "4px" }}>
            {providerLocations.length > 1 ? (
              <select className="svc-input" style={{ padding: "5px 9px", fontSize: "12px" }}
                aria-label="Work hours location"
                value={selectedLocationId || ""}
                onChange={(e) => setSelectedLocationId(e.target.value || null)}>
                <option value="">Both locations</option>
                {providerLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            ) : null}
          </div>
        </div>

        {workHoursSubTab === "regular" ? (
          /* ===== REGULAR HOURS SUB-TAB ===== */
          <>
            {shifts.size === 0 ? (
              <div style={{
                padding: "18px", marginBottom: "14px",
                background: "#FDF8F0",
                border: "1px dashed #D4A574",
                borderRadius: "8px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: "16px", flexWrap: "wrap",
              }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#1F1612", marginBottom: "4px" }}>
                    No regular hours set yet
                  </div>
                  <div style={{ fontSize: "12px", color: "#6B5A47" }}>
                    Set the recurring weekly hours in one step, then adjust individual days as needed.
                  </div>
                </div>
                <button type="button" className="svc-save-btn"
                  onClick={() => setRegularHoursOpen(true)}
                  style={{ padding: "8px 16px" }}>
                  Set regular hours
                </button>
              </div>
            ) : (
              <>
                {/* Week navigation + 7-day template summary */}
                {(() => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const jsDay = today.getDay();
                  const daysSinceMonday = (jsDay + 6) % 7;
                  const weekStart = new Date(today);
                  weekStart.setDate(today.getDate() - daysSinceMonday + regularHoursWeekOffset * 7);
                  const weekEnd = new Date(weekStart);
                  weekEnd.setDate(weekStart.getDate() + 6);
                  const fmtRange = (d: Date) =>
                    `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

                  return (
                    <>
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "6px 0", marginBottom: "10px",
                        borderTop: "0.5px solid #E5D7BB", borderBottom: "0.5px solid #E5D7BB",
                      }}>
                        <button type="button" className="svc-text-btn"
                          onClick={() => setRegularHoursWeekOffset((v) => v - 1)}
                          style={{ fontSize: "18px", padding: "4px 12px" }}
                          aria-label="Previous week">‹</button>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "#1F1612" }}>
                            {fmtRange(weekStart)} – {fmtRange(weekEnd)}, {weekEnd.getFullYear()}
                          </div>
                          {regularHoursWeekOffset !== 0 ? (
                            <button type="button" className="svc-text-btn"
                              onClick={() => setRegularHoursWeekOffset(0)}
                              style={{ fontSize: "10px", textDecoration: "underline", color: "#8B7960" }}>
                              Jump to this week
                            </button>
                          ) : (
                            <div style={{ fontSize: "10px", color: "#8B7960" }}>This week</div>
                          )}
                        </div>
                        <button type="button" className="svc-text-btn"
                          onClick={() => setRegularHoursWeekOffset((v) => v + 1)}
                          style={{ fontSize: "18px", padding: "4px 12px" }}
                          aria-label="Next week">›</button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
                        {WEEKDAY_LABELS.map((label, wd) => {
                          const dayShifts = (shifts.get(wd) || []).filter((s) => s.isActive);
                          const blocked = dayBlockedServices.get(wd) || [];
                          const blockedNames = services.filter((s) => blocked.includes(s.id)).map((s) => s.name);
                          // Compute date for this weekday in the selected week
                          const d = new Date(weekStart);
                          d.setDate(weekStart.getDate() + wd);
                          const dateStr = d.toISOString().split("T")[0];
                          const isToday = dateStr === today.toISOString().split("T")[0];
                          // Check for date-specific override on this date
                          const dateOverride = overrides.find((ov) => {
                            const ovStart = new Date(ov.startsAt).toISOString().split("T")[0];
                            const ovEnd = new Date(ov.endsAt).toISOString().split("T")[0];
                            return dateStr >= ovStart && dateStr <= ovEnd;
                          }) || null;
                          const isCustomOverride = dateOverride?.overrideType === "custom_hours";
                          const isClosedOverride = dateOverride?.overrideType === "closed";
                          const cardBg = isClosedOverride ? "#F5EFE0"
                            : isCustomOverride ? "#E8F0FE"
                            : dayShifts.length > 0 ? "#FDF8F0"
                            : "#FFFFFF";
                          const cardBorderColor = isCustomOverride ? "#4A90D9"
                            : isClosedOverride ? "#B8A88C"
                            : isToday ? "#D4A574"
                            : dayShifts.length > 0 ? "#D4A574"
                            : "#E5D7BB";
                          return (
                            <button key={wd} type="button"
                              onClick={() => setDayEditor({ dateStr, weekday: wd })}
                              aria-label={`Edit ${label} hours`}
                              style={{
                                display: "flex", alignItems: "center", gap: "12px",
                                padding: "10px 14px",
                                background: cardBg,
                                border: `1px solid ${cardBorderColor}`,
                                borderLeft: isToday ? "4px solid #D4A574" : `1px solid ${cardBorderColor}`,
                                borderRadius: "8px",
                                cursor: "pointer",
                                textAlign: "left", width: "100%",
                                font: "inherit", color: "inherit",
                              }}>
                              <div style={{ width: "110px", flexShrink: 0 }}>
                                <div style={{ fontSize: "13px", fontWeight: isToday ? 700 : 600, color: dayShifts.length > 0 || dateOverride ? "#1F1612" : "#8B7960" }}>
                                  {label}
                                </div>
                                <div style={{ fontSize: "10px", color: isToday ? "#4A3D30" : "#8B7960", marginTop: "1px" }}>
                                  {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                </div>
                              </div>
                              <div style={{ flex: 1 }}>
                                {isCustomOverride ? (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <div style={{ fontSize: "13px", color: "#4A90D9", fontWeight: 500 }}>
                                      {dateOverride!.startTime || ""} – {dateOverride!.endTime || ""}
                                    </div>
                                    <div style={{ fontSize: "10px", color: "#4A90D9", fontStyle: "italic" }}>
                                      Override shift
                                    </div>
                                  </div>
                                ) : isClosedOverride ? (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <div style={{ fontSize: "13px", color: "#8B7960", fontStyle: "italic" }}>
                                      Blocked
                                    </div>
                                    <div style={{ fontSize: "10px", color: "#8B7960" }}>
                                      {dateOverride!.reason || "Closed"}
                                    </div>
                                  </div>
                                ) : dayShifts.length > 0 ? (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    {dayShifts.map((s, i) => (
                                      <div key={i} style={{ fontSize: "13px", color: "#1F1612" }}>
                                        {s.startTime} – {s.endTime}
                                      </div>
                                    ))}
                                    {blockedNames.length > 0 ? (
                                      <div style={{ fontSize: "10px", color: "#8B7960", marginTop: "2px" }}>
                                        {blockedNames.length} service{blockedNames.length > 1 ? "s" : ""} blocked: {blockedNames.join(", ")}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: "12px", color: "#8B7960", fontStyle: "italic" }}>Closed</div>
                                )}
                              </div>
                              {isCustomOverride ? (
                                <span style={{
                                  background: "#4A90D9", color: "#FFFFFF",
                                  padding: "2px 8px", borderRadius: "4px",
                                  fontSize: "10px", fontWeight: 600, letterSpacing: "0.5px",
                                  flexShrink: 0,
                                }}>OVERRIDE</span>
                              ) : isClosedOverride ? (
                                <span style={{
                                  background: "#8B7960", color: "#FFFFFF",
                                  padding: "2px 8px", borderRadius: "4px",
                                  fontSize: "10px", fontWeight: 600, letterSpacing: "0.5px",
                                  flexShrink: 0,
                                }}>BLOCKED</span>
                              ) : null}
                              <span style={{ fontSize: "16px", color: "#8B7960", flexShrink: 0 }} aria-hidden>›</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
                <button type="button" className="svc-duplicate-btn"
                  onClick={() => setRegularHoursOpen(true)} disabled={submitting}
                  style={{ alignSelf: "flex-start" }}>
                  Edit regular hours
                </button>
              </>
            )}
          </>
        ) : (
          /* ===== OVERRIDES & TIME OFF SUB-TAB ===== */
          <>
            {/* Mini calendar heatmap — next 4 weeks */}
            {(() => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const jsDay = today.getDay();
              const daysSinceMonday = (jsDay + 6) % 7;
              const weekStart = new Date(today);
              weekStart.setDate(today.getDate() - daysSinceMonday);

              const weeks: Array<Array<{ dateStr: string; dayNum: number; isToday: boolean; status: "none" | "regular" | "override" | "timeoff" }>> = [];
              for (let w = 0; w < 4; w++) {
                const week: typeof weeks[0] = [];
                for (let d = 0; d < 7; d++) {
                  const date = new Date(weekStart);
                  date.setDate(weekStart.getDate() + w * 7 + d);
                  const dateStr = date.toISOString().split("T")[0];
                  const dayNum = date.getDate();
                  const isToday = dateStr === today.toISOString().split("T")[0];

                  const dayShifts = (shifts.get(d) || []).filter((s) => s.isActive);
                  const dateOverride = overrides.find((ov) => {
                    const ovStart = new Date(ov.startsAt).toISOString().split("T")[0];
                    const ovEnd = new Date(ov.endsAt).toISOString().split("T")[0];
                    return dateStr >= ovStart && dateStr <= ovEnd;
                  });

                  let status: "none" | "regular" | "override" | "timeoff" = "none";
                  if (dateOverride) {
                    status = dateOverride.overrideType === "custom_hours" ? "override" : "timeoff";
                  } else if (dayShifts.length > 0) {
                    status = "regular";
                  }
                  week.push({ dateStr, dayNum, isToday, status });
                }
                weeks.push(week);
              }

              const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
              const dayHeaders = ["M", "T", "W", "T", "F", "S", "S"];

              return (
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "11px", color: "#8B7960", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Upcoming weeks</div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    {weeks.map((week, wi) => {
                      const firstDate = new Date(week[0].dateStr + "T00:00:00");
                      const lastDate = new Date(week[6].dateStr + "T00:00:00");
                      const label = `${monthNames[firstDate.getMonth()]} ${firstDate.getDate()}–${lastDate.getDate()}`;
                      return (
                        <div key={wi} style={{ flex: 1 }}>
                          <div style={{ fontSize: "9px", color: "#8B7960", textAlign: "center", marginBottom: "4px" }}>{label}</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "3px" }}>
                            {week.map((day, di) => {
                              const bg = day.status === "override" ? "#4A90D9"
                                : day.status === "timeoff" ? "#8B7960"
                                : day.status === "regular" ? "#D4A574"
                                : "#F5EFE0";
                              const textColor = day.status !== "none" ? "#FFFFFF" : "#8B7960";
                              return (
                                <div key={di} title={`${dayHeaders[di]} ${day.dateStr}: ${day.status}`} style={{
                                  width: "100%", aspectRatio: "1",
                                  background: bg,
                                  borderRadius: "3px",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: "10px", fontWeight: day.isToday ? 700 : 400,
                                  color: textColor,
                                  border: day.isToday ? "2px solid #1F1612" : "none",
                                  cursor: "default",
                                }}>
                                  {day.dayNum}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "12px", marginTop: "8px", fontSize: "10px", color: "#8B7960" }}>
                    <span><span style={{ display: "inline-block", width: "10px", height: "10px", background: "#D4A574", borderRadius: "2px", marginRight: "4px" }} /> Regular</span>
                    <span><span style={{ display: "inline-block", width: "10px", height: "10px", background: "#4A90D9", borderRadius: "2px", marginRight: "4px" }} /> Override</span>
                    <span><span style={{ display: "inline-block", width: "10px", height: "10px", background: "#8B7960", borderRadius: "2px", marginRight: "4px" }} /> Time off</span>
                  </div>
                </div>
              );
            })()}

            {/* All overrides list */}
            <div style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <div style={{ fontSize: "11px", color: "#8B7960", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  All overrides &amp; time off
                </div>
                <button type="button" className="svc-duplicate-btn"
                  onClick={() => setTimeOffOpen(true)} disabled={submitting}
                  style={{ fontSize: "11px", padding: "4px 10px" }}>
                  + Block time off
                </button>
              </div>
              {overrides.length === 0 ? (
                <div style={{
                  padding: "14px", background: "#FDF8F0", borderRadius: "6px",
                  border: "1px dashed #D9CBB1", textAlign: "center",
                  fontSize: "12px", color: "#8B7960",
                }}>
                  No overrides or time off scheduled.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {overrides
                    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
                    .map((ov) => {
                      const startD = new Date(ov.startsAt);
                      const endD = new Date(ov.endsAt);
                      const startDateStr = startD.toISOString().split("T")[0];
                      const endDateStr = endD.toISOString().split("T")[0];
                      const sameDay = startDateStr === endDateStr;
                      const fmtDateStr = (ds: string) => {
                        const [y, m, d] = ds.split("-").map(Number);
                        const date = new Date(Date.UTC(y, m - 1, d));
                        return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
                      };
                      const isCustom = ov.overrideType === "custom_hours";
                      const isPast = endD < new Date();
                      const isExpanded = expandedOverrideId === ov.id;
                      return (
                        <React.Fragment key={ov.id}>
                        <button type="button"
                          onClick={() => setExpandedOverrideId(isExpanded ? null : ov.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: "10px",
                            padding: "10px 12px",
                            background: isPast ? "#FAF7F2" : isCustom ? "#E8F0FE" : "#FDF8F0",
                            borderRadius: "8px",
                            border: `1px solid ${isCustom ? "#4A90D9" : "#E5D7BB"}`,
                            opacity: isPast ? 0.6 : 1,
                            cursor: "pointer",
                            textAlign: "left", width: "100%",
                            font: "inherit", color: "inherit",
                          }}>
                          <div style={{ minWidth: "110px", flexShrink: 0 }}>
                            <div style={{ fontSize: "12px", fontWeight: 500, color: "#1F1612" }}>
                              {sameDay ? fmtDateStr(startDateStr) : `${fmtDateStr(startDateStr)} – ${fmtDateStr(endDateStr)}`}
                            </div>
                            <div style={{ fontSize: "10px", color: "#8B7960", marginTop: "1px" }}>
                              {sameDay ? "1 day" : `${Math.ceil((endD.getTime() - startD.getTime()) / 86400000) + 1} days`}
                            </div>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "12px", color: "#4A3D30" }}>
                              {ov.reason || (isCustom ? "Custom hours" : "Time off")}
                            </div>
                            {isCustom && ov.startTime ? (
                              <div style={{ fontSize: "11px", color: "#4A90D9", marginTop: "2px" }}>
                                {ov.startTime} – {ov.endTime}
                              </div>
                            ) : null}
                            {ov.blockedServiceIds && ov.blockedServiceIds.length > 0 ? (
                              <div style={{ fontSize: "10px", color: "#8B7960", marginTop: "2px" }}>
                                {ov.blockedServiceIds.length} service{ov.blockedServiceIds.length > 1 ? "s" : ""} blocked
                              </div>
                            ) : null}
                          </div>
                          <span style={{
                            padding: "2px 7px", borderRadius: "4px",
                            fontSize: "10px", fontWeight: 600,
                            background: isCustom ? "#4A90D9" : "#8B7960",
                            color: "#FFFFFF",
                          }}>
                            {isCustom ? "OVERRIDE" : "BLOCKED"}
                          </span>
                          <button type="button" className="svc-text-btn"
                            onClick={(e) => { e.stopPropagation(); handleDeleteOverride(ov.id); }}
                            aria-label={`Remove ${isCustom ? "override" : "time off"} ${fmtDateStr(startDateStr)}`}
                            style={{ fontSize: "14px" }}>×</button>
                        </button>
                        {expandedOverrideId === ov.id ? (
                          <div style={{
                            marginTop: "-2px", padding: "12px 14px",
                            background: "#FDF8F0", borderRadius: "0 0 8px 8px",
                            border: "1px solid #E5D7BB", borderTop: "none",
                            display: "flex", flexDirection: "column", gap: "8px",
                          }}>
                            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                              <div>
                                <div style={{ fontSize: "10px", color: "#8B7960", textTransform: "uppercase" }}>Type</div>
                                <div style={{ fontSize: "12px", color: "#1F1612" }}>
                                  {isCustom ? "Custom hours override" : "Full-day block"}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: "10px", color: "#8B7960", textTransform: "uppercase" }}>Duration</div>
                                <div style={{ fontSize: "12px", color: "#1F1612" }}>
                                  {sameDay ? "1 day" : `${Math.ceil((endD.getTime() - startD.getTime()) / 86400000) + 1} days`}
                                </div>
                              </div>
                              {isCustom && ov.startTime ? (
                                <div>
                                  <div style={{ fontSize: "10px", color: "#8B7960", textTransform: "uppercase" }}>Time</div>
                                  <div style={{ fontSize: "12px", color: "#1F1612" }}>{ov.startTime} – {ov.endTime}</div>
                                </div>
                              ) : null}
                            </div>
                            {ov.reason ? (
                              <div>
                                <div style={{ fontSize: "10px", color: "#8B7960", textTransform: "uppercase" }}>Reason</div>
                                <div style={{ fontSize: "12px", color: "#1F1612" }}>{ov.reason}</div>
                              </div>
                            ) : null}
                            <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                              <button type="button" className="svc-text-btn"
                                onClick={() => {
                                  // Use UTC date from the override, not local time
                                  const dateStr = startDateStr;
                                  const weekday = startD.getUTCDay();
                                  const wd = weekday === 0 ? 6 : weekday - 1;
                                  setDayEditor({ dateStr, weekday: wd });
                                }}
                                style={{ fontSize: "11px", textDecoration: "underline" }}>
                                Edit in day editor
                              </button>
                            </div>
                          </div>
                        ) : null}
                        </React.Fragment>
                      );
                    })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {dayEditor ? (
        <DayEditorDrawer
          dateStr={dayEditor.dateStr}
          weekday={dayEditor.weekday}
          services={services}
          recurringShifts={shifts.get(dayEditor.weekday) || []}
          recurringBlockedServices={dayBlockedServices.get(dayEditor.weekday) || []}
          dateOverride={overrides.find((ov) => {
            const s = new Date(ov.startsAt).toISOString().split("T")[0];
            const e = new Date(ov.endsAt).toISOString().split("T")[0];
            return dayEditor.dateStr >= s && dayEditor.dateStr <= e;
          }) || null}
          submitting={submitting}
          onClose={() => setDayEditor(null)}
          onSaveOverride={async (payload) => {
            await handleSaveDateOverride(dayEditor.dateStr, payload);
            setDayEditor(null);
          }}
          onSaveRecurring={async (payload) => {
            await handleSaveRecurringDay(dayEditor.weekday, payload);
            setDayEditor(null);
          }}
          onClearOverride={async (id) => {
            await handleDeleteOverride(id);
            setDayEditor(null);
          }}
        />
      ) : null}

      {timeOffOpen ? (
        <TimeOffDrawer
          services={services}
          submitting={submitting}
          onClose={() => setTimeOffOpen(false)}
          onSave={handleSaveTimeOff}
        />
      ) : null}

      {regularHoursOpen ? (
        <RegularHoursDrawer
          currentShifts={shifts}
          currentBlocked={dayBlockedServices}
          submitting={submitting}
          onClose={() => setRegularHoursOpen(false)}
          onSave={handleSaveBulkRecurring}
        />
      ) : null}
    </div>
  );
}


// ===========================================================================
// Day editor drawer — edit a single date's shifts/services with recurring vs one-off scope
// ===========================================================================

function DayEditorDrawer({
  dateStr,
  weekday,
  services,
  recurringShifts,
  recurringBlockedServices,
  dateOverride,
  submitting,
  onClose,
  onSaveOverride,
  onSaveRecurring,
  onClearOverride,
}: {
  dateStr: string;
  weekday: number;
  services: ServiceSummary[];
  recurringShifts: ProviderScheduleEntry[];
  recurringBlockedServices: string[];
  dateOverride: ProviderTimeOffEntry | null;
  submitting: boolean;
  onClose: () => void;
  onSaveOverride: (payload: {
    closedAllDay: boolean;
    startTime: string;
    endTime: string;
    blockedServiceIds: string[];
    existingOverrideId: string | null;
    startDate?: string;
    endDate?: string;
    reason?: string;
  }) => Promise<void>;
  onSaveRecurring: (payload: {
    shifts: Array<{ startTime: string; endTime: string; isActive: boolean }>;
    blockedServiceIds: string[];
  }) => Promise<void>;
  onClearOverride: (overrideId: string) => Promise<void>;
}) {
  const [scope, setScope] = useState<"date" | "recurring">("date");
  const [localShifts, setLocalShifts] = useState<Array<{ startTime: string; endTime: string }>>([]);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Inline block-date form
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockStartDate, setBlockStartDate] = useState(dateStr);
  const [blockEndDate, setBlockEndDate] = useState(dateStr);
  const [blockReason, setBlockReason] = useState("");
  const [blockAllDay, setBlockAllDay] = useState(false);
  const [blockTimeStart, setBlockTimeStart] = useState("09:00");
  const [blockTimeEnd, setBlockTimeEnd] = useState("17:00");

  // Track which mode we initialized for so we can seed from the correct source when scope changes.
  const initializedForRef = useRef<string>("");
  useEffect(() => {
    const key = `${dateStr}:${scope}:${dateOverride?.id || ""}`;
    if (initializedForRef.current === key) return;
    initializedForRef.current = key;

    if (scope === "date" && dateOverride) {
      if (dateOverride.overrideType === "closed") {
        setLocalShifts([]);
      } else {
        setLocalShifts([{
          startTime: dateOverride.startTime || "09:00",
          endTime: dateOverride.endTime || "17:00",
        }]);
      }
      setBlockedIds(dateOverride.blockedServiceIds || []);
    } else {
      const active = recurringShifts.filter((s) => s.isActive);
      setLocalShifts(active.map((s) => ({ startTime: s.startTime, endTime: s.endTime })));
      setBlockedIds(recurringBlockedServices);
    }
  }, [dateStr, scope, dateOverride, recurringShifts, recurringBlockedServices]);

  const dayName = WEEKDAY_LABELS[weekday];
  const displayDate = new Date(dateStr + "T00:00:00");
  const dateLabel = displayDate.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
  const shortDate = displayDate.toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });

  const addLocalShift = () => setLocalShifts((p) => [...p, { startTime: "09:00", endTime: "17:00" }]);
  const removeLocalShift = (i: number) => setLocalShifts((p) => p.filter((_, idx) => idx !== i));
  const updateLocalShift = (i: number, patch: Partial<{ startTime: string; endTime: string }>) =>
    setLocalShifts((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const toggleService = (id: string) =>
    setBlockedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const handleSave = async () => {
    setSaveError(null);
    const closedAllDay = localShifts.length === 0;
    try {
      if (scope === "date") {
        await onSaveOverride({
          closedAllDay,
          startTime: localShifts[0]?.startTime || "09:00",
          endTime: localShifts[0]?.endTime || "17:00",
          blockedServiceIds: blockedIds,
          existingOverrideId: dateOverride?.id || null,
        });
      } else {
        await onSaveRecurring({
          shifts: localShifts.map((s) => ({ ...s, isActive: true })),
          blockedServiceIds: blockedIds,
        });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label={`Edit ${dateLabel}`} onClick={onClose}>
      <div style={{
        position: "fixed", top: 0, right: 0, height: "100vh",
        width: "min(440px, 100vw)",
        background: "#FFFFFF",
        boxShadow: "-2px 0 12px rgba(31,22,18,0.15)",
        display: "flex", flexDirection: "column",
      }} onClick={(e) => e.stopPropagation()}>
        <header style={{
          padding: "16px 18px", borderBottom: "1px solid #E5D7BB",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        }}>
          <div>
            <div style={{ fontSize: "11px", color: "#8B7960", textTransform: "uppercase", letterSpacing: "0.5px" }}>Edit day</div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#1F1612", marginTop: "2px" }}>{dateLabel}</div>
          </div>
          <button type="button" className="ghost-action" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px" }}>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#1F1612", textTransform: "uppercase", letterSpacing: "0.5px" }}>Shifts</div>
              {localShifts.length > 0 ? (
                <button type="button" className="svc-text-btn"
                  style={{ fontSize: "11px", color: "#8A2E1E" }}
                  onClick={() => setLocalShifts([])}>Clear all (closed)</button>
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {localShifts.length === 0 ? (
                <div style={{
                  padding: "12px", background: "#FDF8F0", borderRadius: "6px",
                  border: "1px dashed #D9CBB1", textAlign: "center",
                  fontSize: "12px", color: "#8B7960",
                }}>
                  No shifts scheduled. This day is closed.
                </div>
              ) : (
                localShifts.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="text" className="svc-input"
                      style={{ width: "88px", textAlign: "center" }}
                      value={s.startTime} placeholder="09:00"
                      aria-label={`Shift ${i + 1} start`}
                      onChange={(e) => updateLocalShift(i, { startTime: e.target.value })} />
                    <span style={{ color: "#8B7960", fontSize: "12px" }}>→</span>
                    <input type="text" className="svc-input"
                      style={{ width: "88px", textAlign: "center" }}
                      value={s.endTime} placeholder="17:00"
                      aria-label={`Shift ${i + 1} end`}
                      onChange={(e) => updateLocalShift(i, { endTime: e.target.value })} />
                    <button type="button" className="svc-text-btn"
                      onClick={() => removeLocalShift(i)}
                      aria-label={`Remove shift ${i + 1}`}>×</button>
                  </div>
                ))
              )}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button type="button"
                  onClick={addLocalShift}
                  style={{
                    fontSize: "12px",
                    padding: "6px 12px",
                    background: "#F5E6D3",
                    color: "#4A3D30",
                    border: "1px solid #D4A574",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}>+ Add shift</button>
                <button type="button"
                  onClick={() => {
                    setShowBlockForm(true);
                    setBlockStartDate(dateStr);
                    setBlockEndDate(dateStr);
                    setBlockReason("");
                  }}
                  style={{
                    fontSize: "12px",
                    padding: "6px 12px",
                    background: "#FDE7E1",
                    color: "#8A2E1E",
                    border: "1px solid #D9CBB1",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}>Block date</button>
              </div>
            </div>
            {showBlockForm ? (
              <div style={{
                marginTop: "12px", padding: "12px",
                background: "#FDF8F0", borderRadius: "8px",
                border: "1px solid #E5D7BB",
              }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "#1F1612", marginBottom: "8px" }}>
                  Block dates as time off
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
                  <input type="date" className="svc-input" style={{ width: "140px" }}
                    value={blockStartDate}
                    aria-label="Block start date"
                    onChange={(e) => setBlockStartDate(e.target.value)} />
                  <span style={{ color: "#8B7960", fontSize: "12px" }}>to</span>
                  <input type="date" className="svc-input" style={{ width: "140px" }}
                    value={blockEndDate}
                    aria-label="Block end date"
                    onChange={(e) => setBlockEndDate(e.target.value)} />
                </div>
                <div style={{ marginBottom: "8px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#4A3D30", cursor: "pointer", marginBottom: "6px" }}>
                    <input type="checkbox" checked={blockAllDay}
                      onChange={(e) => setBlockAllDay(e.target.checked)} />
                    Block all day
                  </label>
                  {!blockAllDay ? (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input type="text" className="svc-input"
                        style={{ width: "80px", textAlign: "center" }}
                        value={blockTimeStart} placeholder="09:00"
                        aria-label="Block time start"
                        onChange={(e) => setBlockTimeStart(e.target.value)} />
                      <span style={{ color: "#8B7960", fontSize: "12px" }}>to</span>
                      <input type="text" className="svc-input"
                        style={{ width: "80px", textAlign: "center" }}
                        value={blockTimeEnd} placeholder="17:00"
                        aria-label="Block time end"
                        onChange={(e) => setBlockTimeEnd(e.target.value)} />
                    </div>
                  ) : null}
                </div>
                <input type="text" className="svc-input"
                  style={{ width: "100%", marginBottom: "8px" }}
                  value={blockReason} placeholder="Reason (optional, e.g. Vacation)"
                  onChange={(e) => setBlockReason(e.target.value)} />
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button type="button" className="svc-save-btn"
                    onClick={async () => {
                      setSaveError(null);
                      try {
                        await onSaveOverride({
                          closedAllDay: blockAllDay,
                          startTime: blockTimeStart,
                          endTime: blockTimeEnd,
                          blockedServiceIds: blockedIds,
                          existingOverrideId: dateOverride?.id || null,
                          startDate: blockStartDate,
                          endDate: blockEndDate,
                          reason: blockReason,
                        });
                        setShowBlockForm(false);
                      } catch (err) {
                        setSaveError(err instanceof Error ? err.message : "Failed to block");
                      }
                    }}
                    disabled={submitting}
                    style={{ fontSize: "11px", padding: "4px 10px" }}>
                    {submitting ? "Saving..." : "Confirm block"}
                  </button>
                  <button type="button" className="svc-text-btn"
                    onClick={() => setShowBlockForm(false)}>Cancel</button>
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#1F1612", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Block services</div>
            <div style={{ fontSize: "11px", color: "#8B7960", marginBottom: "8px" }}>
              Select services that should NOT be bookable on this day.
            </div>
            {services.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8B7960", fontStyle: "italic" }}>
                No services assigned to this provider.
              </div>
            ) : (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {services.map((svc) => {
                  const isBlocked = blockedIds.includes(svc.id);
                  return (
                    <label key={svc.id} style={{
                      display: "flex", alignItems: "center", gap: "5px",
                      fontSize: "11px", cursor: "pointer",
                      padding: "4px 9px", borderRadius: "4px",
                      background: isBlocked ? "#F5E6D3" : "transparent",
                      border: `1px solid ${isBlocked ? "#D4A574" : "#D9CBB1"}`,
                      color: isBlocked ? "#4A3D30" : "#6B5A47",
                    }}>
                      <input type="checkbox" checked={isBlocked}
                        onChange={() => toggleService(svc.id)}
                        style={{ width: "12px", height: "12px" }} />
                      {svc.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {saveError ? (
            <div role="alert" style={{
              padding: "8px 10px", background: "#FDE7E1", borderRadius: "6px",
              fontSize: "12px", color: "#8A2E1E",
            }}>{saveError}</div>
          ) : null}
        </div>

        <footer style={{
          padding: "14px 18px", borderTop: "1px solid #E5D7BB", background: "#FDF8F0",
        }}>
          <div style={{ fontSize: "11px", color: "#8B7960", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Apply to</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#1F1612", cursor: "pointer" }}>
              <input type="radio" name={`scope-${dateStr}`} value="date"
                checked={scope === "date"}
                onChange={() => setScope("date")} />
              Just this {dayName} ({shortDate})
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#1F1612", cursor: "pointer" }}>
              <input type="radio" name={`scope-${dateStr}`} value="recurring"
                checked={scope === "recurring"}
                onChange={() => setScope("recurring")} />
              Every {dayName}
            </label>
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
            {dateOverride && scope === "date" ? (
              <button type="button" className="svc-text-btn"
                onClick={() => { void onClearOverride(dateOverride.id); }}
                style={{ marginRight: "auto", color: "#8A2E1E" }}
                disabled={submitting}>Clear override</button>
            ) : null}
            <button type="button" className="ghost-action" onClick={onClose}>Cancel</button>
            {!showBlockForm ? (
              <button type="button" className="svc-save-btn"
                onClick={handleSave} disabled={submitting}>
                {submitting ? "Saving..." : "Save"}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}


// ===========================================================================
// Time-off drawer — multi-day vacation / closure block
// ===========================================================================

function TimeOffDrawer({
  services,
  submitting,
  onClose,
  onSave,
}: {
  services: ServiceSummary[];
  submitting: boolean;
  onClose: () => void;
  onSave: (payload: {
    startDate: string;
    endDate: string;
    reason: string;
    blockedServiceIds: string[];
  }) => Promise<void>;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setErr(null);
    if (!startDate || !endDate) {
      setErr("Select start and end dates");
      return;
    }
    try {
      await onSave({ startDate, endDate, reason, blockedServiceIds: blockedIds });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="Block time off" onClick={onClose}>
      <div style={{
        position: "fixed", top: 0, right: 0, height: "100vh",
        width: "min(440px, 100vw)",
        background: "#FFFFFF",
        boxShadow: "-2px 0 12px rgba(31,22,18,0.15)",
        display: "flex", flexDirection: "column",
      }} onClick={(e) => e.stopPropagation()}>
        <header style={{
          padding: "16px 18px", borderBottom: "1px solid #E5D7BB",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        }}>
          <div>
            <div style={{ fontSize: "11px", color: "#8B7960", textTransform: "uppercase", letterSpacing: "0.5px" }}>New time off</div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#1F1612", marginTop: "2px" }}>Block dates</div>
          </div>
          <button type="button" className="ghost-action" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <label style={{ fontSize: "12px", color: "#4A3D30" }}>
              Start date
              <input type="date" className="svc-input"
                style={{ width: "100%", marginTop: "4px" }}
                value={startDate}
                aria-label="Time off start date"
                onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label style={{ fontSize: "12px", color: "#4A3D30" }}>
              End date
              <input type="date" className="svc-input"
                style={{ width: "100%", marginTop: "4px" }}
                value={endDate}
                aria-label="Time off end date"
                onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <label style={{ fontSize: "12px", color: "#4A3D30" }}>
              Reason (optional)
              <input type="text" className="svc-input"
                style={{ width: "100%", marginTop: "4px" }}
                value={reason} placeholder="e.g. Vacation"
                onChange={(e) => setReason(e.target.value)} />
            </label>

            {services.length > 0 ? (
              <div>
                <div style={{ fontSize: "12px", color: "#4A3D30", marginBottom: "6px" }}>
                  Block specific services only (optional)
                </div>
                <div style={{ fontSize: "10px", color: "#8B7960", marginBottom: "8px" }}>
                  Leave empty to close all bookings.
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {services.map((svc) => {
                    const isBlocked = blockedIds.includes(svc.id);
                    return (
                      <label key={svc.id} style={{
                        display: "flex", alignItems: "center", gap: "5px",
                        fontSize: "11px", cursor: "pointer",
                        padding: "4px 9px", borderRadius: "4px",
                        background: isBlocked ? "#F5E6D3" : "transparent",
                        border: `1px solid ${isBlocked ? "#D4A574" : "#D9CBB1"}`,
                      }}>
                        <input type="checkbox" checked={isBlocked}
                          onChange={() => setBlockedIds((p) => (p.includes(svc.id) ? p.filter((x) => x !== svc.id) : [...p, svc.id]))}
                          style={{ width: "12px", height: "12px" }} />
                        {svc.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {err ? (
            <div role="alert" style={{
              marginTop: "12px",
              padding: "8px 10px", background: "#FDE7E1", borderRadius: "6px",
              fontSize: "12px", color: "#8A2E1E",
            }}>{err}</div>
          ) : null}
        </div>

        <footer style={{
          padding: "14px 18px", borderTop: "1px solid #E5D7BB", background: "#FDF8F0",
          display: "flex", gap: "8px", justifyContent: "flex-end",
        }}>
          <button type="button" className="ghost-action" onClick={onClose}>Cancel</button>
          <button type="button" className="svc-save-btn"
            onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving..." : "Block dates"}
          </button>
        </footer>
      </div>
    </div>
  );
}


// ===========================================================================
// Regular hours drawer — bulk edit all 7 weekdays at once with presets
// ===========================================================================

type RegularHoursRow = {
  weekday: number;
  isActive: boolean;
  shifts: Array<{ startTime: string; endTime: string }>;
};

function RegularHoursDrawer({
  currentShifts,
  currentBlocked,
  submitting,
  onClose,
  onSave,
}: {
  currentShifts: Map<number, ProviderScheduleEntry[]>;
  currentBlocked: Map<number, string[]>;
  submitting: boolean;
  onClose: () => void;
  onSave: (
    nextShifts: Map<number, Array<{ startTime: string; endTime: string; isActive: boolean }>>,
    nextBlocked: Map<number, string[]>,
  ) => Promise<void>;
}) {
  const [rows, setRows] = useState<RegularHoursRow[]>(() =>
    WEEKDAY_LABELS.map((_, wd) => {
      const active = (currentShifts.get(wd) || []).filter((s) => s.isActive);
      return {
        weekday: wd,
        isActive: active.length > 0,
        shifts: active.length > 0
          ? active.map((s) => ({ startTime: s.startTime, endTime: s.endTime }))
          : [{ startTime: "09:00", endTime: "17:00" }],
      };
    }),
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  const patchRow = (wd: number, patch: Partial<RegularHoursRow>) =>
    setRows((r) => r.map((row) => (row.weekday === wd ? { ...row, ...patch } : row)));

  const toggleActive = (wd: number) =>
    setRows((r) => r.map((row) => (row.weekday === wd ? { ...row, isActive: !row.isActive } : row)));

  const setShiftTime = (wd: number, idx: number, patch: Partial<{ startTime: string; endTime: string }>) =>
    patchRow(wd, {
      shifts: rows.find((r) => r.weekday === wd)!.shifts.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });

  const addShift = (wd: number) => {
    const row = rows.find((r) => r.weekday === wd)!;
    patchRow(wd, {
      isActive: true,
      shifts: [...row.shifts, { startTime: "09:00", endTime: "17:00" }],
    });
  };

  const removeShift = (wd: number, idx: number) => {
    const row = rows.find((r) => r.weekday === wd)!;
    const nextShifts = row.shifts.filter((_, i) => i !== idx);
    patchRow(wd, {
      shifts: nextShifts.length > 0 ? nextShifts : [{ startTime: "09:00", endTime: "17:00" }],
      isActive: nextShifts.length > 0 ? row.isActive : false,
    });
  };

  const copyToAll = (wd: number) => {
    const source = rows.find((r) => r.weekday === wd)!;
    setRows((r) =>
      r.map((row) =>
        row.weekday === wd
          ? row
          : { ...row, isActive: true, shifts: source.shifts.map((s) => ({ ...s })) },
      ),
    );
  };

  const copyToWeekdays = (wd: number) => {
    const source = rows.find((r) => r.weekday === wd)!;
    setRows((r) =>
      r.map((row) =>
        row.weekday !== wd && row.weekday <= 4
          ? { ...row, isActive: true, shifts: source.shifts.map((s) => ({ ...s })) }
          : row,
      ),
    );
  };

  type Preset = "weekdays9to5" | "weekdays10to6" | "everyday10to6" | "clear";
  const applyPreset = (preset: Preset) => {
    if (preset === "weekdays9to5") {
      setRows((r) =>
        r.map((row) => ({
          ...row,
          isActive: row.weekday <= 4,
          shifts: [{ startTime: "09:00", endTime: "17:00" }],
        })),
      );
    } else if (preset === "weekdays10to6") {
      setRows((r) =>
        r.map((row) => ({
          ...row,
          isActive: row.weekday <= 4,
          shifts: [{ startTime: "10:00", endTime: "18:00" }],
        })),
      );
    } else if (preset === "everyday10to6") {
      setRows((r) =>
        r.map((row) => ({
          ...row,
          isActive: true,
          shifts: [{ startTime: "10:00", endTime: "18:00" }],
        })),
      );
    } else if (preset === "clear") {
      setRows((r) => r.map((row) => ({ ...row, isActive: false })));
    }
  };

  const activeCount = rows.filter((r) => r.isActive).length;
  const totalHours = rows.reduce((total, row) => {
    if (!row.isActive) return total;
    return (
      total +
      row.shifts.reduce((h, s) => {
        const [sh, sm] = s.startTime.split(":").map(Number);
        const [eh, em] = s.endTime.split(":").map(Number);
        const mins = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
        return mins > 0 ? h + mins / 60 : h;
      }, 0)
    );
  }, 0);

  const handleSave = async () => {
    setSaveError(null);
    const nextShifts = new Map<number, Array<{ startTime: string; endTime: string; isActive: boolean }>>();
    const nextBlocked = new Map<number, string[]>();
    for (const row of rows) {
      if (row.isActive && row.shifts.length > 0) {
        nextShifts.set(
          row.weekday,
          row.shifts.map((s) => ({ ...s, isActive: true })),
        );
        const existingBlocked = currentBlocked.get(row.weekday);
        if (existingBlocked && existingBlocked.length > 0) {
          nextBlocked.set(row.weekday, existingBlocked);
        }
      }
    }
    try {
      await onSave(nextShifts, nextBlocked);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const presetBtnStyle: React.CSSProperties = {
    padding: "6px 12px",
    fontSize: "12px",
    background: "#FFFFFF",
    color: "#4A3D30",
    border: "1px solid #D4A574",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: 500,
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="Set regular hours" onClick={onClose}>
      <div style={{
        position: "fixed", top: 0, right: 0, height: "100vh",
        width: "min(560px, 100vw)",
        background: "#FFFFFF",
        boxShadow: "-2px 0 12px rgba(31,22,18,0.15)",
        display: "flex", flexDirection: "column",
      }} onClick={(e) => e.stopPropagation()}>
        <header style={{
          padding: "16px 18px", borderBottom: "1px solid #E5D7BB",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        }}>
          <div>
            <div style={{ fontSize: "11px", color: "#8B7960", textTransform: "uppercase", letterSpacing: "0.5px" }}>Recurring template</div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#1F1612", marginTop: "2px" }}>Set regular hours</div>
            <div style={{ fontSize: "11px", color: "#8B7960", marginTop: "4px" }}>
              {activeCount} of 7 days · {totalHours.toFixed(1)} hrs / week
            </div>
          </div>
          <button type="button" className="ghost-action" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px" }}>
          {/* Presets */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", color: "#8B7960", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Quick start</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button type="button" style={presetBtnStyle}
                onClick={() => applyPreset("weekdays9to5")}>Weekdays 9–5</button>
              <button type="button" style={presetBtnStyle}
                onClick={() => applyPreset("weekdays10to6")}>Weekdays 10–6</button>
              <button type="button" style={presetBtnStyle}
                onClick={() => applyPreset("everyday10to6")}>Every day 10–6</button>
              <button type="button" style={{ ...presetBtnStyle, color: "#8A2E1E", borderColor: "#D9CBB1" }}
                onClick={() => applyPreset("clear")}>Clear all</button>
            </div>
          </div>

          {/* 7-day table */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {rows.map((row) => {
              const label = WEEKDAY_LABELS[row.weekday];
              return (
                <div key={row.weekday} style={{
                  padding: "10px 12px",
                  background: row.isActive ? "#FDF8F0" : "#FFFFFF",
                  border: `1px solid ${row.isActive ? "#D4A574" : "#E5D7BB"}`,
                  borderRadius: "8px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <label style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      width: "110px", flexShrink: 0, cursor: "pointer",
                    }}>
                      <input type="checkbox" checked={row.isActive}
                        onChange={() => toggleActive(row.weekday)}
                        aria-label={`${label} active`}
                        style={{ width: "16px", height: "16px" }} />
                      <span style={{
                        fontSize: "13px", fontWeight: 600,
                        color: row.isActive ? "#1F1612" : "#8B7960",
                      }}>{label}</span>
                    </label>
                    <div style={{ flex: 1 }}>
                      {row.isActive ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {row.shifts.map((s, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <input type="text" className="svc-input"
                                style={{ width: "78px", textAlign: "center", padding: "5px 8px" }}
                                value={s.startTime} placeholder="09:00"
                                aria-label={`${label} shift ${i + 1} start`}
                                onChange={(e) => setShiftTime(row.weekday, i, { startTime: e.target.value })} />
                              <span style={{ color: "#8B7960", fontSize: "12px" }}>→</span>
                              <input type="text" className="svc-input"
                                style={{ width: "78px", textAlign: "center", padding: "5px 8px" }}
                                value={s.endTime} placeholder="17:00"
                                aria-label={`${label} shift ${i + 1} end`}
                                onChange={(e) => setShiftTime(row.weekday, i, { endTime: e.target.value })} />
                              <button type="button" className="svc-text-btn"
                                onClick={() => removeShift(row.weekday, i)}
                                aria-label={`Remove ${label} shift ${i + 1}`}
                                style={{ fontSize: "14px", padding: "0 6px" }}>×</button>
                              {i === row.shifts.length - 1 ? (
                                <button type="button" className="svc-text-btn"
                                  onClick={() => addShift(row.weekday)}
                                  style={{ fontSize: "11px", textDecoration: "underline", marginLeft: "4px" }}>+ Add</button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: "12px", color: "#8B7960", fontStyle: "italic" }}>Closed</div>
                      )}
                    </div>
                    {row.isActive ? (
                      <div style={{ display: "flex", gap: "4px", alignItems: "center", flexShrink: 0 }}>
                        {row.weekday <= 4 ? (
                          <button type="button" className="svc-text-btn"
                            onClick={() => copyToWeekdays(row.weekday)}
                            title="Copy to Mon–Fri"
                            style={{ fontSize: "10px", padding: "4px 6px" }}>→ weekdays</button>
                        ) : null}
                        <button type="button" className="svc-text-btn"
                          onClick={() => copyToAll(row.weekday)}
                          title="Copy to all 7 days"
                          style={{ fontSize: "10px", padding: "4px 6px" }}>→ all</button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {saveError ? (
            <div role="alert" style={{
              marginTop: "12px",
              padding: "8px 10px", background: "#FDE7E1", borderRadius: "6px",
              fontSize: "12px", color: "#8A2E1E",
            }}>{saveError}</div>
          ) : null}

          <div style={{
            marginTop: "16px", padding: "10px 12px",
            background: "#F5EFE0", borderRadius: "6px",
            fontSize: "11px", color: "#6B5A47",
          }}>
            <strong>Note:</strong> Saving replaces the entire weekly template for the selected location.
            One-off date overrides and time-off blocks are preserved.
          </div>
        </div>

        <footer style={{
          padding: "14px 18px", borderTop: "1px solid #E5D7BB", background: "#FDF8F0",
          display: "flex", gap: "8px", justifyContent: "flex-end",
        }}>
          <button type="button" className="ghost-action" onClick={onClose}>Cancel</button>
          <button type="button" className="svc-save-btn"
            onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving..." : "Save regular hours"}
          </button>
        </footer>
      </div>
    </div>
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

// Permissions tab (Phase E)
// ---------------------------------------------------------------------------

type PermissionsTabProps = {
  tenantSlug: string;
  user: TenantUserSummary;
};

// ===========================================================================
// Compensation tab
// ===========================================================================

type CompensationTabProps = {
  tenantSlug: string;
  provider: ProviderSummary;
  onSaved: () => void;
};

type CompensationMode = "service_percent" | "sliding_scale" | "product_percent" | "hourly" | "";

function CompensationTab({ tenantSlug, provider, onSaved }: CompensationTabProps) {
  const [mode, setMode] = useState<CompensationMode>(
    (provider.compensationMode as CompensationMode) ?? "",
  );
  const [servicePercent, setServicePercent] = useState(
    provider.compensationServicePercentBp != null
      ? (provider.compensationServicePercentBp / 100).toString()
      : "",
  );
  const [productPercent, setProductPercent] = useState(
    provider.compensationProductPercentBp != null
      ? (provider.compensationProductPercentBp / 100).toString()
      : "",
  );
  const [hourlyRate, setHourlyRate] = useState(
    provider.compensationHourlyCents != null
      ? (provider.compensationHourlyCents / 100).toFixed(2)
      : "",
  );
  const [slidingTiers, setSlidingTiers] = useState<
    Array<{ upToAmountCents: number; percentBp: number }>
  >(
    (provider.compensationSlidingScale as Array<{ upToAmountCents: number; percentBp: number }>) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setMode((provider.compensationMode as CompensationMode) ?? "");
    setServicePercent(
      provider.compensationServicePercentBp != null
        ? (provider.compensationServicePercentBp / 100).toString()
        : "",
    );
    setProductPercent(
      provider.compensationProductPercentBp != null
        ? (provider.compensationProductPercentBp / 100).toString()
        : "",
    );
    setHourlyRate(
      provider.compensationHourlyCents != null
        ? (provider.compensationHourlyCents / 100).toFixed(2)
        : "",
    );
    setSlidingTiers(
      (provider.compensationSlidingScale as Array<{ upToAmountCents: number; percentBp: number }>) ?? [],
    );
  }, [provider]);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const body: Record<string, unknown> = { compensationMode: mode || null };
      if (mode === "service_percent") {
        body.compensationServicePercentBp = servicePercent ? Math.round(Number(servicePercent) * 100) : null;
      }
      if (mode === "product_percent") {
        body.compensationProductPercentBp = productPercent ? Math.round(Number(productPercent) * 100) : null;
      }
      if (mode === "hourly") {
        body.compensationHourlyCents = hourlyRate ? Math.round(Number(hourlyRate) * 100) : null;
      }
      if (mode === "sliding_scale") {
        body.compensationSlidingScale = slidingTiers.length > 0 ? slidingTiers : null;
      }
      const session = await ensureActiveStoredSession();
      const token = session?.accessToken ?? "";
      const resp = await fetch(
        `${apiBaseUrl}/tenants/${tenantSlug}/providers/${provider.id}/compensation`,
        { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) },
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Request failed" }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      setStatus("Compensation saved.");
      onSaved();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to save compensation."));
    } finally {
      setSaving(false);
    }
  };

  const addSlidingTier = () => {
    const last = slidingTiers[slidingTiers.length - 1];
    const nextUpTo = last ? last.upToAmountCents + 10000 : 50000;
    setSlidingTiers([...slidingTiers, { upToAmountCents: nextUpTo, percentBp: 5000 }]);
  };

  const removeSlidingTier = (index: number) => {
    setSlidingTiers(slidingTiers.filter((_, i) => i !== index));
  };

  const updateSlidingTier = (index: number, field: "upToAmountCents" | "percentBp", value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return;
    setSlidingTiers((prev) =>
      prev.map((t, i) =>
        i === index
          ? { ...t, [field]: field === "upToAmountCents" ? Math.round(num) : Math.round(num) }
          : t,
      ),
    );
  };

  return (
    <div className="staff-detail-form">
      {status ? (
        <div className="message-banner" role="status">
          {status}
          <button type="button" className="ghost-action" onClick={() => setStatus(null)}>Dismiss</button>
        </div>
      ) : null}

      <div className="staff-fieldset">
        <h5 style={{ margin: "0 0 0.5rem" }}>Service Commission</h5>
        <p className="settings-form-help" style={{ margin: "0 0 0.75rem" }}>
          Compensation is calculated as a percentage of service sales
        </p>

        <label className="settings-label" style={{ marginBottom: "0.5rem", display: "block" }}>
          <input
            type="radio"
            name="compensationMode"
            value="service_percent"
            checked={mode === "service_percent"}
            onChange={() => setMode("service_percent")}
            style={{ marginRight: "0.5rem" }}
          />
          Basic Service Commission
        </label>
        <p className="settings-form-help" style={{ margin: "0 0 0.75rem 1.5rem" }}>
          A flat percentage of total sales
        </p>
        {mode === "service_percent" ? (
          <div style={{ marginLeft: "1.5rem", marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <input
                className="settings-input"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={servicePercent}
                onChange={(e) => setServicePercent(e.target.value)}
                placeholder="0"
                style={{ width: "6rem" }}
              />
              <span>%</span>
            </div>
          </div>
        ) : null}

        <label className="settings-label" style={{ marginBottom: "0.5rem", display: "block" }}>
          <input
            type="radio"
            name="compensationMode"
            value="sliding_scale"
            checked={mode === "sliding_scale"}
            onChange={() => setMode("sliding_scale")}
            style={{ marginRight: "0.5rem" }}
          />
          Sliding Scale Service Commission
        </label>
        <p className="settings-form-help" style={{ margin: "0 0 0.75rem 1.5rem" }}>
          Percentage depends on amount sold
        </p>
        {mode === "sliding_scale" ? (
          <div style={{ marginLeft: "1.5rem", marginBottom: "0.75rem" }}>
            {slidingTiers.map((tier, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>Up to</span>
                <span>$</span>
                <input
                  className="settings-input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={(tier.upToAmountCents / 100).toFixed(2)}
                  onChange={(e) => updateSlidingTier(i, "upToAmountCents", String(Number(e.target.value) * 100))}
                  style={{ width: "6rem" }}
                />
                <span style={{ fontSize: "0.8rem" }}>→</span>
                <input
                  className="settings-input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={(tier.percentBp / 100).toString()}
                  onChange={(e) => updateSlidingTier(i, "percentBp", String(Number(e.target.value) * 100))}
                  style={{ width: "5rem" }}
                />
                <span>%</span>
                <button type="button" className="ghost-action" onClick={() => removeSlidingTier(i)} style={{ fontSize: "0.75rem" }}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="ghost-action" onClick={addSlidingTier} style={{ fontSize: "0.8rem" }}>
              + Add tier
            </button>
          </div>
        ) : null}
      </div>

      <div className="staff-fieldset">
        <h5 style={{ margin: "0 0 0.5rem" }}>Product Commission</h5>
        <p className="settings-form-help" style={{ margin: "0 0 0.75rem" }}>
          Compensation is calculated as a percentage of product sales
        </p>
        <label className="settings-label" style={{ marginBottom: "0.5rem", display: "block" }}>
          <input
            type="radio"
            name="compensationMode"
            value="product_percent"
            checked={mode === "product_percent"}
            onChange={() => setMode("product_percent")}
            style={{ marginRight: "0.5rem" }}
          />
          Product Commission
        </label>
        {mode === "product_percent" ? (
          <div style={{ marginLeft: "1.5rem", marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <input
                className="settings-input"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={productPercent}
                onChange={(e) => setProductPercent(e.target.value)}
                placeholder="0"
                style={{ width: "6rem" }}
              />
              <span>%</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="staff-fieldset">
        <h5 style={{ margin: "0 0 0.5rem" }}>Hourly</h5>
        <p className="settings-form-help" style={{ margin: "0 0 0.75rem" }}>
          Compensation is calculated using a flat rate per hour
        </p>
        <label className="settings-label" style={{ marginBottom: "0.5rem", display: "block" }}>
          <input
            type="radio"
            name="compensationMode"
            value="hourly"
            checked={mode === "hourly"}
            onChange={() => setMode("hourly")}
            style={{ marginRight: "0.5rem" }}
          />
          Hourly Rate
        </label>
        {mode === "hourly" ? (
          <div style={{ marginLeft: "1.5rem", marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span>$</span>
              <input
                className="settings-input"
                type="number"
                min={0}
                step="0.01"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="0.00"
                style={{ width: "6rem" }}
              />
              <span>/ hr</span>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="primary-action" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save compensation"}
        </button>
      </div>
    </div>
  );
}

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
