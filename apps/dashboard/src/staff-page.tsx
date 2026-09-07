import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type {
  AuthenticatedUser,
  CreateProviderRequest,
  CreateProviderTimeOffRequest,
  CreateStaffRequest,
  LocationSummary,
  PermissionCatalogResponse,
  PermissionDefinition,
  PermissionKey,
  ProviderEarningsSummaryResponse,
  ProviderSchedule,
  ProviderScheduleEntry,
  ProviderSummary,
  ProviderTimeOffEntry,
  ReplaceProviderScheduleRequest,
  ReplaceUserPermissionsRequest,
  ServiceSummary,
  ServiceCategorySummary,
  TenantSummary,
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

// Pastel avatar fallback colors matching the Club Sunday palette
// (--cs-mint / --cs-blue / --cs-peach / --cs-lilac / --cs-pink).
const AVATAR_PLACEHOLDER_COLORS = ["#DFEBE1", "#DCE7F6", "#F6DFCE", "#EAE1F6", "#F6E0E3"];

function avatarColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PLACEHOLDER_COLORS[hash % AVATAR_PLACEHOLDER_COLORS.length]!;
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
  tenant,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser;
  tenant: TenantSummary | null;
}) {
  const canManage = hasPermission(currentUser, "settings.manage");
  const location = useLocation();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [users, setUsers] = useState<TenantUserSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [categories, setCategories] = useState<ServiceCategorySummary[]>([]);
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
      platformApi.listServiceCategories(currentUser.tenantSlug),
    ])
      .then(([usersRes, providersRes, locationsRes, servicesRes, categoriesRes]) => {
        if (cancelled) return;
        setUsers(usersRes.users);
        setProviders(providersRes.providers);
        setLocations(locationsRes.locations);
        setServices(servicesRes.services);
        setCategories(categoriesRes.categories);
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
  }, [canManage, currentUser.tenantSlug, refreshKey, location.pathname]);

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
                            <span
                              className="staff-avatar staff-avatar--initials"
                              style={{ background: avatarColorFor(user.id) }}
                              aria-hidden
                            >
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
                  tenant={tenant}
                  user={selectedUser}
                  provider={selectedProvider}
                  locations={locations}
                  services={services}
                  categories={categories}
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

function ProviderRequiredEmptyState({
  userName,
  creating,
  onLinkProvider,
}: {
  userName: string;
  creating: boolean;
  onLinkProvider: () => void;
}) {
  return (
    <div className="staff-empty-state">
      <p className="staff-empty-state__title">
        {creating
          ? `Setting up ${userName.split(" ")[0] || userName} as a provider…`
          : `Set up ${userName.split(" ")[0] || userName}'s schedule & pay`}
      </p>
      <p className="staff-empty-state__body">
        {creating
          ? "Creating a provider record so you can configure booking settings, work hours, and compensation."
          : "Work hours, compensation, and services are stored on a provider record. Create one (it won't be bookable online until you turn that on) to manage these here."}
      </p>
      {!creating ? (
        <button type="button" className="primary-action" onClick={onLinkProvider}>
          Set up provider record
        </button>
      ) : null}
    </div>
  );
}

function StaffDetail({
  tenantSlug,
  tenant,
  user,
  provider,
  locations,
  services,
  categories,
  activeTab,
  onTabChange,
  onResetPassword,
  onLinkProvider,
  onSaved,
}: {
  tenantSlug: string;
  tenant: TenantSummary | null;
  user: TenantUserSummary;
  provider: ProviderSummary | null;
  locations: LocationSummary[];
  services: ServiceSummary[];
  categories: ServiceCategorySummary[];
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onResetPassword: () => void;
  onLinkProvider: () => void;
  onSaved: () => void;
}) {
  const tabs: Array<{ key: TabKey; label: string; disabled?: boolean }> = [
    { key: "details", label: "Details" },
    { key: "services", label: "Services" },
    { key: "workHours", label: "Work hours" },
    { key: "compensation", label: "Compensation" },
    { key: "permissions", label: "Permissions" },
  ];

  const bookingLinkBase = `${storefrontBaseUrl}/${tenantSlug}/p/`;

  // Work hours, compensation, and services live on a provider record. When a
  // staff member without one opens one of those tabs, silently create a
  // minimal, not-online-bookable provider record so the tab can render its
  // real editing UI immediately. `onLinkProvider` still opens the full
  // location/service picker from the header action.
  const providerTabActive =
    activeTab === "services" || activeTab === "workHours" || activeTab === "compensation";
  const [creatingProvider, setCreatingProvider] = useState(false);
  const [providerCreateError, setProviderCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!providerTabActive || provider !== null || creatingProvider) return;
    let cancelled = false;
    setCreatingProvider(true);
    setProviderCreateError(null);
    platformApi
      .createProvider(tenantSlug, {
        name: user.name,
        email: user.email,
        userId: user.id,
        isBookableOnline: false,
      })
      .then(() => {
        if (!cancelled) onSaved();
      })
      .catch((error: unknown) => {
        if (!cancelled) setProviderCreateError(readErrorMessage(error, "Unable to set up provider record."));
      })
      .finally(() => {
        if (!cancelled) setCreatingProvider(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerTabActive, provider, user.id, tenantSlug]);

  return (
    <div className="staff-detail-inner">
      {providerCreateError ? (
        <div className="message-banner" role="alert">
          {providerCreateError}
          <button type="button" className="ghost-action" onClick={() => setProviderCreateError(null)}>Dismiss</button>
        </div>
      ) : null}
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
      {activeTab === "services" ? (
        provider ? (
          <ServicesTab
            tenantSlug={tenantSlug}
            provider={provider}
            locations={locations}
            services={services}
            categories={categories}
            onSaved={onSaved}
          />
        ) : (
          <ProviderRequiredEmptyState
            userName={user.name}
            creating={creatingProvider}
            onLinkProvider={onLinkProvider}
          />
        )
      ) : null}
      {activeTab === "workHours" ? (
        provider ? (
          <WorkHoursTab tenantSlug={tenantSlug} tenant={tenant} provider={provider} locations={locations} services={services} />
        ) : (
          <ProviderRequiredEmptyState
            userName={user.name}
            creating={creatingProvider}
            onLinkProvider={onLinkProvider}
          />
        )
      ) : null}
      {activeTab === "compensation" ? (
        provider ? (
          <CompensationTab tenantSlug={tenantSlug} provider={provider} services={services} onSaved={onSaved} />
        ) : (
          <ProviderRequiredEmptyState
            userName={user.name}
            creating={creatingProvider}
            onLinkProvider={onLinkProvider}
          />
        )
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
  categories,
  onSaved,
}: {
  tenantSlug: string;
  provider: ProviderSummary;
  locations: LocationSummary[];
  services: ServiceSummary[];
  categories: ServiceCategorySummary[];
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

  // Per-service overrides (duration, price, commission)
  const [serviceOverrides, setServiceOverrides] = useState<
    Record<string, { durationMinutes: string; priceCents: string; flatCents: string; basisPoints: string }>
  >({});
  const [overridesLoaded, setOverridesLoaded] = useState(false);

  // Load existing per-service overrides
  useEffect(() => {
    let cancelled = false;
    const loadOverrides = async () => {
      const map: Record<string, { durationMinutes: string; priceCents: string; flatCents: string; basisPoints: string }> = {};
      for (const svcId of provider.serviceIds) {
        try {
          const resp = await platformApi.getServiceProviderVariants(tenantSlug, svcId);
          const variant = resp.variants.find((v) => v.providerId === provider.id);
          if (variant) {
            map[svcId] = {
              durationMinutes: variant.durationMinutes != null ? String(variant.durationMinutes) : "",
              priceCents: variant.priceCents != null ? (variant.priceCents / 100).toFixed(2) : "",
              flatCents: variant.commissionFlatCents != null ? (variant.commissionFlatCents / 100).toFixed(2) : "",
              basisPoints: variant.commissionBasisPoints != null ? (variant.commissionBasisPoints / 100).toString() : "",
            };
          }
        } catch {
          // ignore — variant may not exist yet
        }
      }
      if (!cancelled) {
        setServiceOverrides(map);
        setOverridesLoaded(true);
      }
    };
    loadOverrides();
    return () => { cancelled = true; };
  }, [tenantSlug, provider.id, provider.serviceIds.join(",")]);

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
    isActive !== provider.isActive ||
    Object.keys(serviceOverrides).some((svcId) => {
      const ov = serviceOverrides[svcId];
      return ov.durationMinutes !== "" || ov.priceCents !== "" || ov.flatCents !== "" || ov.basisPoints !== "";
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Save provider-level settings
      const payload: UpdateProviderRequest = {
        locationIds,
        serviceIds,
        isBookableOnline,
        isActive,
      };
      await platformApi.updateProvider(tenantSlug, provider.id, payload);

      // Save per-service overrides for assigned services
      for (const svcId of serviceIds) {
        const ov = serviceOverrides[svcId];
        const durationMinutes = ov?.durationMinutes ? Number(ov.durationMinutes) : null;
        const priceCents = ov?.priceCents ? Math.round(Number(ov.priceCents) * 100) : null;
        const flatCents = ov?.flatCents ? Math.round(Number(ov.flatCents) * 100) : null;
        const basisPoints = ov?.basisPoints ? Math.round(Number(ov.basisPoints) * 100) : null;
        const hasOverride =
          durationMinutes != null || priceCents != null || flatCents != null || basisPoints != null;
        try {
          const existing = await platformApi.getServiceProviderVariants(tenantSlug, svcId);
          const hadEntry = existing.variants.some((v) => v.providerId === provider.id);
          // Nothing to save and nothing to update — skip the write entirely so we
          // don't create phantom all-null variant rows that show up as spurious
          // entries in the services-page view of the same data.
          if (!hasOverride && !hadEntry) continue;
          // Preserve depositCents and any other field we don't manage here so the
          // services-page ProviderCard can still round-trip its own overrides.
          let merged = existing.variants.map((v) =>
            v.providerId === provider.id
              ? { ...v, durationMinutes, priceCents, commissionFlatCents: flatCents, commissionBasisPoints: basisPoints }
              : v,
          );
          if (!hadEntry) {
            merged.push({
              providerId: provider.id,
              durationMinutes,
              priceCents,
              depositCents: null,
              commissionFlatCents: flatCents,
              commissionBasisPoints: basisPoints,
            });
          }
          // Drop entries where every override field is null so we match the
          // services-page save behavior and keep the two views in sync.
          merged = merged.filter(
            (v) =>
              v.durationMinutes != null ||
              v.priceCents != null ||
              v.depositCents != null ||
              v.commissionFlatCents != null ||
              v.commissionBasisPoints != null,
          );
          await platformApi.replaceServiceProviderVariants(tenantSlug, svcId, { variants: merged });
        } catch (err) {
          if (!(err instanceof Error && err.message.includes("404"))) throw err;
        }
      }

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

      <fieldset className="staff-fieldset staff-services-fieldset">
        <legend>
          Services <span className="staff-fieldset-count">{serviceIds.length} of {services.length}</span>
        </legend>
        {services.length === 0 ? (
          <p className="settings-form-help">No services configured.</p>
        ) : (
          <>
            <p className="svc-lead">
              What she performs. Services come from the Treatments page, filtered to her. Leave a
              field blank to inherit that treatment's price and duration; enter a value to override
              it just for her.
            </p>
            <div className="staff-list-toolbar">
              <input
                type="search"
                className="staff-list-search"
                placeholder="Find a treatment…"
                value={serviceQuery}
                onChange={(event) => setServiceQuery(event.target.value)}
                aria-label="Search services"
              />
            </div>
            {filteredServices.length === 0 ? (
              <p className="settings-form-help">No services match that search.</p>
            ) : !overridesLoaded ? (
              <p className="settings-form-help">Loading…</p>
            ) : (
              (() => {
                // Group filtered services by categoryId. Categories with services this
                // staff can be assigned to are ordered by sortOrder; "Uncategorized" last.
                const servicesByCategory = new Map<string | null, ServiceSummary[]>();
                for (const svc of filteredServices) {
                  const key = svc.categoryId ?? null;
                  if (!servicesByCategory.has(key)) servicesByCategory.set(key, []);
                  servicesByCategory.get(key)!.push(svc);
                }
                const groups: Array<{ id: string | null; name: string; services: ServiceSummary[] }> = [];
                for (const cat of [...categories].sort((a, b) => a.sortOrder - b.sortOrder)) {
                  const list = servicesByCategory.get(cat.id);
                  if (list && list.length > 0) {
                    groups.push({ id: cat.id, name: cat.name, services: list });
                  }
                }
                const uncategorized = servicesByCategory.get(null);
                if (uncategorized && uncategorized.length > 0) {
                  groups.push({ id: null, name: "Uncategorized", services: uncategorized });
                }
                const providerBookingSlug = provider.bookingSlug ?? provider.id;
                return (
                  <div className="staff-services-groups">
                    {groups.map((group) => {
                      const groupIds = group.services.map((s) => s.id);
                      const allEnabled = groupIds.every((id) => serviceIds.includes(id));
                      const noneEnabled = groupIds.every((id) => !serviceIds.includes(id));
                      const performed = group.services.filter((s) => serviceIds.includes(s.id));
                      const notOffered = group.services.filter((s) => !serviceIds.includes(s.id));
                      return (
                        <section key={group.id ?? "uncategorized"} className="staff-services-group">
                          <header className="staff-services-group__header">
                            <h4 className="staff-services-group__title">{group.name}</h4>
                            <button
                              type="button"
                              className="svc-text-btn"
                              onClick={() => {
                                if (allEnabled) {
                                  setServiceIds(serviceIds.filter((id) => !groupIds.includes(id)));
                                } else {
                                  const next = new Set(serviceIds);
                                  for (const id of groupIds) next.add(id);
                                  setServiceIds(Array.from(next));
                                }
                              }}
                            >
                              {allEnabled ? "Disable all" : noneEnabled ? "Enable all" : "Enable all"}
                            </button>
                          </header>

                          {[...performed, ...notOffered].map((svc) => {
                            const isAssigned = serviceIds.includes(svc.id);
                            const showNotOfferedHeader = !isAssigned && svc.id === notOffered[0]?.id;
                            const ov = serviceOverrides[svc.id] || { durationMinutes: "", priceCents: "", flatCents: "", basisPoints: "" };
                            const commissionMode: "flat" | "percent" = ov.basisPoints ? "percent" : "flat";
                            // Auto-enable the service if the operator starts editing any override
                            // so the value they type will actually persist on save.
                            const ensureAssigned = () => {
                              if (!serviceIds.includes(svc.id)) setServiceIds([...serviceIds, svc.id]);
                            };
                            const patch = (partial: Partial<typeof ov>) => {
                              ensureAssigned();
                              setServiceOverrides((prev) => ({
                                ...prev,
                                [svc.id]: { ...(prev[svc.id] || { durationMinutes: "", priceCents: "", flatCents: "", basisPoints: "" }), ...partial },
                              }));
                            };
                            return (
                              <React.Fragment key={svc.id}>
                                {showNotOfferedHeader ? (
                                  <p className="svc-staff-notoffered__label">Not offered by her</p>
                                ) : null}
                              <div
                                className={`svc-staff-trow staff-service-trow${isAssigned ? "" : " svc-staff-trow--off"}`}
                              >
                                <div className="svc-staff-trow__provider">
                                  <input
                                    type="checkbox"
                                    className="svc-staff-checkbox"
                                    aria-label={`Toggle ${svc.name}`}
                                    checked={isAssigned}
                                    onChange={() => setServiceIds(toggle(serviceIds, svc.id))}
                                  />
                                  <span>
                                    <span className="svc-provider-card__name">{svc.name}</span>
                                    {svc.description ? (
                                      <span className="svc-staff-subtitle">{svc.description}</span>
                                    ) : null}
                                  </span>
                                </div>
                              
                                <div className="svc-staff-trow__cell">
                                  <input
                                    className="svc-input svc-provider-row__input"
                                    type="text" inputMode="numeric"
                                    placeholder={`${svc.durationMinutes} min`}
                                    value={ov.durationMinutes}
                                    onFocus={(e) => { ensureAssigned(); e.target.select(); }}
                                    onMouseUp={(e) => e.preventDefault()}
                                    onChange={(e) => patch({ durationMinutes: e.target.value })}
                                    aria-label={`${svc.name} duration`}
                                  />
                                </div>
                              
                                <div className="svc-staff-trow__cell">
                                  <input
                                    className="svc-input svc-provider-row__input"
                                    type="text" inputMode="decimal"
                                    placeholder={`$${(svc.priceCents / 100).toFixed(2)}`}
                                    value={ov.priceCents}
                                    onFocus={(e) => { ensureAssigned(); e.target.select(); }}
                                    onMouseUp={(e) => e.preventDefault()}
                                    onChange={(e) => patch({ priceCents: e.target.value })}
                                    aria-label={`${svc.name} price`}
                                  />
                                </div>
                              
                                <div className="svc-staff-trow__cell svc-staff-trow__commission">
                                  <div className="service-card__pill-toggle" role="group" aria-label="Commission type">
                                    <button type="button"
                                      className={`service-card__pill${commissionMode === "flat" ? " is-active" : ""}`}
                                      onClick={() => { ensureAssigned(); if (commissionMode === "flat") return; patch({ basisPoints: "" }); }}>
                                      $
                                    </button>
                                    <button type="button"
                                      className={`service-card__pill${commissionMode === "percent" ? " is-active" : ""}`}
                                      onClick={() => { ensureAssigned(); if (commissionMode === "percent") return; patch({ flatCents: "" }); }}>
                                      %
                                    </button>
                                  </div>
                                  {commissionMode === "flat" ? (
                                    <input
                                      className="svc-input svc-provider-row__input"
                                      type="text" inputMode="decimal"
                                      placeholder="0.00"
                                      value={ov.flatCents}
                                      onFocus={(e) => { ensureAssigned(); e.target.select(); }}
                                      onMouseUp={(e) => e.preventDefault()}
                                      onChange={(e) => patch({ flatCents: e.target.value, basisPoints: "" })}
                                      aria-label={`${svc.name} commission flat`}
                                    />
                                  ) : (
                                    <input
                                      className="svc-input svc-provider-row__input"
                                      type="text" inputMode="decimal"
                                      placeholder="0"
                                      value={ov.basisPoints}
                                      onFocus={(e) => { ensureAssigned(); e.target.select(); }}
                                      onMouseUp={(e) => e.preventDefault()}
                                      onChange={(e) => patch({ flatCents: "", basisPoints: e.target.value })}
                                      aria-label={`${svc.name} commission percent`}
                                    />
                                  )}
                                </div>
                              </div>
                              </React.Fragment>
                            );
                          })}
                        </section>
                      );
                    })}
                  </div>
                );
              })()
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

const BUSINESS_HOURS_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const BUSINESS_HOURS_DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Condense a tenant's weekly business hours into consecutive-day groups, e.g. "Mon – Fri: 08:00 – 19:00". */
function summarizeBusinessHours(
  week: Record<string, { open: string; close: string; closed: boolean }> | undefined
): Array<{ label: string; text: string }> {
  if (!week) return [];
  const days = BUSINESS_HOURS_DAY_KEYS.map((key, i) => {
    const day = week[key];
    return {
      abbr: BUSINESS_HOURS_DAY_ABBR[i],
      text: day && !day.closed ? `${day.open} – ${day.close}` : "Closed",
    };
  });
  const groups: Array<{ label: string; text: string }> = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1].text === days[i].text) j++;
    const label = j > i ? `${days[i].abbr} – ${days[j].abbr}` : days[i].abbr;
    groups.push({ label, text: days[i].text });
    i = j + 1;
  }
  return groups;
}

/** Human-friendly badge label for a provider-schedule conflict warning. */
function warningBadgeLabel(warning: { type: string }, dayShifts: ProviderScheduleEntry[]): string {
  if (warning.type === "day_closed") return "Studio closed";
  if (warning.type === "outside_business_hours") {
    const runsLate = dayShifts.some((s) => s.endTime && s.endTime > "18:00");
    return runsLate ? "Late night" : "Outside hours";
  }
  return "Needs review";
}


// ===========================================================================
// Work Hours tab (unified schedule + time off)
// ===========================================================================

type WorkHoursTabProps = {
  tenantSlug: string;
  tenant: TenantSummary | null;
  provider: ProviderSummary;
  locations: LocationSummary[];
};

function WorkHoursTab({ tenantSlug, tenant, provider, locations, services }: WorkHoursTabProps & { services: ServiceSummary[] }) {
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

  // Overrides list filter chips: "Time off" / "Custom hours"
  const [overrideFilter, setOverrideFilter] = useState<{ timeOff: boolean; customHours: boolean }>({
    timeOff: false, customHours: false,
  });

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

  // Copy this location's regular hours pattern onto the provider's other location.
  const handleCopyToLocation = async (targetLocationId: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const entries: ProviderScheduleEntry[] = [];
      for (const [weekday, dayShifts] of shifts) {
        for (const s of dayShifts) {
          entries.push({
            id: "",
            weekday,
            locationId: targetLocationId,
            startTime: s.startTime,
            endTime: s.endTime,
            isActive: s.isActive,
            blockedServiceIds: dayBlockedServices.get(weekday) || null,
          });
        }
      }
      await platformApi.replaceProviderSchedule(tenantSlug, provider.id, { entries, locationId: targetLocationId });
      setStatus("Hours copied to the other location");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy hours");
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

  const selectedLocationName = selectedLocationId
    ? providerLocations.find((loc) => loc.id === selectedLocationId)?.name ?? null
    : null;
  const studioHours = summarizeBusinessHours(
    tenant?.settings?.businessHoursEnabled ? (tenant.settings.businessHours as any) : undefined
  );

  return (
    <div className="staff-detail-form wh-tab">
      <div className="wh-layout">
        <div className="wh-main">
          <div className="svc-card wh-card">
            {/* Sub-tab bar */}
            <div className="wh-subtabs-row">
              <div className="staff-detail-tabs wh-subtabs">
                <button type="button"
                  className={`staff-detail-tab${workHoursSubTab === "regular" ? " is-active" : ""}`}
                  onClick={() => setWorkHoursSubTab("regular")}>Regular</button>
                <button type="button"
                  className={`staff-detail-tab${workHoursSubTab === "overrides" ? " is-active" : ""}`}
                  onClick={() => setWorkHoursSubTab("overrides")}>Overrides &amp; time off</button>
              </div>
              {providerLocations.length > 1 ? (
                <label className="wh-location-select">
                  <span className="wh-location-select__label">Location</span>
                  <select
                    aria-label="Work hours location"
                    value={selectedLocationId || ""}
                    onChange={(e) => setSelectedLocationId(e.target.value || null)}>
                    <option value="">Both locations</option>
                    {providerLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {providerLocations.length > 1 ? (
              <p className="wh-helper-text">
                Hours are per location.{selectedLocationName ? ` ${selectedLocationName} keeps its own pattern.` : " Each location keeps its own pattern."}
              </p>
            ) : null}

            {workHoursSubTab === "regular" ? (
          /* ===== REGULAR HOURS SUB-TAB ===== */
          <>
            {shifts.size === 0 ? (
              <div className="wh-empty-state">
                <div>
                  <div className="wh-empty-state__title">No regular hours set yet</div>
                  <div className="wh-empty-state__body">
                    Set the recurring weekly hours in one step, then adjust individual days as needed.
                  </div>
                </div>
                <button type="button" className="svc-save-btn" onClick={() => setRegularHoursOpen(true)}>
                  Set regular hours
                </button>
              </div>
            ) : (
              <>
                {(() => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const jsDay = today.getDay();
                  const daysSinceMonday = (jsDay + 6) % 7;
                  const weekStart = new Date(today);
                  weekStart.setDate(today.getDate() - daysSinceMonday);

                  return (
                    <div className="wh-day-list">
                      {WEEKDAY_LABELS.map((label, wd) => {
                        const rawShifts = shifts.get(wd) || [];
                        const isOn = rawShifts.length > 0 && rawShifts[0].isActive;
                        const dayWarning = warnings.find((w) => w.weekday === wd) || null;
                        const badgeLabel = dayWarning ? warningBadgeLabel(dayWarning, rawShifts) : null;
                        const d = new Date(weekStart);
                        d.setDate(weekStart.getDate() + wd);
                        const dateStr = d.toISOString().split("T")[0];
                        return (
                          <div key={wd} className={`wh-day-row${dayWarning ? " wh-day-row--warn" : ""}`}>
                            <button type="button"
                              className={`wh-toggle${isOn ? " is-on" : ""}`}
                              role="switch" aria-checked={isOn}
                              aria-label={`${isOn ? "Turn off" : "Turn on"} ${label}`}
                              onClick={() => toggleDay(wd)}>
                              <span className="wh-toggle__knob" />
                            </button>
                            <button type="button" className="wh-day-row__label"
                              onClick={() => setDayEditor({ dateStr, weekday: wd })}>
                              {label}
                            </button>
                            {!isOn ? (
                              <span className="wh-day-row__status">Not working</span>
                            ) : (
                              <div className="wh-day-row__shifts">
                                {rawShifts.map((s, i) => (
                                  <div className="wh-time-range" key={i}>
                                    <input type="time" className="wh-time-input" value={s.startTime}
                                      aria-label={`${label} start time`}
                                      onChange={(e) => updateShift(wd, i, { startTime: e.target.value })} />
                                    <span className="wh-time-sep">to</span>
                                    <input type="time" className="wh-time-input" value={s.endTime}
                                      aria-label={`${label} end time`}
                                      onChange={(e) => updateShift(wd, i, { endTime: e.target.value })} />
                                    {rawShifts.length > 1 ? (
                                      <button type="button" className="wh-time-remove"
                                        onClick={() => removeShift(wd, i)} aria-label="Remove shift">×</button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                            {badgeLabel ? <span className="wh-late-badge">{badgeLabel}</span> : null}
                            {isOn ? (
                              <button type="button" className="wh-split-link" onClick={() => addShift(wd)}>
                                + Split shift
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                <div className="wh-week-summary">
                  <span className="wh-week-summary__text">
                    {summary.hoursPerWeek} hours a week · {warnings.length === 0 ? "within studio hours" : "needs review"}
                  </span>
                  {providerLocations.length === 2 && selectedLocationId ? (
                    <button type="button" className="svc-text-btn" disabled={submitting}
                      onClick={() => {
                        const other = providerLocations.find((l) => l.id !== selectedLocationId);
                        if (other) void handleCopyToLocation(other.id);
                      }}>
                      Copy to {providerLocations.find((l) => l.id !== selectedLocationId)?.name}
                    </button>
                  ) : null}
                </div>
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
            <div className="wh-overrides-header">
              <div className="wh-overrides-header__title">Overrides &amp; time off</div>
              <button type="button" className="svc-save-btn"
                onClick={() => setTimeOffOpen(true)} disabled={submitting}>
                + Block time off
              </button>
            </div>
            <div className="wh-filter-row">
              <label className="wh-filter-chip">
                <input type="checkbox" checked={overrideFilter.timeOff}
                  onChange={(e) => setOverrideFilter((prev) => ({ ...prev, timeOff: e.target.checked }))} />
                Time off
              </label>
              <label className="wh-filter-chip">
                <input type="checkbox" checked={overrideFilter.customHours}
                  onChange={(e) => setOverrideFilter((prev) => ({ ...prev, customHours: e.target.checked }))} />
                Custom hours
              </label>
            </div>
            {overrides.length === 0 ? (
              <div className="wh-overrides-empty">No overrides or time off scheduled.</div>
            ) : (
              <div className="wh-override-list">
                {overrides
                  .filter((ov) => {
                    const isCustom = ov.overrideType === "custom_hours";
                    if (!overrideFilter.timeOff && !overrideFilter.customHours) return true;
                    return (overrideFilter.timeOff && !isCustom) || (overrideFilter.customHours && isCustom);
                  })
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
                    return (
                      <div key={ov.id}
                        className={`wh-override-card${isCustom ? " wh-override-card--custom" : " wh-override-card--timeoff"}${isPast ? " wh-override-card--past" : ""}`}>
                        <div className="wh-override-card__body">
                          <div className="wh-override-card__dates">
                            {sameDay
                              ? (isCustom ? fmtDateStr(startDateStr) : `${fmtDateStr(startDateStr)} · all day`)
                              : `${fmtDateStr(startDateStr)} – ${fmtDateStr(endDateStr)}`}
                            {isCustom && ov.startTime ? ` · ${ov.startTime} – ${ov.endTime}` : ""}
                          </div>
                          <div className="wh-override-card__reason">
                            {ov.reason || (isCustom ? "Custom hours" : "Time off")}
                          </div>
                        </div>
                        <button type="button" className="wh-override-card__dismiss"
                          onClick={() => handleDeleteOverride(ov.id)}
                          aria-label={`Remove ${isCustom ? "override" : "time off"} ${fmtDateStr(startDateStr)}`}>
                          ×
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </>
        )}
          </div>
        </div>

        <aside className="wh-side">
          <div className="wh-side-card">
            <div className="wh-side-card__title">Studio hours, for reference</div>
            {studioHours.length > 0 ? (
              <div className="wh-side-hours">
                {studioHours.map((g) => (
                  <div key={g.label} className="wh-side-hours-row">
                    <span className="wh-side-hours-row__label">{g.label}</span>
                    <span className="wh-side-hours-row__value">{g.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="wh-side-empty">No business hours set for this tenant yet.</p>
            )}
          </div>

          <div className="wh-side-card">
            <div className="wh-side-card__title">This week at a glance</div>
            <div className="wh-stat-rows">
              <div className="wh-stat-row">
                <span className="wh-stat-row__label">Scheduled hours</span>
                <span className="wh-stat-row__value">{summary.hoursPerWeek}</span>
              </div>
              <div className="wh-stat-row">
                <span className="wh-stat-row__label">Days working</span>
                <span className="wh-stat-row__value">{summary.workingDays}</span>
              </div>
            </div>
          </div>

          {warnings.length > 0 ? (
            <div className="wh-warning-callout">
              {warnings.map((w, i) => (
                <p key={i} className="wh-warning-callout__text">{w.message}</p>
              ))}
            </div>
          ) : null}
        </aside>
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
  const lastDateRef = useRef<string>("");
  useEffect(() => {
    const key = `${dateStr}:${scope}:${dateOverride?.id || ""}`;
    if (initializedForRef.current === key) return;
    initializedForRef.current = key;

    // When opening a new day, reset and seed from the correct source
    const isNewDay = lastDateRef.current !== dateStr;
    lastDateRef.current = dateStr;

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
      // Only seed blocked services when opening a new day; preserve user selections on scope switch
      if (isNewDay) {
        setBlockedIds(recurringBlockedServices);
      }
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
  services: ServiceSummary[];
  onSaved: () => void;
};

type CompensationMode = "service_percent" | "sliding_scale" | "flat_per_booking" | "hourly" | "";

function formatCentsWhole(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

type ModeCardProps = {
  value: CompensationMode;
  title: string;
  desc: string;
  mode: CompensationMode;
  onSelect: (value: CompensationMode) => void;
  children?: React.ReactNode;
  preview?: React.ReactNode;
};

function ModeCard({ value, title, desc, mode, onSelect, children, preview }: ModeCardProps) {
  const selected = mode === value;
  return (
    <div className={`comp-mode-card${selected ? " comp-mode-card--selected" : ""}`}>
      <label className="comp-mode-card__head">
        <input
          type="radio"
          name="compensationMode"
          value={value}
          checked={selected}
          onChange={() => onSelect(value)}
          className="comp-mode-card__radio-input"
        />
        <span className="comp-mode-card__radio" aria-hidden="true" />
        <span className="comp-mode-card__title">{title}</span>
      </label>
      <p className="comp-mode-card__desc">{desc}</p>
      {selected && children ? <div className="comp-mode-card__body">{children}</div> : null}
      {!selected && preview ? <div className="comp-mode-card__preview">{preview}</div> : null}
    </div>
  );
}

function CompensationTab({ tenantSlug, provider, services, onSaved }: CompensationTabProps) {
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
  const [productCommissionEnabled, setProductCommissionEnabled] = useState(
    provider.compensationProductPercentBp != null,
  );
  const [hourlyRate, setHourlyRate] = useState(
    provider.compensationHourlyCents != null
      ? (provider.compensationHourlyCents / 100).toFixed(2)
      : "",
  );
  const [flatPerBooking, setFlatPerBooking] = useState(
    provider.compensationFlatCents != null
      ? (provider.compensationFlatCents / 100).toFixed(2)
      : "",
  );
  const [slidingTiers, setSlidingTiers] = useState<
    Array<{ upToAmountCents: number; percentBp: number }>
  >(
    (provider.compensationSlidingScale as Array<{ upToAmountCents: number; percentBp: number }>) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<ProviderEarningsSummaryResponse | null>(null);
  const [earningsError, setEarningsError] = useState<string | null>(null);

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
    setProductCommissionEnabled(provider.compensationProductPercentBp != null);
    setHourlyRate(
      provider.compensationHourlyCents != null
        ? (provider.compensationHourlyCents / 100).toFixed(2)
        : "",
    );
    setFlatPerBooking(
      provider.compensationFlatCents != null
        ? (provider.compensationFlatCents / 100).toFixed(2)
        : "",
    );
    setSlidingTiers(
      (provider.compensationSlidingScale as Array<{ upToAmountCents: number; percentBp: number }>) ?? [],
    );
  }, [provider]);

  const loadEarnings = useCallback(async () => {
    try {
      const session = await ensureActiveStoredSession();
      const token = session?.accessToken ?? "";
      const resp = await fetch(
        `${apiBaseUrl}/tenants/${tenantSlug}/providers/${provider.id}/compensation/earnings-summary`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Request failed" }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const data: ProviderEarningsSummaryResponse = await resp.json();
      setEarnings(data);
      setEarningsError(null);
    } catch (error) {
      setEarningsError(readErrorMessage(error, "Unable to load earnings."));
    }
  }, [tenantSlug, provider.id]);

  useEffect(() => {
    loadEarnings();
  }, [loadEarnings]);

  const representativeService = useMemo(() => {
    const linked = services.filter((s) => provider.serviceIds.includes(s.id) && s.isActive);
    return linked[0] ?? null;
  }, [services, provider.serviceIds]);

  const servicePercentHelper = useMemo(() => {
    const pct = Number(servicePercent);
    if (!representativeService || !Number.isFinite(pct) || pct <= 0) return null;
    const amount = Math.round(representativeService.priceCents * (pct / 100));
    return `≈ ${formatCentsWhole(amount)} on a ${formatCentsWhole(representativeService.priceCents)} ${representativeService.name}`;
  }, [servicePercent, representativeService]);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const body: Record<string, unknown> = { compensationMode: mode || null };
      if (mode === "service_percent") {
        body.compensationServicePercentBp = servicePercent ? Math.round(Number(servicePercent) * 100) : null;
      }
      if (mode === "hourly") {
        body.compensationHourlyCents = hourlyRate ? Math.round(Number(hourlyRate) * 100) : null;
      }
      if (mode === "flat_per_booking") {
        body.compensationFlatCents = flatPerBooking ? Math.round(Number(flatPerBooking) * 100) : null;
      }
      if (mode === "sliding_scale") {
        body.compensationSlidingScale = slidingTiers.length > 0 ? slidingTiers : null;
      }
      // Product commission is an add-on bonus that stacks on any primary mode
      body.compensationProductPercentBp = productCommissionEnabled && productPercent
        ? Math.round(Number(productPercent) * 100)
        : null;
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
      loadEarnings();
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
          ? { ...t, [field]: Math.round(num) }
          : t,
      ),
    );
  };

  const overrideCount = earnings?.overrideBookingsCount ?? 0;

  const slidingPreview = slidingTiers.length > 0 ? (
    <span className="comp-tier-preview">
      {slidingTiers.map((tier, i) => (
        <span key={i} className="comp-tier-chip comp-tier-chip--readonly">
          {i === slidingTiers.length - 1 && tier.upToAmountCents === 0
            ? `above · ${tier.percentBp / 100}%`
            : `to $${Math.round(tier.upToAmountCents / 100) / 1000}k · ${tier.percentBp / 100}%`}
        </span>
      ))}
    </span>
  ) : null;

  return (
    <div className="staff-detail-form">
      {status ? (
        <div className="message-banner" role="status">
          {status}
          <button type="button" className="ghost-action" onClick={() => setStatus(null)}>Dismiss</button>
        </div>
      ) : null}

      <p className="comp-lead">
        Pick one model. Per-treatment overrides on the Services tab always win over what's set here.
      </p>

      <div className="comp-mode-list">
        <ModeCard
          value="service_percent"
          title="Percent of service"
          desc="A flat share of every treatment she performs."
          mode={mode}
          onSelect={setMode}
        >
          <div className="comp-value-row">
            <input
              className="comp-value-input"
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={servicePercent}
              onChange={(e) => setServicePercent(e.target.value)}
              placeholder="0"
            />
            <span className="comp-value-suffix">%</span>
            {servicePercentHelper ? <span className="comp-helper">{servicePercentHelper}</span> : null}
          </div>
        </ModeCard>

        <ModeCard
          value="sliding_scale"
          title="Sliding scale"
          desc="Percentage rises with monthly revenue served."
          mode={mode}
          onSelect={setMode}
          preview={slidingPreview}
        >
          <div className="comp-tier-list">
            {slidingTiers.map((tier, i) => (
              <div key={i} className="comp-tier-chip">
                <span className="comp-tier-chip__label">to $</span>
                <input
                  className="comp-tier-chip__input"
                  type="number"
                  min={0}
                  step="1"
                  value={Math.round(tier.upToAmountCents / 100)}
                  onChange={(e) => updateSlidingTier(i, "upToAmountCents", String(Number(e.target.value) * 100))}
                />
                <span className="comp-tier-chip__label">·</span>
                <input
                  className="comp-tier-chip__input comp-tier-chip__input--pct"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={tier.percentBp / 100}
                  onChange={(e) => updateSlidingTier(i, "percentBp", String(Number(e.target.value) * 100))}
                />
                <span className="comp-tier-chip__label">%</span>
                <button
                  type="button"
                  className="comp-tier-chip__remove"
                  onClick={() => removeSlidingTier(i)}
                  aria-label="Remove tier"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="comp-tier-add" onClick={addSlidingTier}>
              + Tier
            </button>
          </div>
        </ModeCard>

        <ModeCard
          value="flat_per_booking"
          title="Flat per booking"
          desc="The same amount however long or costly the treatment."
          mode={mode}
          onSelect={setMode}
        >
          <div className="comp-value-row">
            <span className="comp-value-prefix">$</span>
            <input
              className="comp-value-input"
              type="number"
              min={0}
              step="0.01"
              value={flatPerBooking}
              onChange={(e) => setFlatPerBooking(e.target.value)}
              placeholder="0.00"
            />
            <span className="comp-value-suffix">per booking</span>
          </div>
        </ModeCard>

        <ModeCard
          value="hourly"
          title="Hourly rate"
          desc="Paid on hours worked, not on what she serves."
          mode={mode}
          onSelect={setMode}
        >
          <div className="comp-value-row">
            <span className="comp-value-prefix">$</span>
            <input
              className="comp-value-input"
              type="number"
              min={0}
              step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder="0.00"
            />
            <span className="comp-value-suffix">/ hr</span>
          </div>
        </ModeCard>
      </div>

      <div className="comp-section">
        <div className="comp-section__head">
          <h5 className="comp-section__title">Product commission</h5>
          <span className="comp-section__note">Set separately from treatments</span>
        </div>
        <p className="comp-section__desc">
          What she earns on retail sold at checkout — serums, SPF, aftercare kits. Applies to every product line unless one is excluded below.
        </p>
        <div className="comp-product-card">
          <div className="cs-seg" role="group" aria-label="Product commission mode">
            <button
              type="button"
              aria-pressed={productCommissionEnabled}
              onClick={() => setProductCommissionEnabled(true)}
            >
              Percent
            </button>
            <button
              type="button"
              aria-pressed={!productCommissionEnabled}
              onClick={() => {
                setProductCommissionEnabled(false);
                setProductPercent("");
              }}
            >
              None
            </button>
          </div>
          {productCommissionEnabled ? (
            <div className="comp-value-row" style={{ marginTop: "12px" }}>
              <input
                className="comp-value-input"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={productPercent}
                onChange={(e) => setProductPercent(e.target.value)}
                placeholder="0"
              />
              <span className="comp-value-suffix">% of product sales</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="comp-summary">
        <h5 className="comp-summary__title">{earnings ? `${earnings.monthLabel} so far` : "This month so far"}</h5>
        {earningsError ? (
          <p className="comp-summary__error">{earningsError}</p>
        ) : earnings ? (
          <div className="comp-summary__body">
            <div className="comp-summary__breakdown">
              <p>{formatCentsWhole(earnings.treatmentRevenueCents)} in treatments · {formatCentsWhole(earnings.retailRevenueCents)} in retail{overrideCount > 0 ? ` · ${overrideCount} treatment${overrideCount === 1 ? "" : "s"} on an override rate` : ""}</p>
            </div>
            <div className="comp-summary__total">
              <span className="comp-summary__total-amount">{formatCentsWhole(earnings.totalPayoutCents)}</span>
              <span className="comp-summary__total-split">
                {formatCentsWhole(earnings.servicePayoutCents)} service + {formatCentsWhole(earnings.productPayoutCents)} product
              </span>
            </div>
          </div>
        ) : (
          <p className="comp-summary__loading">Loading…</p>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "18px" }}>
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
  const [savedOverrides, setSavedOverrides] = useState<Record<string, PermissionTriState>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const isOwner = user.role === "owner";

  useEffect(() => {
    let cancelled = false;
    setLoadState({ kind: "loading" });
    const load = isOwner
      ? platformApi
          .getPermissionsCatalog()
          .then((catalogResp): [PermissionCatalogResponse, UserPermissionsResponse | null] => [
            catalogResp,
            null,
          ])
      : Promise.all([
          platformApi.getPermissionsCatalog(),
          platformApi.getUserPermissions(tenantSlug, user.id),
        ]);
    load
      .then(([catalogResp, permsResp]) => {
        if (cancelled) return;
        setCatalog(catalogResp);
        setPermissions(permsResp);
        const next: Record<string, PermissionTriState> = {};
        for (const entry of permsResp?.overrides ?? []) {
          next[entry.key] = entry.allowed ? "allow" : "deny";
        }
        setOverrides(next);
        setSavedOverrides(next);
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
  }, [tenantSlug, user.id, isOwner]);

  const toApiOverrides = (map: Record<string, PermissionTriState>): ReplaceUserPermissionsRequest => ({
    overrides: Object.entries(map).map(
      ([key, value]): UserPermissionOverrideEntry => ({
        key: key as PermissionKey,
        allowed: value === "allow",
      }),
    ),
  });

  const persist = async (map: Record<string, PermissionTriState>) => {
    setSaving(true);
    setStatus(null);
    try {
      const updated = await platformApi.replaceUserPermissions(tenantSlug, user.id, toApiOverrides(map));
      setPermissions(updated);
      const next: Record<string, PermissionTriState> = {};
      for (const entry of updated.overrides) {
        next[entry.key] = entry.allowed ? "allow" : "deny";
      }
      setOverrides(next);
      setSavedOverrides(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save permissions.";
      setStatus(message);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: PermissionKey, next: PermissionTriState) => {
    const nextMap: Record<string, PermissionTriState> = { ...overrides };
    if (next === "inherit") {
      delete nextMap[key];
    } else {
      nextMap[key] = next;
    }
    setOverrides(nextMap);
    setStatus(null);
    void persist(nextMap);
  };

  const handleReset = () => {
    setOverrides({});
    setStatus(null);
    void persist({});
  };

  if (loadState.kind === "loading") {
    return <p className="settings-form-help">Loading permissions…</p>;
  }
  if (loadState.kind === "error") {
    return <p className="error-message">{loadState.message}</p>;
  }
  if (!catalog) return null;

  const firstName = user.name.split(" ")[0] || user.name;

  const groupAll = (defs: PermissionDefinition[]) => {
    const grouped = new Map<string, PermissionDefinition[]>();
    for (const def of defs) {
      const arr = grouped.get(def.category) ?? [];
      arr.push(def);
      grouped.set(def.category, arr);
    }
    return Array.from(grouped.entries());
  };

  // Read-only full-access view for owners.
  if (isOwner) {
    return (
      <div className="perm">
        <div className="perm-banner">
          <div className="perm-banner__text">
            <strong>Owners have full access</strong>
            <p className="perm-banner__sub">Every permission is granted automatically. Customize access on managers, providers, and staff instead.</p>
          </div>
        </div>

        <div className="perm-grid-cols">
          <span>Permission</span>
          <span>Owner default</span>
          <span>For {firstName}</span>
        </div>

        {groupAll(catalog.permissions).map(([category, defs]) => (
          <section key={category} className="perm-group">
            <p className="perm-group__label">{category}</p>
            <div className="perm-group__list">
              {defs.map((def) => (
                <div key={def.key} className="perm-row">
                  <div className="perm-row__label">
                    <strong>{overrideLabel(def.key, def.label)}</strong>
                    <span className="perm-row__key">{def.key}</span>
                  </div>
                  <div className="perm-row__default">
                    <span className="perm-row__count-label">Allowed</span>
                  </div>
                  <div className="perm-row__control">
                    <div className="perm-seg" role="radiogroup" aria-label={def.label}>
                      <button type="button" className="perm-seg__btn" disabled>Inherit</button>
                      <button type="button" className="perm-seg__btn" aria-pressed="true" disabled>Allow</button>
                      <button type="button" className="perm-seg__btn" disabled>Deny</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <div className="perm-summary">
          <p className="perm-summary__text">{firstName} is an Owner — all permissions are always allowed and cannot be restricted from this screen.</p>
        </div>
      </div>
    );
  }

  if (!permissions) return null;

  const roleDefaults = new Set<string>(permissions.roleDefaults);
  const roleLabel = capitalize(permissions.role);
  const overrideCount = Object.keys(overrides).length;
  const dirty = JSON.stringify(normalizeOverrides(overrides)) !== JSON.stringify(normalizeOverrides(savedOverrides));
  const savedCount = Object.keys(savedOverrides).length;

  const activeOverrideEntry = Object.entries(savedOverrides)[0] ?? null;
  const summaryOverrideKey = activeOverrideEntry ? (activeOverrideEntry[0] as PermissionKey) : null;
  const summaryOverrideAllowed = activeOverrideEntry ? activeOverrideEntry[1] === "allow" : false;
  const summaryDef = summaryOverrideKey
    ? catalog.permissions.find((d) => d.key === summaryOverrideKey)
    : undefined;
  const summaryInheritedAllowed = summaryOverrideKey ? roleDefaults.has(summaryOverrideKey) : false;

  return (
    <div className="perm">
      {status ? (
        <div className="message-banner" role="alert">
          {status}
          <button type="button" className="ghost-action" onClick={() => setStatus(null)}>Dismiss</button>
        </div>
      ) : null}

      <div className="perm-banner">
        <div className="perm-banner__text">
          <strong>{roleLabel} defaults apply</strong>
          <p className="perm-banner__sub">Change the role on Details to move the whole baseline.</p>
        </div>
        <button
          type="button"
          className="perm-banner__reset"
          onClick={handleReset}
          disabled={saving || overrideCount === 0}
        >
          Reset overrides
        </button>
      </div>

      <div className="perm-grid-cols">
        <span>Permission</span>
        <span>{roleLabel} default</span>
        <span>For {firstName}</span>
      </div>

      {groupAll(catalog.permissions).map(([category, defs]) => (
        <section key={category} className="perm-group">
          <p className="perm-group__label">{category}</p>
          <div className="perm-group__list">
            {defs.map((def) => {
              const current: PermissionTriState = overrides[def.key] ?? "inherit";
              const inheritedAllowed = roleDefaults.has(def.key);
              const overridden = savedOverrides[def.key] != null;
              return (
                <div key={def.key} className={`perm-row${overridden ? " perm-row--overridden" : ""}`}>
                  <div className="perm-row__label">
                    <strong>{overrideLabel(def.key, def.label)}</strong>
                    <span className="perm-row__key">{def.key}</span>
                  </div>
                  <div className="perm-row__default">
                    <span className="perm-row__count-label">{inheritedAllowed ? "Allowed" : "Denied"}</span>
                  </div>
                  <div className="perm-row__control">
                    <div className="perm-seg" role="radiogroup" aria-label={def.label}>
                      {(["inherit", "allow", "deny"] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={`perm-seg__btn${current === opt ? ` perm-seg__btn--${opt}` : ""}`}
                          aria-pressed={current === opt}
                          onClick={() => handleChange(def.key, opt)}
                        >
                          {opt === "inherit" ? "Inherit" : opt === "allow" ? "Allow" : "Deny"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="perm-summary">
        {dirty ? (
          <p className="perm-summary__text">
            {saving ? "Saving changes…" : "Saving your changes…"}
          </p>
        ) : savedCount > 0 && summaryDef ? (
          <p className="perm-summary__text">
            {savedCount === 1
              ? summaryOverrideAllowed
                ? summaryInheritedAllowed
                  ? `One override is active — ${firstName} can ${summaryDef.label.toLowerCase()} explicitly, not just via the ${roleLabel} default.`
                  : `One override is active — ${firstName} can ${summaryDef.label.toLowerCase()} even though ${roleLabel}s can't by default.`
                : `One override is active — ${firstName} cannot ${summaryDef.label.toLowerCase()} even though ${roleLabel}s ${summaryInheritedAllowed ? "can by default" : "can't anyway"}.`
              : `${savedCount} overrides are active for ${firstName} — including ${summaryDef.label.toLowerCase()} ${summaryOverrideAllowed ? "allowed" : "denied"} against the ${roleLabel} baseline.`}
            {" "}Overrides are logged and surfaced to the owner.
          </p>
        ) : (
          <p className="perm-summary__text">No overrides active for {firstName} — they follow the {roleLabel} defaults.</p>
        )}
      </div>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeOverrides(map: Record<string, PermissionTriState>): Record<string, PermissionTriState> {
  const result: Record<string, PermissionTriState> = {};
  for (const key of Object.keys(map).sort()) {
    result[key] = map[key];
  }
  return result;
}

const PERMISSION_LABEL_OVERRIDES: Record<string, string> = {
  "dashboard.view": "See the dashboard",
  "calendar.view": "See the calendar",
  "calendar.create_booking": "Book from a calendar slot",
  "bookings.view": "Open a booking",
  "bookings.manage": "Edit or reschedule",
  "bookings.complete": "Complete an appointment",
  "bookings.cancel": "Cancel or mark no-show",
  "bookings.collect_payment": "Take payment at checkout",
  "payments.view": "See the payments queue",
  "payments.manage": "Collect, refund and correct",
  "customers.view": "Open client records",
  "customers.manage": "Edit clients and notes",
  "forms.view": "Read submitted forms",
  "forms.manage": "Build and edit forms",
  "services.view": "See the treatment menu",
  "services.manage": "Edit treatments and pricing",
  "providers.view": "See the team",
  "providers.manage": "Edit hours, comp and services",
  "locations.view": "See locations",
  "locations.manage": "Edit locations",
  "settings.view": "See studio settings",
  "settings.manage": "Change studio settings",
  "reports.view": "See reports",
  "reports.financial": "See financial reports",
  "reports.export": "Export reports",
};

function overrideLabel(key: string, fallback: string): string {
  return PERMISSION_LABEL_OVERRIDES[key] ?? fallback;
}
