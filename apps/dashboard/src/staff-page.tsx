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
    { key: "workHours", label: "Work hours", disabled: !provider },
    { key: "compensation", label: "Compensation", disabled: !provider },
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
          <div>
            <span className="svc-card__eyebrow">Regular weekly hours</span>
            <div style={{ fontSize: "11px", color: "#8B7960", marginTop: "4px" }}>Applies every week unless overridden below.</div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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
            <button type="button" className="svc-duplicate-btn" onClick={handleCopyMonday} disabled={submitting}>
              Copy Mon to weekdays
            </button>
          </div>
        </div>

        {WEEKDAY_LABELS.map((label, weekday) => {
          const dayShifts = shifts.get(weekday) || [];
          const isActive = dayShifts.length > 0 && dayShifts[0].isActive;
          return (
            <div key={weekday} className="svc-override-row" style={{ opacity: isActive ? 1 : 0.55 }}>
              <div style={{ width: "64px", flexShrink: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 500, color: "#1F1612" }}>{label}</div>
                <div style={{ fontSize: "10px", color: "#8B7960", marginTop: "1px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {isActive ? "Open" : "Closed"}
                </div>
              </div>
              <label className={`svc-toggle${isActive ? "" : " svc-toggle--off"}`} aria-label={`${label} toggle`}>
                <input type="checkbox" checked={isActive}
                  onChange={() => toggleDay(weekday)}
                  style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
              </label>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                {!isActive ? (
                  <div style={{ fontSize: "12px", color: "#8B7960", fontStyle: "italic" }}>Not working</div>
                ) : dayShifts.length === 0 ? (
                  <div style={{ fontSize: "12px", color: "#8B7960", fontStyle: "italic" }}>No shifts</div>
                ) : (
                  dayShifts.map((shift, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input className="svc-input" type="text" style={{ width: "80px", textAlign: "center", padding: "6px 9px" }}
                        value={shift.startTime}
                        onChange={(e) => updateShift(weekday, idx, { startTime: e.target.value })}
                        placeholder="9:00 AM" />
                      <span style={{ color: "#8B7960", fontSize: "12px" }}>→</span>
                      <input className="svc-input" type="text" style={{ width: "80px", textAlign: "center", padding: "6px 9px" }}
                        value={shift.endTime}
                        onChange={(e) => updateShift(weekday, idx, { endTime: e.target.value })}
                        placeholder="5:00 PM" />
                      {dayShifts.length > 1 ? (
                        <button type="button" className="svc-text-btn" style={{ marginLeft: "4px" }}
                          onClick={() => removeShift(weekday, idx)}>×</button>
                      ) : null}
                    </div>
                  ))
                )}
                {isActive ? (
                  <button type="button" className="svc-text-btn" style={{ textDecoration: "underline" }}
                    onClick={() => addShift(weekday)}>+ Add shift</button>
                ) : null}
                {isActive ? (
                  <div style={{ marginTop: "6px" }}>
                    <div style={{ fontSize: "10px", color: "#8B7960", marginBottom: "3px" }}>Block services this day:</div>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {services.map((svc) => {
                        const dayBlocked = dayBlockedServices.get(weekday) || [];
                        const isBlocked = dayBlocked.includes(svc.id);
                        return (
                          <label key={svc.id} style={{
                            display: "flex", alignItems: "center", gap: "3px",
                            fontSize: "10px", cursor: "pointer",
                            padding: "2px 6px", borderRadius: "3px",
                            background: isBlocked ? "#F5E6D3" : "transparent",
                            border: `1px solid ${isBlocked ? "#D4A574" : "#D9CBB1"}`,
                          }}>
                            <input type="checkbox" checked={isBlocked}
                              onChange={() => toggleDayBlockedService(weekday, svc.id)}
                              style={{ width: "10px", height: "10px" }} />
                            {svc.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        <div style={{ marginTop: "12px" }}>
          <button type="button" className="svc-save-btn" onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving..." : "Save schedule"}
          </button>
        </div>
      </div>

      <div className="svc-card" style={{ marginBottom: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
          <div>
            <span className="svc-card__eyebrow">Date overrides</span>
            <div style={{ fontSize: "11px", color: "#8B7960", marginTop: "4px" }}>Vacations, holidays, and one-off schedule changes.</div>
          </div>
        </div>

        {overrides.map((ov) => {
          const startDate = new Date(ov.startsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
          const endDate = new Date(ov.endsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
          const isClosed = ov.overrideType === "closed";
          return (
            <React.Fragment key={ov.id}>
            <div className="svc-override-row">
              <div style={{ width: "90px", flexShrink: 0 }}>
                <div style={{ fontSize: "12px", fontWeight: 500, color: "#1F1612" }}>{startDate} - {endDate}</div>
                <div style={{ fontSize: "10px", color: "#8B7960", marginTop: "1px" }}>
                  {Math.ceil((new Date(ov.endsAt).getTime() - new Date(ov.startsAt).getTime()) / 86400000) + 1} days
                </div>
              </div>
              <div style={{ fontSize: "12px", color: "#4A3D30", flex: 1 }}>{ov.reason || "No reason"}</div>
              <span className="svc-pill" style={{ background: isClosed ? "#E5D7BB" : "#1F1612", color: isClosed ? "#6B5A47" : "#F7F0DE", padding: "2px 7px", borderRadius: "4px", fontSize: "10px", fontWeight: 500 }}>
                {isClosed ? "Closed" : `${ov.startTime || ""} - ${ov.endTime || ""}`}
              </span>
              <button type="button" className="svc-text-btn" style={{ marginRight: "4px" }}
                  onClick={() => handleStartEditOverride(ov)}>&#9998;</button>
              <button type="button" className="svc-text-btn" onClick={() => handleDeleteOverride(ov.id)}>×</button>
            </div>
            {editingOverrideId === ov.id ? (
              <div style={{ marginTop: "8px", padding: "8px", background: "#FDF8F0", borderRadius: "6px", border: "1px solid #E5D7BB" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "6px" }}>
                  <input type="date" className="svc-input" style={{ width: "130px" }}
                    value={editOverride.startDate}
                    onChange={(e) => setEditOverride((p) => ({ ...p, startDate: e.target.value }))} />
                  <span style={{ color: "#8B7960", fontSize: "12px" }}>to</span>
                  <input type="date" className="svc-input" style={{ width: "130px" }}
                    value={editOverride.endDate}
                    onChange={(e) => setEditOverride((p) => ({ ...p, endDate: e.target.value }))} />
                  <input type="text" className="svc-input" placeholder="Reason" style={{ flex: 1, minWidth: "120px" }}
                    value={editOverride.reason}
                    onChange={(e) => setEditOverride((p) => ({ ...p, reason: e.target.value }))} />
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button type="button" className="svc-save-btn" onClick={handleSaveEditOverride} disabled={submitting}
                    style={{ fontSize: "11px", padding: "4px 10px" }}>
                    {submitting ? "Saving..." : "Save"}
                  </button>
                  <button type="button" className="svc-text-btn" onClick={handleCancelEditOverride}>Cancel</button>
                </div>
              </div>
            ) : null}
            </React.Fragment>
          );
        })}

        <div style={{ marginTop: "10px", padding: "10px 0", borderTop: "0.5px dashed #D9CBB1" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" }}>
            <input type="date" className="svc-input" style={{ width: "130px" }}
              value={newOverride.startDate}
              onChange={(e) => setNewOverride((p) => ({ ...p, startDate: e.target.value }))} />
            <span style={{ color: "#8B7960", fontSize: "12px" }}>to</span>
            <input type="date" className="svc-input" style={{ width: "130px" }}
              value={newOverride.endDate}
              onChange={(e) => setNewOverride((p) => ({ ...p, endDate: e.target.value }))} />
            <input type="text" className="svc-input" placeholder="Reason (optional)" style={{ flex: 1, minWidth: "150px" }}
              value={newOverride.reason}
              onChange={(e) => setNewOverride((p) => ({ ...p, reason: e.target.value }))} />
          </div>
          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", cursor: "pointer" }}>
              <input type="radio" name="overrideType" checked={newOverride.overrideType === "closed"}
                onChange={() => setNewOverride((p) => ({ ...p, overrideType: "closed" }))} />
              Closed
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", cursor: "pointer" }}>
              <input type="radio" name="overrideType" checked={newOverride.overrideType === "custom_hours"}
                onChange={() => setNewOverride((p) => ({ ...p, overrideType: "custom_hours" }))} />
              Custom hours
            </label>
            {newOverride.overrideType === "custom_hours" ? (
              <>
                <input type="text" className="svc-input" style={{ width: "70px", textAlign: "center" }}
                  value={newOverride.startTime}
                  onChange={(e) => setNewOverride((p) => ({ ...p, startTime: e.target.value }))} />
                <span style={{ color: "#8B7960", fontSize: "12px" }}>to</span>
                <input type="text" className="svc-input" style={{ width: "70px", textAlign: "center" }}
                  value={newOverride.endTime}
                  onChange={(e) => setNewOverride((p) => ({ ...p, endTime: e.target.value }))} />
              </>
            ) : null}
            <button type="button" className="svc-save-btn" onClick={handleAddOverride} disabled={submitting}
              style={{ fontSize: "11px", padding: "4px 10px" }}>
              {submitting ? "Adding..." : "+ Add override"}
            </button>
          </div>
          <div style={{ marginTop: "8px" }}>
            <div style={{ fontSize: "11px", color: "#8B7960", marginBottom: "4px" }}>Block specific services (optional)</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {services.map((svc) => {
                const isBlocked = blockedServiceIds.includes(svc.id);
                return (
                  <label key={svc.id} style={{
                    display: "flex", alignItems: "center", gap: "4px",
                    fontSize: "11px", cursor: "pointer",
                    padding: "3px 8px", borderRadius: "4px",
                    background: isBlocked ? "#F5E6D3" : "transparent",
                    border: `1px solid ${isBlocked ? "#D4A574" : "#D9CBB1"}`,
                  }}>
                    <input type="checkbox" checked={isBlocked}
                      onChange={() => setBlockedServiceIds((prev) =>
                        prev.includes(svc.id) ? prev.filter((id) => id !== svc.id) : [...prev, svc.id]
                      )}
                      style={{ width: "12px", height: "12px" }} />
                    {svc.name}
                  </label>
                );
              })}</div>
          </div>
        </div>
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
      await platformApi.fetchJson(
        `${apiBaseUrl}/tenants/${tenantSlug}/providers/${provider.id}/compensation`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
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
