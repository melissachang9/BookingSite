import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import type {
  AuthenticatedUser,
  CategoryFaqItem,
  CategoryFeaturedLabel,
  CreateServiceCategoryRequest,
  CreateServiceRequest,
  FormSummaryResponse,
  LocationSummary,
  ProviderServiceVariantEntry,
  ProviderSummary,
  ReorderRequest,
  ReplaceProviderServiceVariantsRequest,
  ResourceSummary,
  ServiceAddOn,
  ServiceCategorySummary,
  ServiceSummary,
  SocialProof,
  TenantSummary,
  UpdateServiceCategoryRequest,
  UpdateServiceRequest,
  ValueStackItem,
} from "@booking/shared-types";

import { categoryColor } from "./category-colors";
import { effectiveDepositCents } from "./online-booking";
import { formatMoneyShort } from "./format-money";
import { OverflowMenu } from "./overflow-menu";
import { uploadImageFile } from "./upload-image";
import { platformApi } from "./platform-api";

type RouteDefinitionLike = {
  title: string;
  eyebrow: string;
  description: string;
};

const storefrontBaseUrl =
  import.meta.env.VITE_PUBLIC_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}

function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function VariantField({
  label,
  defaultText,
  isOverridden,
  onReset,
  canManage,
  children,
}: {
  label: string;
  defaultText: string;
  isOverridden: boolean;
  onReset: () => void;
  canManage: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`cs-service-variant-row${
        isOverridden ? " cs-service-variant-row--overridden" : ""
      }`}
    >
      <div className="cs-service-variant-row__label">
        <span>{label}</span>
        <span className="cs-service-variant-row__default">{defaultText}</span>
      </div>
      <div className="cs-service-variant-row__control">
        <div className="cs-service-variant-row__input">{children}</div>
        {isOverridden && canManage ? (
          <button
            type="button"
            className="cs-btn cs-btn--ghost cs-btn--sm cs-service-variant-row__reset"
            onClick={onReset}
          >
            Reset to default
          </button>
        ) : null}
      </div>
    </div>
  );
}

function parseMoneyInput(value: string): number | null {
  const normalizedValue = value.replace(/[$,\s]/g, "");
  if (!normalizedValue) return null;
  const parsedValue = Number(normalizedValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) return null;
  return Math.round(parsedValue * 100);
}

const AVATAR_PLACEHOLDER_COLORS = ["#DFEBE1", "#DCE7F6", "#F6DFCE", "#EAE1F6", "#F6E0E3"];

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}`.toUpperCase();
}

function avatarColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PLACEHOLDER_COLORS[hash % AVATAR_PLACEHOLDER_COLORS.length]!;
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

const UNCATEGORIZED_KEY = "__uncategorized";

type SelectionState =
  | { kind: "none" }
  | { kind: "service"; serviceId: string }
  | { kind: "category"; categoryId: string };

type ServiceTabKey = "details" | "staff" | "resources" | "customizations" | "onlineBooking";

type DragState =
  | { kind: "none" }
  | { kind: "service"; serviceId: string; fromCategoryKey: string }
  | { kind: "category"; categoryId: string };

type DragOverTarget =
  | { kind: "none" }
  | { kind: "category"; categoryId: string }
  | { kind: "service"; serviceId: string }
  | { kind: "group"; groupKey: string };

export function ServicesPage({
  definition,
  currentUser,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser | null;
}) {
  const tenantSlug = currentUser?.tenantSlug ?? "";
  const canManage =
    currentUser !== null && hasPermission(currentUser, "services.manage");
  const canView =
    currentUser !== null && hasPermission(currentUser, "services.view");
  // Required forms and new resources are managed from settings, which needs
  // settings access.
  const canManageSettings =
    currentUser !== null && hasPermission(currentUser, "settings.manage");

  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [categories, setCategories] = useState<ServiceCategorySummary[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [selection, setSelection] = useState<SelectionState>({ kind: "none" });
  const [activeTab, setActiveTab] = useState<ServiceTabKey>("details");
  const [drag, setDrag] = useState<DragState>({ kind: "none" });
  const [dragOverTarget, setDragOverTarget] = useState<DragOverTarget>({ kind: "none" });
  const [status, setStatus] = useState<string | null>(null);
  // A service made with "New" stays a draft until the operator saves on purpose;
  // closing its screen without saving removes it. Moving between tabs does not.
  const draftServiceIdRef = useRef<string | null>(null);
  const [categoryModal, setCategoryModal] = useState<
    | { kind: "none" }
    | { kind: "create" }
    | { kind: "rename"; category: ServiceCategorySummary }
    | { kind: "delete"; category: ServiceCategorySummary }
  >({ kind: "none" });

  useEffect(() => {
    if (!canView || !tenantSlug) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const [
          tenantSummary,
          serviceResp,
          categoryResp,
          locationResp,
          providerResp,
        ] = await Promise.all([
          platformApi.getTenantBySlug(tenantSlug),
          platformApi.listServices(tenantSlug),
          platformApi.listServiceCategories(tenantSlug),
          platformApi.listLocations(tenantSlug),
          platformApi.listProvidersAdmin(tenantSlug),
        ]);
        if (cancelled) return;
        setTenant(tenantSummary);
        setServices(serviceResp.services);
        setCategories(categoryResp.categories);
        setLocations(locationResp.locations.filter((loc) => loc.isActive));
        setProviders(providerResp.providers);
        setLoadState({ kind: "ready" });
      } catch (error) {
        if (cancelled) return;
        setLoadState({
          kind: "error",
          message: readErrorMessage(error, "Unable to load the catalog."),
        });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, canView]);

  const discardDraftService = (serviceId: string) => {
    void platformApi.deleteService(tenantSlug, serviceId)
      .then(() => platformApi.listServices(tenantSlug))
      .then((resp) => {
        setServices(resp.services);
        setStatus("The new service was discarded because it was never saved.");
      })
      .catch((error) => setStatus(readErrorMessage(error, "Unable to discard the unsaved service.")));
  };

  // Leaving the draft's screen (another service or category) discards it.
  useEffect(() => {
    const draftId = draftServiceIdRef.current;
    if (!draftId) return;
    if (selection.kind === "service" && selection.serviceId === draftId) return;
    draftServiceIdRef.current = null;
    discardDraftService(draftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // Leaving the Services page entirely also closes the draft's screen. There is no
  // screen left to report a failure on, so this one is best effort.
  useEffect(() => () => {
    const draftId = draftServiceIdRef.current;
    if (draftId) void platformApi.deleteService(tenantSlug, draftId).catch(() => undefined);
  }, [tenantSlug]);

  // ===== Grouping helpers =====
  // NOTE: These useMemo calls must run on every render, so they come BEFORE the
  // early returns for loading/error states to satisfy the Rules of Hooks.
  const servicesByCategory = useMemo(() => {
    const map = new Map<string, ServiceSummary[]>();
    for (const category of categories) {
      map.set(category.id, []);
    }
    map.set(UNCATEGORIZED_KEY, []);
    for (const service of services) {
      const key = service.categoryId ?? UNCATEGORIZED_KEY;
      const bucket = map.get(key) ?? [];
      bucket.push(service);
      map.set(key, bucket);
    }
    for (const [key, list] of map.entries()) {
      map.set(
        key,
        [...list].sort((a, b) => a.sortOrder - b.sortOrder),
      );
    }
    return map;
  }, [services, categories]);

  const orderedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  );

  if (!currentUser) {
    return <main className="cs-page-stack"><p className="cs-empty">Sign in required</p></main>;
  }

  if (!canView) {
    return <main className="cs-page-stack"><p className="cs-empty">You do not have permission to view the service catalog.</p></main>;
  }

  if (loadState.kind === "error") {
    return <main className="cs-page-stack"><div className="cs-banner cs-banner--error" role="alert">{loadState.message}</div></main>;
  }

  // ===== Grouping helpers =====
  const selectedCategory =
    selection.kind === "category"
      ? categories.find((c) => c.id === selection.categoryId) ?? null
      : null;

  // ===== Mutations =====
  const refreshServices = async () => {
    const resp = await platformApi.listServices(tenantSlug);
    setServices(resp.services);
  };
  const refreshCategories = async () => {
    const resp = await platformApi.listServiceCategories(tenantSlug);
    setCategories(resp.categories);
  };
  const refreshProviders = async () => {
    const resp = await platformApi.listProvidersAdmin(tenantSlug);
    setProviders(resp.providers);
  };

  const handleCreateCategory = () => {
    if (!canManage) return;
    setCategoryModal({ kind: "create" });
  };

  const handleCopyCategoryLink = async (category: ServiceCategorySummary) => {
    if (!category.slug) return;
    try {
      await navigator.clipboard.writeText(`${storefrontBaseUrl}/${tenantSlug}/c/${category.slug}`);
      setStatus(`Booking link for ${category.name} copied.`);
    } catch {
      setStatus("Copy failed — open the category to copy its link manually.");
    }
  };

  const handleRenameCategory = (category: ServiceCategorySummary) => {
    if (!canManage) return;
    setCategoryModal({ kind: "rename", category });
  };

  const handleDeleteCategory = (category: ServiceCategorySummary) => {
    if (!canManage) return;
    setCategoryModal({ kind: "delete", category });
  };

  const handleDuplicateService = async (service: ServiceSummary) => {
    if (!canManage) return;
    // Duplicating is a deliberate step, so an unfinished original is kept.
    if (draftServiceIdRef.current === service.id) draftServiceIdRef.current = null;
    try {
      const created = await platformApi.duplicateService(tenantSlug, service.id);
      await refreshServices();
      setSelection({ kind: "service", serviceId: created.id });
      setStatus(`Created "${created.name}".`);
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to duplicate service."));
    }
  };

  const handleReorderCategories = async (orderedIds: string[]) => {
    if (!canManage) return;
    const body: ReorderRequest = { orderedIds };
    try {
      const resp = await platformApi.reorderServiceCategories(tenantSlug, body);
      setCategories(resp.categories);
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to reorder categories."));
    }
  };

  const renderServiceItem = (service: ServiceSummary) => {
    const isSelected = selection.kind === "service" && selection.serviceId === service.id;
    const staffCount = providers.filter((p) => p.isActive && p.serviceIds.includes(service.id)).length;
    return (
      <li key={service.id}>
        <button
          type="button"
          className={`cs-svc-rail-item${isSelected ? " is-selected" : ""}${service.isActive ? "" : " is-hidden"}`}
          aria-current={isSelected ? "true" : undefined}
          onClick={() => { setSelection({ kind: "service", serviceId: service.id }); setActiveTab("details"); }}
        >
          <span className="cs-svc-rail-item__text">
            <span className="cs-svc-rail-item__name">{service.name}</span>
            <span className="cs-svc-rail-item__meta">
              {service.durationMinutes} min · {formatMoneyShort(service.priceCents)} · {staffCount} staff
            </span>
          </span>
          {!service.isActive ? (
            <span className="cs-svc-rail-item__flag">Hidden</span>
          ) : service.featuredLabel ? (
            <span className={`cs-svc-badge cs-svc-badge--${service.featuredLabel}`}>
              {FEATURED_LABEL_DISPLAY[service.featuredLabel] ?? service.featuredLabel}
            </span>
          ) : null}
        </button>
      </li>
    );
  };

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

      <section className="cs-md-shell">
        <div className="cs-md-grid">
          <aside className="cs-md-rail cs-svc-rail">
            <header className="cs-svc-rail__header">
              <h4 className="cs-svc-rail__title">Services</h4>
              {canManage ? (
                <button
                  type="button"
                  className="cs-svc-new-btn"
                  aria-label="New service"
                  onClick={async () => {
                    // Create a minimal draft service and select it so the full
                    // ServiceDetail panel opens with all tabs available.
                    const firstLocationId = locations.length > 0 ? locations[0].id : null;
                    if (!firstLocationId) {
                      setStatus("Create a location first.");
                      return;
                    }
                    try {
                      // Service names are unique, so a leftover "New Service" becomes "New Service 2", and so on.
                      // The list only shows active services, so retry if a hidden one holds the name.
                      let created: ServiceSummary | null = null;
                      const taken = new Set(services.map((item) => item.name.trim().toLowerCase()));
                      for (let attempt = 1; created === null; attempt += 1) {
                        const name = attempt === 1 ? "New Service" : `New Service ${attempt}`;
                        if (taken.has(name.toLowerCase())) continue;
                        try {
                          created = await platformApi.createService(tenantSlug, {
                            name,
                            durationMinutes: 60,
                            priceCents: 0,
                            depositCents: 0,
                            locationIds: [firstLocationId],
                          });
                        } catch (err) {
                          const conflict = (err as { status?: number } | null)?.status === 409;
                          if (!conflict || attempt >= 25) throw err;
                        }
                      }
                      await refreshServices();
                      // Starting another new service closes the previous unsaved one.
                      const previousDraftId = draftServiceIdRef.current;
                      draftServiceIdRef.current = created.id;
                      if (previousDraftId && previousDraftId !== created.id) discardDraftService(previousDraftId);
                      setActiveTab("details");
                      setSelection({ kind: "service", serviceId: created.id });
                      setStatus("New service created. Fill in the details below.");
                    } catch (err) {
                      setStatus(readErrorMessage(err, "Unable to create service."));
                    }
                  }}
                >
                  New
                  <span className="cs-svc-new-btn__icon" aria-hidden="true">+</span>
                </button>
              ) : null}
            </header>
            <div className="cs-svc-rail__groups">
              {orderedCategories.map((category, index) => {
                const list = servicesByCategory.get(category.id) ?? [];
                return (
                  <div key={category.id} className="cs-svc-rail__group">
                    <div className="cs-svc-rail__group-head">
                      <button
                        type="button"
                        className={`cs-svc-rail__group-label${selection.kind === "category" && selection.categoryId === category.id ? " is-selected" : ""}`}
                        aria-current={selection.kind === "category" && selection.categoryId === category.id ? "true" : undefined}
                        onClick={() => setSelection({ kind: "category", categoryId: category.id })}
                      >
                        <span className="cs-svc-rail__dot" style={{ background: categoryColor(index) }} aria-hidden="true" />
                        {category.name}
                      </button>
                      {canManage ? (
                        <OverflowMenu
                          label={`${category.name} actions`}
                          items={[
                            { label: "Settings", onSelect: () => setSelection({ kind: "category", categoryId: category.id }) },
                            { label: "Rename", onSelect: () => handleRenameCategory(category) },
                            ...(category.slug
                              ? [{ label: "Copy booking link", onSelect: () => void handleCopyCategoryLink(category) }]
                              : []),
                            { label: "Delete", onSelect: () => handleDeleteCategory(category), danger: true },
                          ]}
                        />
                      ) : null}
                    </div>
                    {category.subheadline || category.featuredLabel ? (
                      <div className="cs-svc-rail__group-sub">
                        {category.subheadline ? <span>{category.subheadline}</span> : null}
                        {category.featuredLabel ? (
                          <span className={`cs-svc-badge cs-svc-badge--${category.featuredLabel}`}>
                            {FEATURED_LABEL_DISPLAY[category.featuredLabel] ?? category.featuredLabel}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {list.length === 0 ? (
                      <p className="cs-svc-rail__empty">No services yet.</p>
                    ) : (
                      <ul className="cs-svc-rail__list">{list.map(renderServiceItem)}</ul>
                    )}
                  </div>
                );
              })}
              {(() => {
                const uncategorized = servicesByCategory.get(UNCATEGORIZED_KEY) ?? [];
                if (uncategorized.length === 0) return null;
                return (
                  <div className="cs-svc-rail__group">
                    <div className="cs-svc-rail__group-head">
                      <p className="cs-svc-rail__group-label">
                        <span
                          className="cs-svc-rail__dot"
                          style={{ background: categoryColor(orderedCategories.length) }}
                          aria-hidden="true"
                        />
                        Uncategorized
                      </p>
                    </div>
                    <ul className="cs-svc-rail__list">{uncategorized.map(renderServiceItem)}</ul>
                  </div>
                );
              })()}
            </div>
            {canManage ? (
              <div className="cs-svc-rail__footer">
                <button type="button" className="cs-svc-add-category" onClick={handleCreateCategory}>
                  + Add category
                </button>
              </div>
            ) : null}
          </aside>

          <div className="cs-md-detail">
            {selection.kind === "service" ? (
              (() => {
                const selectedService = services.find((s) => s.id === selection.serviceId);
                if (!selectedService) {
                  return <p className="cs-settings-form-help">Service not found.</p>;
                }
                return (
                  <ServiceDetail
                    service={selectedService}
                    categories={orderedCategories}
                    locations={locations}
                    providers={providers}
                    canManage={canManage}
                    tenantSlug={tenantSlug}
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    onSaved={async (msg) => {
                      await refreshServices();
                      if (msg) setStatus(msg);
                    }}
                    onDuplicate={handleDuplicateService}
                    onCommitted={() => {
                      if (draftServiceIdRef.current === selectedService.id) draftServiceIdRef.current = null;
                    }}
                    refreshProviders={refreshProviders}
                    canManageSettings={canManageSettings}
                  />
                );
              })()
            ) : selectedCategory ? (
              <CategoryDetailPanel
                tenantSlug={tenantSlug}
                category={selectedCategory}
                color={categoryColor(Math.max(0, orderedCategories.findIndex((c) => c.id === selectedCategory.id)))}
                canManage={canManage}
                canManageForms={canManageSettings}
                onChanged={async (message) => {
                  await refreshCategories();
                  if (message) setStatus(message);
                }}
                onStatus={setStatus}
                onDelete={() => handleDeleteCategory(selectedCategory)}
              />
            ) : (
              <p className="cs-settings-form-help">Select a service or category to view details.</p>
            )}
          </div>
        </div>
      </section>

      {categoryModal.kind === "create" ? (
        <CreateCategoryDialog
          tenantSlug={tenantSlug}
          onClose={() => setCategoryModal({ kind: "none" })}
          onCreated={async (name) => {
            await refreshCategories();
            setStatus(`Category "${name}" created.`);
            setCategoryModal({ kind: "none" });
          }}
          onStatus={setStatus}
        />
      ) : null}

      {categoryModal.kind === "rename" ? (
        <RenameCategoryDialog
          tenantSlug={tenantSlug}
          category={categoryModal.category}
          onClose={() => setCategoryModal({ kind: "none" })}
          onRenamed={async (name) => {
            await refreshCategories();
            setStatus(`Renamed to "${name}".`);
            setCategoryModal({ kind: "none" });
          }}
          onStatus={setStatus}
        />
      ) : null}

      {categoryModal.kind === "delete" ? (
        <DeleteCategoryDialog
          tenantSlug={tenantSlug}
          category={categoryModal.category}
          serviceCount={(servicesByCategory.get(categoryModal.category.id) ?? []).length}
          otherCategories={orderedCategories.filter((c) => c.id !== categoryModal.category.id)}
          onClose={() => setCategoryModal({ kind: "none" })}
          onDeleted={async (name, categoryId) => {
            await Promise.all([refreshCategories(), refreshServices()]);
            if (selection.kind === "category" && selection.categoryId === categoryId) {
              setSelection({ kind: "none" });
            }
            setStatus(`Category "${name}" deleted.`);
            setCategoryModal({ kind: "none" });
          }}
          onStatus={setStatus}
        />
      ) : null}
    </main>
  );
}

// ===========================================================================
// Inline editable service cards
// ===========================================================================

type ServiceCardState = {
  name: string;
  description: string;
  durationMinutes: string;
  setupBufferMinutes: string;
  cleanupBufferMinutes: string;
  priceAmount: string;
  depositAmount: string;
  categoryId: string;
  locationIds: string[];
  isActive: boolean;
  onlineBookingDescription: string;
  requireCardOnFile: boolean | null; // null = same as the category
  isTaxable: boolean | null; // null = same as the category (taxable when it has none)
  bookingPaymentMode: string; // '' (same as the category) | 'none' | 'full' | 'partial_flat' | 'partial_percent'
  bookingPaymentValueAmount: string; // dollar amount for partial_flat
  bookingPaymentPercent: string; // percentage for partial_percent
  providerSelectionMode: string; // '' (same as the category), 'client_choice', 'auto_assign', 'hide'
  featuredLabel: string; // '' for none
  imageUrl: string;
  formIds: string[]; // customer-facing forms this service requires
  slug: string;
  scarcityHint: string;
  metaDescription: string;
  financingMode: string; // '' (follows the category) | 'on' | 'off' | 'custom'
  financingUrl: string; // the service's own link, for 'custom'
};

/** The "Taken at booking" choices, shared by services and categories. */
function PaymentRuleChoices({
  name, mode, valueAmount, percent, priceCents, ariaLabel, onChange,
}: {
  name: string;
  mode: string;
  valueAmount: string;
  percent: string;
  /** Used to show the amount due at the visit; null for categories (no single price). */
  priceCents: number | null;
  ariaLabel: string;
  onChange: (patch: { mode?: string; valueAmount?: string; percent?: string }) => void;
}) {
  const flatCents = parseMoneyInput(valueAmount) ?? 0;
  const pct = Number(percent);
  const percentCents = priceCents !== null && Number.isFinite(pct) ? Math.round((priceCents * pct) / 100) : 0;
  const dueAtVisit = (takenCents: number) =>
    priceCents === null ? null : `${formatMoney(Math.max(0, priceCents - Math.min(takenCents, priceCents)))} due at visit`;
  const option = (value: string, content: ReactNode, extra?: ReactNode) => (
    <label className={`cs-svc-choice${mode === value ? " is-selected" : ""}`}>
      <input type="radio" name={name} value={value} className="cs-svc-choice__radio"
        checked={mode === value} onChange={() => onChange({ mode: value })} />
      <span className="cs-svc-choice__label">{content}</span>
      {extra ? <span className="cs-svc-choice__extra">{extra}</span> : null}
    </label>
  );
  return (
    <div className="cs-svc-choices" role="radiogroup" aria-label={ariaLabel}>
      {option("none", "No payment required at booking")}
      {option("full", priceCents === null ? "Full payment" : `Full payment — ${formatMoney(priceCents)}`)}
      {option(
        "partial_flat",
        <>
          Partial payment — $
          <input
            className="cs-svc-choice__input"
            type="text"
            inputMode="decimal"
            aria-label="Partial payment amount"
            placeholder="0.00"
            value={valueAmount}
            onFocus={() => onChange({ mode: "partial_flat" })}
            onChange={(e) => onChange({ valueAmount: e.target.value, mode: "partial_flat" })}
          />
        </>,
        mode === "partial_flat" ? dueAtVisit(flatCents) : null,
      )}
      {option(
        "partial_percent",
        <>
          Partial payment — %
          <input
            className="cs-svc-choice__input"
            type="number"
            min={0}
            max={100}
            aria-label="Partial payment percentage"
            value={percent}
            onFocus={() => onChange({ mode: "partial_percent" })}
            onChange={(e) => onChange({ percent: e.target.value, mode: "partial_percent" })}
          />
        </>,
        mode === "partial_percent" ? dueAtVisit(percentCents) : null,
      )}
    </div>
  );
}

function toCardState(service: ServiceSummary): ServiceCardState {
  return {
    name: service.name,
    description: service.description ?? "",
    durationMinutes: String(service.durationMinutes),
    setupBufferMinutes: String(service.setupBufferMinutes ?? 0),
    cleanupBufferMinutes: String(service.cleanupBufferMinutes ?? 0),
    priceAmount: (service.priceCents / 100).toFixed(2),
    depositAmount: (service.depositCents / 100).toFixed(2),
    categoryId: service.categoryId ?? "",
    locationIds: [...service.locationIds],
    isActive: service.isActive,
    onlineBookingDescription: service.onlineBookingDescription ?? "",
    requireCardOnFile: service.requireCardOnFile ?? null,
    isTaxable: service.isTaxable ?? null,
    // Empty means the service follows its category.
    bookingPaymentMode: service.bookingPaymentMode ?? "",
    bookingPaymentValueAmount:
      service.bookingPaymentValueCents != null ? (service.bookingPaymentValueCents / 100).toFixed(2) : "",
    bookingPaymentPercent: service.bookingPaymentPercent != null ? String(service.bookingPaymentPercent) : "",
    providerSelectionMode: service.providerSelectionMode ?? "",
    featuredLabel: service.featuredLabel ?? "",
    imageUrl: service.imageUrl ?? "",
    formIds: [...service.formIds],
    slug: service.slug ?? "",
    scarcityHint: service.scarcityHint ?? "",
    metaDescription: service.metaDescription ?? "",
    financingMode: service.financingMode ?? "",
    financingUrl: service.financingUrl ?? "",
  };
}

function ServiceDetail({
  service,
  categories,
  locations,
  providers,
  canManage,
  tenantSlug,
  activeTab,
  onTabChange,
  onSaved,
  onDuplicate,
  onCommitted,
  refreshProviders,
  canManageSettings,
}: {
  service: ServiceSummary;
  categories: ServiceCategorySummary[];
  locations: LocationSummary[];
  providers: ProviderSummary[];
  canManage: boolean;
  tenantSlug: string;
  activeTab: ServiceTabKey;
  onTabChange: (tab: ServiceTabKey) => void;
  onSaved: (msg?: string) => void;
  onDuplicate: (service: ServiceSummary) => void;
  /** The operator saved on purpose (or deleted the service), so an unfinished new service is now a real one. */
  onCommitted: () => void;
  refreshProviders: () => Promise<void>;
  canManageSettings: boolean;
}) {
  const [form, setForm] = useState<ServiceCardState>(() => toCardState(service));
  const detailsFormId = useId();
  // Client-facing forms that can be required for this service.
  const [forms, setForms] = useState<FormSummaryResponse[]>([]);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [formsReloadKey, setFormsReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [variants, setVariants] = useState<ProviderServiceVariantEntry[]>([]);
  const [savedVariants, setSavedVariants] = useState<ProviderServiceVariantEntry[]>([]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);
  const [variantsSaving, setVariantsSaving] = useState(false);
  // Raw text the operator is typing for each provider's override inputs. Storing
  // the display string directly (rather than re-deriving it from cents on every
  // render) preserves the caret position and lets them type decimals like "9."
  // or trailing zeros without the value getting reformatted mid-keystroke.
  const [variantTexts, setVariantTexts] = useState<
    Record<string, { duration: string; price: string; deposit: string; flat: string; percent: string }>
  >({});
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  // The Resources tab keeps its own rows; it registers its save here so the header Save can include them.
  const resourcesSaveRef = useRef<((quiet?: boolean) => Promise<void>) | null>(null);

  useEffect(() => { setForm(toCardState(service)); }, [service]);

  useEffect(() => {
    let cancelled = false;
    setVariantsLoaded(false);
    void platformApi.getServiceProviderVariants(tenantSlug, service.id).then((resp) => {
      if (cancelled) return;
      setVariants(resp.variants);
      setSavedVariants(resp.variants);
      // Seed the display text map so the initial render shows exactly what the
      // backend returned, without .toFixed(2) fighting the operator's typing.
      const seed: Record<string, { duration: string; price: string; deposit: string; flat: string; percent: string }> = {};
      for (const v of resp.variants) {
        seed[v.providerId] = {
          duration: v.durationMinutes != null ? String(v.durationMinutes) : "",
          price: v.priceCents != null ? (v.priceCents / 100).toFixed(2) : "",
          deposit: v.depositCents != null ? (v.depositCents / 100).toFixed(2) : "",
          flat: v.commissionFlatCents != null ? (v.commissionFlatCents / 100).toFixed(2) : "",
          percent: v.commissionBasisPoints != null ? (v.commissionBasisPoints / 100).toString() : "",
        };
      }
      setVariantTexts(seed);
      setVariantsLoaded(true);
    }).catch(() => { if (!cancelled) setVariantsLoaded(true); });
    return () => { cancelled = true; };
  }, [tenantSlug, service.id]);

  useEffect(() => {
    return () => { if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    platformApi.listForms(tenantSlug)
      .then((resp) => {
        if (cancelled) return;
        setForms(resp.items.filter((item) => item.scope === "customer" && item.isActive));
        setFormsError(null);
      })
      .catch((error) => {
        if (!cancelled) setFormsError(readErrorMessage(error, "Unable to load forms."));
      });
    return () => { cancelled = true; };
  }, [tenantSlug, formsReloadKey]);

  // Direct link deep-links to the service page on the storefront so the client lands
  // on this specific service instead of the generic tenant browse flow.
  const schedulingHref = `${storefrontBaseUrl}/${tenantSlug}/services/${service.slug || service.id}`;

  const handleCopyLink = async () => {
    try { await navigator.clipboard.writeText(schedulingHref); setCopyHint("Link copied!"); }
    catch { setCopyHint("Copy failed."); }
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyHint(null), 2000);
  };

  /** Validates and saves the Details/Online booking form. Resolves to whether it was saved. */
  const persistService = async (quiet = false): Promise<boolean> => {
    if (!canManage) return false;
    const name = form.name.trim();
    if (!name) { onSaved("Service name is required."); return false; }
    const durationMinutes = Number(form.durationMinutes);
    const priceCents = parseMoneyInput(form.priceAmount);
    const depositCents = parseMoneyInput(form.depositAmount);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || priceCents === null || depositCents === null) {
      onSaved("Enter a valid duration, price, and deposit."); return false;
    }
    if (form.locationIds.length === 0) { onSaved("Select at least one location."); return false; }
    const body: UpdateServiceRequest = {
      name, durationMinutes,
      setupBufferMinutes: Number(form.setupBufferMinutes) || 0,
      cleanupBufferMinutes: Number(form.cleanupBufferMinutes) || 0,
      priceCents, depositCents,
      locationIds: form.locationIds,
      isActive: form.isActive,
    };
    if (form.requireCardOnFile === null) body.inheritRequireCardOnFile = true;
    else body.requireCardOnFile = form.requireCardOnFile;
    if (form.isTaxable === null) body.inheritIsTaxable = true;
    else body.isTaxable = form.isTaxable;
    const desc = form.description.trim();
    if (desc) body.description = desc;
    else if (service.description) body.clearDescription = true;
    if (form.categoryId) body.categoryId = form.categoryId;
    else if (service.categoryId) body.clearCategory = true;
    // Online booking description
    const obDesc = form.onlineBookingDescription.trim();
    if (obDesc) body.onlineBookingDescription = obDesc;
    else if (service.onlineBookingDescription) body.clearOnlineBookingDescription = true;
    // Payment rule: empty follows the category; otherwise the service's own.
    if (!form.bookingPaymentMode) {
      body.inheritBookingPayment = true;
    } else {
      body.bookingPaymentMode = form.bookingPaymentMode;
    }
    if (form.bookingPaymentMode === "partial_flat") {
      const val = form.bookingPaymentValueAmount.trim() ? parseMoneyInput(form.bookingPaymentValueAmount) : null;
      if (val == null) { onSaved("Enter the amount to take at booking."); return false; }
      body.bookingPaymentValueCents = val;
    }
    if (form.bookingPaymentMode === "partial_percent") {
      const pct = Number(form.bookingPaymentPercent);
      if (!form.bookingPaymentPercent.trim() || !Number.isFinite(pct) || pct < 0 || pct > 100) {
        onSaved("Enter a partial payment percentage from 0 to 100."); return false;
      }
      body.bookingPaymentPercent = pct;
    }
    // Storefront listing
    const slug = form.slug.trim();
    if (slug) body.slug = slug;
    else if (service.slug) body.clearSlug = true;
    const scarcity = form.scarcityHint.trim();
    if (scarcity) body.scarcityHint = scarcity;
    else if (service.scarcityHint) body.clearScarcityHint = true;
    const meta = form.metaDescription.trim();
    if (meta) body.metaDescription = meta;
    else if (service.metaDescription) body.clearMetaDescription = true;
    // Financing: follow the category, show it, hide it, or use this service's own link.
    if (!form.financingMode) {
      body.inheritFinancing = true;
    } else if (form.financingMode === "on" || form.financingMode === "off") {
      body.financingMode = form.financingMode;
    } else {
      const financingUrl = form.financingUrl.trim();
      if (!/^https?:\/\/\S+$/i.test(financingUrl)) {
        onSaved("Enter the financing link as a web address starting with http:// or https://."); return false;
      }
      body.financingMode = "custom";
      body.financingUrl = financingUrl;
    }
    // Provider selection mode
    body.providerSelectionMode = form.providerSelectionMode;
    if (form.featuredLabel) body.featuredLabel = form.featuredLabel as CategoryFeaturedLabel;
    else if (service.featuredLabel) body.clearFeaturedLabel = true;
    if (form.imageUrl) {
      if (form.imageUrl !== service.imageUrl) body.imageUrl = form.imageUrl;
    } else if (service.imageUrl) {
      body.clearImage = true;
    }
    setSaving(true);
    try {
      await platformApi.updateService(tenantSlug, service.id, body);
      // Forms own their service list, so a changed requirement updates the form.
      const changedForms = forms.filter(
        (item) => !item.appliesToAllServices && item.serviceIds.includes(service.id) !== form.formIds.includes(item.id),
      );
      for (const item of changedForms) {
        const serviceIds = form.formIds.includes(item.id)
          ? [...item.serviceIds, service.id]
          : item.serviceIds.filter((id) => id !== service.id);
        await platformApi.updateForm(tenantSlug, item.id, { serviceIds });
      }
      if (changedForms.length > 0) setFormsReloadKey((key) => key + 1);
      // A quiet save (switching tabs) refreshes the list without announcing itself.
      onSaved(quiet ? undefined : `"${name}" saved.`);
      return true;
    }
    catch (error) { onSaved(readErrorMessage(error, "Unable to save service.")); return false; }
    finally { setSaving(false); }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await persistService()) onCommitted();
  };

  // Variants
  const variantByProvider = useMemo(() => {
    const map = new Map<string, ProviderServiceVariantEntry>();
    for (const entry of variants) map.set(entry.providerId, entry);
    return map;
  }, [variants]);

  const updateVariant = (providerId: string, patch: Partial<ProviderServiceVariantEntry>) => {
    setVariants((current) => {
      const existing = current.find((v) => v.providerId === providerId);
      if (!existing) return [...current, { providerId, priceCents: null, durationMinutes: null, depositCents: null, commissionFlatCents: null, commissionBasisPoints: null, ...patch }];
      return current.map((v) => v.providerId === providerId ? { ...v, ...patch } : v);
    });
  };

  // Update the per-provider text state (what the operator is actively typing)
  // and best-effort-mirror it into the cents-based `variants` state so the save
  // button / dirty tracking observe the change. We intentionally do NOT bounce
  // the parsed value back into the input's `value` prop, which is what caused
  // typing to feel broken before (each keystroke replaced "9." with "9").
  const patchVariantText = (
    providerId: string,
    field: "duration" | "price" | "deposit" | "flat" | "percent",
    raw: string,
  ) => {
    setVariantTexts((prev) => {
      const current = prev[providerId] ?? { duration: "", price: "", deposit: "", flat: "", percent: "" };
      return { ...prev, [providerId]: { ...current, [field]: raw } };
    });
    if (field === "duration") {
      if (!raw) { updateVariant(providerId, { durationMinutes: null }); return; }
      const n = Number(raw);
      updateVariant(providerId, { durationMinutes: Number.isFinite(n) ? n : null });
      return;
    }
    if (field === "price") {
      if (!raw) { updateVariant(providerId, { priceCents: null }); return; }
      const cents = parseMoneyInput(raw);
      updateVariant(providerId, { priceCents: cents });
      return;
    }
    if (field === "deposit") {
      if (!raw) { updateVariant(providerId, { depositCents: null }); return; }
      updateVariant(providerId, { depositCents: parseMoneyInput(raw) });
      return;
    }
    if (field === "flat") {
      if (!raw) { updateVariant(providerId, { commissionFlatCents: null }); return; }
      const cents = parseMoneyInput(raw);
      updateVariant(providerId, { commissionFlatCents: cents, commissionBasisPoints: null });
      return;
    }
    if (field === "percent") {
      if (!raw) { updateVariant(providerId, { commissionBasisPoints: null }); return; }
      const pct = Number(raw);
      if (!Number.isFinite(pct)) return;
      const bp = Math.round(pct * 100);
      updateVariant(providerId, {
        commissionBasisPoints: Math.max(0, Math.min(10_000, bp)),
        commissionFlatCents: null,
      });
    }
  };

  const handleSaveVariants = async (quiet = false) => {
    if (!canManage) return;
    const payload: ProviderServiceVariantEntry[] = variants
      .filter((v) => v.priceCents != null || v.durationMinutes != null || v.depositCents != null || v.commissionFlatCents != null || v.commissionBasisPoints != null)
      .map((v) => ({ providerId: v.providerId, priceCents: v.priceCents ?? null, durationMinutes: v.durationMinutes ?? null, depositCents: v.depositCents ?? null, commissionFlatCents: v.commissionFlatCents ?? null, commissionBasisPoints: v.commissionBasisPoints ?? null }));
    setVariantsSaving(true);
    try {
      const resp = await platformApi.replaceServiceProviderVariants(tenantSlug, service.id, { variants: payload });
      setVariants(resp.variants); setSavedVariants(resp.variants);
      onSaved(quiet ? undefined : "Per-provider pricing saved.");
    } catch (error) { onSaved(readErrorMessage(error, "Unable to save variants.")); }
    finally { setVariantsSaving(false); }
  };

  // The header Save works on every tab: it saves whatever is pending (per-provider
  // overrides, resource rows, and the service details) in one click.
  const handleSaveCurrent = async () => {
    if (!canManage) return;
    if (isVariantsDirty) await handleSaveVariants();
    if (resourcesSaveRef.current) await resourcesSaveRef.current();
    if (await persistService()) onCommitted();
  };

  // Everything pending is saved as the operator moves between tabs, so nothing typed is lost.
  const isFormDirty = JSON.stringify(form) !== JSON.stringify(toCardState(service));
  const handleTabChange = async (tab: ServiceTabKey) => {
    if (tab === activeTab) return;
    if (canManage && !saving && !variantsSaving) {
      if (isVariantsDirty) await handleSaveVariants(true);
      if (resourcesSaveRef.current) await resourcesSaveRef.current(true);
      if (isFormDirty) await persistService(true);
    }
    onTabChange(tab);
  };

  const eligibleProviders = useMemo(
    () => providers.filter((p) => p.isActive),
    [providers],
  );

  const assignedProviderIds = useMemo(
    () => new Set(providers.filter((p) => p.serviceIds.includes(service.id)).map((p) => p.id)),
    [providers, service.id],
  );

  const toggleProviderAssignment = async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider || !canManage) return;
    const isAssigned = assignedProviderIds.has(providerId);
    const newServiceIds = isAssigned
      ? provider.serviceIds.filter((id) => id !== service.id)
      : [...provider.serviceIds, service.id];
    try {
      await platformApi.updateProvider(tenantSlug, providerId, { serviceIds: newServiceIds });
      await refreshProviders();
      onSaved(isAssigned ? `Removed ${provider.name} from this service.` : `Added ${provider.name} to this service.`);
    } catch (error) {
      onSaved(readErrorMessage(error, "Unable to update provider assignment."));
    }
  };

  /** Returns an error message, or null when the booking link was saved. */
  const setProviderBookingSlug = async (providerId: string, slug: string): Promise<string | null> => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider || !canManage) return "You can't change this booking link.";
    try {
      await platformApi.updateProvider(tenantSlug, providerId, { bookingSlug: slug });
      await refreshProviders();
      onSaved(`${provider.name}'s booking link saved.`);
      return null;
    } catch (error) {
      return readErrorMessage(error, "Unable to save the booking link.");
    }
  };

  const setProviderBookable = async (providerId: string, bookable: boolean) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider || !canManage) return;
    try {
      await platformApi.updateProvider(tenantSlug, providerId, { isBookableOnline: bookable });
      await refreshProviders();
      onSaved(`${provider.name} is ${bookable ? "now bookable online" : "now calendar only"}.`);
    } catch (error) {
      onSaved(readErrorMessage(error, "Unable to update online booking."));
    }
  };

  const isVariantsDirty = useMemo(() => {
    const normalize = (entries: ProviderServiceVariantEntry[]) => {
      const map = new Map<string, string>();
      for (const entry of entries) {
        const p = entry.priceCents ?? null; const d = entry.durationMinutes ?? null;
        const dp = entry.depositCents ?? null; const cf = entry.commissionFlatCents ?? null;
        const cb = entry.commissionBasisPoints ?? null;
        if (p == null && d == null && dp == null && cf == null && cb == null) continue;
        map.set(entry.providerId, `${p}|${d}|${dp}|${cf}|${cb}`);
      }
      return map;
    };
    const current = normalize(variants); const saved = normalize(savedVariants);
    if (current.size !== saved.size) return true;
    for (const [pid, sig] of current) { if (saved.get(pid) !== sig) return true; }
    return false;
  }, [variants, savedVariants]);

  const formDuration = Number(form.durationMinutes);
  const baseDurationMinutes = Number.isFinite(formDuration) && formDuration > 0 ? formDuration : service.durationMinutes;
  const baseFormPrice = parseMoneyInput(form.priceAmount);
  const basePriceCents = baseFormPrice != null && baseFormPrice >= 0 ? baseFormPrice : service.priceCents;
  const baseDepositCents = effectiveDepositCents(service, basePriceCents);

  const tabs: Array<{ key: ServiceTabKey; label: string }> = [
    { key: "details", label: "Details" },
    { key: "staff", label: "Staff" },
    { key: "resources", label: "Resources" },
    { key: "customizations", label: "Add-ons" },
    { key: "onlineBooking", label: "Online booking" },
  ];

  // The header follows the form as the operator types, so it never disagrees with the fields below it.
  const categoryIndex = categories.findIndex((category) => category.id === form.categoryId);
  const categoryName = categoryIndex >= 0 ? categories[categoryIndex]!.name : "Uncategorized";

  return (
    <div className="cs-md-detail__inner">
      <header className="cs-md-detail__header cs-svc-detail-head">
        <div className="cs-svc-detail-head__text">
          <p className="cs-svc-detail-head__eyebrow">{categoryName}</p>
          <h4 className="cs-svc-detail-head__name">{form.name.trim() || service.name}</h4>
        </div>
        {canManage ? (
          <div className="cs-svc-detail-head__actions">
            {activeTab === "details" ? (
              <label className="cs-svc-active-toggle">
                <input
                  type="checkbox"
                  className="cs-switch__input"
                  checked={form.isActive}
                  disabled={saving}
                  onChange={(e) => setForm((c) => ({ ...c, isActive: e.target.checked }))}
                />
                <span className={`cs-switch${form.isActive ? "" : " cs-switch--off"}`} aria-hidden="true" />
                Active
              </label>
            ) : null}
            <button type="button" className="cs-svc-pill-btn" onClick={() => onDuplicate(service)}>Duplicate</button>
            {activeTab === "details" || activeTab === "onlineBooking" ? (
              <button type="submit" form={detailsFormId} className="cs-svc-pill-btn cs-svc-pill-btn--primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            ) : (
              <button type="button" className="cs-svc-pill-btn cs-svc-pill-btn--primary"
                disabled={saving || variantsSaving} onClick={() => void handleSaveCurrent()}>
                {saving || variantsSaving ? "Saving…" : "Save"}
              </button>
            )}
            <OverflowMenu
              label="More service actions"
              items={[{
                label: "Delete service",
                danger: true,
                onSelect: () => {
                  if (window.confirm(`Delete "${service.name}"? This cannot be undone.`)) {
                    platformApi.deleteService(tenantSlug, service.id)
                      .then(() => { onCommitted(); onSaved(`"${service.name}" deleted.`); })
                      .catch((e) => onSaved(readErrorMessage(e, "Unable to delete service.")));
                  }
                },
              }]}
            />
          </div>
        ) : null}
      </header>

      <nav className="cs-md-tabs" role="tablist" aria-label="Service sections">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key}
            className={`cs-md-tab${activeTab === tab.key ? " is-active" : ""}`}
            onClick={() => void handleTabChange(tab.key)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "details" ? (
        <ServiceDetailsTab formId={detailsFormId} form={form} setForm={setForm} service={service}
          categories={categories} locations={locations} canManage={canManage} saving={saving}
          tenantSlug={tenantSlug} forms={forms} formsError={formsError} canManageForms={canManageSettings}
          handleSave={handleSave} />
      ) : null}
      {activeTab === "staff" ? (
        <ServiceStaffTab service={service} eligibleProviders={eligibleProviders}
          assignedProviderIds={assignedProviderIds}
          toggleProviderAssignment={toggleProviderAssignment}
          variantByProvider={variantByProvider} updateVariant={updateVariant}
          variantTexts={variantTexts} patchVariantText={patchVariantText}
          canManage={canManage} variantsLoaded={variantsLoaded}
          isVariantsDirty={isVariantsDirty} variantsSaving={variantsSaving}
          handleSaveVariants={handleSaveVariants}
          baseDurationMinutes={baseDurationMinutes} basePriceCents={basePriceCents}
          baseDepositCents={baseDepositCents} tenantSlug={tenantSlug}
          storefrontBaseUrl={storefrontBaseUrl}
          form={form} setForm={setForm}
          saving={saving} handleSave={handleSave}
          setProviderBookable={setProviderBookable}
          setProviderBookingSlug={setProviderBookingSlug}
          category={categories.find((c) => c.id === form.categoryId) ?? null} />
      ) : null}
      {activeTab === "resources" ? (
        <ServiceResourcesTab service={service} tenantSlug={tenantSlug} locations={locations}
          canManage={canManage} canCreateResources={canManageSettings} onSaved={onSaved}
          saveRef={resourcesSaveRef} />
      ) : null}
      {activeTab === "customizations" ? (
        <ServiceAddOnsTab service={service} tenantSlug={tenantSlug} canManage={canManage} />
      ) : null}
      {activeTab === "onlineBooking" ? (
        <ServiceOnlineBookingTab service={service} formId={detailsFormId} form={form} setForm={setForm} canManage={canManage}
          schedulingHref={schedulingHref} handleCopyLink={handleCopyLink} copyHint={copyHint}
          saving={saving} handleSave={handleSave} category={categories.find((c) => c.id === form.categoryId) ?? null} />
      ) : null}
    </div>
  );
}

// ===========================================================================
// Tab components
// ===========================================================================

// Clicking a number field selects what's in it, so typing replaces it straight away.
const selectNumberOnFocus = {
  onFocus: (event: React.FocusEvent<HTMLInputElement>) => event.target.select(),
  onMouseUp: (event: React.MouseEvent<HTMLInputElement>) => event.preventDefault(),
};

const FORM_TIMING_LABELS: Record<string, string> = {
  pre_booking: "Before booking",
  pre_visit: "Before the appointment",
  post_visit: "After the appointment",
};

function ServiceDetailsTab({
  formId, form, setForm, service, categories, locations, canManage, saving,
  tenantSlug, forms, formsError, canManageForms, handleSave,
}: {
  formId: string;
  form: ServiceCardState;
  setForm: React.Dispatch<React.SetStateAction<ServiceCardState>>;
  service: ServiceSummary;
  categories: ServiceCategorySummary[];
  locations: LocationSummary[];
  canManage: boolean;
  saving: boolean;
  tenantSlug: string;
  forms: FormSummaryResponse[];
  formsError: string | null;
  canManageForms: boolean;
  handleSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  // A stored URL can stop resolving; show the placeholder instead of alt text.
  const [imageBroken, setImageBroken] = useState(false);
  useEffect(() => { setImageFileName(null); setImageError(null); }, [service.id]);
  useEffect(() => { setImageBroken(false); }, [form.imageUrl]);

  const durationMinutes = Number(form.durationMinutes || 0);
  const setupMinutes = Number(form.setupBufferMinutes || 0);
  const cleanupMinutes = Number(form.cleanupBufferMinutes || 0);
  // Same choices as categories, with "None" last.
  const featuredOptions = [
    ...FEATURED_LABEL_OPTIONS.filter((option) => option.value),
    ...FEATURED_LABEL_OPTIONS.filter((option) => !option.value),
  ];

  const handleImageChosen = async (file: File | undefined) => {
    if (!file) return;
    setImageUploading(true);
    setImageError(null);
    try {
      const uploaded = await uploadImageFile(tenantSlug, file);
      setForm((c) => ({ ...c, imageUrl: uploaded.url }));
      setImageFileName(uploaded.fileName);
    } catch (error) {
      setImageError(readErrorMessage(error, "Unable to upload image."));
    } finally {
      setImageUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const minutesField = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: { min: number; step: number; required?: boolean },
  ) => (
    <label className="cs-svc-details__field">
      <span className="cs-svc-details__label">{label}</span>
      <span className="cs-svc-unit cs-svc-unit--suffix">
        <input className="cs-svc-details__input" type="number" min={options.min} step={options.step}
          {...selectNumberOnFocus} value={value} required={options.required}
          onChange={(e) => onChange(e.target.value)} />
        {/* --chars lets CSS place the unit right after the typed digits. */}
        <span className="cs-svc-unit__affix" aria-hidden="true"
          style={{ "--chars": value.length } as React.CSSProperties}>min</span>
      </span>
    </label>
  );

  return (
    <form id={formId} className="cs-svc-detail-form" onSubmit={handleSave}>
      <fieldset className="cs-svc-fieldset" disabled={!canManage || saving}>
        <div className="cs-svc-card cs-svc-details">
          <div className="cs-svc-details__grid">
            <label className="cs-svc-details__field cs-svc-details__field--half">
              <span className="cs-svc-details__label">Service name</span>
              <input className="cs-svc-details__input" value={form.name}
                onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                placeholder="Service name" required />
            </label>
            <label className="cs-svc-details__field cs-svc-details__field--half">
              <span className="cs-svc-details__label">Category</span>
              <select className="cs-svc-details__input" value={form.categoryId}
                onChange={(e) => setForm((c) => ({ ...c, categoryId: e.target.value }))}>
                <option value="">Uncategorized</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </label>

            <label className="cs-svc-details__field">
              <span className="cs-svc-details__label">Price</span>
              <span className="cs-svc-unit cs-svc-unit--prefix">
                <input className="cs-svc-details__input" type="number" min={0} step="0.01"
                  {...selectNumberOnFocus} value={form.priceAmount}
                  onChange={(e) => setForm((c) => ({ ...c, priceAmount: e.target.value }))} required />
                <span className="cs-svc-unit__affix" aria-hidden="true">$</span>
              </span>
            </label>
            {minutesField("Duration", form.durationMinutes,
              (value) => setForm((c) => ({ ...c, durationMinutes: value })), { min: 15, step: 15, required: true })}
            {minutesField("Setup buffer", form.setupBufferMinutes,
              (value) => setForm((c) => ({ ...c, setupBufferMinutes: value })), { min: 0, step: 5 })}
            {minutesField("Cleanup buffer", form.cleanupBufferMinutes,
              (value) => setForm((c) => ({ ...c, cleanupBufferMinutes: value })), { min: 0, step: 5 })}
          </div>

          {/* Slot footprint: what availability actually blocks, buffers included. */}
          <div className="cs-svc-footprint">
            <span className="cs-svc-details__label">Slot footprint</span>
            <div
              className="cs-svc-footprint__track"
              role="img"
              aria-label={`Setup ${setupMinutes} min, treatment ${durationMinutes} min, cleanup ${cleanupMinutes} min`}
            >
              {setupMinutes > 0 ? (
                <span className="cs-svc-footprint__seg cs-svc-footprint__seg--buffer" style={{ flexGrow: setupMinutes }}>
                  {setupMinutes}
                </span>
              ) : null}
              <span className="cs-svc-footprint__seg cs-svc-footprint__seg--treatment" style={{ flexGrow: Math.max(durationMinutes, 1) }}>
                Treatment {durationMinutes} min
              </span>
              {cleanupMinutes > 0 ? (
                <span className="cs-svc-footprint__seg cs-svc-footprint__seg--buffer" style={{ flexGrow: cleanupMinutes }}>
                  {cleanupMinutes}
                </span>
              ) : null}
            </div>
            <span className="cs-svc-footprint__total">Books {durationMinutes + setupMinutes + cleanupMinutes} min</span>
          </div>

          <hr className="cs-svc-details__divider" />

          {(() => {
            const taxCategory = categories.find((c) => c.id === form.categoryId) ?? null;
            // Follows the category until the operator changes it; taxable when neither says otherwise.
            const taxed = form.isTaxable ?? taxCategory?.isTaxable ?? true;
            return (
              <div className="cs-svc-setting">
                <span className="cs-svc-setting__text">
                  <span className="cs-svc-card__title">Charge tax</span>
                  <span className="cs-svc-section__lead">
                    {taxed
                      ? "Tax is added at the service tax rate of the location it's booked at. Set rates under Locations."
                      : "No tax is added to this service."}
                    {form.isTaxable === null && taxCategory ? ` Following ${taxCategory.name}.` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className={`cs-switch${taxed ? "" : " cs-switch--off"}`}
                  aria-label="Charge tax toggle"
                  aria-pressed={taxed}
                  onClick={() => setForm((c) => ({ ...c, isTaxable: !taxed }))}
                />
              </div>
            );
          })()}

          <hr className="cs-svc-details__divider" />

          <label className="cs-svc-details__field">
            <span className="cs-svc-details__label">Client-facing description</span>
            <textarea
              className="cs-svc-details__input cs-svc-details__textarea cs-svc-details__textarea--tall"
              rows={8}
              value={form.description}
              onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
              placeholder="Describe the treatment as it appears on the storefront…"
            />
          </label>

          <div className="cs-svc-details__grid">
            <div className="cs-svc-details__field cs-svc-details__field--half" role="group" aria-label="Featured label">
              <span className="cs-svc-details__label" aria-hidden="true">Featured label</span>
              <div className="cs-svc-featured">
                {featuredOptions.map(({ value, label }) => (
                  <button
                    key={label}
                    type="button"
                    className={`cs-svc-featured__pill${form.featuredLabel === value ? " is-active" : ""}`}
                    aria-pressed={form.featuredLabel === value}
                    onClick={() => setForm((c) => ({ ...c, featuredLabel: value }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="cs-svc-details__field cs-svc-details__field--half">
              <span className="cs-svc-details__label">Listing image</span>
              <div className="cs-svc-listing">
                <span className="cs-svc-listing__thumb">
                  {form.imageUrl && !imageBroken ? (
                    <img src={form.imageUrl} alt={service.imageAltText ?? ""} onError={() => setImageBroken(true)} />
                  ) : null}
                </span>
                <span className="cs-svc-listing__text">
                  <span className="cs-svc-listing__name">
                    {imageUploading
                      ? "Uploading…"
                      : !form.imageUrl
                        ? "No image yet"
                        : imageBroken
                          ? "Image couldn't load"
                          : imageFileName ?? "Listing image"}
                  </span>
                  {canManage ? (
                    <span className="cs-svc-listing__actions">
                      <button type="button" className="cs-link-btn" onClick={() => imageInputRef.current?.click()}>
                        {form.imageUrl ? "Replace" : "Upload"}
                      </button>
                      {form.imageUrl ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <button type="button" className="cs-link-btn"
                            onClick={() => { setForm((c) => ({ ...c, imageUrl: "" })); setImageFileName(null); }}>
                            Remove
                          </button>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  {imageError ? <span role="alert" className="cs-svc-helper cs-svc-helper--error">{imageError}</span> : null}
                </span>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="cs-visually-hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => handleImageChosen(e.target.files?.[0])}
                />
              </div>
            </div>
          </div>

          <hr className="cs-svc-details__divider" />

          <div className="cs-svc-details__field">
            <span className="cs-svc-details__label">Required forms</span>
            {formsError ? (
              <p role="alert" className="cs-svc-helper cs-svc-helper--error">{formsError}</p>
            ) : forms.length === 0 ? (
              <p className="cs-svc-helper">No client-facing forms yet. Create them on the Forms page.</p>
            ) : (
              <div className="cs-svc-forms">
                {forms.map((item) => {
                  const appliesToAll = item.appliesToAllServices;
                  const categoryName = categories.find((c) => c.id === form.categoryId && (item.categoryIds ?? []).includes(c.id))?.name;
                  const checked = appliesToAll || Boolean(categoryName) || form.formIds.includes(item.id);
                  return (
                    <label key={item.id} className={`cs-svc-form-row${checked ? "" : " is-off"}`}>
                      <input
                        type="checkbox"
                        className="cs-check"
                        checked={checked}
                        disabled={appliesToAll || Boolean(categoryName) || !canManageForms}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setForm((c) => ({
                            ...c,
                            formIds: next ? [...c.formIds, item.id] : c.formIds.filter((id) => id !== item.id),
                          }));
                        }}
                      />
                      <span className="cs-svc-form-row__name">{item.name}</span>
                      <span className="cs-svc-form-row__meta">
                        {appliesToAll
                          ? "Required for every service"
                          : categoryName
                            ? `Required by ${categoryName}`
                          : checked
                            ? FORM_TIMING_LABELS[item.customerPromptTiming ?? "pre_booking"] ?? "Required"
                            : "Not required"}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {forms.length > 0 && !canManageForms ? (
              <p className="cs-svc-helper">Changing required forms needs the settings permission.</p>
            ) : null}
          </div>

          <div className="cs-svc-details__field">
            <span className="cs-svc-details__label">Available at locations</span>
            <div className="cs-svc-chips">
              {locations.map((loc) => (
                <label key={loc.id} className="cs-svc-chip">
                  <input type="checkbox" className="cs-check"
                    checked={form.locationIds.includes(loc.id)}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setForm((c) => ({ ...c, locationIds: next ? [...c.locationIds, loc.id] : c.locationIds.filter((id) => id !== loc.id) }));
                    }} />
                  {loc.name}
                </label>
              ))}
            </div>
          </div>
        </div>
      </fieldset>
    </form>
  );
}

/** A link into the Staff page: in-app navigation when inside the router, a plain link otherwise. */
function StaffLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const inRouter = useInRouterContext();
  return inRouter ? (
    <Link to={to} className={className}>{children}</Link>
  ) : (
    <a href={to} className={className}>{children}</a>
  );
}

/** How a provider is paid by default, from their Team pay setting. */
function describeTeamPay(provider: ProviderSummary): string {
  switch (provider.compensationMode) {
    case "service_percent":
      return `${(provider.compensationServicePercentBp ?? 0) / 100}% of service revenue`;
    case "flat_per_booking":
      return `${formatMoney(provider.compensationFlatCents ?? 0)} per booking`;
    case "hourly":
      return `${formatMoney(provider.compensationHourlyCents ?? 0)} per hour`;
    case "sliding_scale":
      return "a sliding scale";
    default:
      return "no pay set";
  }
}

/** What the default pay setting earns on one booking, when it can be worked out from the price alone. */
function teamPayEarnsCents(provider: ProviderSummary, priceCents: number): number | null {
  if (provider.compensationMode === "service_percent") {
    return Math.round((priceCents * (provider.compensationServicePercentBp ?? 0)) / 10_000);
  }
  if (provider.compensationMode === "flat_per_booking") return provider.compensationFlatCents ?? 0;
  return null;
}

function ServiceStaffTab({
  service, eligibleProviders, assignedProviderIds, toggleProviderAssignment,
  variantByProvider, updateVariant, variantTexts, patchVariantText, canManage,
  variantsLoaded, isVariantsDirty, variantsSaving, handleSaveVariants,
  baseDurationMinutes, basePriceCents, baseDepositCents, tenantSlug, storefrontBaseUrl,
  form, setForm, saving, handleSave, category, setProviderBookable, setProviderBookingSlug,
}: {
  category: ServiceCategorySummary | null;
  /** Saves the provider's booking link straight away; resolves to an error message or null. */
  setProviderBookingSlug: (providerId: string, slug: string) => Promise<string | null>;
  /** Online booking is a setting on the provider, so it saves straight away and applies to every treatment. */
  setProviderBookable: (providerId: string, bookable: boolean) => Promise<void>;
  service: ServiceSummary;
  eligibleProviders: ProviderSummary[];
  assignedProviderIds: Set<string>;
  toggleProviderAssignment: (providerId: string) => Promise<void>;
  variantByProvider: Map<string, ProviderServiceVariantEntry>;
  updateVariant: (providerId: string, patch: Partial<ProviderServiceVariantEntry>) => void;
  variantTexts: Record<string, { duration: string; price: string; deposit: string; flat: string; percent: string }>;
  patchVariantText: (
    providerId: string,
    field: "duration" | "price" | "deposit" | "flat" | "percent",
    raw: string,
  ) => void;
  canManage: boolean;
  variantsLoaded: boolean;
  isVariantsDirty: boolean;
  variantsSaving: boolean;
  handleSaveVariants: (quiet?: boolean) => Promise<void>;
  baseDurationMinutes: number;
  basePriceCents: number;
  baseDepositCents: number;
  tenantSlug: string;
  storefrontBaseUrl: string;
  form: ServiceCardState;
  setForm: React.Dispatch<React.SetStateAction<ServiceCardState>>;
  saving: boolean;
  handleSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const selectionCategoryName = category?.name ?? "its category";
  const selectionInherited = category?.providerSelectionMode ?? "client_choice";
  // Following the category until the operator picks something else.
  const shownSelection = form.providerSelectionMode || selectionInherited;
  // The provider whose settings panel is open.
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [linkHint, setLinkHint] = useState<string | null>(null);
  // The booking link being typed, and any problem saving it.
  // The ending being typed, remembered per provider so switching people never shows someone else's draft.
  const [slugEdit, setSlugEdit] = useState<{ providerId: string; value: string } | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [slugSaving, setSlugSaving] = useState(false);
  useEffect(() => { setSelectedProviderId(null); setLinkHint(null); }, [service.id]);
  useEffect(() => { setLinkHint(null); setSlugError(null); }, [selectedProviderId]);
  if (eligibleProviders.length === 0) {
    return (
      <div className="cs-svc-detail-form">
        <div className="cs-svc-card">
          <p className="cs-svc-helper">No active providers configured. Add staff in the Staff tab first.</p>
        </div>
      </div>
    );
  }

  const offered = eligibleProviders.filter((p) => assignedProviderIds.has(p.id));
  const notOffered = eligibleProviders.filter((p) => !assignedProviderIds.has(p.id));
  const selectedProvider = offered.find((p) => p.id === selectedProviderId) ?? null;

  const selectOnFocus = (event: React.FocusEvent<HTMLInputElement>) => event.target.select();
  const keepSelection = (event: React.MouseEvent<HTMLInputElement>) => event.preventDefault();

  const renderProviderRow = (provider: ProviderSummary) => {
    const isAssigned = assignedProviderIds.has(provider.id);
    const avatar = (
      <span
        className="cs-override-table__avatar"
        style={provider.imageUrl ? undefined : { background: avatarColorFor(provider.id) }}
        aria-hidden="true"
      >
        {provider.imageUrl ? <img src={provider.imageUrl} alt="" /> : initialsFor(provider.name)}
      </span>
    );
    const names = (
      <span className="cs-override-table__lead-text">
        <span className="cs-override-table__name">{provider.name}</span>
      </span>
    );
    const checkbox = (
      <input
        type="checkbox"
        className="cs-check"
        aria-label={`Toggle ${provider.name}`}
        checked={isAssigned}
        disabled={!canManage}
        onChange={() => {
          if (isAssigned && selectedProviderId === provider.id) setSelectedProviderId(null);
          void toggleProviderAssignment(provider.id);
        }}
      />
    );

    if (!isAssigned) {
      return (
        <div key={provider.id} className="cs-override-table__row cs-override-table__row--off">
          <span className="cs-override-table__lead cs-override-table__lead--static">
            {checkbox}
            {avatar}
            {names}
          </span>
          <p className="cs-override-table__note">
            {canManage ? "Not offering this treatment — tick to add it to their menu" : "Doesn't offer this treatment"}
          </p>
        </div>
      );
    }

    const text = variantTexts[provider.id] ?? { duration: "", price: "", deposit: "", flat: "", percent: "" };
    const selected = selectedProviderId === provider.id;
    const open = () => setSelectedProviderId(selected ? null : provider.id);

    return (
      <div key={provider.id} className={`cs-override-table__row cs-override-table__row--staff${selected ? " is-selected" : ""}`}>
        <span className="cs-override-table__lead cs-override-table__lead--static">
          {checkbox}
          <button
            type="button"
            className="cs-override-table__open"
            aria-label={`Open settings for ${provider.name}`}
            aria-expanded={selected}
            onClick={open}
          >
            {avatar}
            {names}
          </button>
        </span>

        <div className="cs-override-table__cell cs-override-table__cell--prefix" data-label="Price">
          <input
            className="cs-override-table__field"
            type="text" inputMode="decimal"
            disabled={!canManage}
            placeholder={formatMoneyShort(basePriceCents)}
            value={text.price || (basePriceCents / 100).toFixed(2)}
            onFocus={selectOnFocus}
            onMouseUp={keepSelection}
            onChange={(e) => patchVariantText(provider.id, "price", e.target.value)}
            aria-label={`${provider.name} price`}
          />
          <span className="cs-override-table__affix" aria-hidden="true">$</span>
        </div>

        <div className="cs-override-table__cell cs-override-table__cell--suffix" data-label="Duration">
          <input
            className="cs-override-table__field"
            type="text" inputMode="numeric"
            disabled={!canManage}
            placeholder={`${baseDurationMinutes} min`}
            value={text.duration || String(baseDurationMinutes)}
            onFocus={selectOnFocus}
            onMouseUp={keepSelection}
            onChange={(e) => patchVariantText(provider.id, "duration", e.target.value)}
            aria-label={`${provider.name} duration`}
          />
          {/* --chars lets CSS place the unit right after the typed digits. */}
          <span
            className="cs-override-table__affix"
            aria-hidden="true"
            style={{ "--chars": (text.duration || String(baseDurationMinutes)).length } as React.CSSProperties}
          >
            min
          </span>
        </div>

        <div className="cs-override-table__cell cs-override-table__cell--prefix" data-label="Deposit">
          <input
            className="cs-override-table__field"
            type="text" inputMode="decimal"
            disabled={!canManage}
            placeholder={formatMoneyShort(baseDepositCents)}
            value={text.deposit || (baseDepositCents / 100).toFixed(2)}
            onFocus={selectOnFocus}
            onMouseUp={keepSelection}
            onChange={(e) => patchVariantText(provider.id, "deposit", e.target.value)}
            aria-label={`${provider.name} deposit`}
          />
          <span className="cs-override-table__affix" aria-hidden="true">$</span>
        </div>

        <button type="button" className="cs-override-table__online" onClick={open} aria-label={`${provider.name} online booking: ${provider.isBookableOnline ? "online" : "calendar only"}`} tabIndex={-1}>
          <span className={`cs-override-table__status${provider.isBookableOnline ? " is-online" : ""}`}>
            {provider.isBookableOnline ? "Online" : "Calendar only"}
          </span>
          <span className="cs-override-table__chevron" aria-hidden="true">›</span>
        </button>
      </div>
    );
  };

  // What clients see on the storefront: the cheapest price among providers they can book online.
  const bookableOnline = offered.filter((p) => p.isBookableOnline);
  const onlinePrices = bookableOnline.map((p) => variantByProvider.get(p.id)?.priceCents ?? basePriceCents);
  const lowestOnlinePrice = onlinePrices.length > 0 ? Math.min(...onlinePrices) : null;
  const storefrontPrice =
    lowestOnlinePrice === null
      ? null
      : onlinePrices.some((price) => price !== lowestOnlinePrice)
        ? `from ${formatMoney(lowestOnlinePrice)}`
        : formatMoney(lowestOnlinePrice);

  const renderPanel = (provider: ProviderSummary) => {
    const entry = variantByProvider.get(provider.id) ?? {
      providerId: provider.id, priceCents: null, durationMinutes: null,
      depositCents: null, commissionFlatCents: null, commissionBasisPoints: null,
    };
    const text = variantTexts[provider.id] ?? { duration: "", price: "", deposit: "", flat: "", percent: "" };
    const firstName = provider.name.split(" ")[0] ?? provider.name;
    const payMode: "default" | "percent" | "flat" =
      entry.commissionFlatCents != null ? "flat" : entry.commissionBasisPoints != null ? "percent" : "default";
    const visitPrice = entry.priceCents ?? basePriceCents;
    const visitDuration = entry.durationMinutes ?? baseDurationMinutes;
    const teamPay = describeTeamPay(provider);
    const earns =
      payMode === "flat"
        ? entry.commissionFlatCents
        : payMode === "percent"
          ? Math.round((visitPrice * (entry.commissionBasisPoints ?? 0)) / 10_000)
          : teamPayEarnsCents(provider, visitPrice);
    const setPayMode = (mode: "default" | "percent" | "flat") => {
      if (mode === payMode) return;
      // Start from the staff member's own pay setting, converted at this treatment's price when it's the other kind, so nothing resets to zero.
      const teamPercentBp =
        provider.compensationMode === "service_percent"
          ? provider.compensationServicePercentBp ?? 0
          : provider.compensationMode === "flat_per_booking" && visitPrice > 0
            ? Math.min(10_000, Math.round(((provider.compensationFlatCents ?? 0) * 10_000) / visitPrice))
            : 0;
      const teamFlatCents =
        provider.compensationMode === "flat_per_booking"
          ? provider.compensationFlatCents ?? 0
          : provider.compensationMode === "service_percent"
            ? Math.round((visitPrice * (provider.compensationServicePercentBp ?? 0)) / 10_000)
            : 0;
      patchVariantText(provider.id, "flat", mode === "flat" ? (teamFlatCents / 100).toFixed(2) : "");
      patchVariantText(provider.id, "percent", mode === "percent" ? (teamPercentBp / 100).toString() : "");
      if (mode === "default") updateVariant(provider.id, { commissionFlatCents: null, commissionBasisPoints: null });
      else if (mode === "percent") updateVariant(provider.id, { commissionFlatCents: null, commissionBasisPoints: teamPercentBp });
      else updateVariant(provider.id, { commissionBasisPoints: null, commissionFlatCents: teamFlatCents });
    };
    const bookingLink = provider.bookingUrl ?? null;
    const savedSlug = provider.bookingSlug ?? "";
    const slugDraft = slugEdit?.providerId === provider.id ? slugEdit.value : savedSlug;
    const slugChanged = slugDraft.trim() !== savedSlug;

    return (
      <aside className="cs-svc-staff-panel" aria-label={`${provider.name} settings`}>
        <header className="cs-svc-staff-panel__head">
          <span
            className="cs-override-table__avatar cs-svc-staff-panel__avatar"
            style={provider.imageUrl ? undefined : { background: avatarColorFor(provider.id) }}
            aria-hidden="true"
          >
            {provider.imageUrl ? <img src={provider.imageUrl} alt="" /> : initialsFor(provider.name)}
          </span>
          <span className="cs-svc-staff-panel__who">
            <h4 className="cs-svc-staff-panel__name">{provider.name}</h4>
            <span className="cs-svc-staff-panel__meta">
              {[service.name, formatMoney(visitPrice), formatDurationMinutes(visitDuration)].join(" · ")}
            </span>
          </span>
          <button type="button" className="cs-svc-staff-panel__close" aria-label="Close" onClick={() => setSelectedProviderId(null)}>
            ×
          </button>
        </header>

        <section className="cs-svc-staff-panel__section">
          <h5 className="cs-svc-staff-panel__label">Pay for this treatment</h5>
          <div className="cs-svc-staff-panel__segments" role="group" aria-label="Pay for this treatment">
            {([
              ["default", "Staff default"],
              ["percent", "% of price"],
              ["flat", "Flat per booking"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`cs-svc-staff-panel__segment${payMode === mode ? " is-active" : ""}`}
                aria-pressed={payMode === mode}
                disabled={!canManage}
                onClick={() => setPayMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {payMode === "default" ? (
            <div className="cs-svc-staff-panel__note">
              <span>
                Uses {firstName}&apos;s Team pay setting: <strong>{teamPay}</strong>
              </span>
              <StaffLink className="cs-svc-staff-panel__link" to={`/staff?provider=${provider.id}&tab=compensation`}>
                Edit in Staff
              </StaffLink>
            </div>
          ) : payMode === "percent" ? (
            <label className="cs-svc-staff-panel__field">
              <span>Percent of the price</span>
              <span className="cs-svc-staff-panel__input">
                <input
                  type="text" inputMode="decimal"
                  disabled={!canManage}
                  placeholder="0"
                  value={text.percent}
                  onFocus={selectOnFocus}
                  onChange={(e) => patchVariantText(provider.id, "percent", e.target.value)}
                  aria-label={`${provider.name} pay percent`}
                />
                <span aria-hidden="true">%</span>
              </span>
            </label>
          ) : (
            <label className="cs-svc-staff-panel__field">
              <span>Amount per booking</span>
              <span className="cs-svc-staff-panel__input">
                <span aria-hidden="true">$</span>
                <input
                  type="text" inputMode="decimal"
                  disabled={!canManage}
                  placeholder="0.00"
                  value={text.flat}
                  onFocus={selectOnFocus}
                  onChange={(e) => patchVariantText(provider.id, "flat", e.target.value)}
                  aria-label={`${provider.name} pay flat amount`}
                />
              </span>
            </label>
          )}
          <div className="cs-svc-staff-panel__earns">
            <span>Earns per booking</span>
            <strong>{earns == null ? "—" : formatMoney(earns)}</strong>
          </div>
        </section>

        <section className="cs-svc-staff-panel__section">
          <h5 className="cs-svc-staff-panel__label">Online booking</h5>
          <div className="cs-svc-staff-panel__toggle">
            <span className="cs-svc-staff-panel__toggle-text">
              <span className="cs-svc-staff-panel__toggle-title">Bookable online</span>
              <span className="cs-svc-staff-panel__hint">
                Clients can choose {firstName} on the storefront and through their link.
              </span>
            </span>
            <button
              type="button"
              className={`cs-switch${provider.isBookableOnline ? "" : " cs-switch--off"}`}
              aria-label={`${provider.name} bookable online toggle`}
              aria-pressed={provider.isBookableOnline}
              disabled={!canManage}
              onClick={() => void setProviderBookable(provider.id, !provider.isBookableOnline)}
            />
          </div>
          <p className="cs-svc-staff-panel__hint">Applies to all of {firstName}&apos;s treatments, not just this one.</p>
        </section>

        <section className="cs-svc-staff-panel__section">
          <h5 className="cs-svc-staff-panel__label">Booking link</h5>
          <div className="cs-svc-staff-panel__link-box">
            <span
              className="cs-svc-staff-panel__prefix"
              title={`${storefrontBaseUrl}/${tenantSlug}/p/`}
              aria-hidden="true"
            >
              {`…/${tenantSlug}/p/`}
            </span>
            <input
              className="cs-svc-staff-panel__slug"
              type="text"
              aria-label={`${provider.name} booking link`}
              value={slugDraft}
              disabled={!canManage || slugSaving}
              placeholder="your-name"
              maxLength={100}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => { setSlugEdit({ providerId: provider.id, value: e.target.value.toLowerCase().replace(/\s+/g, "-") }); setSlugError(null); setLinkHint(null); }}
            />
          </div>
          {slugError ? <p role="alert" className="cs-svc-helper cs-svc-helper--error">{slugError}</p> : null}
          <div className="cs-svc-staff-panel__link-actions">
            {canManage ? (
              <button
                type="button"
                className="cs-svc-pill-btn cs-svc-pill-btn--primary"
                disabled={slugSaving || !slugChanged}
                onClick={async () => {
                  const trimmed = slugDraft.trim();
                  if (trimmed && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
                    setSlugError("Use letters, numbers and single hyphens only.");
                    return;
                  }
                  setSlugSaving(true);
                  const problem = await setProviderBookingSlug(provider.id, trimmed);
                  setSlugError(problem);
                  if (problem === null) setSlugEdit(null);
                  setSlugSaving(false);
                }}
              >
                {slugSaving ? "Saving…" : "Save link"}
              </button>
            ) : null}
            <button
              type="button"
              className="cs-svc-pill-btn"
              disabled={!bookingLink || slugChanged}
              title={slugChanged ? "Save the link first" : undefined}
              onClick={() => {
                if (!bookingLink) return;
                void navigator.clipboard.writeText(bookingLink).then(
                  () => setLinkHint("Link copied!"),
                  () => setLinkHint("Copy failed."),
                );
              }}
            >
              Copy link
            </button>
          </div>
          {linkHint ? <p className="cs-svc-helper cs-svc-helper--ok">{linkHint}</p> : null}
          <p className="cs-svc-staff-panel__hint">
            {bookingLink
              ? `Opens ${firstName}'s storefront page with only their times. Share it in bios, emails or texts.`
              : `${firstName} has no booking link yet. Pick one above and save it.`}
          </p>
        </section>

        <footer className="cs-svc-staff-panel__foot">
          <button type="button" className="cs-svc-pill-btn cs-svc-pill-btn--primary" onClick={() => setSelectedProviderId(null)}>
            Done
          </button>
        </footer>
      </aside>
    );
  };

  return (
    <div className="cs-svc-detail-form">
      <div className={`cs-svc-staff-layout${selectedProvider ? " has-panel" : ""}`}>
        <div className="cs-svc-staff-main">
        <section className="cs-svc-card" aria-label="Staff">
          <header className="cs-svc-card__head cs-svc-card__head--stack">
            <h3 className="cs-svc-card__title">Who performs this</h3>
            <p className="cs-svc-helper">
              {canManage ? "Click a name for pay, online booking and their booking link. " : ""}
              Blank fields inherit the base treatment — inherited values show <em>italic and dotted</em>.
            </p>
          </header>

          {!variantsLoaded ? (
            <p className="cs-svc-helper">Loading…</p>
          ) : (
            <div className="cs-override-table">
              <div className="cs-override-table__columns" aria-hidden="true">
                <span>Provider</span>
                <span>Price</span>
                <span>Duration</span>
                <span>Deposit</span>
                <span>Online booking</span>
              </div>

              {selectedProvider ? (
                <button type="button" className="cs-link-btn cs-override-table__back" onClick={() => setSelectedProviderId(null)}>
                  ← All staff
                </button>
              ) : null}

              <div className="cs-override-table__list">
                {selectedProvider ? (
                  renderProviderRow(selectedProvider)
                ) : (
                  <>
                    {offered.map(renderProviderRow)}
                    {notOffered.map(renderProviderRow)}
                  </>
                )}
              </div>

              {canManage && !selectedProvider && (offered.length > 0 || notOffered.length > 0) ? (
                <div className="cs-override-table__group-foot">
                  {offered.length > 0 ? (
                    <button type="button" className="cs-link-btn"
                      onClick={() => {
                        setSelectedProviderId(null);
                        for (const p of offered) void toggleProviderAssignment(p.id);
                      }}>Disable all</button>
                  ) : null}
                  {notOffered.length > 0 ? (
                    <button type="button" className="cs-link-btn"
                      onClick={() => {
                        for (const p of notOffered) void toggleProviderAssignment(p.id);
                      }}>Enable all</button>
                  ) : null}
                </div>
              ) : null}

              <p className="cs-svc-staff-summary" hidden={selectedProvider !== null}>
                {storefrontPrice === null
                  ? "No one is bookable online for this treatment yet."
                  : <>Storefront shows <strong>{storefrontPrice}</strong> · {bookableOnline.length} of {offered.length} bookable online</>}
              </p>
            </div>
          )}
        </section>

        <div className="cs-svc-card">
          <span className="cs-svc-card__eyebrow">Client selection on booking</span>
          <div className="cs-svc-selection">
            {([
              ["client_choice", "Let clients choose their artist", "Clients see all eligible staff and pick one when booking online."],
              ["auto_assign", "Assign automatically", "Distribute bookings evenly across eligible staff. Best for fairness."],
              ["hide", "Hide artist selection", "Clients book the service without seeing who'll perform it. Useful for new staff or training periods."],
            ] as const).map(([mode, title, helper]) => (
              <label
                key={mode}
                className={`cs-svc-selection-opt${shownSelection === mode ? " cs-svc-selection-opt--active" : ""}`}
              >
                <input type="radio" name="clientSelection" value={mode}
                  className="cs-visually-hidden"
                  checked={shownSelection === mode}
                  onChange={() => setForm((c) => ({ ...c, providerSelectionMode: mode }))}
                  disabled={!canManage} />
                <span className={`cs-svc-radio${shownSelection === mode ? " cs-svc-radio--on" : ""}`} aria-hidden="true" />
                <span className="cs-svc-selection-opt__text">
                  <span className="cs-svc-selection-opt__title">{title}</span>
                  <span className="cs-svc-helper">{helper}</span>
                </span>
              </label>
            ))}
          </div>
          {form.providerSelectionMode === "" ? (
            <p className="cs-svc-helper">Following {selectionCategoryName}. Choose another option to set this service&apos;s own.</p>
          ) : null}
        </div>
        </div>

        {selectedProvider ? renderPanel(selectedProvider) : null}
      </div>

    </div>
  );
}

function ServiceOnlineBookingTab({
  service, formId, form, setForm, canManage, schedulingHref, handleCopyLink, copyHint,
  saving, handleSave, category,
}: {
  service: ServiceSummary;
  formId: string;
  form: ServiceCardState;
  setForm: React.Dispatch<React.SetStateAction<ServiceCardState>>;
  canManage: boolean;
  schedulingHref: string;
  handleCopyLink: () => Promise<void>;
  copyHint: string | null;
  saving: boolean;
  handleSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  category: ServiceCategorySummary | null;
}) {
  const priceCents = parseMoneyInput(form.priceAmount) ?? 0;
  const prettyUrl = schedulingHref.replace(/^https?:\/\//, "");
  // A service starts out following its category. The category's values are shown as the
  // current choice; changing one makes it this service's own.
  const categoryName = category?.name ?? "its category";
  const followingPayment = form.bookingPaymentMode === "";
  const shownPayment = followingPayment
    ? {
        mode: category?.bookingPaymentMode ?? "none",
        valueAmount: category?.bookingPaymentValueCents != null ? (category.bookingPaymentValueCents / 100).toFixed(2) : "",
        percent: category?.bookingPaymentPercent != null ? String(category.bookingPaymentPercent) : "",
      }
    : { mode: form.bookingPaymentMode, valueAmount: form.bookingPaymentValueAmount, percent: form.bookingPaymentPercent };
  const shownCard = form.requireCardOnFile ?? Boolean(category?.requireCardOnFile);
  const cardChoice = (value: boolean, label: string) => (
    <label className={`cs-svc-choice${shownCard === value ? " is-selected" : ""}`}>
      <input type="radio" name="requireCardOnFile" className="cs-svc-choice__radio"
        checked={shownCard === value}
        onChange={() => setForm((c) => ({ ...c, requireCardOnFile: value }))} />
      <span className="cs-svc-choice__label">{label}</span>
    </label>
  );

  return (
    <form id={formId} className="cs-svc-detail-form" onSubmit={handleSave}>
      <div className="cs-svc-card cs-svc-details">
        <fieldset className="cs-svc-fieldset cs-svc-fieldset--inline" disabled={!canManage || saving}>
          <div className="cs-svc-setting">
            <span className="cs-svc-setting__text">
              <span className="cs-svc-card__title">Bookable online</span>
              <span className="cs-svc-section__lead">Clients can find and book this on the storefront.</span>
            </span>
            <label className={`cs-switch${form.isActive ? "" : " cs-switch--off"}`} aria-label="Online booking toggle">
              <input type="checkbox" className="cs-switch__input" checked={form.isActive}
                onChange={(e) => setForm((c) => ({ ...c, isActive: e.target.checked }))} />
            </label>
          </div>

          <hr className="cs-svc-details__divider" />

          <div className="cs-svc-details__field">
            <span className="cs-svc-details__label">Taken at booking</span>
            <PaymentRuleChoices
              name="bookingPaymentMode"
              ariaLabel="Taken at booking"
              mode={shownPayment.mode}
              valueAmount={shownPayment.valueAmount}
              percent={shownPayment.percent}
              priceCents={priceCents}
              onChange={(patch) => setForm((c) => ({
                ...c,
                // The first edit turns the inherited values into this service's own.
                bookingPaymentMode: patch.mode ?? shownPayment.mode,
                bookingPaymentValueAmount: patch.valueAmount ?? shownPayment.valueAmount,
                bookingPaymentPercent: patch.percent ?? shownPayment.percent,
              }))}
            />
            {followingPayment ? (
              <p className="cs-svc-helper">Following {categoryName}. Change it to set this service&apos;s own.</p>
            ) : null}
            <p className="cs-svc-helper">
              A deposit set for a provider on the Staff tab takes priority, and add-ons count toward full and
              percentage payments. Refunds on cancellation follow your cancellation rules in Settings.
            </p>
          </div>

          <hr className="cs-svc-details__divider" />

          <div className="cs-svc-details__field" role="radiogroup" aria-label="Require a card on file">
            <span className="cs-svc-details__label">Require a card on file</span>
            <span className="cs-svc-section__lead">
              Not active yet — clients aren&apos;t asked for a card at booking until card collection is added.
            </span>
            <div className="cs-svc-choices">
              {cardChoice(true, "Required")}
              {cardChoice(false, "Not required")}
            </div>
            {form.requireCardOnFile === null ? (
              <p className="cs-svc-helper">Following {categoryName}. Change it to set this service&apos;s own.</p>
            ) : null}
          </div>

          <hr className="cs-svc-details__divider" />

          <div className="cs-svc-setting cs-svc-setting--stack">
            <span className="cs-svc-setting__text">
              <span className="cs-svc-card__title">Financing</span>
              <span className="cs-svc-section__lead">
                {service.effectiveFinancing
                  ? `Shows “or ${formatMoney(service.effectiveFinancing.monthlyCents)}/mo” with a “${service.effectiveFinancing.buttonText}” button.`
                  : form.financingMode === "off"
                    ? "No financing is shown for this service."
                    : form.financingMode === "" && category?.financingMode !== "on"
                      ? `Off. ${categoryName} doesn't offer financing; choose Show financing to offer it on this service.`
                      : "Not shown yet. Set up the financing link under Settings → Marketing."}
              </span>
            </span>
            <label className="cs-svc-details__field cs-svc-details__field--half">
              <span className="cs-svc-details__label">Financing link</span>
              <select className="cs-svc-details__input" value={form.financingMode} disabled={!canManage}
                aria-label="Financing"
                onChange={(e) => setForm((c) => ({ ...c, financingMode: e.target.value }))}>
                <option value="">Same as {categoryName}</option>
                <option value="on">Show financing</option>
                <option value="off">Don&apos;t show financing</option>
                <option value="custom">Use a different link</option>
              </select>
            </label>
            {form.financingMode === "custom" ? (
              <label className="cs-svc-details__field">
                <span className="cs-svc-details__label">Link for this service</span>
                <input className="cs-svc-details__input" type="url" maxLength={2048} placeholder="https://"
                  value={form.financingUrl} disabled={!canManage}
                  onChange={(e) => setForm((c) => ({ ...c, financingUrl: e.target.value }))} />
              </label>
            ) : null}
          </div>

          <hr className="cs-svc-details__divider" />

          <div className="cs-svc-details__grid">
            <label className="cs-svc-details__field cs-svc-details__field--half">
              <span className="cs-svc-details__label">URL slug</span>
              <input className="cs-svc-details__input" value={form.slug} placeholder="auto from name when blank"
                onChange={(e) => setForm((c) => ({ ...c, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))} />
            </label>
            <label className="cs-svc-details__field cs-svc-details__field--half">
              <span className="cs-svc-details__label">Scarcity hint</span>
              <input className="cs-svc-details__input" value={form.scarcityHint} placeholder="e.g. 3 spots left this week"
                onChange={(e) => setForm((c) => ({ ...c, scarcityHint: e.target.value }))} />
            </label>
          </div>
          <label className="cs-svc-details__field">
            <span className="cs-svc-details__label">Meta description</span>
            <textarea className="cs-svc-details__input cs-svc-details__textarea" rows={2} maxLength={320}
              value={form.metaDescription} placeholder="Shown in search results and link previews."
              onChange={(e) => setForm((c) => ({ ...c, metaDescription: e.target.value }))} />
          </label>
          <label className="cs-svc-details__field">
            <span className="cs-svc-details__label">Booking page description</span>
            <textarea className="cs-svc-details__input cs-svc-details__textarea" rows={2} maxLength={2000}
              value={form.onlineBookingDescription}
              placeholder="Optional — shown on the booking page instead of the client-facing description."
              onChange={(e) => setForm((c) => ({ ...c, onlineBookingDescription: e.target.value }))} />
          </label>
        </fieldset>

          {form.isActive ? (
            <div className="cs-svc-live">
              <span className="cs-svc-live__text">
                <span className="cs-svc-live__title">Live on the storefront</span>
                <span className="cs-svc-live__url">{prettyUrl}</span>
                {copyHint ? <span className="cs-svc-helper cs-svc-helper--ok">{copyHint}</span> : null}
              </span>
              <span className="cs-svc-live__actions">
                <button type="button" className="cs-link-btn" onClick={handleCopyLink}>Copy link</button>
                <a className="cs-svc-pill-btn cs-svc-live__preview" href={schedulingHref} target="_blank" rel="noreferrer">
                  Preview ↗
                </a>
              </span>
            </div>
          ) : (
            <div className="cs-svc-live cs-svc-live--off">
              <span className="cs-svc-live__text">
                <span className="cs-svc-live__title">Hidden from the storefront</span>
                <span className="cs-svc-live__url">Turn on Bookable online to publish it.</span>
              </span>
            </div>
          )}
      </div>
    </form>
  );
}

// ===========================================================================
// Resources tab
// ===========================================================================

type NewResourceDraft = {
  kind: "room" | "equipment";
  name: string;
  quantity: string;
  locationId: string;
  notes: string;
};

function serializeAttached(map: Map<string, number>): string {
  return JSON.stringify([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function ServiceResourcesTab({
  service, tenantSlug, locations, canManage, canCreateResources, onSaved, saveRef,
}: {
  service: ServiceSummary;
  tenantSlug: string;
  locations: LocationSummary[];
  canManage: boolean;
  /** Creating a resource is a settings action (settings.manage). */
  canCreateResources: boolean;
  onSaved: (msg?: string) => void;
  /** Lets the header Save include this tab's unsaved rows. */
  saveRef: React.MutableRefObject<((quiet?: boolean) => Promise<void>) | null>;
}) {
  const [allResources, setAllResources] = useState<ResourceSummary[]>([]);
  const [attached, setAttached] = useState<Map<string, number>>(new Map());
  const [savedKey, setSavedKey] = useState(serializeAttached(new Map()));
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState<NewResourceDraft | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [resList, svcRes] = await Promise.all([
          platformApi.listResources(tenantSlug),
          platformApi.getServiceResources(tenantSlug, service.id),
        ]);
        if (cancelled) return;
        setAllResources(resList.items.filter((r) => r.isActive));
        const map = new Map<string, number>();
        for (const entry of svcRes.resources) {
          map.set(entry.resourceId, entry.quantity);
        }
        setAttached(map);
        setSavedKey(serializeAttached(map));
        setLoadError(null);
        setLoaded(true);
      } catch (error) {
        if (!cancelled) {
          setLoadError(readErrorMessage(error, "Unable to load resources."));
          setLoaded(true);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [tenantSlug, service.id]);

  const isDirty = serializeAttached(attached) !== savedKey;

  const toggleResource = (resourceId: string) => {
    setAttached((prev) => {
      const next = new Map(prev);
      if (next.has(resourceId)) {
        next.delete(resourceId);
      } else {
        next.set(resourceId, 1);
      }
      return next;
    });
  };

  const setQuantity = (resourceId: string, qty: number) => {
    if (qty < 1) return;
    setAttached((prev) => {
      const next = new Map(prev);
      next.set(resourceId, qty);
      return next;
    });
  };

  const handleSave = async (quiet = false) => {
    if (!canManage) return;
    setSaving(true);
    try {
      const resources = Array.from(attached.entries()).map(([resourceId, quantity]) => ({
        resourceId,
        quantity,
      }));
      await platformApi.replaceServiceResources(tenantSlug, service.id, { resources });
      setSavedKey(serializeAttached(attached));
      onSaved(quiet ? undefined : "Resources saved.");
    } catch (err) {
      onSaved(readErrorMessage(err, "Unable to save resources."));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    saveRef.current = isDirty ? handleSave : null;
    return () => { saveRef.current = null; };
  });

  const startAdding = (kind: NewResourceDraft["kind"]) => {
    setAddError(null);
    setAdding({ kind, name: "", quantity: "1", locationId: "", notes: "" });
  };

  // Create the resource, then tick it for this service (saved with "Save resources").
  const createResource = async () => {
    if (!adding) return;
    const name = adding.name.trim();
    if (!name) { setAddError("Give it a name."); return; }
    const units = adding.kind === "room" ? 1 : Number(adding.quantity);
    if (!Number.isInteger(units) || units < 1 || units > 100) {
      setAddError("Units owned must be a whole number from 1 to 100.");
      return;
    }
    setCreating(true);
    setAddError(null);
    try {
      const created = await platformApi.createResource(tenantSlug, {
        name,
        kind: adding.kind,
        quantity: units,
        locationId: adding.locationId || null,
        notes: adding.notes.trim() || undefined,
      });
      setAllResources((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setAttached((prev) => new Map(prev).set(created.id, 1));
      setAdding(null);
    } catch (error) {
      setAddError(readErrorMessage(error, "Unable to add resource."));
    } finally {
      setCreating(false);
    }
  };

  if (!loaded) {
    return <div className="cs-svc-detail-form"><p className="cs-svc-helper">Loading…</p></div>;
  }

  if (loadError) {
    return (
      <div className="cs-svc-detail-form">
        <div className="cs-svc-card">
          <p role="alert" className="cs-svc-helper cs-svc-helper--error">{loadError}</p>
        </div>
      </div>
    );
  }

  const canAdd = canManage && canCreateResources;
  if (allResources.length === 0 && !canAdd) {
    return (
      <div className="cs-svc-detail-form">
        <div className="cs-svc-card">
          <p className="cs-svc-helper">No resources configured. Add rooms or equipment in Settings &amp; Management → Resources.</p>
        </div>
      </div>
    );
  }

  const rooms = allResources.filter((res) => res.kind === "room");
  const equipment = allResources.filter((res) => res.kind !== "room");

  const renderResourceRow = (res: ResourceSummary, tracksUnits: boolean) => {
    const isAttached = attached.has(res.id);
    const qty = attached.get(res.id) ?? 1;
    const locationName = res.locationId
      ? locations.find((loc) => loc.id === res.locationId)?.name ?? "One location only"
      : null;
    return (
      <div key={res.id} className={`cs-svc-row${isAttached ? "" : " cs-svc-row--off"}`}>
        <label className="cs-svc-row__main">
          <input
            type="checkbox"
            className="cs-check"
            aria-label={`Toggle ${res.name}`}
            checked={isAttached}
            disabled={!canManage}
            onChange={() => toggleResource(res.id)}
          />
          <span className="cs-svc-row__name">{res.name}</span>
          {locationName ? <span className="cs-svc-row__tag">{locationName}</span> : null}
        </label>
        {isAttached && tracksUnits ? (
          <label className="cs-svc-row__side">
            Uses
            <input
              className="cs-svc-row__qty"
              type="number"
              min={1}
              max={res.quantity}
              value={qty}
              onChange={(e) => setQuantity(res.id, Number(e.target.value))}
              disabled={!canManage}
              aria-label={`${res.name} units per booking`}
            />
            of {res.quantity} {res.quantity === 1 ? "unit" : "units"}
            {res.locationId ? "" : " studio-wide"}
          </label>
        ) : (
          <span className="cs-svc-row__side">
            {tracksUnits
              ? isAttached ? "" : "Not required"
              : res.notes?.trim() || (isAttached ? "" : "Not required")}
          </span>
        )}
      </div>
    );
  };

  const renderAddForm = (kind: NewResourceDraft["kind"]) => {
    if (!adding || adding.kind !== kind) return null;
    const label = kind === "room" ? "room" : "equipment";
    return (
      <div className="cs-svc-inline-form" role="group" aria-label={`New ${label}`}>
        <label className="cs-svc-details__field cs-svc-inline-form__wide">
          <span className="cs-svc-details__label">Name</span>
          <input className="cs-svc-details__input" value={adding.name} autoFocus
            placeholder={kind === "room" ? "e.g. Facial room 3" : "e.g. LED panel"}
            onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
        </label>
        {kind === "equipment" ? (
          <label className="cs-svc-details__field">
            <span className="cs-svc-details__label">Units owned</span>
            <input className="cs-svc-details__input" type="number" min={1} max={100} value={adding.quantity}
              onChange={(e) => setAdding({ ...adding, quantity: e.target.value })} />
          </label>
        ) : null}
        <label className={`cs-svc-details__field${kind === "room" ? " cs-svc-inline-form__wide" : ""}`}>
          <span className="cs-svc-details__label">Location</span>
          <select className="cs-svc-details__input" value={adding.locationId}
            onChange={(e) => setAdding({ ...adding, locationId: e.target.value })}>
            <option value="">All locations</option>
            {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
        </label>
        <label className="cs-svc-details__field cs-svc-inline-form__full">
          <span className="cs-svc-details__label">{kind === "room" ? "Features" : "Notes"}</span>
          <input className="cs-svc-details__input" value={adding.notes}
            placeholder={kind === "room" ? "e.g. Sink, steamer, LED panel" : "Optional"}
            onChange={(e) => setAdding({ ...adding, notes: e.target.value })} />
        </label>
        <div className="cs-svc-inline-form__actions">
          {addError ? <span role="alert" className="cs-svc-helper cs-svc-helper--error">{addError}</span> : null}
          <button type="button" className="cs-svc-pill-btn" onClick={() => setAdding(null)} disabled={creating}>Cancel</button>
          <button type="button" className="cs-svc-pill-btn cs-svc-pill-btn--primary" onClick={createResource} disabled={creating}>
            {creating ? "Adding…" : `Add ${label}`}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="cs-svc-detail-form">
      <div className="cs-svc-card cs-svc-resources-card">
        <section className="cs-svc-section" aria-label="Room">
          <div className="cs-svc-section__head">
            <h3 className="cs-svc-card__title">Room</h3>
            {canAdd && adding?.kind !== "room" ? (
              <button type="button" className="cs-link-btn" onClick={() => startAdding("room")}>+ Add room</button>
            ) : null}
          </div>
          <p className="cs-svc-section__lead">
            A slot only opens on the calendar when both a qualified provider and one of these rooms are free.
          </p>
          {renderAddForm("room")}
          {rooms.length > 0 ? (
            <div className="cs-svc-rows">{rooms.map((res) => renderResourceRow(res, false))}</div>
          ) : adding?.kind === "room" ? null : (
            <p className="cs-svc-helper">No rooms yet.</p>
          )}
        </section>
        <hr className="cs-svc-details__divider" />
        <section className="cs-svc-section" aria-label="Equipment">
          <div className="cs-svc-section__head">
            <h3 className="cs-svc-card__title">Equipment</h3>
            {canAdd && adding?.kind !== "equipment" ? (
              <button type="button" className="cs-link-btn" onClick={() => startAdding("equipment")}>+ Add equipment</button>
            ) : null}
          </div>
          <p className="cs-svc-section__lead">
            Tracked units also block on the calendar — booking stops once every unit is in use.
          </p>
          {renderAddForm("equipment")}
          {equipment.length > 0 ? (
            <div className="cs-svc-rows">{equipment.map((res) => renderResourceRow(res, true))}</div>
          ) : adding?.kind === "equipment" ? null : (
            <p className="cs-svc-helper">No equipment yet.</p>
          )}
        </section>
      </div>

      {canManage ? (
        <div className="cs-svc-actions">
          {isDirty ? <span className="cs-svc-helper">Unsaved changes</span> : null}
          <button type="button" className="cs-svc-save-btn" onClick={() => void handleSave()} disabled={saving || !isDirty}>
            {saving ? "Saving…" : "Save resources"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ===========================================================================
// Add-ons tab
// ===========================================================================

type AddOnDraft = { name: string; price: string; minutes: string; description: string };

const emptyAddOnDraft: AddOnDraft = { name: "", price: "", minutes: "0", description: "" };

function ServiceAddOnsTab({
  service, tenantSlug, canManage,
}: {
  service: ServiceSummary;
  tenantSlug: string;
  canManage: boolean;
}) {
  const [addOns, setAddOns] = useState<ServiceAddOn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // "new" while adding, an add-on id while editing it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AddOnDraft>(emptyAddOnDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    platformApi.listServiceAddOnsManaged(tenantSlug, service.id)
      .then((resp) => {
        if (cancelled) return;
        setAddOns(resp.items);
        setLoadError(null);
        setLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(readErrorMessage(error, "Unable to load add-ons."));
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [tenantSlug, service.id]);

  const startNew = () => { setDraft(emptyAddOnDraft); setFormError(null); setEditingId("new"); };
  const startEdit = (addOn: ServiceAddOn) => {
    setDraft({
      name: addOn.name,
      price: (addOn.priceCents / 100).toFixed(2),
      minutes: String(addOn.durationMinutes),
      description: addOn.description ?? "",
    });
    setFormError(null);
    setEditingId(addOn.id);
  };

  const submitDraft = async () => {
    const name = draft.name.trim();
    const priceCents = parseMoneyInput(draft.price);
    const minutes = Number(draft.minutes || 0);
    if (!name) { setFormError("Give the add-on a name."); return; }
    if (priceCents === null) { setFormError("Enter a valid price."); return; }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) {
      setFormError("Extra minutes must be a whole number from 0 to 240.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      if (editingId === "new") {
        const created = await platformApi.createServiceAddOn(tenantSlug, service.id, {
          name, priceCents, durationMinutes: minutes, description: draft.description.trim() || null,
        });
        setAddOns((prev) => [...prev, created]);
      } else if (editingId) {
        const description = draft.description.trim();
        const updated = await platformApi.updateServiceAddOn(tenantSlug, service.id, editingId, {
          name, priceCents, durationMinutes: minutes,
          ...(description ? { description } : { clearDescription: true }),
        });
        setAddOns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }
      setEditingId(null);
    } catch (error) {
      setFormError(readErrorMessage(error, "Unable to save add-on."));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (addOn: ServiceAddOn, isActive: boolean) => {
    setActionError(null);
    try {
      const updated = await platformApi.updateServiceAddOn(tenantSlug, service.id, addOn.id, { isActive });
      setAddOns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      setActionError(readErrorMessage(error, "Unable to update add-on."));
    }
  };

  const remove = async (addOn: ServiceAddOn) => {
    if (!window.confirm(`Delete "${addOn.name}"? Existing bookings keep it.`)) return;
    setActionError(null);
    try {
      await platformApi.deleteServiceAddOn(tenantSlug, service.id, addOn.id);
      setAddOns((prev) => prev.filter((item) => item.id !== addOn.id));
    } catch (error) {
      setActionError(readErrorMessage(error, "Unable to delete add-on."));
    }
  };

  const renderForm = () => (
    <div className="cs-svc-inline-form" role="group" aria-label={editingId === "new" ? "New add-on" : "Edit add-on"}>
      <label className="cs-svc-details__field cs-svc-inline-form__wide">
        <span className="cs-svc-details__label">Name</span>
        <input className="cs-svc-details__input" value={draft.name} autoFocus placeholder="e.g. LED therapy"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className="cs-svc-details__field">
        <span className="cs-svc-details__label">Price</span>
        <span className="cs-svc-unit cs-svc-unit--prefix">
          <input className="cs-svc-details__input" type="number" min={0} step="0.01" {...selectNumberOnFocus} value={draft.price}
            placeholder="0.00" onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          <span className="cs-svc-unit__affix" aria-hidden="true">$</span>
        </span>
      </label>
      <label className="cs-svc-details__field">
        <span className="cs-svc-details__label">Extra minutes</span>
        <span className="cs-svc-unit cs-svc-unit--suffix">
          <input className="cs-svc-details__input" type="number" min={0} max={240} step={5} {...selectNumberOnFocus} value={draft.minutes}
            onChange={(e) => setDraft({ ...draft, minutes: e.target.value })} />
          <span className="cs-svc-unit__affix" aria-hidden="true"
            style={{ "--chars": draft.minutes.length } as React.CSSProperties}>min</span>
        </span>
      </label>
      <label className="cs-svc-details__field cs-svc-inline-form__full">
        <span className="cs-svc-details__label">Description</span>
        <input className="cs-svc-details__input" value={draft.description}
          placeholder="Shown to clients when they pick add-ons (optional)"
          onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </label>
      <div className="cs-svc-inline-form__actions">
        {formError ? <span role="alert" className="cs-svc-helper cs-svc-helper--error">{formError}</span> : null}
        <button type="button" className="cs-svc-pill-btn" onClick={() => setEditingId(null)} disabled={busy}>Cancel</button>
        <button type="button" className="cs-svc-pill-btn cs-svc-pill-btn--primary" onClick={submitDraft} disabled={busy}>
          {busy ? "Saving…" : editingId === "new" ? "Add add-on" : "Save add-on"}
        </button>
      </div>
    </div>
  );

  if (!loaded) {
    return <div className="cs-svc-detail-form"><p className="cs-svc-helper">Loading…</p></div>;
  }

  const activeCount = addOns.filter((item) => item.isActive).length;

  return (
    <div className="cs-svc-detail-form">
      <div className="cs-svc-card cs-svc-resources-card">
        <section className="cs-svc-section" aria-label="Add-ons">
          <div className="cs-svc-section__head">
            <h3 className="cs-svc-card__title">
              Add-ons <span className="cs-svc-card__count">{activeCount} offered</span>
            </h3>
            {canManage && editingId !== "new" ? (
              <button type="button" className="cs-link-btn" onClick={startNew}>+ Add add-on</button>
            ) : null}
          </div>
          <p className="cs-svc-section__lead">
            Optional extras clients can pick when booking online, and staff can add from the calendar or at
            checkout. Extra minutes lengthen the appointment.
          </p>
          {loadError ? <p role="alert" className="cs-svc-helper cs-svc-helper--error">{loadError}</p> : null}
          {actionError ? <p role="alert" className="cs-svc-helper cs-svc-helper--error">{actionError}</p> : null}
          {editingId === "new" ? renderForm() : null}
          {addOns.length === 0 && editingId !== "new" && !loadError ? (
            <p className="cs-svc-helper">No add-ons yet.</p>
          ) : (
            <div className="cs-svc-rows">
              {addOns.map((addOn) =>
                editingId === addOn.id ? (
                  <div key={addOn.id}>{renderForm()}</div>
                ) : (
                  <div key={addOn.id} className={`cs-svc-row${addOn.isActive ? "" : " cs-svc-row--off"}`}>
                    <span className="cs-svc-row__main">
                      <span className="cs-svc-row__text">
                        <span className="cs-svc-row__name">{addOn.name}</span>
                        {addOn.description ? <span className="cs-svc-row__sub">{addOn.description}</span> : null}
                      </span>
                    </span>
                    <span className="cs-svc-row__side">
                      +{formatMoneyShort(addOn.priceCents)}
                      {addOn.durationMinutes > 0 ? ` · +${addOn.durationMinutes} min` : ""}
                      {addOn.isActive ? "" : " · Hidden from booking"}
                      {canManage ? (
                        <OverflowMenu
                          label={`${addOn.name} actions`}
                          items={[
                            { label: "Edit", onSelect: () => startEdit(addOn) },
                            addOn.isActive
                              ? { label: "Hide from booking", onSelect: () => setActive(addOn, false) }
                              : { label: "Offer again", onSelect: () => setActive(addOn, true) },
                            { label: "Delete", onSelect: () => remove(addOn), danger: true },
                          ]}
                        />
                      ) : null}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ===========================================================================
// Create dialog
// ===========================================================================

// ===========================================================================
// Create Category Dialog
// ===========================================================================

function CreateCategoryDialog({
  tenantSlug,
  onClose,
  onCreated,
  onStatus,
}: {
  tenantSlug: string;
  onClose: () => void;
  onCreated: (name: string) => Promise<void> | void;
  onStatus: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a category name.");
      return;
    }
    const body: CreateServiceCategoryRequest = { name: trimmedName };
    setSaving(true);
    try {
      await platformApi.createServiceCategory(tenantSlug, body);
      await onCreated(trimmedName);
    } catch (err) {
      onStatus(readErrorMessage(err, "Unable to create category."));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cs-modal" role="dialog" aria-modal="true" aria-label="Add category">
      <div className="cs-modal__panel">
        <header className="cs-modal__header">
          <h4>Add category</h4>
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="cs-modal__form" onSubmit={handleSubmit}>
          {error ? (
            <div className="cs-banner cs-banner--error">{error}</div>
          ) : null}
          <label>
            <span>Category name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Brows, Facials, Lamination"
              autoFocus
            />
          </label>
          <div className="cs-modal__actions">
            <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={saving}>
              {saving ? "Creating…" : "Create category"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===========================================================================
// Rename Category Dialog
// ===========================================================================

function RenameCategoryDialog({
  tenantSlug,
  category,
  onClose,
  onRenamed,
  onStatus,
}: {
  tenantSlug: string;
  category: ServiceCategorySummary;
  onClose: () => void;
  onRenamed: (name: string) => Promise<void> | void;
  onStatus: (message: string) => void;
}) {
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a category name.");
      return;
    }
    if (trimmedName === category.name) {
      onClose();
      return;
    }
    const body: UpdateServiceCategoryRequest = { name: trimmedName };
    setSaving(true);
    try {
      await platformApi.updateServiceCategory(tenantSlug, category.id, body);
      await onRenamed(trimmedName);
    } catch (err) {
      onStatus(readErrorMessage(err, "Unable to rename category."));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cs-modal" role="dialog" aria-modal="true" aria-label="Rename category">
      <div className="cs-modal__panel">
        <header className="cs-modal__header">
          <h4>Rename category</h4>
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="cs-modal__form" onSubmit={handleSubmit}>
          {error ? (
            <div className="cs-banner cs-banner--error">{error}</div>
          ) : null}
          <label>
            <span>Category name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          <div className="cs-modal__actions">
            <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={saving}>
              {saving ? "Saving…" : "Rename"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===========================================================================
// Delete Category Dialog
// ===========================================================================

function DeleteCategoryDialog({
  tenantSlug,
  category,
  serviceCount,
  otherCategories,
  onClose,
  onDeleted,
  onStatus,
}: {
  tenantSlug: string;
  category: ServiceCategorySummary;
  serviceCount: number;
  otherCategories: ServiceCategorySummary[];
  onClose: () => void;
  onDeleted: (name: string, categoryId: string) => Promise<void> | void;
  onStatus: (message: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  // Where the category's services go: another category, or uncategorized.
  const [destination, setDestination] = useState<"move" | "uncategorize">(
    otherCategories.length > 0 ? "move" : "uncategorize",
  );
  const [targetId, setTargetId] = useState(otherCategories[0]?.id ?? "");

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const moveToCategoryId = serviceCount > 0 && destination === "move" && targetId ? targetId : undefined;
      await platformApi.deleteServiceCategory(tenantSlug, category.id, { moveToCategoryId });
      await onDeleted(category.name, category.id);
    } catch (err) {
      onStatus(readErrorMessage(err, "Unable to delete category."));
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="cs-modal" role="dialog" aria-modal="true" aria-label="Delete category">
      <div className="cs-modal__panel cs-cat-delete">
        <h4 className="cs-cat-delete__title">Delete category</h4>
        {serviceCount > 0 ? (
          <>
            <p className="cs-cat-delete__lead">
              {category.name} holds {serviceCount} {serviceCount === 1 ? "service" : "services"}. Choose where
              {serviceCount === 1 ? " it goes" : " they go"} — nothing is deleted with the category.
            </p>
            <div className="cs-svc-choices" role="radiogroup" aria-label="Where its services go">
              {otherCategories.length > 0 ? (
                <label className={`cs-svc-choice${destination === "move" ? " is-selected" : ""}`}>
                  <input type="radio" name="categoryDestination" className="cs-svc-choice__radio" aria-label="Move them to"
                    checked={destination === "move"} onChange={() => setDestination("move")} />
                  <span className="cs-svc-choice__label" aria-hidden="true">Move them to</span>
                  <select
                    className="cs-svc-choice__select"
                    aria-label="Category to move them to"
                    value={targetId}
                    onFocus={() => setDestination("move")}
                    onChange={(e) => { setTargetId(e.target.value); setDestination("move"); }}
                  >
                    {otherCategories.map((other) => (
                      <option key={other.id} value={other.id}>{other.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className={`cs-svc-choice${destination === "uncategorize" ? " is-selected" : ""}`}>
                <input type="radio" name="categoryDestination" className="cs-svc-choice__radio"
                  checked={destination === "uncategorize"} onChange={() => setDestination("uncategorize")} />
                <span className="cs-svc-choice__label">Leave them uncategorised</span>
              </label>
            </div>
          </>
        ) : (
          <p className="cs-cat-delete__lead">
            {category.name} has no services, so nothing else changes.
          </p>
        )}
        <div className="cs-svc-actions">
          <button type="button" className="cs-svc-pill-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="cs-svc-pill-btn cs-svc-pill-btn--primary" disabled={deleting} onClick={handleDelete}>
            {deleting ? "Deleting…" : "Delete category"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Category detail panel — Hormozi-aligned landing-page merchandising
// ===========================================================================

const FEATURED_LABEL_OPTIONS: Array<{ value: "" | CategoryFeaturedLabel; label: string }> = [
  { value: "", label: "None" },
  { value: "signature", label: "Signature" },
  { value: "most_popular", label: "Most popular" },
  { value: "new", label: "New" },
  { value: "limited", label: "Limited" },
];

const FEATURED_LABEL_DISPLAY: Record<string, string> = {
  signature: "Signature",
  most_popular: "Most popular",
  new: "New",
  limited: "Limited",
};

type CategoryFormState = {
  name: string;
  slug: string;
  isActive: boolean;
  outcomeHeadline: string;
  subheadline: string;
  heroImageUrl: string;
  heroImageAlt: string;
  scarcityHint: string;
  guaranteeText: string;
  metaDescription: string;
  featuredLabel: "" | CategoryFeaturedLabel;
  socialQuote: string;
  socialAuthor: string;
  socialImageUrl: string;
  valueStack: ValueStackItem[];
  bonuses: ValueStackItem[];
  faqs: CategoryFaqItem[];
  // Online booking rules inherited by the category's services.
  bookingPaymentMode: string; // '' = not set
  bookingPaymentValueAmount: string;
  bookingPaymentPercent: string;
  requireCardOnFile: boolean;
  providerSelectionMode: string; // '' = not set (clients choose their artist)
  financingEnabled: boolean; // services in the category show the studio's financing link
  formIds: string[];
  isTaxable: boolean; // false stops the business tax rate applying to services that don't say otherwise
};

function categoryToFormState(category: ServiceCategorySummary): CategoryFormState {
  return {
    name: category.name,
    slug: category.slug ?? "",
    isActive: category.isActive,
    outcomeHeadline: category.outcomeHeadline ?? "",
    subheadline: category.subheadline ?? "",
    heroImageUrl: category.heroImageUrl ?? "",
    heroImageAlt: category.heroImageAlt ?? "",
    scarcityHint: category.scarcityHint ?? "",
    guaranteeText: category.guaranteeText ?? "",
    metaDescription: category.metaDescription ?? "",
    featuredLabel: category.featuredLabel ?? "",
    socialQuote: category.socialProof?.quote ?? "",
    socialAuthor: category.socialProof?.author ?? "",
    socialImageUrl: category.socialProof?.imageUrl ?? "",
    valueStack: category.valueStack ?? [],
    bonuses: category.bonuses ?? [],
    faqs: category.faqs ?? [],
    bookingPaymentMode: category.bookingPaymentMode ?? "",
    bookingPaymentValueAmount:
      category.bookingPaymentValueCents != null ? (category.bookingPaymentValueCents / 100).toFixed(2) : "",
    bookingPaymentPercent: category.bookingPaymentPercent != null ? String(category.bookingPaymentPercent) : "",
    requireCardOnFile: category.requireCardOnFile ?? false,
    providerSelectionMode: category.providerSelectionMode ?? "",
    financingEnabled: category.financingMode === "on",
    formIds: category.formIds ?? [],
    isTaxable: category.isTaxable ?? true,
  };
}

function CategoryDetailPanel({
  tenantSlug,
  category,
  color,
  canManage,
  canManageForms,
  onChanged,
  onStatus,
  onDelete,
}: {
  tenantSlug: string;
  category: ServiceCategorySummary;
  color: string;
  canManage: boolean;
  /** Attaching a form to a category edits the form, which needs the forms permission. */
  canManageForms: boolean;
  onChanged: (status?: string | null) => Promise<void>;
  onStatus: (msg: string) => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState<CategoryFormState>(() => categoryToFormState(category));
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const heroInputRef = useRef<HTMLInputElement>(null);
  const authorInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<"heroImageUrl" | "socialImageUrl" | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  // Client-facing forms that can be required for every service in the category.
  const [customerForms, setCustomerForms] = useState<FormSummaryResponse[]>([]);
  const [formsError, setFormsError] = useState<string | null>(null);

  useEffect(() => {
    setForm(categoryToFormState(category));
  }, [category]);

  useEffect(() => {
    let cancelled = false;
    platformApi.listForms(tenantSlug)
      .then((resp) => {
        if (cancelled) return;
        setCustomerForms(resp.items.filter((item) => item.scope === "customer" && item.isActive));
        setFormsError(null);
      })
      .catch((error) => {
        if (!cancelled) setFormsError(readErrorMessage(error, "Unable to load forms."));
      });
    return () => { cancelled = true; };
  }, [tenantSlug, category.id]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const landingHref = form.slug.trim()
    ? `${storefrontBaseUrl}/${tenantSlug}/c/${form.slug.trim()}`
    : null;

  const handleCopyLink = async () => {
    if (!landingHref) return;
    try {
      await navigator.clipboard.writeText(landingHref);
      setCopyHint("Link copied!");
    } catch {
      setCopyHint("Copy failed — select and copy manually.");
    }
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyHint(null), 2000);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage) return;
    const name = form.name.trim();
    if (!name) {
      onStatus("Category name is required.");
      return;
    }

    const body: UpdateServiceCategoryRequest = {
      name,
      isActive: form.isActive,
    };

    const slug = form.slug.trim();
    if (slug) {
      body.slug = slug;
    } else if (category.slug) {
      body.clearSlug = true;
    }

    const setOrClear = (
      value: string,
      original: string | null | undefined,
      field: keyof UpdateServiceCategoryRequest,
      clearFlag: keyof UpdateServiceCategoryRequest,
    ) => {
      const trimmed = value.trim();
      if (trimmed) {
        (body as Record<string, unknown>)[field as string] = trimmed;
      } else if (original) {
        (body as Record<string, unknown>)[clearFlag as string] = true;
      }
    };

    setOrClear(form.outcomeHeadline, category.outcomeHeadline, "outcomeHeadline", "clearOutcomeHeadline");
    setOrClear(form.subheadline, category.subheadline, "subheadline", "clearSubheadline");
    setOrClear(form.scarcityHint, category.scarcityHint, "scarcityHint", "clearScarcityHint");
    setOrClear(form.guaranteeText, category.guaranteeText, "guaranteeText", "clearGuaranteeText");
    setOrClear(form.metaDescription, category.metaDescription, "metaDescription", "clearMetaDescription");

    const heroUrl = form.heroImageUrl.trim();
    const heroAlt = form.heroImageAlt.trim();
    if (heroUrl) {
      body.heroImageUrl = heroUrl;
      body.heroImageAlt = heroAlt || null;
    } else if (category.heroImageUrl) {
      body.clearHeroImage = true;
    }

    if (form.featuredLabel) {
      body.featuredLabel = form.featuredLabel;
    } else if (category.featuredLabel) {
      body.clearFeaturedLabel = true;
    }

    const socialQuote = form.socialQuote.trim();
    if (socialQuote) {
      body.socialProof = {
        quote: socialQuote,
        author: form.socialAuthor.trim() || null,
        imageUrl: form.socialImageUrl.trim() || null,
      };
    } else if (category.socialProof) {
      body.clearSocialProof = true;
    }

    body.valueStack = form.valueStack
      .map((item) => ({
        label: item.label.trim(),
        estValueCents:
          typeof item.estValueCents === "number" && Number.isFinite(item.estValueCents)
            ? item.estValueCents
            : null,
      }))
      .filter((item) => item.label.length > 0);

    body.bonuses = form.bonuses
      .map((item) => ({
        label: item.label.trim(),
        estValueCents:
          typeof item.estValueCents === "number" && Number.isFinite(item.estValueCents)
            ? item.estValueCents
            : null,
      }))
      .filter((item) => item.label.length > 0);

    body.faqs = form.faqs
      .map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
      .filter((item) => item.question.length > 0 && item.answer.length > 0);

    // Online booking rules the category's services inherit.
    if (!form.bookingPaymentMode) {
      if (category.bookingPaymentMode) body.clearBookingPayment = true;
    } else {
      body.bookingPaymentMode = form.bookingPaymentMode;
      if (form.bookingPaymentMode === "partial_flat") {
        const amount = form.bookingPaymentValueAmount.trim() ? parseMoneyInput(form.bookingPaymentValueAmount) : null;
        if (amount == null) { onStatus("Enter the amount to take at booking."); return; }
        body.bookingPaymentValueCents = amount;
      }
      if (form.bookingPaymentMode === "partial_percent") {
        const pct = Number(form.bookingPaymentPercent);
        if (!form.bookingPaymentPercent.trim() || !Number.isFinite(pct) || pct < 0 || pct > 100) {
          onStatus("Enter a partial payment percentage from 0 to 100."); return;
        }
        body.bookingPaymentPercent = pct;
      }
    }
    if (!form.isTaxable) body.isTaxable = false;
    else if (category.isTaxable === false) body.clearIsTaxable = true;
    if (form.requireCardOnFile) body.requireCardOnFile = true;
    else if (category.requireCardOnFile !== null && category.requireCardOnFile !== undefined) body.clearRequireCardOnFile = true;
    if (form.providerSelectionMode) body.providerSelectionMode = form.providerSelectionMode;
    else if (category.providerSelectionMode) body.clearProviderSelectionMode = true;
    if (form.financingEnabled) body.financingMode = "on";
    else if (category.financingMode) body.clearFinancing = true;

    setSaving(true);
    try {
      await platformApi.updateServiceCategory(tenantSlug, category.id, body);
      // Forms own their category list, so a changed requirement updates the form.
      for (const item of customerForms) {
        const required = form.formIds.includes(item.id);
        if (required !== (item.categoryIds ?? []).includes(category.id)) {
          const categoryIds = required
            ? [...(item.categoryIds ?? []), category.id]
            : (item.categoryIds ?? []).filter((id) => id !== category.id);
          await platformApi.updateForm(tenantSlug, item.id, { categoryIds });
        }
      }
      await onChanged(`Category "${name}" saved.`);
    } catch (error) {
      onStatus(readErrorMessage(error, "Unable to save category."));
    } finally {
      setSaving(false);
    }
  };

  // Upload an image and drop its URL into a form field (hero image, author photo).
  const uploadInto = async (file: File | undefined, field: "heroImageUrl" | "socialImageUrl") => {
    if (!file) return;
    setUploading(field);
    try {
      const uploaded = await uploadImageFile(tenantSlug, file);
      setForm((prev) => ({ ...prev, [field]: uploaded.url }));
    } catch (error) {
      onStatus(readErrorMessage(error, "Unable to upload image."));
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="cs-md-detail__inner">
      <header className="cs-md-detail__header cs-svc-detail-head">
        <div className="cs-svc-detail-head__text">
          <p className="cs-svc-detail-head__eyebrow">Category</p>
          <h4 className="cs-svc-detail-head__name">{form.name.trim() || category.name}</h4>
        </div>
        <div className="cs-svc-detail-head__actions">
          <span className="cs-cat-swatch" style={{ background: color }} aria-hidden="true" />
          {canManage ? (
            <>
              <label className="cs-svc-active-toggle">
                <input
                  type="checkbox"
                  className="cs-switch__input"
                  checked={form.isActive}
                  disabled={saving}
                  onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                />
                <span className={`cs-switch${form.isActive ? "" : " cs-switch--off"}`} aria-hidden="true" />
                {form.isActive ? "Active" : "Hidden"}
              </label>
              <button type="submit" form={formId} className="cs-svc-pill-btn cs-svc-pill-btn--primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <OverflowMenu
                label="More category actions"
                items={[
                  ...(landingHref
                    ? [
                        { label: "Copy booking link", onSelect: () => void handleCopyLink() },
                        { label: "View booking page", onSelect: () => { window.open(landingHref, "_blank", "noopener"); } },
                      ]
                    : []),
                  { label: "Delete category", danger: true, onSelect: onDelete },
                ]}
              />
            </>
          ) : null}
        </div>
      </header>

      <form id={formId} className="cs-svc-detail-form cs-cat-editor" onSubmit={handleSave}>
        <fieldset className="cs-svc-fieldset" disabled={!canManage || saving}>
          <div className="cs-svc-card cs-svc-details">
            <div className="cs-svc-details__grid">
              <label className="cs-svc-details__field cs-svc-details__field--half">
                <span className="cs-svc-details__label">Category name</span>
                <input className="cs-svc-details__input" value={form.name} required
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
              </label>
              <label className="cs-svc-details__field cs-svc-details__field--half">
                <span className="cs-svc-details__label">Booking link</span>
                <span className="cs-cat-slug">
                  <span className="cs-cat-slug__prefix" aria-hidden="true">
                    {`${storefrontBaseUrl}/${tenantSlug}/c/`.replace(/^https?:\/\//, "")}
                  </span>
                  <input className="cs-svc-details__input cs-cat-slug__input" aria-label="Category link"
                    value={form.slug} placeholder="auto from name when blank"
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, slug: event.target.value.toLowerCase().replace(/\s+/g, "-") }))
                    } />
                </span>
              </label>
            </div>
            {landingHref ? (
              <p className="cs-cat-landing">
                Live at{" "}
                <a href={landingHref} target="_blank" rel="noreferrer">{landingHref.replace(/^https?:\/\//, "")}</a>
                <button type="button" className="cs-link-btn" onClick={handleCopyLink}>Copy</button>
                {copyHint ? <span className="cs-svc-helper cs-svc-helper--ok">{copyHint}</span> : null}
              </p>
            ) : null}

            <div className="cs-svc-setting">
              <span className="cs-svc-setting__text">
                <span className="cs-svc-card__title">Charge tax</span>
                <span className="cs-svc-section__lead">
                  {form.isTaxable
                    ? "Services here are taxed at their location's service tax rate unless they say otherwise."
                    : "No tax is added to services here unless they say otherwise."}
                </span>
              </span>
              <button
                type="button"
                className={`cs-switch${form.isTaxable ? "" : " cs-switch--off"}`}
                aria-label="Category charge tax toggle"
                aria-pressed={form.isTaxable}
                onClick={() => setForm((prev) => ({ ...prev, isTaxable: !prev.isTaxable }))}
              />
            </div>

            <hr className="cs-svc-details__divider" />

            <label className="cs-svc-details__field">
              <span className="cs-svc-details__label">Outcome headline</span>
              <input className="cs-svc-details__input" value={form.outcomeHeadline}
                placeholder="The result your client wants, in one line"
                onChange={(event) => setForm((prev) => ({ ...prev, outcomeHeadline: event.target.value }))} />
            </label>
            <label className="cs-svc-details__field">
              <span className="cs-svc-details__label">Subheadline</span>
              <input className="cs-svc-details__input" value={form.subheadline}
                placeholder="A sentence expanding on the outcome"
                onChange={(event) => setForm((prev) => ({ ...prev, subheadline: event.target.value }))} />
            </label>

            <div className="cs-cat-hero">
              <span className="cs-cat-hero__thumb">
                {form.heroImageUrl.trim() ? <img src={form.heroImageUrl.trim()} alt="" /> : null}
              </span>
              <div className="cs-cat-hero__fields">
                <label className="cs-svc-details__field">
                  <span className="cs-svc-details__label cs-cat-hero__label">
                    Hero image
                    {canManage ? (
                      <button type="button" className="cs-link-btn" onClick={() => heroInputRef.current?.click()}>
                        {uploading === "heroImageUrl" ? "Uploading…" : "Upload"}
                      </button>
                    ) : null}
                  </span>
                  <input className="cs-svc-details__input" value={form.heroImageUrl} placeholder="Upload or paste an image URL"
                    onChange={(event) => setForm((prev) => ({ ...prev, heroImageUrl: event.target.value }))} />
                </label>
                <label className="cs-svc-details__field">
                  <span className="cs-svc-details__label">Alt text</span>
                  <input className="cs-svc-details__input" value={form.heroImageAlt} placeholder="Describe the image for screen readers"
                    onChange={(event) => setForm((prev) => ({ ...prev, heroImageAlt: event.target.value }))} />
                </label>
              </div>
              <input ref={heroInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                className="cs-visually-hidden" tabIndex={-1} aria-hidden="true"
                onChange={(event) => { void uploadInto(event.target.files?.[0], "heroImageUrl"); event.target.value = ""; }} />
            </div>

            <label className="cs-svc-details__field">
              <span className="cs-svc-details__label">Guarantee</span>
              <input className="cs-svc-details__input" value={form.guaranteeText}
                placeholder="What you promise if a client isn't happy"
                onChange={(event) => setForm((prev) => ({ ...prev, guaranteeText: event.target.value }))} />
            </label>

            <div className="cs-cat-quote" role="group" aria-label="Testimonial">
              <button type="button" className="cs-cat-quote__avatar" aria-label="Upload author photo"
                onClick={() => authorInputRef.current?.click()} disabled={!canManage}>
                {form.socialImageUrl.trim() ? <img src={form.socialImageUrl.trim()} alt="" /> : null}
              </button>
              <div className="cs-cat-quote__fields">
                <textarea className="cs-cat-quote__text" rows={2} aria-label="Testimonial quote"
                  value={form.socialQuote} placeholder="“A short quote from a happy client.”"
                  onChange={(event) => setForm((prev) => ({ ...prev, socialQuote: event.target.value }))} />
                <input className="cs-cat-quote__author" aria-label="Testimonial author"
                  value={form.socialAuthor} placeholder="First name + last initial"
                  onChange={(event) => setForm((prev) => ({ ...prev, socialAuthor: event.target.value }))} />
              </div>
              <input ref={authorInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                className="cs-visually-hidden" tabIndex={-1} aria-hidden="true"
                onChange={(event) => { void uploadInto(event.target.files?.[0], "socialImageUrl"); event.target.value = ""; }} />
            </div>
          </div>

          <div className="cs-svc-card cs-svc-details">
            <h3 className="cs-svc-card__title">Online booking</h3>
            <p className="cs-svc-helper">
              Every service in this category follows these rules unless it sets its own. A service&apos;s own setting
              always wins.
            </p>

            <div className="cs-svc-details__field">
              <span className="cs-svc-details__label">Taken at booking</span>
              <PaymentRuleChoices
                name={`category-payment-${category.id}`}
                ariaLabel="Category taken at booking"
                mode={form.bookingPaymentMode}
                valueAmount={form.bookingPaymentValueAmount}
                percent={form.bookingPaymentPercent}
                priceCents={null}
                onChange={(patch) => setForm((prev) => ({
                  ...prev,
                  ...(patch.mode !== undefined ? { bookingPaymentMode: patch.mode } : {}),
                  ...(patch.valueAmount !== undefined ? { bookingPaymentValueAmount: patch.valueAmount } : {}),
                  ...(patch.percent !== undefined ? { bookingPaymentPercent: patch.percent } : {}),
                }))}
              />
              {!form.bookingPaymentMode ? (
                <p className="cs-svc-helper">Not set — services here take no payment at booking unless they set their own.</p>
              ) : null}
            </div>

            <hr className="cs-svc-details__divider" />

            <div className="cs-svc-setting">
              <span className="cs-svc-setting__text">
                <span className="cs-svc-card__title">Require a card on file</span>
                <span className="cs-svc-section__lead">
                  Not active yet — clients aren&apos;t asked for a card at booking until card collection is added.
                </span>
              </span>
              <button
                type="button"
                className={`cs-switch${form.requireCardOnFile ? "" : " cs-switch--off"}`}
                aria-label="Category require card on file toggle"
                aria-pressed={form.requireCardOnFile}
                onClick={() => setForm((prev) => ({ ...prev, requireCardOnFile: !prev.requireCardOnFile }))}
              />
            </div>

            <hr className="cs-svc-details__divider" />

            <div className="cs-svc-setting">
              <span className="cs-svc-setting__text">
                <span className="cs-svc-card__title">Offer financing</span>
                <span className="cs-svc-section__lead">
                  Shows “or $X/mo” with your financing button on every service in this category. A service can
                  turn it off or use its own link. Set the link under Settings → Marketing.
                </span>
              </span>
              <button
                type="button"
                className={`cs-switch${form.financingEnabled ? "" : " cs-switch--off"}`}
                aria-label="Category financing toggle"
                aria-pressed={form.financingEnabled}
                disabled={!canManage}
                onClick={() => setForm((prev) => ({ ...prev, financingEnabled: !prev.financingEnabled }))}
              />
            </div>

            <hr className="cs-svc-details__divider" />

            <div className="cs-svc-details__field" role="radiogroup" aria-label="Client selection on booking">
              <span className="cs-svc-details__label">Client selection on booking</span>
              <div className="cs-svc-choices">
                {([
                  ["client_choice", "Let clients choose their artist"],
                  ["auto_assign", "Assign automatically"],
                  ["hide", "Hide artist selection"],
                ] as const).map(([mode, label]) => {
                  const selected = (form.providerSelectionMode || "client_choice") === mode;
                  return (
                    <label key={mode} className={`cs-svc-choice${selected ? " is-selected" : ""}`}>
                      <input type="radio" name={`category-selection-${category.id}`} className="cs-svc-choice__radio"
                        checked={selected}
                        onChange={() => setForm((prev) => ({ ...prev, providerSelectionMode: mode }))} />
                      <span className="cs-svc-choice__label">{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <hr className="cs-svc-details__divider" />

            <div className="cs-svc-details__field">
              <span className="cs-svc-details__label">Required forms</span>
              <p className="cs-svc-helper">Required in addition to any forms a service requires on its own.</p>
              {formsError ? (
                <p role="alert" className="cs-svc-helper cs-svc-helper--error">{formsError}</p>
              ) : customerForms.length === 0 ? (
                <p className="cs-svc-helper">No client-facing forms yet. Create them on the Forms page.</p>
              ) : (
                <div className="cs-svc-forms">
                  {customerForms.map((item) => {
                    const checked = form.formIds.includes(item.id);
                    return (
                      <label key={item.id} className={`cs-svc-form-row${checked ? "" : " is-off"}`}>
                        <input
                          type="checkbox"
                          className="cs-check"
                          checked={checked}
                          disabled={!canManageForms}
                          onChange={(event) => {
                            const next = event.target.checked;
                            setForm((prev) => ({
                              ...prev,
                              formIds: next ? [...prev.formIds, item.id] : prev.formIds.filter((id) => id !== item.id),
                            }));
                          }}
                        />
                        <span className="cs-svc-form-row__name">{item.name}</span>
                        <span className="cs-svc-form-row__meta">
                          {checked ? FORM_TIMING_LABELS[item.customerPromptTiming ?? "pre_booking"] ?? "Required" : "Not required"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {customerForms.length > 0 && !canManageForms ? (
                <p className="cs-svc-helper">You don&apos;t have permission to change which forms are required.</p>
              ) : null}
            </div>
          </div>

          <div className="cs-svc-card cs-svc-details">
            <h3 className="cs-svc-card__title">More for the landing page</h3>
            <div className="cs-svc-details__grid">
              <div className="cs-svc-details__field cs-svc-details__field--half" role="group" aria-label="Featured label">
                <span className="cs-svc-details__label" aria-hidden="true">Featured label</span>
                <div className="cs-svc-featured">
                  {[...FEATURED_LABEL_OPTIONS.filter((o) => o.value), ...FEATURED_LABEL_OPTIONS.filter((o) => !o.value)].map(
                    ({ value, label }) => (
                      <button
                        key={label}
                        type="button"
                        className={`cs-svc-featured__pill${form.featuredLabel === value ? " is-active" : ""}`}
                        aria-pressed={form.featuredLabel === value}
                        onClick={() => setForm((prev) => ({ ...prev, featuredLabel: value }))}
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <label className="cs-svc-details__field cs-svc-details__field--half">
                <span className="cs-svc-details__label">Scarcity hint</span>
                <input className="cs-svc-details__input" value={form.scarcityHint} placeholder="e.g. Only 3 slots left this week"
                  onChange={(event) => setForm((prev) => ({ ...prev, scarcityHint: event.target.value }))} />
              </label>
            </div>
            <label className="cs-svc-details__field">
              <span className="cs-svc-details__label">Meta description</span>
              <textarea className="cs-svc-details__input cs-svc-details__textarea" rows={2} value={form.metaDescription}
                placeholder="Shown in search results and link previews."
                onChange={(event) => setForm((prev) => ({ ...prev, metaDescription: event.target.value }))} />
            </label>
            <ValueStackEditor
              legend="Value stack"
              help="What clients get, and what each piece is worth."
              items={form.valueStack}
              disabled={!canManage}
              onChange={(next) => setForm((prev) => ({ ...prev, valueStack: next }))}
            />
            <ValueStackEditor
              legend="Bonuses"
              help="Extras included at no additional charge."
              items={form.bonuses}
              disabled={!canManage}
              onChange={(next) => setForm((prev) => ({ ...prev, bonuses: next }))}
            />
            <FaqEditor
              items={form.faqs}
              disabled={!canManage}
              onChange={(next) => setForm((prev) => ({ ...prev, faqs: next }))}
            />
          </div>
          {!canManage ? <p className="cs-svc-helper">You don&apos;t have permission to edit categories.</p> : null}
        </fieldset>
      </form>
    </div>
  );
}

function ValueStackEditor({
  legend,
  help,
  items,
  disabled,
  onChange,
}: {
  legend: string;
  help: string;
  items: ValueStackItem[];
  disabled: boolean;
  onChange: (next: ValueStackItem[]) => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>{legend}</legend>
      <p className="cs-cat-field-help">{help}</p>
      <ul className="cs-cat-stack-editor">
        {items.map((item, idx) => (
          <li key={idx}>
            <input
              type="text"
              value={item.label}
              placeholder="Item label"
              onChange={(event) => {
                const next = [...items];
                next[idx] = { ...next[idx], label: event.target.value };
                onChange(next);
              }}
            />
            <input
              type="text"
              inputMode="decimal"
              value={
                typeof item.estValueCents === "number"
                  ? (item.estValueCents / 100).toString()
                  : ""
              }
              placeholder="Est. value $"
              onChange={(event) => {
                const cents = parseMoneyInput(event.target.value);
                const next = [...items];
                next[idx] = { ...next[idx], estValueCents: cents };
                onChange(next);
              }}
            />
            <button
              type="button"
              className="cs-btn cs-btn--ghost cs-btn--sm"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="cs-btn cs-btn--ghost cs-btn--sm"
        onClick={() => onChange([...items, { label: "", estValueCents: null }])}
      >
        + Add item
      </button>
    </fieldset>
  );
}

function FaqEditor({
  items,
  disabled,
  onChange,
}: {
  items: CategoryFaqItem[];
  disabled: boolean;
  onChange: (next: CategoryFaqItem[]) => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>FAQ</legend>
      <p className="cs-cat-field-help">
        Address the friction points and objections customers raise before booking.
      </p>
      <ul className="cs-cat-faq-editor">
        {items.map((item, idx) => (
          <li key={idx}>
            <input
              type="text"
              value={item.question}
              placeholder="Question"
              onChange={(event) => {
                const next = [...items];
                next[idx] = { ...next[idx], question: event.target.value };
                onChange(next);
              }}
            />
            <textarea
              value={item.answer}
              rows={2}
              placeholder="Answer"
              onChange={(event) => {
                const next = [...items];
                next[idx] = { ...next[idx], answer: event.target.value };
                onChange(next);
              }}
            />
            <button
              type="button"
              className="cs-btn cs-btn--ghost cs-btn--sm"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="cs-btn cs-btn--ghost cs-btn--sm"
        onClick={() => onChange([...items, { question: "", answer: "" }])}
      >
        + Add question
      </button>
    </fieldset>
  );
}
