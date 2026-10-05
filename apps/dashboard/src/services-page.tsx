import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
                    const defaultDeposit = tenant?.settings.defaultDepositCents ?? 0;
                    const firstLocationId = locations.length > 0 ? locations[0].id : null;
                    if (!firstLocationId) {
                      setStatus("Create a location first.");
                      return;
                    }
                    try {
                      const created = await platformApi.createService(tenantSlug, {
                        name: "New Service",
                        durationMinutes: 60,
                        priceCents: 0,
                        depositCents: 0,
                        locationIds: [firstLocationId],
                      });
                      await refreshServices();
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
                            { label: "Rename", onSelect: () => handleRenameCategory(category) },
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
                    refreshProviders={refreshProviders}
                    canManageSettings={canManageSettings}
                    defaultDepositCents={tenant?.settings?.defaultDepositCents ?? 0}
                  />
                );
              })()
            ) : selectedCategory ? (
              <CategoryDetailPanel
                tenantSlug={tenantSlug}
                category={selectedCategory}
                color={categoryColor(Math.max(0, orderedCategories.findIndex((c) => c.id === selectedCategory.id)))}
                canManage={canManage}
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
  requireCardOnFile: boolean;
  bookingPaymentMode: string; // 'none' | 'full' | 'partial_flat' | 'partial_percent'
  bookingPaymentValueAmount: string; // dollar amount for partial_flat; blank = studio default
  bookingPaymentPercent: string; // percentage for partial_percent
  providerSelectionMode: string; // 'client_choice', 'auto_assign', 'hide'
  featuredLabel: string; // '' for none
  imageUrl: string;
  formIds: string[]; // customer-facing forms this service requires
  slug: string;
  scarcityHint: string;
  metaDescription: string;
};

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
    requireCardOnFile: service.requireCardOnFile ?? false,
    // Services saved before payment modes existed take their plain deposit at
    // booking, which is the same as a fixed partial payment (or none at $0).
    bookingPaymentMode: service.bookingPaymentMode || (service.depositCents > 0 ? "partial_flat" : "none"),
    bookingPaymentValueAmount:
      service.bookingPaymentValueCents != null
        ? (service.bookingPaymentValueCents / 100).toFixed(2)
        : !service.bookingPaymentMode && service.depositCents > 0
          ? (service.depositCents / 100).toFixed(2)
          : "",
    bookingPaymentPercent: service.bookingPaymentPercent != null ? String(service.bookingPaymentPercent) : "",
    providerSelectionMode: service.providerSelectionMode ?? "client_choice",
    featuredLabel: service.featuredLabel ?? "",
    imageUrl: service.imageUrl ?? "",
    formIds: [...service.formIds],
    slug: service.slug ?? "",
    scarcityHint: service.scarcityHint ?? "",
    metaDescription: service.metaDescription ?? "",
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
  refreshProviders,
  canManageSettings,
  defaultDepositCents,
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
  refreshProviders: () => Promise<void>;
  canManageSettings: boolean;
  defaultDepositCents: number;
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
    Record<string, { duration: string; price: string; flat: string; percent: string }>
  >({});
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

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
      const seed: Record<string, { duration: string; price: string; flat: string; percent: string }> = {};
      for (const v of resp.variants) {
        seed[v.providerId] = {
          duration: v.durationMinutes != null ? String(v.durationMinutes) : "",
          price: v.priceCents != null ? (v.priceCents / 100).toFixed(2) : "",
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

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage) return;
    const name = form.name.trim();
    if (!name) { onSaved("Service name is required."); return; }
    const durationMinutes = Number(form.durationMinutes);
    const priceCents = parseMoneyInput(form.priceAmount);
    const depositCents = parseMoneyInput(form.depositAmount);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || priceCents === null || depositCents === null) {
      onSaved("Enter a valid duration, price, and deposit."); return;
    }
    if (form.locationIds.length === 0) { onSaved("Select at least one location."); return; }
    const body: UpdateServiceRequest = {
      name, durationMinutes,
      setupBufferMinutes: Number(form.setupBufferMinutes) || 0,
      cleanupBufferMinutes: Number(form.cleanupBufferMinutes) || 0,
      priceCents, depositCents,
      locationIds: form.locationIds,
      isActive: form.isActive,
      requireCardOnFile: form.requireCardOnFile,
      bookingPaymentMode: form.bookingPaymentMode || null,
    };
    const desc = form.description.trim();
    if (desc) body.description = desc;
    else if (service.description) body.clearDescription = true;
    if (form.categoryId) body.categoryId = form.categoryId;
    else if (service.categoryId) body.clearCategory = true;
    // Online booking description
    const obDesc = form.onlineBookingDescription.trim();
    if (obDesc) body.onlineBookingDescription = obDesc;
    else if (service.onlineBookingDescription) body.clearOnlineBookingDescription = true;
    // Payment value/percent
    if (form.bookingPaymentMode === "partial_flat") {
      if (form.bookingPaymentValueAmount.trim()) {
        const val = parseMoneyInput(form.bookingPaymentValueAmount);
        if (val == null) { onSaved("Enter a valid partial payment amount."); return; }
        body.bookingPaymentValueCents = val;
      } else {
        // Blank means "use the studio default deposit".
        body.clearBookingPaymentValue = true;
      }
    }
    if (form.bookingPaymentMode === "partial_percent") {
      const pct = Number(form.bookingPaymentPercent);
      if (!form.bookingPaymentPercent.trim() || !Number.isFinite(pct) || pct < 0 || pct > 100) {
        onSaved("Enter a partial payment percentage from 0 to 100."); return;
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
    // Provider selection mode
    body.providerSelectionMode = form.providerSelectionMode || null;
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
      onSaved(`"${name}" saved.`);
    }
    catch (error) { onSaved(readErrorMessage(error, "Unable to save service.")); }
    finally { setSaving(false); }
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
    field: "duration" | "price" | "flat" | "percent",
    raw: string,
  ) => {
    setVariantTexts((prev) => {
      const current = prev[providerId] ?? { duration: "", price: "", flat: "", percent: "" };
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

  const handleSaveVariants = async () => {
    if (!canManage) return;
    const payload: ProviderServiceVariantEntry[] = variants
      .filter((v) => v.priceCents != null || v.durationMinutes != null || v.depositCents != null || v.commissionFlatCents != null || v.commissionBasisPoints != null)
      .map((v) => ({ providerId: v.providerId, priceCents: v.priceCents ?? null, durationMinutes: v.durationMinutes ?? null, depositCents: v.depositCents ?? null, commissionFlatCents: v.commissionFlatCents ?? null, commissionBasisPoints: v.commissionBasisPoints ?? null }));
    setVariantsSaving(true);
    try {
      const resp = await platformApi.replaceServiceProviderVariants(tenantSlug, service.id, { variants: payload });
      setVariants(resp.variants); setSavedVariants(resp.variants);
      onSaved("Per-provider pricing saved.");
    } catch (error) { onSaved(readErrorMessage(error, "Unable to save variants.")); }
    finally { setVariantsSaving(false); }
  };

  // Single save action for the Staff tab: persist per-provider overrides (if any
  // were edited) and the client-selection setting in one click.
  const handleSaveStaffTab = async () => {
    if (!canManage) return;
    if (isVariantsDirty) {
      await handleSaveVariants();
    }
    await handleSave({ preventDefault: () => {} } as FormEvent<HTMLFormElement>);
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
  const baseFormDeposit = parseMoneyInput(form.depositAmount);
  const baseDepositCents = baseFormDeposit != null && baseFormDeposit >= 0 ? baseFormDeposit : service.depositCents;

  const tabs: Array<{ key: ServiceTabKey; label: string }> = [
    { key: "details", label: "Details" },
    { key: "staff", label: "Staff" },
    { key: "resources", label: "Resources" },
    { key: "customizations", label: "Add-ons" },
    { key: "onlineBooking", label: "Online booking" },
  ];

  const categoryIndex = categories.findIndex((category) => category.id === service.categoryId);
  const categoryName = categoryIndex >= 0 ? categories[categoryIndex]!.name : "Uncategorized";

  return (
    <div className="cs-md-detail__inner">
      <header className="cs-md-detail__header cs-svc-detail-head">
        <div className="cs-svc-detail-head__text">
          <p className="cs-svc-detail-head__eyebrow">{categoryName}</p>
          <h4 className="cs-svc-detail-head__name">{service.name}</h4>
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
            ) : null}
            <OverflowMenu
              label="More service actions"
              items={[{
                label: "Delete service",
                danger: true,
                onSelect: () => {
                  if (window.confirm(`Delete "${service.name}"? This cannot be undone.`)) {
                    platformApi.deleteService(tenantSlug, service.id)
                      .then(() => onSaved(`"${service.name}" deleted.`))
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
            onClick={() => onTabChange(tab.key)}>
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
          handleSaveStaffTab={handleSaveStaffTab}
          baseDurationMinutes={baseDurationMinutes} basePriceCents={basePriceCents}
          baseDepositCents={baseDepositCents} tenantSlug={tenantSlug}
          storefrontBaseUrl={storefrontBaseUrl}
          form={form} setForm={setForm}
          saving={saving} handleSave={handleSave} />
      ) : null}
      {activeTab === "resources" ? (
        <ServiceResourcesTab service={service} tenantSlug={tenantSlug} locations={locations}
          canManage={canManage} canCreateResources={canManageSettings} onSaved={onSaved} />
      ) : null}
      {activeTab === "customizations" ? (
        <ServiceAddOnsTab service={service} tenantSlug={tenantSlug} canManage={canManage} />
      ) : null}
      {activeTab === "onlineBooking" ? (
        <ServiceOnlineBookingTab formId={detailsFormId} form={form} setForm={setForm} canManage={canManage}
          schedulingHref={schedulingHref} handleCopyLink={handleCopyLink} copyHint={copyHint}
          saving={saving} handleSave={handleSave} defaultDepositCents={defaultDepositCents} />
      ) : null}
    </div>
  );
}

// ===========================================================================
// Tab components
// ===========================================================================

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
          value={value} required={options.required}
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
                  value={form.priceAmount}
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

          <label className="cs-svc-details__field">
            <span className="cs-svc-details__label">Client-facing description</span>
            <textarea
              className="cs-svc-details__input cs-svc-details__textarea"
              rows={2}
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
                  const checked = appliesToAll || form.formIds.includes(item.id);
                  return (
                    <label key={item.id} className={`cs-svc-form-row${checked ? "" : " is-off"}`}>
                      <input
                        type="checkbox"
                        className="cs-check"
                        checked={checked}
                        disabled={appliesToAll || !canManageForms}
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

function ServiceStaffTab({
  service, eligibleProviders, assignedProviderIds, toggleProviderAssignment,
  variantByProvider, updateVariant, variantTexts, patchVariantText, canManage,
  variantsLoaded, isVariantsDirty, variantsSaving, handleSaveVariants,
  handleSaveStaffTab,
  baseDurationMinutes, basePriceCents, baseDepositCents, tenantSlug, storefrontBaseUrl,
  form, setForm, saving, handleSave,
}: {
  service: ServiceSummary;
  eligibleProviders: ProviderSummary[];
  assignedProviderIds: Set<string>;
  toggleProviderAssignment: (providerId: string) => Promise<void>;
  variantByProvider: Map<string, ProviderServiceVariantEntry>;
  updateVariant: (providerId: string, patch: Partial<ProviderServiceVariantEntry>) => void;
  variantTexts: Record<string, { duration: string; price: string; flat: string; percent: string }>;
  patchVariantText: (
    providerId: string,
    field: "duration" | "price" | "flat" | "percent",
    raw: string,
  ) => void;
  canManage: boolean;
  variantsLoaded: boolean;
  isVariantsDirty: boolean;
  variantsSaving: boolean;
  handleSaveVariants: () => Promise<void>;
  handleSaveStaffTab: () => Promise<void>;
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

  const renderProviderRow = (provider: ProviderSummary) => {
    const isAssigned = assignedProviderIds.has(provider.id);
    const lead = (
      <label className="cs-override-table__lead">
        <input
          type="checkbox"
          className="cs-check"
          aria-label={`Toggle ${provider.name}`}
          checked={isAssigned}
          disabled={!canManage}
          onChange={() => toggleProviderAssignment(provider.id)}
        />
        <span
          className="cs-override-table__avatar"
          style={provider.imageUrl ? undefined : { background: avatarColorFor(provider.id) }}
          aria-hidden="true"
        >
          {provider.imageUrl ? <img src={provider.imageUrl} alt="" /> : initialsFor(provider.name)}
        </span>
        <span className="cs-override-table__lead-text">
          <span className="cs-override-table__name">{provider.name}</span>
          {provider.description ? (
            <span className="cs-override-table__meta">{provider.description}</span>
          ) : null}
        </span>
      </label>
    );

    if (!isAssigned) {
      return (
        <div key={provider.id} className="cs-override-table__row cs-override-table__row--off">
          {lead}
          <p className="cs-override-table__note">
            {canManage ? "Tick to add this service to their menu" : "Doesn't offer this service"}
          </p>
        </div>
      );
    }

    const entry = variantByProvider.get(provider.id) ?? {
      providerId: provider.id, priceCents: null, durationMinutes: null,
      depositCents: null, commissionFlatCents: null, commissionBasisPoints: null,
    };
    const commissionMode: "flat" | "percent" = entry.commissionFlatCents != null ? "flat" : "percent";
    const text = variantTexts[provider.id] ?? { duration: "", price: "", flat: "", percent: "" };
    // Commission the provider inherits without an override: their service-percent
    // rate from the Compensation tab (payroll falls back to it).
    const inheritedPercent =
      provider.compensationMode === "service_percent" && provider.compensationServicePercentBp
        ? provider.compensationServicePercentBp / 100
        : null;
    const selectOnFocus = (event: React.FocusEvent<HTMLInputElement>) => event.target.select();
    const keepSelection = (event: React.MouseEvent<HTMLInputElement>) => event.preventDefault();

    return (
      <div key={provider.id} className="cs-override-table__row">
        {lead}

        <div className="cs-override-table__cell cs-override-table__cell--prefix" data-label="Price">
          <input
            className="cs-override-table__field"
            type="text" inputMode="decimal"
            disabled={!canManage}
            placeholder={formatMoneyShort(basePriceCents)}
            value={text.price}
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
            value={text.duration}
            onFocus={selectOnFocus}
            onMouseUp={keepSelection}
            onChange={(e) => patchVariantText(provider.id, "duration", e.target.value)}
            aria-label={`${provider.name} duration`}
          />
          {/* --chars lets CSS place the unit right after the typed digits. */}
          <span
            className="cs-override-table__affix"
            aria-hidden="true"
            style={{ "--chars": text.duration.length } as React.CSSProperties}
          >
            min
          </span>
        </div>

        {/* Deposit overrides are edited from the provider's Services tab. */}
        <div className="cs-override-table__cell" data-label="Deposit">
          <span
            className={`cs-override-table__value${entry.depositCents == null ? " cs-override-table__value--inherited" : ""}`}
          >
            {formatMoneyShort(entry.depositCents ?? baseDepositCents)}
          </span>
        </div>

        <div className="cs-override-table__commission" data-label="Commission">
          <div className="cs-override-table__mode" role="group" aria-label="Commission type">
            <button
              type="button"
              className={`cs-override-table__mode-btn${commissionMode === "percent" ? " is-active" : ""}`}
              aria-pressed={commissionMode === "percent"}
              title="Percent of the service price"
              disabled={!canManage}
              onClick={() => {
                if (commissionMode === "percent") return;
                patchVariantText(provider.id, "flat", "");
                updateVariant(provider.id, { commissionFlatCents: null, commissionBasisPoints: entry.commissionBasisPoints ?? 0 });
              }}
            >
              %
            </button>
            <button
              type="button"
              className={`cs-override-table__mode-btn${commissionMode === "flat" ? " is-active" : ""}`}
              aria-pressed={commissionMode === "flat"}
              title="Flat amount per service"
              disabled={!canManage}
              onClick={() => {
                if (commissionMode === "flat") return;
                patchVariantText(provider.id, "percent", "");
                updateVariant(provider.id, { commissionBasisPoints: null, commissionFlatCents: entry.commissionFlatCents ?? 0 });
              }}
            >
              $
            </button>
          </div>
          {commissionMode === "flat" ? (
            <input
              className="cs-override-table__field"
              type="text" inputMode="decimal"
              disabled={!canManage}
              placeholder="0.00"
              value={text.flat}
              onFocus={selectOnFocus}
              onMouseUp={keepSelection}
              onChange={(e) => patchVariantText(provider.id, "flat", e.target.value)}
              aria-label={`${provider.name} commission flat`}
            />
          ) : (
            <input
              className="cs-override-table__field"
              type="text" inputMode="decimal"
              disabled={!canManage}
              placeholder={inheritedPercent != null ? String(inheritedPercent) : "0"}
              value={text.percent}
              onFocus={selectOnFocus}
              onMouseUp={keepSelection}
              onChange={(e) => patchVariantText(provider.id, "percent", e.target.value)}
              aria-label={`${provider.name} commission percent`}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="cs-svc-detail-form">
      <section className="cs-svc-card" aria-label="Staff">
        <header className="cs-svc-card__head">
          <h3 className="cs-svc-card__title">
            Staff <span className="cs-svc-card__count">{offered.length} of {eligibleProviders.length}</span>
          </h3>
          <span className="cs-svc-card__meta">
            Base {formatDurationMinutes(baseDurationMinutes)} · {formatMoney(basePriceCents)} · {formatMoney(baseDepositCents)} deposit
          </span>
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
              <span>Commission</span>
            </div>

            {offered.length > 0 ? (
              <section className="cs-override-table__group" aria-label="Offered by">
                <header className="cs-override-table__group-head">
                  <h4 className="cs-override-table__group-title">
                    <span className="cs-override-table__dot" style={{ background: "var(--cs-mint)" }} aria-hidden="true" />
                    Offered by
                  </h4>
                  {canManage ? (
                    <button type="button" className="cs-link-btn"
                      onClick={() => {
                        for (const p of offered) toggleProviderAssignment(p.id);
                      }}>Disable all</button>
                  ) : null}
                </header>
                {offered.map(renderProviderRow)}
              </section>
            ) : null}

            {notOffered.length > 0 ? (
              <section className="cs-override-table__group cs-override-table__group--off" aria-label="Not offered">
                <header className="cs-override-table__group-head">
                  <h4 className="cs-override-table__group-title">
                    <span className="cs-override-table__dot" style={{ background: "var(--cs-grey)" }} aria-hidden="true" />
                    Not offered
                  </h4>
                  {canManage ? (
                    <button type="button" className="cs-link-btn"
                      onClick={() => {
                        for (const p of notOffered) toggleProviderAssignment(p.id);
                      }}>Enable all</button>
                  ) : null}
                </header>
                {notOffered.map(renderProviderRow)}
              </section>
            ) : null}
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
              className={`cs-svc-selection-opt${form.providerSelectionMode === mode ? " cs-svc-selection-opt--active" : ""}`}
            >
              <input type="radio" name="clientSelection" value={mode}
                className="cs-visually-hidden"
                checked={form.providerSelectionMode === mode}
                onChange={() => setForm((c) => ({ ...c, providerSelectionMode: mode }))}
                disabled={!canManage} />
              <span className={`cs-svc-radio${form.providerSelectionMode === mode ? " cs-svc-radio--on" : ""}`} aria-hidden="true" />
              <span className="cs-svc-selection-opt__text">
                <span className="cs-svc-selection-opt__title">{title}</span>
                <span className="cs-svc-helper">{helper}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {canManage ? (
        <div className="cs-svc-actions">
          <button type="button" className="cs-svc-save-btn" disabled={saving || variantsSaving}
            onClick={handleSaveStaffTab}>
            {saving || variantsSaving ? "Saving…" : "Save"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ServiceOnlineBookingTab({
  formId, form, setForm, canManage, schedulingHref, handleCopyLink, copyHint,
  saving, handleSave, defaultDepositCents,
}: {
  formId: string;
  form: ServiceCardState;
  setForm: React.Dispatch<React.SetStateAction<ServiceCardState>>;
  canManage: boolean;
  schedulingHref: string;
  handleCopyLink: () => Promise<void>;
  copyHint: string | null;
  saving: boolean;
  handleSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  defaultDepositCents: number;
}) {
  const priceCents = parseMoneyInput(form.priceAmount) ?? 0;
  // What's left to pay at the visit for the partial options (service price only).
  const flatCents = form.bookingPaymentValueAmount.trim()
    ? parseMoneyInput(form.bookingPaymentValueAmount) ?? 0
    : defaultDepositCents;
  const percent = Number(form.bookingPaymentPercent);
  const percentCents = Number.isFinite(percent) ? Math.round((priceCents * percent) / 100) : 0;
  const dueAtVisit = (takenCents: number) => formatMoney(Math.max(0, priceCents - Math.min(takenCents, priceCents)));
  const selectMode = (mode: string) => setForm((c) => ({ ...c, bookingPaymentMode: mode }));
  const prettyUrl = schedulingHref.replace(/^https?:\/\//, "");

  const option = (mode: string, content: ReactNode, extra?: ReactNode) => (
    <label className={`cs-svc-choice${form.bookingPaymentMode === mode ? " is-selected" : ""}`}>
      <input type="radio" name="bookingPaymentMode" value={mode} className="cs-svc-choice__radio"
        checked={form.bookingPaymentMode === mode} onChange={() => selectMode(mode)} />
      <span className="cs-svc-choice__label">{content}</span>
      {extra ? <span className="cs-svc-choice__extra">{extra}</span> : null}
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

          <div className="cs-svc-details__field" role="radiogroup" aria-label="Taken at booking">
            <span className="cs-svc-details__label">Taken at booking</span>
            <div className="cs-svc-choices">
              {option("none", "No payment required at booking")}
              {option("full", `Full payment — ${formatMoney(priceCents)}`)}
              {option(
                "partial_flat",
                <>
                  Partial payment — $
                  <input
                    className="cs-svc-choice__input"
                    type="text"
                    inputMode="decimal"
                    aria-label="Partial payment amount"
                    placeholder={(defaultDepositCents / 100).toFixed(2)}
                    value={form.bookingPaymentValueAmount}
                    onFocus={() => selectMode("partial_flat")}
                    onChange={(e) => setForm((c) => ({ ...c, bookingPaymentValueAmount: e.target.value, bookingPaymentMode: "partial_flat" }))}
                  />
                </>,
                form.bookingPaymentMode === "partial_flat" ? `${dueAtVisit(flatCents)} due at visit` : null,
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
                    value={form.bookingPaymentPercent}
                    onFocus={() => selectMode("partial_percent")}
                    onChange={(e) => setForm((c) => ({ ...c, bookingPaymentPercent: e.target.value, bookingPaymentMode: "partial_percent" }))}
                  />
                </>,
                form.bookingPaymentMode === "partial_percent" ? `${dueAtVisit(percentCents)} due at visit` : null,
              )}
            </div>
            <p className="cs-svc-helper">
              Leave the amount blank to take the studio default deposit ({formatMoney(defaultDepositCents)}).
              A deposit set for a provider on the Staff tab takes priority, and add-ons count toward full and
              percentage payments. Refunds on cancellation follow your cancellation rules in Settings.
            </p>
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
              aria-label="Require card on file toggle"
              aria-pressed={form.requireCardOnFile}
              onClick={() => setForm((c) => ({ ...c, requireCardOnFile: !c.requireCardOnFile }))}
            />
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
  service, tenantSlug, locations, canManage, canCreateResources, onSaved,
}: {
  service: ServiceSummary;
  tenantSlug: string;
  locations: LocationSummary[];
  canManage: boolean;
  /** Creating a resource is a settings action (settings.manage). */
  canCreateResources: boolean;
  onSaved: (msg?: string) => void;
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

  const handleSave = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      const resources = Array.from(attached.entries()).map(([resourceId, quantity]) => ({
        resourceId,
        quantity,
      }));
      await platformApi.replaceServiceResources(tenantSlug, service.id, { resources });
      setSavedKey(serializeAttached(attached));
      onSaved("Resources saved.");
    } catch (err) {
      onSaved(readErrorMessage(err, "Unable to save resources."));
    } finally {
      setSaving(false);
    }
  };

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
          <button type="button" className="cs-svc-save-btn" onClick={handleSave} disabled={saving || !isDirty}>
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
          <input className="cs-svc-details__input" type="number" min={0} step="0.01" value={draft.price}
            placeholder="0.00" onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          <span className="cs-svc-unit__affix" aria-hidden="true">$</span>
        </span>
      </label>
      <label className="cs-svc-details__field">
        <span className="cs-svc-details__label">Extra minutes</span>
        <span className="cs-svc-unit cs-svc-unit--suffix">
          <input className="cs-svc-details__input" type="number" min={0} max={240} step={5} value={draft.minutes}
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
  };
}

function CategoryDetailPanel({
  tenantSlug,
  category,
  color,
  canManage,
  onChanged,
  onStatus,
  onDelete,
}: {
  tenantSlug: string;
  category: ServiceCategorySummary;
  color: string;
  canManage: boolean;
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

  useEffect(() => {
    setForm(categoryToFormState(category));
  }, [category]);

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

    setSaving(true);
    try {
      await platformApi.updateServiceCategory(tenantSlug, category.id, body);
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
          <h4 className="cs-svc-detail-head__name">{category.name}</h4>
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
                items={[{ label: "Delete category", danger: true, onSelect: onDelete }]}
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
                <span className="cs-svc-details__label">URL slug</span>
                <input className="cs-svc-details__input" value={form.slug} placeholder="auto from name when blank"
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, slug: event.target.value.toLowerCase().replace(/\s+/g, "-") }))
                  } />
              </label>
            </div>
            {landingHref ? (
              <p className="cs-cat-landing">
                Landing page{" "}
                <a href={landingHref} target="_blank" rel="noreferrer">{landingHref.replace(/^https?:\/\//, "")}</a>
                <button type="button" className="cs-link-btn" onClick={handleCopyLink}>Copy</button>
                {copyHint ? <span className="cs-svc-helper cs-svc-helper--ok">{copyHint}</span> : null}
              </p>
            ) : null}

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
