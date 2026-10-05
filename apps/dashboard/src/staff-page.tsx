import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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

import { categoryColor } from "./category-colors";
import { formatMoneyShort } from "./format-money";
import { uploadImageFile } from "./upload-image";
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
      <div className="cs-modal" role="dialog" aria-label="Crop photo">
        <div className="cs-modal__panel cs-modal__panel--crop">
          <div className="cs-modal__header">
            <h4>Crop photo</h4>
            <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onCancel}>Cancel</button>
          </div>
          <div className="cs-modal__form" style={{ alignItems: "center", padding: "2rem" }}>
            <p className="cs-settings-form-help">Loading image…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cs-modal" role="dialog" aria-label="Crop photo">
      <div className="cs-modal__panel cs-modal__panel--crop">
        <div className="cs-modal__header">
          <h4>Crop photo</h4>
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onCancel}>Cancel</button>
        </div>
        <div className="cs-crop__body">
          <div
            className={`cs-crop__mask${maskShape === "rectangle" ? " cs-crop__mask--rect" : ""}`}
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
          <div className="cs-crop__controls">
            <label className="cs-crop__zoom-label">
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
        <div className="cs-modal__actions" style={{ padding: "0 1.25rem 1.25rem" }}>
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onCancel}>Cancel</button>
          <button type="button" className="cs-btn cs-btn--primary cs-btn--sm" onClick={handleSave}>Save</button>
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
  pill = false,
}: {
  tenantSlug: string;
  value: string;
  name: string;
  onChange: (next: string) => void;
  inputId: string;
  pill?: boolean;
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
      const { url } = await uploadImageFile(tenantSlug, croppedFile);
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
      <div className={pill ? "cs-dt-photo-uploader" : "cs-staff-avatar-uploader"}>
        <div className="cs-staff-avatar-uploader__preview cs-dt-photo-uploader__preview" aria-hidden="true">
          {value ? <img src={value} alt="" /> : <span>{initialsOf(name) || "?"}</span>}
        </div>
        <div className="cs-staff-avatar-uploader__controls">
          <input
            id={inputId}
            type="file"
            className={pill ? "cs-dt-photo-uploader__input" : undefined}
            accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void handleFile(file);
              event.target.value = "";
            }}
            disabled={uploading}
          />
          {pill ? (
            <label htmlFor={inputId} className="cs-dt-upload-pill">
              Upload &amp; crop
            </label>
          ) : null}
          {value ? (
            <button
              type="button"
              className="cs-btn cs-btn--ghost cs-btn--sm"
              onClick={() => onChange("")}
              disabled={uploading}
            >
              Remove
            </button>
          ) : null}
          {uploading ? <small className="cs-settings-form-help">Uploading…</small> : null}
          {error ? (
            <small role="alert" className="cs-settings-error">
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
  const [rosterFilter, setRosterFilter] = useState<"all" | "providers" | "admin">("all");
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    // Only show the full-page "Loading roster…" placeholder on the very first
    // load. Subsequent refreshes (e.g. after toggling a location pill or
    // saving a field) refetch quietly in the background so the panel stays
    // mounted and the scroll position doesn't jump.
    if (!hasLoadedRef.current) {
      setState({ kind: "loading" });
    }
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
        hasLoadedRef.current = true;
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

  // Split the roster into booking providers vs front-desk/admin so each group
  // can be labelled and filtered independently.
  const providerUsers = useMemo(
    () => users.filter((u) => providers.some((p) => p.userId === u.id)),
    [users, providers],
  );
  const adminUsers = useMemo(
    () => users.filter((u) => !providers.some((p) => p.userId === u.id)),
    [users, providers],
  );

  const renderRosterItem = (user: TenantUserSummary) => {
    const provider = providers.find((p) => p.userId === user.id);
    const isActive = user.id === selectedUserId;
    return (
      <li key={user.id}>
        <button
          type="button"
          className={`cs-md-list__item${isActive ? " is-active" : ""}`}
          onClick={() => {
            setSelectedUserId(user.id);
            setActiveTab("details");
          }}
        >
          {user.avatarUrl ? (
            <img className="cs-staff-avatar" src={user.avatarUrl} alt="" loading="lazy" />
          ) : (
            <span
              className="cs-staff-avatar cs-staff-avatar--initials"
              style={{ background: avatarColorFor(user.id) }}
              aria-hidden
            >
              {initialsOf(user.name)}
            </span>
          )}
          <span className="cs-md-list__meta">
            <span className="cs-md-list__name">{user.name}</span>
            <span className="cs-md-list__role">
              {ROLE_LABELS[user.role] ?? user.role}
              {provider ? " · Provider" : ""}
              {!user.isActive ? " · Inactive" : ""}
            </span>
          </span>
        </button>
      </li>
    );
  };

  if (!canManage) {
    return <main className="cs-page-stack"><p className="cs-empty">You do not have permission to view the team roster.</p></main>;
  }

  return (
    <main className="cs-page-stack">
      <section className="cs-md-shell">
        {state.kind === "loading" ? <p>Loading roster…</p> : null}
        {state.kind === "error" ? (
          <p role="alert" className="cs-settings-error">
            {state.message}
          </p>
        ) : null}
        {state.kind === "ready" ? (
          <div className="cs-md-grid">
            <aside className="cs-md-rail">
              <header className="cs-md-rail__header">
                <h4>Team</h4>
                <button
                  type="button"
                  className="cs-btn cs-btn--primary cs-btn--sm"
                  onClick={() => setModal({ kind: "add" })}
                >
                  Add staff
                </button>
              </header>
              <div className="cs-md-filters" role="group" aria-label="Filter team">
                {(["all", "providers", "admin"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`cs-md-filter${rosterFilter === key ? " is-active" : ""}`}
                    aria-pressed={rosterFilter === key}
                    onClick={() => setRosterFilter(key)}
                  >
                    {key === "all" ? "All" : key === "providers" ? "Providers" : "Admin"}
                  </button>
                ))}
              </div>
              {users.length === 0 ? (
                <p className="cs-settings-form-help">No users configured yet.</p>
              ) : (
                <div className="cs-md-groups">
                  {(rosterFilter === "all" || rosterFilter === "providers") && providerUsers.length > 0 ? (
                    <div className="cs-md-group">
                      <p className="cs-md-group__label">Takes bookings</p>
                      <ul className="cs-md-list">{providerUsers.map(renderRosterItem)}</ul>
                    </div>
                  ) : null}
                  {(rosterFilter === "all" || rosterFilter === "admin") && adminUsers.length > 0 ? (
                    <div className="cs-md-group">
                      <p className="cs-md-group__label">Front desk &amp; admin</p>
                      <ul className="cs-md-list">{adminUsers.map(renderRosterItem)}</ul>
                    </div>
                  ) : null}
                </div>
              )}
            </aside>

            <div className="cs-md-detail">
              {selectedUser === null ? (
                <p className="cs-settings-form-help">Select a team member to view details.</p>
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
    <div className="cs-staff-empty-state">
      <p className="cs-staff-empty-state__title">
        {creating
          ? `Setting up ${userName.split(" ")[0] || userName} as a provider…`
          : `Set up ${userName.split(" ")[0] || userName}'s schedule & pay`}
      </p>
      <p className="cs-staff-empty-state__body">
        {creating
          ? "Creating a provider record so you can configure booking settings, work hours, and compensation."
          : "Work hours, compensation, and services are stored on a provider record. Create one (it won't be bookable online until you turn that on) to manage these here."}
      </p>
      {!creating ? (
        <button type="button" className="cs-btn cs-btn--primary cs-btn--sm" onClick={onLinkProvider}>
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
    <div className="cs-md-detail__inner">
      {providerCreateError ? (
        <div className="cs-banner" role="alert">
          {providerCreateError}
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={() => setProviderCreateError(null)}>Dismiss</button>
        </div>
      ) : null}
      <header className="cs-md-detail__header">
        <div className="cs-dt-header">
          <span
            className="cs-dt-header__avatar"
            aria-hidden="true"
            style={{ background: user.avatarUrl ? undefined : avatarColorFor(user.id) }}
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" />
            ) : (
              initialsOf(user.name)
            )}
          </span>
          <div className="cs-dt-header__text">
            <h4 className="cs-dt-header__name">{user.name}</h4>
            <div className="cs-dt-header__pills">
              <span className="cs-dt-pill cs-dt-pill--dark">{ROLE_LABELS[user.role] ?? user.role}</span>
              {provider ? (
                <span className="cs-dt-pill cs-dt-pill--light">Takes bookings</span>
              ) : null}
              {!user.isActive ? (
                <span className="cs-dt-pill cs-dt-pill--warn">Inactive</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="cs-md-detail__actions">
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onResetPassword}>
            Reset password
          </button>
          {provider === null ? (
            <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onLinkProvider}>
              Make service provider
            </button>
          ) : null}
        </div>
      </header>

      <nav className="cs-md-tabs" role="tablist" aria-label="Staff sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            disabled={tab.disabled}
            className={`cs-md-tab${activeTab === tab.key ? " is-active" : ""}`}
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
          locations={locations}
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
  locations,
  bookingLinkBase,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  provider: ProviderSummary | null;
  locations: LocationSummary[];
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
  const [providerForm, setProviderForm] = useState({
    title: provider?.availabilityLabel ?? "",
    bio: provider?.description ?? "",
  });

  useEffect(() => {
    setBookingSlug(provider?.bookingSlug ?? "");
    setSlugError(null);
    setSlugCopied(false);
    setProviderForm({
      title: provider?.availabilityLabel ?? "",
      bio: provider?.description ?? "",
    });
  }, [provider?.id, provider?.bookingSlug, provider?.availabilityLabel, provider?.description]);

  useEffect(() => {
    setForm({
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      phone: user.phone ?? "",
      avatarUrl: user.avatarUrl ?? "",
    });
  }, [user]);

  const isProvider = provider !== null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload: UpdateTenantUserRequest = {};
    if (form.name.trim() !== user.name) payload.name = form.name.trim();
    // Service providers cannot change their in-system role.
    if (!isProvider && form.role !== user.role) payload.role = form.role;
    if (form.isActive !== user.isActive) payload.isActive = form.isActive;
    const phone = form.phone.trim();
    if (phone !== (user.phone ?? "")) payload.phone = phone || null;
    const avatar = form.avatarUrl.trim();
    if (avatar !== (user.avatarUrl ?? "")) payload.avatarUrl = avatar || null;

    const providerPayload: UpdateProviderRequest = {};
    if (provider) {
      const title = providerForm.title.trim();
      if (title !== (provider.availabilityLabel ?? "")) providerPayload.availabilityLabel = title || null;
      const bio = providerForm.bio.trim();
      if (bio !== (provider.description ?? "")) providerPayload.description = bio || null;
    }

    if (Object.keys(payload).length === 0 && Object.keys(providerPayload).length === 0) {
      setSubmitting(false);
      return;
    }
    try {
      if (Object.keys(payload).length > 0) {
        await platformApi.updateTenantUser(tenantSlug, user.id, payload);
      }
      if (provider && Object.keys(providerPayload).length > 0) {
        await platformApi.updateProvider(tenantSlug, provider.id, providerPayload);
      }
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to update user."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="cs-md-form cs-dt-form" onSubmit={submit}>
      {/* Section 1 — identity */}
      <div className="cs-dt-section">
        <div className="cs-dt-row">
          <div className="cs-dt-field">
            <span className="cs-dt-label">Name</span>
            <input
              className="cs-dt-input"
              type="text"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </div>
          <div className="cs-dt-field">
            <span className="cs-dt-label">Role</span>
            <div className="cs-dt-role-pills" role="group" aria-label="Role">
              {ROLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={isProvider}
                  className={`cs-dt-pill cs-dt-pill--role${form.role === option.value ? " is-selected" : ""}`}
                  onClick={() => setForm({ ...form, role: option.value })}
                  aria-pressed={form.role === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {isProvider ? (
              <span className="cs-dt-helper">Role is locked while this person takes bookings.</span>
            ) : null}
          </div>
        </div>
        <div className="cs-dt-row">
          <div className="cs-dt-field">
            <span className="cs-dt-label">Email</span>
            <input className="cs-dt-input" type="email" value={user.email} disabled readOnly />
          </div>
          <div className="cs-dt-field">
            <span className="cs-dt-label">Phone</span>
            <input
              className="cs-dt-input"
              type="text"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="+1 555-555-1212"
            />
          </div>
        </div>
      </div>

      <div className="cs-dt-divider" role="presentation" />

      {/* Section 2 — profile */}
      <div className="cs-dt-section">
        <div className="cs-dt-row">
          <div className="cs-dt-field">
            <span className="cs-dt-label">Profile photo</span>
            <div className="cs-dt-photo">
              <AvatarUploader
                tenantSlug={tenantSlug}
                value={form.avatarUrl}
                name={form.name}
                inputId={`user-${user.id}-avatar-upload`}
                pill={true}
                onChange={(next) => setForm({ ...form, avatarUrl: next })}
              />
              <small className="cs-dt-photo__help">
                JPG, PNG, GIF, WEBP, or HEIC up to 10&nbsp;MB.
              </small>
            </div>
          </div>
          {provider ? (
            <div className="cs-dt-field">
              <span className="cs-dt-label">Title shown to clients</span>
              <input
                className="cs-dt-input"
                type="text"
                value={providerForm.title}
                onChange={(event) => setProviderForm({ ...providerForm, title: event.target.value })}
                placeholder="Lead therapist"
              />
              <span className="cs-dt-label" style={{ marginTop: 12 }}>Bio</span>
              <textarea
                className="cs-dt-input cs-dt-textarea"
                value={providerForm.bio}
                onChange={(event) => setProviderForm({ ...providerForm, bio: event.target.value })}
                placeholder="A short client-facing bio…"
                rows={3}
              />
            </div>
          ) : (
            <div className="cs-dt-field">
              <span className="cs-dt-label">Joined</span>
              <input
                className="cs-dt-input"
                type="text"
                value={DATE_FORMAT.format(new Date(user.createdAt))}
                disabled
                readOnly
              />
            </div>
          )}
        </div>
      </div>

      <div className="cs-dt-divider" role="presentation" />

      {/* Section 3 — availability & access */}
      <div className="cs-dt-section">
        {provider ? (
          <div className="cs-dt-row">
            <div className="cs-dt-field">
              <span className="cs-dt-label">Works at</span>
              <div className="cs-dt-pill-row">
                {locations.map((loc) => {
                  const assigned = provider.locationIds.includes(loc.id);
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      className={`cs-dt-pill cs-dt-pill--location${assigned ? " is-assigned" : ""}`}
                      onClick={() => {
                        const next = assigned
                          ? provider.locationIds.filter((id) => id !== loc.id)
                          : [...provider.locationIds, loc.id];
                        platformApi
                          .updateProvider(tenantSlug, provider.id, { locationIds: next })
                          .then(() => onSaved())
                          .catch((e: unknown) => setError(readErrorMessage(e, "Unable to update locations.")));
                      }}
                      aria-pressed={assigned}
                    >
                      {loc.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="cs-dt-field">
              <span className="cs-dt-label">Bookable online</span>
              <label className="cs-dt-toggle-row">
                <input
                  type="checkbox"
                  checked={provider.isBookableOnline}
                  onChange={(event) => {
                    platformApi
                      .updateProvider(tenantSlug, provider.id, { isBookableOnline: event.target.checked })
                      .then(() => onSaved())
                      .catch((e: unknown) => setError(readErrorMessage(e, "Unable to update bookability.")));
                  }}
                />
                <span className="cs-dt-helper">Clients can request {user.name.split(" ")[0] || user.name} by name</span>
              </label>
            </div>
          </div>
        ) : null}
        <div className="cs-dt-row">
          <div className="cs-dt-field">
            <span className="cs-dt-label">Can sign in</span>
            <label className="cs-dt-toggle-row">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
              <span>Active</span>
            </label>
          </div>
          <div className="cs-dt-field" aria-hidden="true" />
        </div>
      </div>

      {provider ? (
        <div className="cs-dt-booking-link">
          <p className="cs-dt-label">Booking link</p>
          <div className="cs-dt-booking-link__row">
            <span className="cs-dt-booking-link__prefix">{bookingLinkBase}</span>
            <input
              className="cs-dt-input cs-dt-booking-link__input"
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
            {provider.bookingUrl ? (
              <div className="cs-dt-booking-link__actions">
                <button
                  type="button"
                  className="cs-btn cs-btn--ghost cs-btn--sm"
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
                  {slugCopied ? "Copied!" : "Copy"}
                </button>
                <a
                  className="cs-btn cs-btn--ghost cs-btn--sm"
                  href={provider.bookingUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open
                </a>
              </div>
            ) : null}
          </div>
          {slugError ? (
            <p className="cs-dt-helper" role="alert">
              <span className="cs-settings-error">{slugError}</span>
            </p>
          ) : (
            <div className="cs-dt-booking-notes">
              <p className="cs-dt-note cs-dt-note--ok">
                Available. Lowercase letters, numbers and hyphens — changing it breaks any link already shared.
              </p>
              <p className="cs-dt-note cs-dt-note--muted">
                Leave it blank and this person is bookable only from the studio&rsquo;s main page.
              </p>
            </div>
          )}
          {bookingSlug.trim() !== (provider.bookingSlug ?? "") ? (
            <button
              type="button"
              className="cs-dt-link-save"
              disabled={slugSubmitting}
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
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="cs-settings-error">
          {error}
        </p>
      ) : null}

      <div className="cs-modal__actions">
        <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
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
  // Per-service location offering (serviceId -> locationIds). A service absent
  // here is offered at all of the provider's locations.
  const [serviceLocations, setServiceLocations] = useState<Record<string, string[]>>(
    provider.serviceLocations ?? {},
  );
  const [isBookableOnline, setIsBookableOnline] = useState(provider.isBookableOnline);
  const [isActive, setIsActive] = useState(provider.isActive);
  const [linkCopied, setLinkCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const idPrefix = useId();

  // Per-service overrides (duration, price, commission)
  const [serviceOverrides, setServiceOverrides] = useState<
    Record<string, { durationMinutes: string; priceCents: string; depositCents: string; flatCents: string; basisPoints: string }>
  >({});
  // Explicit $/% choice per service, independent of whether a value has been typed yet
  // (without this, clicking % while the percent field is still blank would immediately
  // fall back to showing the flat $ input, since the mode was derived only from the data).
  const [commissionModeOverride, setCommissionModeOverride] = useState<Record<string, "flat" | "percent">>({});
  const [overridesLoaded, setOverridesLoaded] = useState(false);

  // Load existing per-service overrides
  useEffect(() => {
    let cancelled = false;
    const loadOverrides = async () => {
      const map: Record<string, { durationMinutes: string; priceCents: string; depositCents: string; flatCents: string; basisPoints: string }> = {};
      for (const svcId of provider.serviceIds) {
        try {
          const resp = await platformApi.getServiceProviderVariants(tenantSlug, svcId);
          const variant = resp.variants.find((v) => v.providerId === provider.id);
          if (variant) {
            map[svcId] = {
              durationMinutes: variant.durationMinutes != null ? String(variant.durationMinutes) : "",
              priceCents: variant.priceCents != null ? (variant.priceCents / 100).toFixed(2) : "",
              depositCents: variant.depositCents != null ? (variant.depositCents / 100).toFixed(2) : "",
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
    setServiceLocations(provider.serviceLocations ?? {});
    setIsBookableOnline(provider.isBookableOnline);
    setIsActive(provider.isActive);
  }, [provider]);

  // Regular weekly shifts per location, used only to flag services that a
  // shift blocks. Advisory: if a load fails the tab simply shows no badges.
  const [shiftsByLocation, setShiftsByLocation] = useState<Record<string, ProviderScheduleEntry[]>>({});
  useEffect(() => {
    let cancelled = false;
    const loadShifts = async () => {
      const next: Record<string, ProviderScheduleEntry[]> = {};
      for (const locId of provider.locationIds) {
        try {
          const resp = await platformApi.getProviderWorkHours(tenantSlug, provider.id, locId);
          next[locId] = resp.regularHours;
        } catch {
          // ignore — badges are informational only
        }
      }
      if (!cancelled) setShiftsByLocation(next);
    };
    loadShifts();
    return () => { cancelled = true; };
  }, [tenantSlug, provider.id, provider.locationIds.join(",")]);

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  // Toggle one location for a service (defaulting to all provider locations).
  const toggleServiceLocation = (svcId: string, locId: string) => {
    setServiceLocations((prev) => {
      const current = prev[svcId] ?? locationIds;
      const next = current.includes(locId) ? current.filter((l) => l !== locId) : [...current, locId];
      return { ...prev, [svcId]: next };
    });
  };

  const filteredLocations = useMemo(() => {
    const q = locationQuery.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter((loc) => loc.name.toLowerCase().includes(q));
  }, [locations, locationQuery]);

  // Services grouped by category in configured order; anything without a known
  // category lands in a trailing "Uncategorized" group.
  const categoryGroups = useMemo(() => {
    const byCategory = new Map<string, ServiceSummary[]>();
    const uncategorized: ServiceSummary[] = [];
    const knownIds = new Set(categories.map((cat) => cat.id));
    for (const svc of services) {
      if (svc.categoryId && knownIds.has(svc.categoryId)) {
        if (!byCategory.has(svc.categoryId)) byCategory.set(svc.categoryId, []);
        byCategory.get(svc.categoryId)!.push(svc);
      } else {
        uncategorized.push(svc);
      }
    }
    const groups: Array<{ id: string | null; name: string; color: string; services: ServiceSummary[] }> = [];
    const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    sorted.forEach((cat, index) => {
      const list = byCategory.get(cat.id);
      if (list) groups.push({ id: cat.id, name: cat.name, color: categoryColor(index), services: list });
    });
    if (uncategorized.length > 0) {
      groups.push({ id: null, name: "Uncategorized", color: categoryColor(sorted.length), services: uncategorized });
    }
    return groups;
  }, [services, categories]);

  // Weekdays on which every shift (at the locations offering the service)
  // blocks it — mirrors availability, so clients can't book it those days.
  const blockedWeekdays = useMemo(() => {
    const result: Record<string, number[]> = {};
    for (const svcId of serviceIds) {
      const offeredAt = (serviceLocations[svcId] ?? locationIds).filter((locId) => shiftsByLocation[locId]);
      const days: number[] = [];
      for (let weekday = 0; weekday < 7; weekday++) {
        const dayShifts = offeredAt.flatMap((locId) =>
          shiftsByLocation[locId].filter((shift) => shift.isActive && shift.weekday === weekday),
        );
        if (dayShifts.length > 0 && dayShifts.every((shift) => shift.blockedServiceIds?.includes(svcId))) {
          days.push(weekday);
        }
      }
      if (days.length > 0) result[svcId] = days;
    }
    return result;
  }, [serviceIds, serviceLocations, locationIds, shiftsByLocation]);

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
      return ov.durationMinutes !== "" || ov.priceCents !== "" || ov.depositCents !== "" || ov.flatCents !== "" || ov.basisPoints !== "";
    }) ||
    serviceIds.some((svcId) => {
      const current = serviceLocations[svcId] ?? locationIds;
      const original = provider.serviceLocations?.[svcId] ?? provider.locationIds;
      return !sameIds(current, original);
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
        serviceLocations: Object.fromEntries(
          serviceIds.map((svcId) => [svcId, serviceLocations[svcId] ?? locationIds]),
        ),
        isBookableOnline,
        isActive,
      };
      await platformApi.updateProvider(tenantSlug, provider.id, payload);

      // Save per-service overrides for assigned services
      for (const svcId of serviceIds) {
        const ov = serviceOverrides[svcId];
        const durationMinutes = ov?.durationMinutes ? Number(ov.durationMinutes) : null;
        const priceCents = ov?.priceCents ? Math.round(Number(ov.priceCents) * 100) : null;
        const depositCents = ov?.depositCents ? Math.round(Number(ov.depositCents) * 100) : null;
        const flatCents = ov?.flatCents ? Math.round(Number(ov.flatCents) * 100) : null;
        const basisPoints = ov?.basisPoints ? Math.round(Number(ov.basisPoints) * 100) : null;
        const hasOverride =
          durationMinutes != null || priceCents != null || depositCents != null || flatCents != null || basisPoints != null;
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
              ? { ...v, durationMinutes, priceCents, depositCents, commissionFlatCents: flatCents, commissionBasisPoints: basisPoints }
              : v,
          );
          if (!hadEntry) {
            merged.push({
              providerId: provider.id,
              durationMinutes,
              priceCents,
              depositCents,
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

  const emptyOverride = { durationMinutes: "", priceCents: "", depositCents: "", flatCents: "", basisPoints: "" };
  // Commission a service inherits when it has no override: the provider's
  // service-percent rate from the Compensation tab (payroll falls back to it).
  const inheritedPercent =
    provider.compensationMode === "service_percent" && provider.compensationServicePercentBp
      ? provider.compensationServicePercentBp / 100
      : null;

  const query = serviceQuery.trim().toLowerCase();
  const matchesQuery = (svc: ServiceSummary) => !query || svc.name.toLowerCase().includes(query);
  const offeredGroups = categoryGroups
    .map((group) => ({
      ...group,
      services: group.services.filter((svc) => serviceIds.includes(svc.id) && matchesQuery(svc)),
    }))
    .filter((group) => group.services.length > 0);
  const notOffered = categoryGroups
    .flatMap((group) => group.services)
    .filter((svc) => !serviceIds.includes(svc.id) && matchesQuery(svc));
  const menuServices = categoryGroups.flatMap((group) => group.services).filter((svc) => serviceIds.includes(svc.id));

  // Parsed override (cents or minutes), or null when blank/unparseable.
  const overrideAmount = (raw: string | undefined, scale: number): number | null => {
    if (!raw || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.round(value * scale) : null;
  };
  const overriddenFieldCount = serviceIds.reduce((count, svcId) => {
    const ov = serviceOverrides[svcId];
    if (!ov) return count;
    const fields = [ov.priceCents, ov.durationMinutes, ov.depositCents, ov.flatCents || ov.basisPoints];
    return count + fields.filter((value) => value.trim() !== "").length;
  }, 0);
  // The largest price difference from base, surfaced as a callout.
  const largestPriceDelta = menuServices.reduce<{ svc: ServiceSummary; delta: number } | null>((best, svc) => {
    const price = overrideAmount(serviceOverrides[svc.id]?.priceCents, 100);
    if (price == null || price === svc.priceCents) return best;
    const delta = price - svc.priceCents;
    return best && Math.abs(best.delta) >= Math.abs(delta) ? best : { svc, delta };
  }, null);

  const blockedLabel = (days: number[]) =>
    days.length === 1
      ? `Blocked ${WEEKDAY_LABELS[days[0]]}s`
      : `Blocked ${days.map((day) => BUSINESS_HOURS_DAY_ABBR[day]).join(", ")}`;

  const renderServiceRow = (svc: ServiceSummary) => {
    const isAssigned = serviceIds.includes(svc.id);
    const ov = serviceOverrides[svc.id] || emptyOverride;
    const treatment = (
      <label className="cs-override-table__lead">
        <input
          type="checkbox"
          className="cs-check"
          aria-label={`Toggle ${svc.name}`}
          checked={isAssigned}
          onChange={() => setServiceIds(toggle(serviceIds, svc.id))}
        />
        <span className="cs-override-table__lead-text">
          <span className="cs-override-table__name">{svc.name}</span>
          <span className="cs-override-table__meta">
            {svc.isActive ? `${svc.durationMinutes} min base` : "Hidden from the storefront"}
          </span>
        </span>
      </label>
    );

    if (!isAssigned) {
      return (
        <div key={svc.id} className="cs-override-table__row cs-override-table__row--off">
          {treatment}
          <p className="cs-override-table__note">
            {svc.isActive
              ? "Tick to add to this provider's menu"
              : "Ticking it won't publish the service — it stays hidden until it's turned on in Services"}
          </p>
        </div>
      );
    }

    const blockedDays = blockedWeekdays[svc.id];
    const commissionMode: "flat" | "percent" =
      commissionModeOverride[svc.id] ??
      (ov.basisPoints ? "percent" : ov.flatCents ? "flat" : inheritedPercent != null ? "percent" : "flat");
    const patch = (partial: Partial<typeof ov>) => {
      setServiceOverrides((prev) => ({
        ...prev,
        [svc.id]: { ...(prev[svc.id] || emptyOverride), ...partial },
      }));
    };
    const selectOnFocus = (event: React.FocusEvent<HTMLInputElement>) => event.target.select();
    const keepSelection = (event: React.MouseEvent<HTMLInputElement>) => event.preventDefault();

    return (
      <div
        key={svc.id}
        className={`cs-override-table__row${blockedDays ? " cs-override-table__row--blocked" : ""}`}
      >
        {treatment}

        <div className="cs-override-table__cell cs-override-table__cell--prefix" data-label="Price">
          <input
            className="cs-override-table__field"
            type="text" inputMode="decimal"
            placeholder={formatMoneyShort(svc.priceCents)}
            value={ov.priceCents}
            onFocus={selectOnFocus}
            onMouseUp={keepSelection}
            onChange={(e) => patch({ priceCents: e.target.value })}
            aria-label={`${svc.name} price`}
          />
          <span className="cs-override-table__affix" aria-hidden="true">$</span>
        </div>

        <div className="cs-override-table__cell cs-override-table__cell--suffix" data-label="Duration">
          <input
            className="cs-override-table__field"
            type="text" inputMode="numeric"
            placeholder={`${svc.durationMinutes} min`}
            value={ov.durationMinutes}
            onFocus={selectOnFocus}
            onMouseUp={keepSelection}
            onChange={(e) => patch({ durationMinutes: e.target.value })}
            aria-label={`${svc.name} duration`}
          />
          {/* --chars lets CSS place the unit right after the typed digits. */}
          <span
            className="cs-override-table__affix"
            aria-hidden="true"
            style={{ "--chars": ov.durationMinutes.length } as React.CSSProperties}
          >
            min
          </span>
        </div>

        <div className="cs-override-table__cell cs-override-table__cell--prefix" data-label="Deposit">
          <input
            className="cs-override-table__field"
            type="text" inputMode="decimal"
            placeholder={formatMoneyShort(svc.depositCents)}
            value={ov.depositCents}
            onFocus={selectOnFocus}
            onMouseUp={keepSelection}
            onChange={(e) => patch({ depositCents: e.target.value })}
            aria-label={`${svc.name} deposit`}
          />
          <span className="cs-override-table__affix" aria-hidden="true">$</span>
        </div>

        <div className="cs-override-table__commission" data-label="Commission">
          <div className="cs-override-table__mode" role="group" aria-label="Commission type">
            <button
              type="button"
              className={`cs-override-table__mode-btn${commissionMode === "percent" ? " is-active" : ""}`}
              aria-pressed={commissionMode === "percent"}
              title="Percent of the service price"
              onClick={() => {
                setCommissionModeOverride((prev) => ({ ...prev, [svc.id]: "percent" }));
                if (commissionMode === "percent") return;
                patch({ flatCents: "" });
              }}
            >
              %
            </button>
            <button
              type="button"
              className={`cs-override-table__mode-btn${commissionMode === "flat" ? " is-active" : ""}`}
              aria-pressed={commissionMode === "flat"}
              title="Flat amount per service"
              onClick={() => {
                setCommissionModeOverride((prev) => ({ ...prev, [svc.id]: "flat" }));
                if (commissionMode === "flat") return;
                patch({ basisPoints: "" });
              }}
            >
              $
            </button>
          </div>
          {commissionMode === "flat" ? (
            <input
              className="cs-override-table__field"
              type="text" inputMode="decimal"
              placeholder="0.00"
              value={ov.flatCents}
              onFocus={(e) => { patch({ flatCents: "" }); e.target.select(); }}
              onMouseUp={keepSelection}
              onChange={(e) => patch({ flatCents: e.target.value, basisPoints: "" })}
              aria-label={`${svc.name} commission flat`}
            />
          ) : (
            <input
              className="cs-override-table__field"
              type="text" inputMode="decimal"
              placeholder={inheritedPercent != null ? String(inheritedPercent) : "0"}
              value={ov.basisPoints}
              onFocus={(e) => { patch({ basisPoints: "" }); e.target.select(); }}
              onMouseUp={keepSelection}
              onChange={(e) => patch({ flatCents: "", basisPoints: e.target.value })}
              aria-label={`${svc.name} commission percent`}
            />
          )}
        </div>

        {blockedDays ? (
          <div className="cs-override-table__foot">
            <span className="cs-override-table__badge">{blockedLabel(blockedDays)}</span>
            <span className="cs-override-table__note">
              {blockedDays.length === 1
                ? `Ticked, but the ${WEEKDAY_LABELS[blockedDays[0]]} shift excludes it — clients can't book it that day`
                : "Ticked, but those shifts exclude it — clients can't book it on those days"}
            </span>
          </div>
        ) : null}

        {locationIds.length > 1 ? (
          <div className="cs-override-table__foot" role="group" aria-label={`${svc.name} locations`}>
            <span className="cs-override-table__foot-label">Offered at</span>
            {locationIds.map((locId) => {
              const loc = locations.find((l) => l.id === locId);
              if (!loc) return null;
              const offered = serviceLocations[svc.id] ?? locationIds;
              return (
                <label key={locId} className="cs-override-table__chip">
                  <input
                    type="checkbox"
                    checked={offered.includes(locId)}
                    onChange={() => toggleServiceLocation(svc.id, locId)}
                  />
                  <span>{loc.name}</span>
                </label>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <form className="cs-md-form cs-staff-svc" onSubmit={submit}>
      <section className="cs-staff-svc__card" aria-labelledby={`${idPrefix}-services`}>
        <header className="cs-staff-svc__head">
          <h3 id={`${idPrefix}-services`} className="cs-staff-svc__title">
            Services <span className="cs-staff-svc__count">{serviceIds.length} of {services.length}</span>
          </h3>
          {services.length > 0 ? (
            <label className="cs-staff-svc__search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>
              <input
                type="search"
                placeholder="Find a treatment…"
                value={serviceQuery}
                onChange={(event) => setServiceQuery(event.target.value)}
                aria-label="Search services"
              />
            </label>
          ) : null}
        </header>

        {services.length === 0 ? (
          <p className="cs-staff-svc__empty">No services configured.</p>
        ) : !overridesLoaded ? (
          <p className="cs-staff-svc__empty">Loading…</p>
        ) : offeredGroups.length === 0 && notOffered.length === 0 ? (
          <p className="cs-staff-svc__empty">No services match that search.</p>
        ) : (
          <div className="cs-override-table">
            <div className="cs-override-table__columns" aria-hidden="true">
              <span>Treatment</span>
              <span>Price</span>
              <span>Duration</span>
              <span>Deposit</span>
              <span>Commission</span>
            </div>

            {offeredGroups.map((group) => {
              const groupIds = group.services.map((svc) => svc.id);
              return (
                <section key={group.id ?? "uncategorized"} className="cs-override-table__group" aria-label={group.name}>
                  <header className="cs-override-table__group-head">
                    <h4 className="cs-override-table__group-title">
                      <span className="cs-override-table__dot" style={{ background: group.color }} aria-hidden="true" />
                      {group.name}
                    </h4>
                    <button
                      type="button"
                      className="cs-link-btn"
                      onClick={() => setServiceIds(serviceIds.filter((id) => !groupIds.includes(id)))}
                    >
                      Disable all
                    </button>
                  </header>
                  {group.services.map(renderServiceRow)}
                </section>
              );
            })}

            {notOffered.length > 0 ? (
              <section className="cs-override-table__group cs-override-table__group--off" aria-label="Not offered">
                <header className="cs-override-table__group-head">
                  <h4 className="cs-override-table__group-title">
                    <span className="cs-override-table__dot" style={{ background: "var(--cs-grey)" }} aria-hidden="true" />
                    Not offered
                  </h4>
                  <button
                    type="button"
                    className="cs-link-btn"
                    onClick={() => setServiceIds([...serviceIds, ...notOffered.map((svc) => svc.id)])}
                  >
                    Enable all
                  </button>
                </header>
                {notOffered.map(renderServiceRow)}
              </section>
            ) : null}
          </div>
        )}
      </section>

      <div className="cs-staff-svc__pair">
        <section className="cs-staff-svc__panel" aria-labelledby={`${idPrefix}-menu`}>
          <h4 id={`${idPrefix}-menu`} className="cs-staff-svc__eyebrow">Menu summary</h4>
          {!isBookableOnline ? (
            <p className="cs-staff-svc__empty">Not bookable online, so this menu is hidden from the storefront.</p>
          ) : null}
          {menuServices.length === 0 ? (
            <p className="cs-staff-svc__empty">No services ticked yet.</p>
          ) : (
            <ul className="cs-staff-svc__menu">
              {menuServices.map((svc) => {
                const ov = serviceOverrides[svc.id];
                const price = overrideAmount(ov?.priceCents, 100) ?? svc.priceCents;
                const minutes = overrideAmount(ov?.durationMinutes, 1) ?? svc.durationMinutes;
                const blockedDays = blockedWeekdays[svc.id];
                return (
                  <li key={svc.id} className="cs-staff-svc__menu-item">
                    <span className="cs-staff-svc__menu-name">{svc.name}</span>
                    <span className="cs-staff-svc__menu-meta">
                      {formatMoneyShort(price)} · {minutes} min
                      {blockedDays ? ` · not ${blockedDays.map((day) => BUSINESS_HOURS_DAY_ABBR[day]).join(", ")}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="cs-staff-svc__panel" aria-labelledby={`${idPrefix}-effect`}>
          <h4 id={`${idPrefix}-effect`} className="cs-staff-svc__eyebrow">Effect of overrides</h4>
          <dl className="cs-staff-svc__stats">
            <div className="cs-staff-svc__stat">
              <dt>Services offered</dt>
              <dd>{serviceIds.length}</dd>
            </div>
            <div className="cs-staff-svc__stat">
              <dt>Overridden fields</dt>
              <dd>{overriddenFieldCount}</dd>
            </div>
          </dl>
          {largestPriceDelta ? (
            <p className="cs-staff-svc__callout">
              {largestPriceDelta.svc.name} is {formatMoneyShort(Math.abs(largestPriceDelta.delta))}{" "}
              {largestPriceDelta.delta > 0 ? "above" : "below"} its base price of{" "}
              {formatMoneyShort(largestPriceDelta.svc.priceCents)}.
            </p>
          ) : null}
        </section>
      </div>

      <div className="cs-staff-svc__pair">
        <fieldset className="cs-staff-svc__card">
          <legend className="cs-staff-svc__title">
            Locations <span className="cs-staff-svc__count">{locationIds.length} of {locations.length}</span>
          </legend>
          {locations.length === 0 ? (
            <p className="cs-staff-svc__empty">No locations configured.</p>
          ) : (
            <>
              <div className="cs-staff-svc__toolbar">
                <label className="cs-staff-svc__search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>
                  <input
                    type="search"
                    placeholder="Search locations…"
                    value={locationQuery}
                    onChange={(event) => setLocationQuery(event.target.value)}
                    aria-label="Search locations"
                  />
                </label>
                <button
                  type="button"
                  className="cs-link-btn"
                  onClick={() => selectAll(locationIds, setLocationIds, filteredLocations)}
                  disabled={filteredLocations.length === 0}
                >
                  Select all{locationQuery ? " shown" : ""}
                </button>
                <button
                  type="button"
                  className="cs-link-btn"
                  onClick={() => clearFiltered(locationIds, setLocationIds, filteredLocations)}
                  disabled={filteredLocations.length === 0}
                >
                  Clear{locationQuery ? " shown" : ""}
                </button>
              </div>
              {filteredLocations.length === 0 ? (
                <p className="cs-staff-svc__empty">No locations match that search.</p>
              ) : (
                <div className="cs-staff-svc__locations">
                  {filteredLocations.map((loc) => (
                    <label key={loc.id} className="cs-staff-svc__location">
                      <input
                        type="checkbox"
                        className="cs-check"
                        checked={locationIds.includes(loc.id)}
                        onChange={() => setLocationIds(toggle(locationIds, loc.id))}
                      />
                      <span className="cs-staff-svc__location-text">
                        <span className="cs-staff-svc__location-name">{loc.name}</span>
                        <span className="cs-staff-svc__location-meta">
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

        <fieldset className="cs-staff-svc__card">
          <legend className="cs-staff-svc__title">Online booking</legend>
          <label className="cs-dt-toggle-row">
            <input
              type="checkbox"
              checked={isBookableOnline}
              onChange={(event) => setIsBookableOnline(event.target.checked)}
            />
            <span>Bookable online (shows on storefront)</span>
          </label>
          {isBookableOnline && provider.bookingUrl ? (
            <div className="cs-staff-svc__link">
              <span className="cs-staff-svc__link-url">{provider.bookingUrl}</span>
              <div className="cs-staff-svc__link-actions">
                <button
                  type="button"
                  className="cs-btn cs-btn--ghost cs-btn--sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(provider.bookingUrl!);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    } catch {
                      // ignore
                    }
                  }}
                >
                  {linkCopied ? "Copied!" : "Copy"}
                </button>
                <a className="cs-btn cs-btn--ghost cs-btn--sm" href={provider.bookingUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
            </div>
          ) : null}
          <label className="cs-dt-toggle-row">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            <span>Active provider</span>
          </label>
        </fieldset>
      </div>

      {error ? (
        <p role="alert" className="cs-settings-error">
          {error}
        </p>
      ) : null}

      <div className="cs-modal__actions">
        {isDirty ? <span className="cs-settings-form-help">Unsaved changes</span> : null}
        <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={submitting || !isDirty}>
          {submitting ? "Saving…" : "Save"}
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

/**
 * Convert a wall-clock date + time, interpreted in `timeZone` (an IANA zone such
 * as the location's business timezone), to a UTC ISO instant. Handles DST by
 * measuring the zone's offset at that instant. `timeStr` may be HH:MM or HH:MM:SS.
 */
function zonedWallTimeToUtcISO(dateStr: string, timeStr: string, timeZone: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi, se] = timeStr.split(":").map(Number);
  const utcGuess = Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, se || 0);
  let f: Record<string, number> = {};
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(utcGuess));
    for (const p of parts) if (p.type !== "literal") f[p.type] = Number(p.value);
  } catch {
    // Unknown timezone — fall back to treating the wall time as UTC.
    return new Date(utcGuess).toISOString();
  }
  const seenAsUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour === 24 ? 0 : f.hour, f.minute, f.second);
  return new Date(utcGuess - (seenAsUtc - utcGuess)).toISOString();
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
  // Build an override instant from a wall-clock date + time in the selected
  // location's timezone (business timezone fallback), so overrides are consistent
  // with the availability engine's per-location timezone resolution.
  const toLocationUtcISO = (dateStr: string, timeStr: string) =>
    zonedWallTimeToUtcISO(
      dateStr,
      timeStr,
      locations.find((loc) => loc.id === selectedLocationId)?.timeZone || tenant?.timezone || "UTC",
    );
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

  // Exceptions-by-date calendar: which month is showing, and which date is selected for editing.
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedExceptionDate, setSelectedExceptionDate] = useState<string | null>(() =>
    new Date().toISOString().split("T")[0]
  );
  const [panelMode, setPanelMode] = useState<"custom_hours" | "closed">("custom_hours");
  const [panelStart, setPanelStart] = useState("09:00");
  const [panelEnd, setPanelEnd] = useState("17:00");
  const [panelReason, setPanelReason] = useState("");

  const latestLocationRef = useRef(selectedLocationId);
  latestLocationRef.current = selectedLocationId;
  // Tracks which location's data is currently loaded so we can tell a real
  // location switch (needs the full-page "Loading…" placeholder + cleared
  // state) apart from a background refresh after save/delete (reloadKey
  // bump), which should refetch quietly without unmounting the calendar
  // panel or resetting scroll position.
  const loadedLocationRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const locId = selectedLocationId;
    const isNewLocation = loadedLocationRef.current !== locId;
    if (isNewLocation) {
      setShifts(new Map());
      setOverrides([]);
      setLoading(true);
    }
    const doLoad = async () => {
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
        loadedLocationRef.current = locId;
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

  // Find the date-override (if any) whose range covers a given YYYY-MM-DD date.
  const findOverrideForDate = (dateStr: string): ProviderTimeOffEntry | null => {
    for (const ov of overrides) {
      const s = new Date(ov.startsAt).toISOString().split("T")[0];
      const e = new Date(ov.endsAt).toISOString().split("T")[0];
      if (dateStr >= s && dateStr <= e) return ov;
    }
    return null;
  };

  // Seed the exception-editor panel whenever the selected calendar date (or the
  // overrides loaded for it) changes, so it always reflects the current saved state.
  useEffect(() => {
    if (!selectedExceptionDate) return;
    const existing = findOverrideForDate(selectedExceptionDate);
    const weekdayIdx = (new Date(selectedExceptionDate + "T00:00:00").getDay() + 6) % 7;
    const regularShiftsForDay = shifts.get(weekdayIdx) || [];
    const regularIsOn = regularShiftsForDay.length > 0 && regularShiftsForDay[0].isActive;
    if (existing) {
      setPanelMode(existing.overrideType === "closed" ? "closed" : "custom_hours");
      setPanelStart(existing.startTime || regularShiftsForDay[0]?.startTime || "09:00");
      setPanelEnd(existing.endTime || regularShiftsForDay[0]?.endTime || "17:00");
      setPanelReason(existing.reason || "");
    } else {
      setPanelMode(regularIsOn ? "custom_hours" : "closed");
      setPanelStart(regularShiftsForDay[0]?.startTime || "09:00");
      setPanelEnd(regularShiftsForDay[0]?.endTime || "17:00");
      setPanelReason("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExceptionDate, overrides, shifts]);

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
        startsAt: toLocationUtcISO(addShiftDate, "00:00"),
        endsAt: toLocationUtcISO(addShiftDate, "23:59:59"),
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
        startsAt: toLocationUtcISO(newOverride.startDate, "00:00"),
        endsAt: toLocationUtcISO(newOverride.endDate, "23:59:59"),
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
      blockWindow?: { startTime: string; endTime: string } | null;
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
      // A "Block" on a regularly-working day blocks only the chosen window
      // (the availability engine blocks a closed override over [startsAt, endsAt]).
      // Times are interpreted in the location's timezone.
      const startsAt = payload.blockWindow
        ? toLocationUtcISO(start, normalizeTime(payload.blockWindow.startTime))
        : toLocationUtcISO(start, "00:00");
      const endsAt = payload.blockWindow
        ? toLocationUtcISO(end, normalizeTime(payload.blockWindow.endTime))
        : toLocationUtcISO(end, "23:59:59");
      const body: CreateProviderTimeOffRequest = {
        startsAt,
        endsAt,
        reason: payload.reason?.trim() || null,
        overrideType: payload.closedAllDay ? "closed" : "custom_hours",
        // For a windowed "Block" we also persist the window in start/end time so the
        // panel can show it back on reload; the engine blocks it via startsAt/endsAt.
        startTime: payload.blockWindow
          ? normalizeTime(payload.blockWindow.startTime)
          : payload.closedAllDay
            ? null
            : normalizeTime(payload.startTime),
        endTime: payload.blockWindow
          ? normalizeTime(payload.blockWindow.endTime)
          : payload.closedAllDay
            ? null
            : normalizeTime(payload.endTime),
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
        startsAt: toLocationUtcISO(payload.startDate, "00:00"),
        endsAt: toLocationUtcISO(payload.endDate, "23:59:59"),
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
    return <div className="cs-md-form"><p className="cs-settings-form-help">Loading work hours...</p></div>;
  }

  if (providerLocations.length === 0) {
    return <div className="cs-md-form"><p className="cs-settings-form-help">Assign this provider to at least one location first.</p></div>;
  }

  const selectedLocationName = selectedLocationId
    ? providerLocations.find((loc) => loc.id === selectedLocationId)?.name ?? null
    : null;
  const studioHours = summarizeBusinessHours(
    tenant?.settings?.businessHoursEnabled ? (tenant.settings.businessHours as any) : undefined
  );

  return (
    <div className="cs-md-form cs-wh-tab">
      <div className="cs-wh-layout">
        <div className="cs-wh-main">
          <div className="cs-svc-card cs-wh-card">
            <div className="cs-wh-editing-for">
              <span className="cs-wh-editing-for__label">Editing hours for</span>
              {providerLocations.length > 1 ? (
                <select
                  className="cs-wh-editing-for__select"
                  aria-label="Work hours location"
                  value={selectedLocationId || ""}
                  onChange={(e) => setSelectedLocationId(e.target.value || null)}>
                  <option value="">Both locations</option>
                  {providerLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              ) : (
                <strong className="cs-wh-editing-for__name">{providerLocations[0]?.name}</strong>
              )}
            </div>
            {providerLocations.length > 1 ? (
              <p className="cs-wh-helper-text">
                Hours are per location.{selectedLocationName ? ` ${selectedLocationName} keeps its own pattern.` : " Each location keeps its own pattern."}
              </p>
            ) : null}

            <h4 className="cs-wh-section-title">Regular weekly pattern</h4>
            <p className="cs-wh-helper-text">
              This repeats every week. Click a date on the calendar to set a one-off exception instead.
            </p>

            {shifts.size === 0 ? (
              <div className="cs-wh-empty-state">
                <div>
                  <div className="cs-wh-empty-state__title">No regular hours set yet</div>
                  <div className="cs-wh-empty-state__body">
                    Set the recurring weekly hours in one step, then adjust individual days as needed.
                  </div>
                </div>
                <button type="button" className="cs-svc-save-btn" onClick={() => setRegularHoursOpen(true)}>
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
                    <div className="cs-wh-day-list">
                      {WEEKDAY_LABELS.map((label, wd) => {
                        const rawShifts = shifts.get(wd) || [];
                        const isOn = rawShifts.length > 0 && rawShifts[0].isActive;
                        const dayWarning = warnings.find((w) => w.weekday === wd) || null;
                        const badgeLabel = dayWarning ? warningBadgeLabel(dayWarning, rawShifts) : null;
                        const d = new Date(weekStart);
                        d.setDate(weekStart.getDate() + wd);
                        const dateStr = d.toISOString().split("T")[0];
                        return (
                          <div key={wd} className={`cs-wh-day-row${dayWarning ? " cs-wh-day-row--warn" : ""}`}>
                            <button type="button"
                              className={`cs-wh-toggle${isOn ? " is-on" : ""}`}
                              role="switch" aria-checked={isOn}
                              aria-label={`${isOn ? "Turn off" : "Turn on"} ${label}`}
                              onClick={() => toggleDay(wd)}>
                              <span className="cs-wh-toggle__knob" />
                            </button>
                            <button type="button" className="cs-wh-day-row__label"
                              onClick={() => setDayEditor({ dateStr, weekday: wd })}>
                              {label}
                            </button>
                            {!isOn ? (
                              <span className="cs-wh-day-row__status">Not working</span>
                            ) : (
                              <div className="cs-wh-day-row__shifts">
                                {rawShifts.map((s, i) => (
                                  <div className="cs-wh-time-range" key={i}>
                                    <input type="time" className="cs-wh-time-input" value={s.startTime}
                                      aria-label={`${label} start time`}
                                      onChange={(e) => updateShift(wd, i, { startTime: e.target.value })} />
                                    <span className="cs-wh-time-sep">to</span>
                                    <input type="time" className="cs-wh-time-input" value={s.endTime}
                                      aria-label={`${label} end time`}
                                      onChange={(e) => updateShift(wd, i, { endTime: e.target.value })} />
                                    {rawShifts.length > 1 ? (
                                      <button type="button" className="cs-wh-time-remove"
                                        onClick={() => removeShift(wd, i)} aria-label="Remove shift">×</button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                            {badgeLabel ? <span className="cs-wh-late-badge">{badgeLabel}</span> : null}
                            {isOn ? (
                              <button type="button" className="cs-wh-split-link" onClick={() => addShift(wd)}>
                                + Split shift
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                <div className="cs-wh-week-summary">
                  <span className="cs-wh-week-summary__text">
                    {summary.hoursPerWeek} hours a week · {warnings.length === 0 ? "within studio hours" : "needs review"}
                  </span>
                  {providerLocations.length === 2 && selectedLocationId ? (
                    <button type="button" className="cs-svc-text-btn" disabled={submitting}
                      onClick={() => {
                        const other = providerLocations.find((l) => l.id !== selectedLocationId);
                        if (other) void handleCopyToLocation(other.id);
                      }}>
                      Copy to {providerLocations.find((l) => l.id !== selectedLocationId)?.name}
                    </button>
                  ) : null}
                </div>
                <button type="button" className="cs-svc-duplicate-btn"
                  onClick={() => setRegularHoursOpen(true)} disabled={submitting}
                  style={{ alignSelf: "flex-start" }}>
                  Edit regular hours
                </button>
              </>
            )}
          </div>
        </div>

        <aside className="cs-wh-side">
          <div className="cs-wh-side-card cs-wh-exceptions-card">
            <div className="cs-wh-exceptions-header">
              <div className="cs-wh-side-card__title">Exceptions by date</div>
              <button type="button" className="cs-svc-text-btn" onClick={() => setTimeOffOpen(true)} disabled={submitting}>
                + Block a range
              </button>
            </div>
            {(() => {
              const year = calendarMonth.getFullYear();
              const month = calendarMonth.getMonth();
              const monthLabel = calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
              const firstOfMonth = new Date(year, month, 1);
              const startOffset = firstOfMonth.getDay(); // 0 = Sunday
              const daysInMonth = new Date(year, month + 1, 0).getDate();
              const todayStr = new Date().toISOString().split("T")[0];
              const cells: Array<{ dateStr: string; day: number } | null> = [];
              for (let i = 0; i < startOffset; i++) cells.push(null);
              for (let day = 1; day <= daysInMonth; day++) {
                const d = new Date(year, month, day);
                cells.push({ dateStr: d.toISOString().split("T")[0], day });
              }
              return (
                <>
                  <div className="cs-wh-cal-nav">
                    <button type="button" className="cs-wh-cal-nav__btn" aria-label="Previous month"
                      onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
                      ‹
                    </button>
                    <span className="cs-wh-cal-nav__label">{monthLabel}</span>
                    <button type="button" className="cs-wh-cal-nav__btn" aria-label="Next month"
                      onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
                      ›
                    </button>
                  </div>
                  <div className="cs-wh-cal-grid">
                    {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                      <span key={i} className="cs-wh-cal-dow">{d}</span>
                    ))}
                    {cells.map((cell, i) => {
                      if (!cell) return <span key={`blank-${i}`} className="cs-wh-cal-day cs-wh-cal-day--blank" />;
                      const ov = findOverrideForDate(cell.dateStr);
                      const isTimeOff = ov?.overrideType === "closed";
                      const isCustom = ov?.overrideType === "custom_hours";
                      const isToday = cell.dateStr === todayStr;
                      const isSelected = cell.dateStr === selectedExceptionDate;
                      return (
                        <button type="button" key={cell.dateStr}
                          className={`cs-wh-cal-day${isTimeOff ? " cs-wh-cal-day--timeoff" : ""}${isCustom ? " cs-wh-cal-day--custom" : ""}${isToday ? " cs-wh-cal-day--today" : ""}${isSelected ? " cs-wh-cal-day--selected" : ""}`}
                          onClick={() => setSelectedExceptionDate(cell.dateStr)}
                          aria-label={`Edit hours for ${cell.dateStr}`}>
                          {cell.day}
                        </button>
                      );
                    })}
                  </div>
                  <div className="cs-wh-cal-legend">
                    <span className="cs-wh-cal-legend__item"><i className="cs-wh-cal-legend__swatch cs-wh-cal-legend__swatch--timeoff" />Time off</span>
                    <span className="cs-wh-cal-legend__item"><i className="cs-wh-cal-legend__swatch cs-wh-cal-legend__swatch--custom" />Custom hours</span>
                  </div>
                </>
              );
            })()}

            {selectedExceptionDate ? (() => {
              const dateObj = new Date(selectedExceptionDate + "T00:00:00");
              const weekdayIdx = (dateObj.getDay() + 6) % 7;
              const regularShiftsForDay = shifts.get(weekdayIdx) || [];
              const regularIsOn = regularShiftsForDay.length > 0 && regularShiftsForDay[0].isActive;
              const regularPatternLabel = regularIsOn
                ? `${regularShiftsForDay[0].startTime} – ${regularShiftsForDay[0].endTime}`
                : "Not working";
              const existing = findOverrideForDate(selectedExceptionDate);
              const dateLabel = dateObj.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
              return (
                <div className="cs-wh-exception-panel">
                  <div className="cs-wh-exception-panel__header">
                    <div className="cs-wh-exception-panel__title">{dateLabel}</div>
                    <button type="button" className="cs-wh-exception-panel__close"
                      onClick={() => setSelectedExceptionDate(null)} aria-label="Close">×</button>
                  </div>
                  <p className="cs-wh-exception-panel__pattern">Regular pattern: {regularPatternLabel}</p>

                  <div className="cs-wh-seg-toggle" role="group" aria-label="Exception type">
                    <button type="button"
                      className={`cs-wh-seg-toggle__btn${panelMode === "custom_hours" ? " is-active" : ""}`}
                      onClick={() => setPanelMode("custom_hours")}>
                      Custom hours
                    </button>
                    <button type="button"
                      className={`cs-wh-seg-toggle__btn${panelMode === "closed" ? " is-active" : ""}`}
                      onClick={() => setPanelMode("closed")}>
                      {regularIsOn ? "Block" : "Not working"}
                    </button>
                  </div>

                  {panelMode === "custom_hours" || (panelMode === "closed" && regularIsOn) ? (
                    <div className="cs-wh-time-range cs-wh-exception-panel__times">
                      <input type="time" className="cs-wh-time-input" value={panelStart}
                        aria-label={panelMode === "closed" ? "Block start time" : "Exception start time"}
                        onChange={(e) => setPanelStart(e.target.value)} />
                      <span className="cs-wh-time-sep">to</span>
                      <input type="time" className="cs-wh-time-input" value={panelEnd}
                        aria-label={panelMode === "closed" ? "Block end time" : "Exception end time"}
                        onChange={(e) => setPanelEnd(e.target.value)} />
                    </div>
                  ) : null}

                  <label className="cs-wh-exception-panel__reason-label" htmlFor="wh-exception-reason">
                    Reason — shown to staff, optional
                  </label>
                  <input id="wh-exception-reason" type="text" className="cs-svc-input"
                    value={panelReason} onChange={(e) => setPanelReason(e.target.value)}
                    placeholder="e.g. Training session" />

                  <p className="cs-wh-exception-panel__note">
                    This date only. {regularIsOn
                      ? `Every other ${WEEKDAY_LABELS[weekdayIdx]} keeps the regular ${regularPatternLabel} pattern.`
                      : `${WEEKDAY_LABELS[weekdayIdx]}s are normally not working.`}
                  </p>

                  <div className="cs-wh-exception-panel__actions">
                    {existing ? (
                      <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" disabled={submitting}
                        onClick={() => handleDeleteOverride(existing.id)}>
                        Remove exception
                      </button>
                    ) : null}
                    <button type="button" className="cs-svc-save-btn" disabled={submitting}
                      onClick={() => handleSaveDateOverride(selectedExceptionDate, {
                        closedAllDay: panelMode === "closed",
                        startTime: panelStart,
                        endTime: panelEnd,
                        blockWindow:
                          panelMode === "closed" && regularIsOn
                            ? { startTime: panelStart, endTime: panelEnd }
                            : null,
                        blockedServiceIds: existing?.blockedServiceIds || [],
                        existingOverrideId: existing?.id || null,
                        reason: panelReason,
                      })}>
                      Save this date
                    </button>
                  </div>
                </div>
              );
            })() : null}
          </div>

          <div className="cs-wh-side-card">
            <div className="cs-wh-side-card__title">Studio hours, for reference</div>
            {studioHours.length > 0 ? (
              <div className="cs-wh-side-hours">
                {studioHours.map((g) => (
                  <div key={g.label} className="cs-wh-side-hours-row">
                    <span className="cs-wh-side-hours-row__label">{g.label}</span>
                    <span className="cs-wh-side-hours-row__value">{g.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="cs-wh-side-empty">No business hours set for this tenant yet.</p>
            )}
          </div>

          <div className="cs-wh-side-card">
            <div className="cs-wh-side-card__title">This week at a glance</div>
            <div className="cs-wh-stat-rows">
              <div className="cs-wh-stat-row">
                <span className="cs-wh-stat-row__label">Scheduled hours</span>
                <span className="cs-wh-stat-row__value">{summary.hoursPerWeek}</span>
              </div>
              <div className="cs-wh-stat-row">
                <span className="cs-wh-stat-row__label">Days working</span>
                <span className="cs-wh-stat-row__value">{summary.workingDays}</span>
              </div>
            </div>
          </div>

          {warnings.length > 0 ? (
            <div className="cs-wh-warning-callout">
              {warnings.map((w, i) => (
                <p key={i} className="cs-wh-warning-callout__text">{w.message}</p>
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
    <div className="cs-modal" role="dialog" aria-label={`Edit ${dateLabel}`} onClick={onClose}>
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
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px" }}>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#1F1612", textTransform: "uppercase", letterSpacing: "0.5px" }}>Shifts</div>
              {localShifts.length > 0 ? (
                <button type="button" className="cs-svc-text-btn"
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
                    <input type="text" className="cs-svc-input"
                      style={{ width: "88px", textAlign: "center" }}
                      value={s.startTime} placeholder="09:00"
                      aria-label={`Shift ${i + 1} start`}
                      onChange={(e) => updateLocalShift(i, { startTime: e.target.value })} />
                    <span style={{ color: "#8B7960", fontSize: "12px" }}>→</span>
                    <input type="text" className="cs-svc-input"
                      style={{ width: "88px", textAlign: "center" }}
                      value={s.endTime} placeholder="17:00"
                      aria-label={`Shift ${i + 1} end`}
                      onChange={(e) => updateLocalShift(i, { endTime: e.target.value })} />
                    <button type="button" className="cs-svc-text-btn"
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
                  <input type="date" className="cs-svc-input" style={{ width: "140px" }}
                    value={blockStartDate}
                    aria-label="Block start date"
                    onChange={(e) => setBlockStartDate(e.target.value)} />
                  <span style={{ color: "#8B7960", fontSize: "12px" }}>to</span>
                  <input type="date" className="cs-svc-input" style={{ width: "140px" }}
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
                      <input type="text" className="cs-svc-input"
                        style={{ width: "80px", textAlign: "center" }}
                        value={blockTimeStart} placeholder="09:00"
                        aria-label="Block time start"
                        onChange={(e) => setBlockTimeStart(e.target.value)} />
                      <span style={{ color: "#8B7960", fontSize: "12px" }}>to</span>
                      <input type="text" className="cs-svc-input"
                        style={{ width: "80px", textAlign: "center" }}
                        value={blockTimeEnd} placeholder="17:00"
                        aria-label="Block time end"
                        onChange={(e) => setBlockTimeEnd(e.target.value)} />
                    </div>
                  ) : null}
                </div>
                <input type="text" className="cs-svc-input"
                  style={{ width: "100%", marginBottom: "8px" }}
                  value={blockReason} placeholder="Reason (optional, e.g. Vacation)"
                  onChange={(e) => setBlockReason(e.target.value)} />
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button type="button" className="cs-svc-save-btn"
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
                  <button type="button" className="cs-svc-text-btn"
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
              <button type="button" className="cs-svc-text-btn"
                onClick={() => { void onClearOverride(dateOverride.id); }}
                style={{ marginRight: "auto", color: "#8A2E1E" }}
                disabled={submitting}>Clear override</button>
            ) : null}
            <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>Cancel</button>
            {!showBlockForm ? (
              <button type="button" className="cs-svc-save-btn"
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
    <div className="cs-modal" role="dialog" aria-label="Block time off" onClick={onClose}>
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
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <label style={{ fontSize: "12px", color: "#4A3D30" }}>
              Start date
              <input type="date" className="cs-svc-input"
                style={{ width: "100%", marginTop: "4px" }}
                value={startDate}
                aria-label="Time off start date"
                onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label style={{ fontSize: "12px", color: "#4A3D30" }}>
              End date
              <input type="date" className="cs-svc-input"
                style={{ width: "100%", marginTop: "4px" }}
                value={endDate}
                aria-label="Time off end date"
                onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <label style={{ fontSize: "12px", color: "#4A3D30" }}>
              Reason (optional)
              <input type="text" className="cs-svc-input"
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
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>Cancel</button>
          <button type="button" className="cs-svc-save-btn"
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

  return (
    <div className="cs-modal" role="dialog" aria-label="Set regular hours" onClick={onClose}>
      <div className="cs-wh-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="cs-wh-drawer__header">
          <div>
            <div className="cs-wh-drawer__eyebrow">Recurring template</div>
            <div className="cs-wh-drawer__title">Set regular hours</div>
            <div className="cs-wh-drawer__sub">
              {activeCount} of 7 days · {totalHours.toFixed(1)} hrs / week
            </div>
          </div>
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="cs-wh-drawer__body">
          <div>
            <div className="cs-wh-drawer__section-label">Quick start</div>
            <div className="cs-wh-drawer__presets">
              <button type="button" className="cs-wh-drawer__preset"
                onClick={() => applyPreset("weekdays9to5")}>Weekdays 9–5</button>
              <button type="button" className="cs-wh-drawer__preset"
                onClick={() => applyPreset("weekdays10to6")}>Weekdays 10–6</button>
              <button type="button" className="cs-wh-drawer__preset"
                onClick={() => applyPreset("everyday10to6")}>Every day 10–6</button>
              <button type="button" className="cs-wh-drawer__preset cs-wh-drawer__preset--danger"
                onClick={() => applyPreset("clear")}>Clear all</button>
            </div>
          </div>

          <div className="cs-wh-drawer__days">
            {rows.map((row) => {
              const label = WEEKDAY_LABELS[row.weekday];
              return (
                <div key={row.weekday}
                  className={`cs-wh-drawer__day${row.isActive ? "" : " cs-wh-drawer__day--off"}`}>
                  <input type="checkbox" className="cs-wh-drawer__switch" role="switch"
                    checked={row.isActive}
                    onChange={() => toggleActive(row.weekday)}
                    aria-label={`${label} active`} />
                  <span className="cs-wh-drawer__day-name">{label}</span>
                  <div className="cs-wh-drawer__shifts">
                    {row.isActive ? (
                      row.shifts.map((s, i) => (
                        <div key={i} className="cs-wh-drawer__shift">
                          <input type="text" className="cs-wh-drawer__time"
                            value={s.startTime} placeholder="09:00"
                            aria-label={`${label} shift ${i + 1} start`}
                            onChange={(e) => setShiftTime(row.weekday, i, { startTime: e.target.value })} />
                          <span className="cs-wh-drawer__to">to</span>
                          <input type="text" className="cs-wh-drawer__time"
                            value={s.endTime} placeholder="17:00"
                            aria-label={`${label} shift ${i + 1} end`}
                            onChange={(e) => setShiftTime(row.weekday, i, { endTime: e.target.value })} />
                          <button type="button" className="cs-wh-drawer__icon-btn"
                            onClick={() => removeShift(row.weekday, i)}
                            aria-label={`Remove ${label} shift ${i + 1}`}>×</button>
                          {i === row.shifts.length - 1 ? (
                            <button type="button" className="cs-wh-drawer__add"
                              onClick={() => addShift(row.weekday)}>+ Split shift</button>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <span className="cs-wh-drawer__closed">Not working</span>
                    )}
                  </div>
                  {row.isActive ? (
                    <div className="cs-wh-drawer__copy">
                      {row.weekday <= 4 ? (
                        <button type="button" className="cs-wh-drawer__copy-btn"
                          onClick={() => copyToWeekdays(row.weekday)}
                          title="Copy to Mon–Fri">→ weekdays</button>
                      ) : null}
                      <button type="button" className="cs-wh-drawer__copy-btn"
                        onClick={() => copyToAll(row.weekday)}
                        title="Copy to all 7 days">→ all</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {saveError ? (
            <div role="alert" className="cs-wh-drawer__error">{saveError}</div>
          ) : null}

          <div className="cs-wh-drawer__note">
            <strong>Note:</strong> Saving replaces the entire weekly template for the selected location.
            One-off date overrides and time-off blocks are preserved.
          </div>
        </div>

        <footer className="cs-wh-drawer__footer">
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>Cancel</button>
          <button type="button" className="cs-svc-save-btn"
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
    <div className="cs-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`cs-modal__panel${wide ? " cs-modal__panel--wide" : ""}`}>
        <header className="cs-modal__header">
          <h4>{title}</h4>
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose} aria-label="Close">
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
      <form className="cs-modal__form" onSubmit={submit}>
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
          <small className="cs-settings-form-help">Minimum 8 characters. Share securely.</small>
        </label>
        <label className="cs-settings-toggle">
          <input
            type="checkbox"
            checked={form.isProvider}
            onChange={(event) => setForm({ ...form, isProvider: event.target.checked })}
          />
          <span>This person is a service provider</span>
        </label>

        {form.isProvider ? (
          <>
            <fieldset className="cs-staff-fieldset">
              <legend>Locations</legend>
              {locations.length === 0 ? (
                <p className="cs-settings-form-help">No locations configured.</p>
              ) : (
                <div className="cs-staff-checkbox-grid">
                  {locations.map((loc) => (
                    <label key={loc.id} className="cs-settings-toggle">
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
            <fieldset className="cs-staff-fieldset">
              <legend>Services performed</legend>
              {services.length === 0 ? (
                <p className="cs-settings-form-help">No services configured.</p>
              ) : (
                <div className="cs-staff-checkbox-grid">
                  {services.map((svc) => (
                    <label key={svc.id} className="cs-settings-toggle">
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
            <label className="cs-settings-toggle">
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
          <p role="alert" className="cs-settings-error">
            {error}
          </p>
        ) : null}
        <div className="cs-modal__actions">
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={disabled}>
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
      <form className="cs-modal__form" onSubmit={submit}>
        <fieldset className="cs-staff-fieldset">
          <legend>Locations</legend>
          <div className="cs-staff-checkbox-grid">
            {locations.map((loc) => (
              <label key={loc.id} className="cs-settings-toggle">
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
        <fieldset className="cs-staff-fieldset">
          <legend>Services performed</legend>
          <div className="cs-staff-checkbox-grid">
            {services.map((svc) => (
              <label key={svc.id} className="cs-settings-toggle">
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
        <label className="cs-settings-toggle">
          <input
            type="checkbox"
            checked={isBookableOnline}
            onChange={(event) => setIsBookableOnline(event.target.checked)}
          />
          <span>Bookable online</span>
        </label>

        {error ? (
          <p role="alert" className="cs-settings-error">
            {error}
          </p>
        ) : null}
        <div className="cs-modal__actions">
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={submitting}>
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
      <form className="cs-modal__form" onSubmit={submit}>
        <label>
          <span>New password</span>
          <input
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
          <small className="cs-settings-form-help">
            Minimum 8 characters. Share securely with the user.
          </small>
        </label>
        {error ? (
          <p role="alert" className="cs-settings-error">
            {error}
          </p>
        ) : null}
        <div className="cs-modal__actions">
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="cs-btn cs-btn--primary cs-btn--sm"
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
    <div className={`cs-comp-mode-card${selected ? " cs-comp-mode-card--selected" : ""}`}>
      <label className="cs-comp-mode-card__head">
        <input
          type="radio"
          name="compensationMode"
          value={value}
          checked={selected}
          onChange={() => onSelect(value)}
          className="cs-comp-mode-card__radio-input"
        />
        <span className="cs-comp-mode-card__radio" aria-hidden="true" />
        <span className="cs-comp-mode-card__title">{title}</span>
      </label>
      <p className="cs-comp-mode-card__desc">{desc}</p>
      {selected && children ? <div className="cs-comp-mode-card__body">{children}</div> : null}
      {!selected && preview ? <div className="cs-comp-mode-card__preview">{preview}</div> : null}
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
  const [productMode, setProductMode] = useState<"percent" | "flat" | "none">(
    provider.compensationProductPercentBp != null
      ? "percent"
      : provider.compensationProductFlatCents != null
        ? "flat"
        : "none",
  );
  const [productFlat, setProductFlat] = useState(
    provider.compensationProductFlatCents != null
      ? (provider.compensationProductFlatCents / 100).toFixed(2)
      : "",
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
    setProductMode(
      provider.compensationProductPercentBp != null
        ? "percent"
        : provider.compensationProductFlatCents != null
          ? "flat"
          : "none",
    );
    setProductFlat(
      provider.compensationProductFlatCents != null
        ? (provider.compensationProductFlatCents / 100).toFixed(2)
        : "",
    );
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
      // Product commission is an add-on bonus that stacks on any primary mode.
      // Send both fields so switching modes clears the other (0 → null server-side).
      body.compensationProductPercentBp = productMode === "percent" && productPercent
        ? Math.round(Number(productPercent) * 100)
        : 0;
      body.compensationProductFlatCents = productMode === "flat" && productFlat
        ? Math.round(Number(productFlat) * 100)
        : 0;
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
    <span className="cs-comp-tier-preview">
      {slidingTiers.map((tier, i) => (
        <span key={i} className="cs-comp-tier-chip cs-comp-tier-chip--readonly">
          {i === slidingTiers.length - 1 && tier.upToAmountCents === 0
            ? `above · ${tier.percentBp / 100}%`
            : `to $${Math.round(tier.upToAmountCents / 100) / 1000}k · ${tier.percentBp / 100}%`}
        </span>
      ))}
    </span>
  ) : null;

  return (
    <div className="cs-md-form">
      {status ? (
        <div className="cs-banner" role="status">
          {status}
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={() => setStatus(null)}>Dismiss</button>
        </div>
      ) : null}

      <p className="cs-comp-lead">
        Pick one model. Per-treatment overrides on the Services tab always win over what's set here.
      </p>

      <div className="cs-comp-mode-list">
        <ModeCard
          value="service_percent"
          title="Percent of service"
          desc="A flat share of every treatment they perform."
          mode={mode}
          onSelect={setMode}
        >
          <div className="cs-comp-value-row">
            <input
              className="cs-comp-value-input"
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={servicePercent}
              onChange={(e) => setServicePercent(e.target.value)}
              placeholder="0"
            />
            <span className="cs-comp-value-suffix">%</span>
            {servicePercentHelper ? <span className="cs-comp-helper">{servicePercentHelper}</span> : null}
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
          <div className="cs-comp-tier-list">
            {slidingTiers.map((tier, i) => (
              <div key={i} className="cs-comp-tier-chip">
                <span className="cs-comp-tier-chip__label">to $</span>
                <input
                  className="cs-comp-tier-chip__input"
                  type="number"
                  min={0}
                  step="1"
                  value={Math.round(tier.upToAmountCents / 100)}
                  onChange={(e) => updateSlidingTier(i, "upToAmountCents", String(Number(e.target.value) * 100))}
                />
                <span className="cs-comp-tier-chip__label">·</span>
                <input
                  className="cs-comp-tier-chip__input cs-comp-tier-chip__input--pct"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={tier.percentBp / 100}
                  onChange={(e) => updateSlidingTier(i, "percentBp", String(Number(e.target.value) * 100))}
                />
                <span className="cs-comp-tier-chip__label">%</span>
                <button
                  type="button"
                  className="cs-comp-tier-chip__remove"
                  onClick={() => removeSlidingTier(i)}
                  aria-label="Remove tier"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="cs-comp-tier-add" onClick={addSlidingTier}>
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
          <div className="cs-comp-value-row">
            <span className="cs-comp-value-prefix">$</span>
            <input
              className="cs-comp-value-input"
              type="number"
              min={0}
              step="0.01"
              value={flatPerBooking}
              onChange={(e) => setFlatPerBooking(e.target.value)}
              placeholder="0.00"
            />
            <span className="cs-comp-value-suffix">per booking</span>
          </div>
        </ModeCard>

        <ModeCard
          value="hourly"
          title="Hourly rate"
          desc="Paid on hours worked, not on what they serve."
          mode={mode}
          onSelect={setMode}
        >
          <div className="cs-comp-value-row">
            <span className="cs-comp-value-prefix">$</span>
            <input
              className="cs-comp-value-input"
              type="number"
              min={0}
              step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder="0.00"
            />
            <span className="cs-comp-value-suffix">/ hr</span>
          </div>
        </ModeCard>
      </div>

      <div className="cs-comp-section">
        <div className="cs-comp-section__head">
          <h5 className="cs-comp-section__title">Product commission</h5>
          <span className="cs-comp-section__note">Set separately from treatments</span>
        </div>
        <p className="cs-comp-section__desc">
          What they earn on retail sold at checkout — serums, SPF, aftercare kits. Applies to every product line unless one is excluded below.
        </p>
        <div className="cs-comp-product-card">
          <div className="cs-seg" role="group" aria-label="Product commission mode">
            <button type="button" aria-pressed={productMode === "percent"} onClick={() => setProductMode("percent")}>
              Percent
            </button>
            <button type="button" aria-pressed={productMode === "flat"} onClick={() => setProductMode("flat")}>
              Flat per item
            </button>
            <button
              type="button"
              aria-pressed={productMode === "none"}
              onClick={() => {
                setProductMode("none");
                setProductPercent("");
                setProductFlat("");
              }}
            >
              None
            </button>
          </div>
          {productMode === "percent" ? (
            <div className="cs-comp-value-row" style={{ marginTop: "12px" }}>
              <input
                className="cs-comp-value-input"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={productPercent}
                onChange={(e) => setProductPercent(e.target.value)}
                placeholder="0"
              />
              <span className="cs-comp-value-suffix">% of product sales</span>
            </div>
          ) : productMode === "flat" ? (
            <div className="cs-comp-value-row" style={{ marginTop: "12px" }}>
              <span className="cs-comp-value-prefix">$</span>
              <input
                className="cs-comp-value-input"
                type="number"
                min={0}
                step="0.01"
                value={productFlat}
                onChange={(e) => setProductFlat(e.target.value)}
                placeholder="0.00"
              />
              <span className="cs-comp-value-suffix">per item sold</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="cs-comp-summary">
        <h5 className="cs-comp-summary__title">{earnings ? `${earnings.monthLabel} so far` : "This month so far"}</h5>
        {earningsError ? (
          <p className="cs-comp-summary__error">{earningsError}</p>
        ) : earnings ? (
          <div className="cs-comp-summary__body">
            <div className="cs-comp-summary__breakdown">
              <p>{formatCentsWhole(earnings.treatmentRevenueCents)} in treatments · {formatCentsWhole(earnings.retailRevenueCents)} in retail{overrideCount > 0 ? ` · ${overrideCount} treatment${overrideCount === 1 ? "" : "s"} on an override rate` : ""}</p>
            </div>
            <div className="cs-comp-summary__total">
              <span className="cs-comp-summary__total-amount">{formatCentsWhole(earnings.totalPayoutCents)}</span>
              <span className="cs-comp-summary__total-split">
                {formatCentsWhole(earnings.servicePayoutCents)} service + {formatCentsWhole(earnings.productPayoutCents)} product
              </span>
            </div>
          </div>
        ) : (
          <p className="cs-comp-summary__loading">Loading…</p>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "18px" }}>
        <button type="button" className="cs-btn cs-btn--primary cs-btn--sm" onClick={handleSave} disabled={saving}>
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
    return <p className="cs-settings-form-help">Loading permissions…</p>;
  }
  if (loadState.kind === "error") {
    return <p className="cs-error">{loadState.message}</p>;
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
      <div className="cs-perm">
        <div className="cs-perm-banner">
          <div className="cs-perm-banner__text">
            <strong>Owners have full access</strong>
            <p className="cs-perm-banner__sub">Every permission is granted automatically. Customize access on managers, providers, and staff instead.</p>
          </div>
        </div>

        <div className="cs-perm-grid-cols">
          <span>Permission</span>
          <span>Owner default</span>
          <span>For {firstName}</span>
        </div>

        {groupAll(catalog.permissions).map(([category, defs]) => (
          <section key={category} className="cs-perm-group">
            <p className="cs-perm-group__label">{category}</p>
            <div className="cs-perm-group__list">
              {defs.map((def) => (
                <div key={def.key} className="cs-perm-row">
                  <div className="cs-perm-row__label">
                    <strong>{overrideLabel(def.key, def.label)}</strong>
                    <span className="cs-perm-row__key">{def.key}</span>
                  </div>
                  <div className="cs-perm-row__default">
                    <span className="cs-perm-row__count-label">Allowed</span>
                  </div>
                  <div className="cs-perm-row__control">
                    <div className="cs-perm-seg" role="radiogroup" aria-label={def.label}>
                      <button type="button" className="cs-perm-seg__btn" disabled>Default</button>
                      <button type="button" className="cs-perm-seg__btn" aria-pressed="true" disabled>Allow</button>
                      <button type="button" className="cs-perm-seg__btn" disabled>Deny</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <div className="cs-perm-summary">
          <p className="cs-perm-summary__text">{firstName} is an Owner — all permissions are always allowed and cannot be restricted from this screen.</p>
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
    <div className="cs-perm">
      {status ? (
        <div className="cs-banner" role="alert">
          {status}
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={() => setStatus(null)}>Dismiss</button>
        </div>
      ) : null}

      <div className="cs-perm-banner">
        <div className="cs-perm-banner__text">
          <strong>{roleLabel} defaults apply</strong>
          <p className="cs-perm-banner__sub">Change the role on Details to move the whole baseline.</p>
        </div>
        <button
          type="button"
          className="cs-perm-banner__reset"
          onClick={handleReset}
          disabled={saving || overrideCount === 0}
        >
          Reset overrides
        </button>
      </div>

      <div className="cs-perm-grid-cols">
        <span>Permission</span>
        <span>{roleLabel} default</span>
        <span>For {firstName}</span>
      </div>

      {groupAll(catalog.permissions).map(([category, defs]) => (
        <section key={category} className="cs-perm-group">
          <p className="cs-perm-group__label">{category}</p>
          <div className="cs-perm-group__list">
            {defs.map((def) => {
              const current: PermissionTriState = overrides[def.key] ?? "inherit";
              const inheritedAllowed = roleDefaults.has(def.key);
              const overridden = savedOverrides[def.key] != null;
              return (
                <div key={def.key} className={`cs-perm-row${overridden ? " cs-perm-row--overridden" : ""}`}>
                  <div className="cs-perm-row__label">
                    <strong>{overrideLabel(def.key, def.label)}</strong>
                    <span className="cs-perm-row__key">{def.key}</span>
                  </div>
                  <div className="cs-perm-row__default">
                    <span className="cs-perm-row__count-label">{inheritedAllowed ? "Allowed" : "Denied"}</span>
                  </div>
                  <div className="cs-perm-row__control">
                    <div className="cs-perm-seg" role="radiogroup" aria-label={def.label}>
                      {(["inherit", "allow", "deny"] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={`cs-perm-seg__btn${current === opt ? ` cs-perm-seg__btn--${opt}` : ""}`}
                          aria-pressed={current === opt}
                          onClick={() => handleChange(def.key, opt)}
                        >
                          {opt === "inherit" ? "Default" : opt === "allow" ? "Allow" : "Deny"}
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

      <div className="cs-perm-summary">
        {dirty ? (
          <p className="cs-perm-summary__text">
            {saving ? "Saving changes…" : "Saving your changes…"}
          </p>
        ) : savedCount > 0 && summaryDef ? (
          <p className="cs-perm-summary__text">
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
          <p className="cs-perm-summary__text">No overrides active for {firstName} — they follow the {roleLabel} defaults.</p>
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
