import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  AuthenticatedUser,
  CategoryFaqItem,
  CategoryFeaturedLabel,
  CreateServiceCategoryRequest,
  CreateServiceRequest,
  LocationSummary,
  ProviderServiceVariantEntry,
  ProviderSummary,
  ReorderRequest,
  ReplaceProviderServiceVariantsRequest,
  ServiceCategorySummary,
  ServiceSummary,
  SocialProof,
  TenantSummary,
  UpdateServiceCategoryRequest,
  UpdateServiceRequest,
  ValueStackItem,
} from "@booking/shared-types";

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
      className={`service-variant-row${
        isOverridden ? " service-variant-row--overridden" : ""
      }`}
    >
      <div className="service-variant-row__label">
        <span>{label}</span>
        <span className="service-variant-row__default">{defaultText}</span>
      </div>
      <div className="service-variant-row__control">
        <div className="service-variant-row__input">{children}</div>
        {isOverridden && canManage ? (
          <button
            type="button"
            className="text-action service-variant-row__reset"
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
  const [showCreate, setShowCreate] = useState(false);
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
            <p>You do not have permission to view the service catalog.</p>
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
        <div className="calendar-state">Loading services…</div>
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
          </div>
        </section>
        <div className="calendar-state calendar-state--muted">{loadState.message}</div>
      </main>
    );
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

      <section className="ops-panel staff-master-detail">
        <div className="staff-grid">
          <aside className="staff-list-rail">
            <header className="staff-list-rail-header">
              <h4>Services</h4>
              {canManage ? (
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => setShowCreate(true)}
                >
                  Add service
                </button>
              ) : null}
            </header>
            <div className="staff-list" style={{ flexDirection: "column", gap: 0 }}>
              {orderedCategories.map((category) => {
                const list = servicesByCategory.get(category.id) ?? [];
                return (
                  <div key={category.id} className="services-category-group">
                    <div className="services-category-group-header">
                      <span className="services-category-group-name">{category.name}</span>
                      {category.subheadline ? (
                        <span className="services-category-group-subheadline">{category.subheadline}</span>
                      ) : null}
                      {category.featuredLabel ? (
                        <span className={`services-category-badge services-category-badge--${category.featuredLabel}`}>
                          {FEATURED_LABEL_DISPLAY[category.featuredLabel] ?? category.featuredLabel}
                        </span>
                      ) : null}
                      <span className="services-category-count">{list.length}</span>
                      {canManage ? (
                        <span className="services-category-group-actions">
                          <button type="button" className="text-action"
                            onClick={() => handleRenameCategory(category)}>Rename</button>
                          <button type="button" className="text-action"
                            onClick={() => handleDeleteCategory(category)}>Delete</button>
                        </span>
                      ) : null}
                    </div>
                    {list.length === 0 ? (
                      <p className="services-list-empty">No services yet.</p>
                    ) : (
                      <ul className="services-list">
                        {list.map((service) => (
                          <li key={service.id}>
                            <button
                              type="button"
                              className={`services-list-item${selection.kind === "service" && selection.serviceId === service.id ? " is-active" : ""}`}
                              onClick={() => { setSelection({ kind: "service", serviceId: service.id }); setActiveTab("details"); }}
                            >
                              <span className="services-list-item__name">{service.name}</span>
                              <span className="services-list-item__meta">
                                {formatDurationMinutes(service.durationMinutes)} · {formatMoney(service.priceCents)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {(() => {
                const uncategorized = servicesByCategory.get(UNCATEGORIZED_KEY) ?? [];
                if (uncategorized.length === 0) return null;
                return (
                  <div className="services-category-group">
                    <div className="services-category-group-header">
                      <span className="services-category-group-name">Uncategorized</span>
                      <span className="services-category-count">{uncategorized.length}</span>
                    </div>
                    <ul className="services-list">
                      {uncategorized.map((service) => (
                        <li key={service.id}>
                          <button
                            type="button"
                            className={`services-list-item${selection.kind === "service" && selection.serviceId === service.id ? " is-active" : ""}`}
                            onClick={() => { setSelection({ kind: "service", serviceId: service.id }); setActiveTab("details"); }}
                          >
                            <span className="services-list-item__name">{service.name}</span>
                            <span className="services-list-item__meta">
                              {formatDurationMinutes(service.durationMinutes)} · {formatMoney(service.priceCents)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
            {canManage ? (
              <div style={{ padding: "0.5rem 0.75rem", borderTop: "1px solid var(--ui-border, #e5e7eb)" }}>
                <button type="button" className="ghost-action" onClick={handleCreateCategory}>
                  + Add category
                </button>
              </div>
            ) : null}
          </aside>

          <div className="staff-detail">
            {selection.kind === "service" ? (
              (() => {
                const selectedService = services.find((s) => s.id === selection.serviceId);
                if (!selectedService) {
                  return <p className="settings-form-help">Service not found.</p>;
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
                  />
                );
              })()
            ) : (
              <p className="settings-form-help">Select a service to view details.</p>
            )}
          </div>
        </div>
      </section>

      {showCreate && canManage ? (
        <CreateServiceDialog
          tenantSlug={tenantSlug}
          defaultDepositCents={tenant?.settings.defaultDepositCents ?? 0}
          categories={orderedCategories}
          locations={locations}
          initialCategoryId={
            selection.kind === "category" &&
            selection.categoryId !== UNCATEGORIZED_KEY
              ? selection.categoryId
              : null
          }
          onClose={() => setShowCreate(false)}
          onCreated={async (created) => {
            await refreshServices();
            setSelection({ kind: "service", serviceId: created.id });
            setStatus(`Service "${created.name}" created.`);
            setShowCreate(false);
          }}
        />
      ) : null}

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
  bookingPaymentMode: string; // '', 'partial_percent', 'partial_flat', 'full'
  bookingPaymentValueAmount: string; // dollar amount for partial_flat
  bookingPaymentPercent: string; // percentage for partial_percent
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
    bookingPaymentMode: service.bookingPaymentMode ?? "",
    bookingPaymentValueAmount: service.bookingPaymentValueCents != null ? (service.bookingPaymentValueCents / 100).toFixed(2) : "",
    bookingPaymentPercent: service.bookingPaymentPercent != null ? String(service.bookingPaymentPercent) : "",
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
}) {
  const [form, setForm] = useState<ServiceCardState>(() => toCardState(service));
  const [saving, setSaving] = useState(false);
  const [variants, setVariants] = useState<ProviderServiceVariantEntry[]>([]);
  const [savedVariants, setSavedVariants] = useState<ProviderServiceVariantEntry[]>([]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);
  const [variantsSaving, setVariantsSaving] = useState(false);
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
      setVariantsLoaded(true);
    }).catch(() => { if (!cancelled) setVariantsLoaded(true); });
    return () => { cancelled = true; };
  }, [tenantSlug, service.id]);

  useEffect(() => {
    return () => { if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current); };
  }, []);

  const schedulingHref = `${storefrontBaseUrl}/${tenantSlug}?serviceId=${service.id}`;

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
      const val = parseMoneyInput(form.bookingPaymentValueAmount);
      if (val != null) body.bookingPaymentValueCents = val;
    }
    if (form.bookingPaymentMode === "partial_percent") {
      const pct = Number(form.bookingPaymentPercent);
      if (Number.isFinite(pct) && pct >= 0 && pct <= 100) body.bookingPaymentPercent = pct;
    }
    setSaving(true);
    try { await platformApi.updateService(tenantSlug, service.id, body); onSaved(`"${name}" saved.`); }
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

  const eligibleProviders = useMemo(
    () => providers.filter((p) => p.isActive && p.serviceIds.includes(service.id)),
    [providers, service.id],
  );

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
    { key: "customizations", label: "Customizations" },
    { key: "onlineBooking", label: "Online booking" },
  ];

  return (
    <div className="staff-detail-inner">
      <header className="staff-detail-header">
        <div>
          <p className="eyebrow">Service</p>
          <h4>{service.name}</h4>
        </div>
        <div className="staff-detail-actions">
          {canManage ? (
            <button type="button" className="svc-duplicate-btn" onClick={() => onDuplicate(service)}>Duplicate</button>
          ) : null}
        </div>
      </header>

      <nav className="staff-detail-tabs" role="tablist" aria-label="Service sections">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key}
            className={`staff-detail-tab${activeTab === tab.key ? " is-active" : ""}`}
            onClick={() => onTabChange(tab.key)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "details" ? (
        <ServiceDetailsTab form={form} setForm={setForm} service={service} categories={categories}
          locations={locations} canManage={canManage} saving={saving} schedulingHref={schedulingHref}
          handleCopyLink={handleCopyLink} copyHint={copyHint} handleSave={handleSave} />
      ) : null}
      {activeTab === "staff" ? (
        <ServiceStaffTab service={service} eligibleProviders={eligibleProviders}
          variantByProvider={variantByProvider} updateVariant={updateVariant}
          canManage={canManage} variantsLoaded={variantsLoaded}
          isVariantsDirty={isVariantsDirty} variantsSaving={variantsSaving}
          handleSaveVariants={handleSaveVariants}
          baseDurationMinutes={baseDurationMinutes} basePriceCents={basePriceCents}
          baseDepositCents={baseDepositCents} tenantSlug={tenantSlug}
          storefrontBaseUrl={storefrontBaseUrl} />
      ) : null}
      {activeTab === "resources" ? (
        <div className="staff-detail-form"><p className="settings-form-help">Resources and attachments coming soon.</p></div>
      ) : null}
      {activeTab === "customizations" ? (
        <div className="staff-detail-form"><p className="settings-form-help">Customizations coming soon.</p></div>
      ) : null}
      {activeTab === "onlineBooking" ? (
        <ServiceOnlineBookingTab form={form} setForm={setForm} canManage={canManage}
          schedulingHref={schedulingHref} handleCopyLink={handleCopyLink} copyHint={copyHint} />
      ) : null}
    </div>
  );
}

// ===========================================================================
// Tab components
// ===========================================================================

function ServiceDetailsTab({
  form, setForm, service, categories, locations, canManage, saving,
  schedulingHref, handleCopyLink, copyHint, handleSave,
}: {
  form: ServiceCardState;
  setForm: React.Dispatch<React.SetStateAction<ServiceCardState>>;
  service: ServiceSummary;
  categories: ServiceCategorySummary[];
  locations: LocationSummary[];
  canManage: boolean;
  saving: boolean;
  schedulingHref: string;
  handleCopyLink: () => Promise<void>;
  copyHint: string | null;
  handleSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form className="svc-detail-form" onSubmit={handleSave}>
      <fieldset disabled={!canManage || saving} style={{ border: 0, padding: 0, margin: 0 }}>

        {/* Basics card */}
        <div className="svc-card">
          <div className="svc-card__row">
            <span className="svc-card__eyebrow">Basics</span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: "#4A3D30" }}>Active</span>
              <label className={`svc-toggle${form.isActive ? "" : " svc-toggle--off"}`} aria-label="Active toggle">
                <input type="checkbox" checked={form.isActive}
                  onChange={(e) => setForm((c) => ({ ...c, isActive: e.target.checked }))}
                  style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
              </label>
            </div>
          </div>
          <div style={{ marginBottom: "12px" }}>
            <label className="svc-field-label">Service name</label>
            <input className="svc-input" value={form.name}
              onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
              placeholder="Service name" required />
          </div>
          <div style={{ marginBottom: "12px" }}>
            <label className="svc-field-label">Description</label>
            <textarea className="svc-input" rows={2} style={{ resize: "vertical" }}
              value={form.description}
              onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
              placeholder="A 60-minute treatment with clean skin." />
          </div>
          <div>
            <label className="svc-field-label">Category</label>
            <select className="svc-input" value={form.categoryId}
              onChange={(e) => setForm((c) => ({ ...c, categoryId: e.target.value }))}>
              <option value="">Uncategorized</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Pricing & deposit card */}
        <div className="svc-card">
          <div className="svc-card__row">
            <span className="svc-card__eyebrow">Pricing &amp; deposit</span>
            {(Number(form.priceAmount) !== service.priceCents / 100 || Number(form.depositAmount) !== service.depositCents / 100) && canManage ? (
              <span className="svc-reset-link" onClick={() => setForm((c) => ({
                ...c,
                priceAmount: (service.priceCents / 100).toFixed(2),
                depositAmount: (service.depositCents / 100).toFixed(2),
              }))}>Reset to default</span>
            ) : null}
          </div>
          <div className="svc-grid-2">
            <div>
              <label className="svc-field-label">Price</label>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "13px", color: "#1F1612" }}>$</span>
                <input className="svc-input" type="number" min={0} step="0.01"
                  value={form.priceAmount}
                  onChange={(e) => setForm((c) => ({ ...c, priceAmount: e.target.value }))} required />
              </div>
            </div>
            <div>
              <label className="svc-field-label">Deposit</label>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "13px", color: "#1F1612" }}>$</span>
                <input className="svc-input" type="number" min={0} step="0.01"
                  value={form.depositAmount}
                  onChange={(e) => setForm((c) => ({ ...c, depositAmount: e.target.value }))} required />
              </div>
              <div className="svc-helper">Required to book online.</div>
            </div>
          </div>
        </div>

        {/* Scheduling card */}
        <div className="svc-card">
          <span className="svc-card__eyebrow" style={{ marginBottom: "14px", display: "block" }}>Scheduling</span>
          <div className="svc-grid-3">
            <div>
              <label className="svc-field-label">Duration</label>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input className="svc-input" type="number" min={15} step={15}
                  value={form.durationMinutes}
                  onChange={(e) => setForm((c) => ({ ...c, durationMinutes: e.target.value }))} required />
                <span style={{ fontSize: "12px", color: "#6B5A47" }}>min</span>
              </div>
            </div>
            <div>
              <label className="svc-field-label">Setup buffer</label>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input className="svc-input" type="number" min={0} step={5}
                  value={form.setupBufferMinutes}
                  onChange={(e) => setForm((c) => ({ ...c, setupBufferMinutes: e.target.value }))} />
                <span style={{ fontSize: "12px", color: "#6B5A47" }}>min</span>
              </div>
            </div>
            <div>
              <label className="svc-field-label">Cleanup buffer</label>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input className="svc-input" type="number" min={0} step={5}
                  value={form.cleanupBufferMinutes}
                  onChange={(e) => setForm((c) => ({ ...c, cleanupBufferMinutes: e.target.value }))} />
                <span style={{ fontSize: "12px", color: "#6B5A47" }}>min</span>
              </div>
            </div>
          </div>
        </div>

        {/* Online booking card */}
        <div className="svc-card">
          <span className="svc-card__eyebrow" style={{ marginBottom: "14px", display: "block" }}>Online booking</span>
          <div className="svc-card__row" style={{ marginBottom: "10px" }}>
            <div>
              <div style={{ fontSize: "13px", color: "#1F1612", fontWeight: 500 }}>Enable in online booking</div>
              <div className="svc-helper" style={{ marginTop: "2px" }}>Clients can self-book this service.</div>
            </div>
            <label className={`svc-toggle${form.isActive ? "" : " svc-toggle--off"}`} aria-label="Online booking toggle">
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm((c) => ({ ...c, isActive: e.target.checked }))}
                style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
            </label>
          </div>
          <div className="svc-card__row" style={{ paddingTop: "10px", borderTop: "0.5px dashed #D9CBB1" }}>
            <div style={{ fontSize: "12px", color: "#4A3D30" }}>Direct booking link</div>
            <span className="svc-reset-link" onClick={handleCopyLink}>Copy link</span>
          </div>
          {copyHint ? <div className="svc-helper" style={{ color: "#2d6a4f" }}>{copyHint}</div> : null}
        </div>

        {/* Locations card */}
        <div className="svc-card" style={{ marginBottom: 0 }}>
          <span className="svc-card__eyebrow" style={{ marginBottom: "12px", display: "block" }}>Available at locations</span>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {locations.map((loc) => {
              const checked = form.locationIds.includes(loc.id);
              return (
                <label key={loc.id} className={`svc-chip${checked ? " svc-chip--on" : ""}`}>
                  <input type="checkbox" checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setForm((c) => ({ ...c, locationIds: next ? [...c.locationIds, loc.id] : c.locationIds.filter((id) => id !== loc.id) }));
                    }}
                    style={{ display: "none" }} />
                  {checked ? "✓ " : ""}{loc.name}
                </label>
              );
            })}
          </div>
        </div>
      </fieldset>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" }}>
        {canManage ? (
          <button type="submit" className="svc-save-btn" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ServiceStaffTab({
  service, eligibleProviders, variantByProvider, updateVariant, canManage,
  variantsLoaded, isVariantsDirty, variantsSaving, handleSaveVariants,
  baseDurationMinutes, basePriceCents, baseDepositCents, tenantSlug, storefrontBaseUrl,
}: {
  service: ServiceSummary;
  eligibleProviders: ProviderSummary[];
  variantByProvider: Map<string, ProviderServiceVariantEntry>;
  updateVariant: (providerId: string, patch: Partial<ProviderServiceVariantEntry>) => void;
  canManage: boolean;
  variantsLoaded: boolean;
  isVariantsDirty: boolean;
  variantsSaving: boolean;
  handleSaveVariants: () => Promise<void>;
  baseDurationMinutes: number;
  basePriceCents: number;
  baseDepositCents: number;
  tenantSlug: string;
  storefrontBaseUrl: string;
}) {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  if (eligibleProviders.length === 0) {
    return (
      <div className="svc-detail-form">
        <div className="svc-card">
          <p className="svc-helper">No providers offer this service yet.</p>
        </div>
      </div>
    );
  }

  const enabledCount = eligibleProviders.filter((p) => p.isActive).length;

  return (
    <div className="svc-detail-form">
      {canManage && isVariantsDirty ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
          <button type="button" className="svc-save-btn" onClick={handleSaveVariants} disabled={variantsSaving}>
            {variantsSaving ? "Saving…" : "Save overrides"}
          </button>
        </div>
      ) : null}

      {/* Eligible staff card */}
      <div className="svc-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
          <div>
            <span className="svc-card__eyebrow">Eligible staff</span>
            <div className="svc-summary-row" style={{ marginTop: "4px" }}>
              <span><strong style={{ fontWeight: 500 }}>{enabledCount}</strong> of {eligibleProviders.length} staff can perform this service</span>
            </div>
          </div>
          {canManage ? (
            <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
              <button type="button" className="svc-text-btn">Enable all</button>
              <button type="button" className="svc-text-btn">Disable all</button>
            </div>
          ) : null}
        </div>

        {!variantsLoaded ? (
          <p className="svc-helper">Loading…</p>
        ) : (
          eligibleProviders.map((provider) => {
            const entry = variantByProvider.get(provider.id) ?? {
              providerId: provider.id, priceCents: null, durationMinutes: null,
              depositCents: null, commissionFlatCents: null, commissionBasisPoints: null,
            };
            const hasAnyOverride = entry.priceCents != null || entry.durationMinutes != null ||
              entry.depositCents != null || entry.commissionFlatCents != null || entry.commissionBasisPoints != null;
            const commissionMode: "flat" | "percent" = entry.commissionFlatCents != null ? "flat" : "percent";
            const isExpanded = expandedProvider === provider.id;
            const isActive = provider.isActive;

            const metaParts: string[] = [];
            if (hasAnyOverride) metaParts.push("Custom pricing");
            if (entry.commissionBasisPoints != null) metaParts.push(`${entry.commissionBasisPoints / 100}% commission`);
            if (entry.commissionFlatCents != null) metaParts.push(`$${(entry.commissionFlatCents / 100).toFixed(2)} commission`);
            if (metaParts.length === 0) metaParts.push("Uses service defaults");

            return (
              <div key={provider.id} className={`svc-staff-row${isActive ? "" : " svc-staff-row--dim"}`}>
                <button
                  type="button"
                  className="svc-staff-row__main"
                  onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                >
                  <div className="svc-staff-avatar" style={{ background: isActive ? "#6B5A47" : "#8B7960" }}>
                    {provider.name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span className="svc-staff-name">{provider.name}</span>
                    <div className="svc-staff-meta">{metaParts.join(" · ")}</div>
                  </div>
                  <span className="svc-chev">{isExpanded ? "▾" : "▸"}</span>
                </button>
                <label className={`svc-toggle${isActive ? "" : " svc-toggle--off"}`} aria-label={`Toggle ${provider.name}`}>
                  <input type="checkbox" checked={isActive}
                    onChange={() => {}} disabled={!canManage}
                    style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                </label>

                {isExpanded ? (
                  <div className="svc-override-card">
                    <div className="svc-override-rows">
                      <div className="svc-override-row">
                        <span className="svc-override-label">Duration</span>
                        <div className="svc-override-value">
                          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <input className="svc-input" type="number" min={15} max={480} step={15} disabled={!canManage}
                              placeholder={String(baseDurationMinutes)} value={entry.durationMinutes ?? ""}
                              onChange={(e) => { const raw = e.target.value; if (!raw) { updateVariant(provider.id, { durationMinutes: null }); return; } const n = Number(raw); updateVariant(provider.id, { durationMinutes: Number.isFinite(n) ? n : null }); }} />
                            <span style={{ fontSize: "12px", color: "#6B5A47" }}>min</span>
                          </div>
                          {entry.durationMinutes != null && canManage ? (
                            <button type="button" className="svc-text-btn"
                              onClick={() => updateVariant(provider.id, { durationMinutes: null })}>
                              Reset to default
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="svc-override-row">
                        <span className="svc-override-label">Price</span>
                        <div className="svc-override-value">
                          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <span style={{ fontSize: "13px", color: "#1F1612" }}>$</span>
                            <input className="svc-input" type="number" min={0} step="0.01" disabled={!canManage}
                              placeholder={(basePriceCents / 100).toFixed(2)}
                              value={entry.priceCents == null ? "" : (entry.priceCents / 100).toFixed(2)}
                              onChange={(e) => { const raw = e.target.value; if (!raw) { updateVariant(provider.id, { priceCents: null }); return; } const cents = parseMoneyInput(raw); updateVariant(provider.id, { priceCents: cents }); }} />
                          </div>
                          {entry.priceCents != null && canManage ? (
                            <button type="button" className="svc-text-btn"
                              onClick={() => updateVariant(provider.id, { priceCents: null })}>
                              Reset to default
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="svc-override-row">
                        <span className="svc-override-label">Commission</span>
                        <div className="svc-override-value">
                          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <div className="service-card__pill-toggle" role="group" aria-label="Commission type">
                              <button type="button" className={`service-card__pill${commissionMode === "flat" ? " is-active" : ""}`} disabled={!canManage}
                                onClick={() => { if (commissionMode === "flat") return; updateVariant(provider.id, { commissionBasisPoints: null, commissionFlatCents: entry.commissionFlatCents ?? 0 }); }}>$</button>
                              <button type="button" className={`service-card__pill${commissionMode === "percent" ? " is-active" : ""}`} disabled={!canManage}
                                onClick={() => { if (commissionMode === "percent") return; updateVariant(provider.id, { commissionFlatCents: null, commissionBasisPoints: entry.commissionBasisPoints ?? 0 }); }}>%</button>
                            </div>
                            {commissionMode === "flat" ? (
                              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <span style={{ fontSize: "13px", color: "#1F1612" }}>$</span>
                                <input className="svc-input" type="number" min={0} step="0.01" disabled={!canManage} placeholder="0.00" style={{ width: "5rem" }}
                                  value={entry.commissionFlatCents == null ? "" : (entry.commissionFlatCents / 100).toFixed(2)}
                                  onChange={(e) => { const raw = e.target.value; if (!raw) { updateVariant(provider.id, { commissionFlatCents: null }); return; } const cents = parseMoneyInput(raw); updateVariant(provider.id, { commissionFlatCents: cents, commissionBasisPoints: null }); }} />
                              </div>
                            ) : (
                              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <input className="svc-input" type="number" min={0} max={100} step="0.1" disabled={!canManage} placeholder="0" style={{ width: "4rem" }}
                                  value={entry.commissionBasisPoints == null ? "" : (entry.commissionBasisPoints / 100).toString()}
                                  onChange={(e) => { const raw = e.target.value; if (!raw) { updateVariant(provider.id, { commissionBasisPoints: null }); return; } const pct = Number(raw); if (!Number.isFinite(pct)) return; const bp = Math.round(pct * 100); updateVariant(provider.id, { commissionBasisPoints: Math.max(0, Math.min(10_000, bp)), commissionFlatCents: null }); }} />
                                <span style={{ fontSize: "12px", color: "#6B5A47" }}>%</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="svc-override-row">
                        <span className="svc-override-label">Enable in online booking</span>
                        <div className="svc-override-value">
                          <label className={`svc-toggle${isActive ? "" : " svc-toggle--off"}`} aria-label={`Online booking for ${provider.name}`}>
                            <input type="checkbox" checked={isActive} disabled={!canManage}
                              onChange={() => {}}
                              style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                          </label>
                        </div>
                      </div>
                      <div className="svc-override-row">
                        <span className="svc-override-label">Online booking</span>
                        <div className="svc-override-value">
                          <a
                            href={`${storefrontBaseUrl}/${tenantSlug}?serviceId=${service.id}&staffId=${provider.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="svc-reset-link"
                            onClick={async (e) => {
                              e.preventDefault();
                              const link = `${storefrontBaseUrl}/${tenantSlug}?serviceId=${service.id}&staffId=${provider.id}`;
                              try { await navigator.clipboard.writeText(link); } catch {}
                              window.open(link, "_blank", "noopener,noreferrer");
                            }}
                          >
                            Direct link
                          </a>
                        </div>
                      </div>
                    </div>
                    {(entry.priceCents != null || entry.durationMinutes != null || entry.commissionFlatCents != null || entry.commissionBasisPoints != null) ? (
                      <button type="button" className="svc-text-btn" style={{ marginTop: "10px" }}
                        onClick={() => updateVariant(provider.id, { priceCents: null, durationMinutes: null, depositCents: null, commissionFlatCents: null, commissionBasisPoints: null })}>
                        Reset to service defaults
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Client selection card */}
      <div className="svc-card" style={{ marginBottom: 0 }}>
        <span className="svc-card__eyebrow" style={{ marginBottom: "14px", display: "block" }}>Client selection on booking</span>

        <label className="svc-selection-opt svc-selection-opt--active">
          <input type="radio" name="clientSelection" defaultChecked style={{ display: "none" }} />
          <div className="svc-radio svc-radio--on" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 500 }}>Let clients choose their artist</div>
            <div className="svc-helper">Clients see all eligible staff and pick one when booking online.</div>
          </div>
        </label>

        <label className="svc-selection-opt">
          <input type="radio" name="clientSelection" style={{ display: "none" }} />
          <div className="svc-radio" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 500 }}>Assign automatically</div>
            <div className="svc-helper">Distribute bookings evenly across eligible staff. Best for fairness.</div>
          </div>
        </label>

        <label className="svc-selection-opt" style={{ marginBottom: 0 }}>
          <input type="radio" name="clientSelection" style={{ display: "none" }} />
          <div className="svc-radio" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 500 }}>Hide artist selection</div>
            <div className="svc-helper">Clients book the service without seeing who'll perform it. Useful for new staff or training periods.</div>
          </div>
        </label>
      </div>
    </div>
  );
}

function ServiceOnlineBookingTab({
  form, setForm, canManage, schedulingHref, handleCopyLink, copyHint,
}: {
  form: ServiceCardState;
  setForm: React.Dispatch<React.SetStateAction<ServiceCardState>>;
  canManage: boolean;
  schedulingHref: string;
  handleCopyLink: () => Promise<void>;
  copyHint: string | null;
}) {
  return (
    <div className="svc-detail-form">
      <div className="svc-card">
        <span className="svc-card__eyebrow" style={{ marginBottom: "14px", display: "block" }}>Online booking</span>
        <div className="svc-card__row" style={{ marginBottom: "10px" }}>
          <div>
            <div style={{ fontSize: "13px", color: "#1F1612", fontWeight: 500 }}>Enable in online booking</div>
            <div className="svc-helper" style={{ marginTop: "2px" }}>Clients can self-book this service.</div>
          </div>
          <label className={`svc-toggle${form.isActive ? "" : " svc-toggle--off"}`} aria-label="Online booking toggle">
            <input type="checkbox" checked={form.isActive} disabled={!canManage}
              onChange={(e) => setForm((c) => ({ ...c, isActive: e.target.checked }))}
              style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
          </label>
        </div>

        <div className="svc-card__row" style={{ paddingTop: "10px", borderTop: "0.5px dashed #D9CBB1" }}>
          <div style={{ fontSize: "12px", color: "#4A3D30" }}>Direct booking link</div>
          <span className="svc-reset-link" onClick={handleCopyLink}>Copy link</span>
        </div>
        {copyHint ? <div className="svc-helper" style={{ color: "#2d6a4f" }}>{copyHint}</div> : null}
      </div>

      <div className="svc-card">
        <span className="svc-card__eyebrow" style={{ marginBottom: "14px", display: "block" }}>Customer-facing description</span>
        <label className="svc-field-label" style={{ marginBottom: "4px" }}>Online booking description</label>
        <textarea
          className="svc-input"
          value={form.onlineBookingDescription}
          onChange={(e) => setForm((c) => ({ ...c, onlineBookingDescription: e.target.value }))}
          disabled={!canManage}
          rows={3}
          maxLength={2000}
          placeholder="Describe this service for customers browsing online…"
          style={{ width: "100%", resize: "vertical" }}
        />
        <div className="svc-helper" style={{ marginTop: "4px" }}>Shown to customers on the online booking page.</div>
      </div>

      <div className="svc-card">
        <span className="svc-card__eyebrow" style={{ marginBottom: "14px", display: "block" }}>Payment requirements</span>
        <div className="svc-card__row" style={{ marginBottom: "10px" }}>
          <div>
            <div style={{ fontSize: "13px", color: "#1F1612", fontWeight: 500 }}>Require a credit card on file to book</div>
            <div className="svc-helper" style={{ marginTop: "2px" }}>Clients must have a saved payment method before booking.</div>
          </div>
          <label className={`svc-toggle${form.requireCardOnFile ? "" : " svc-toggle--off"}`} aria-label="Require card on file toggle">
            <input type="checkbox" checked={form.requireCardOnFile} disabled={!canManage}
              onChange={(e) => setForm((c) => ({ ...c, requireCardOnFile: e.target.checked }))}
              style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
          </label>
        </div>

        <div style={{ paddingTop: "10px", borderTop: "0.5px dashed #D9CBB1" }}>
          <div style={{ fontSize: "13px", color: "#1F1612", fontWeight: 500, marginBottom: "8px" }}>Require payment at time of booking</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label className="svc-selection-opt" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input type="radio" name="bookingPaymentMode" value=""
                checked={form.bookingPaymentMode === ""}
                onChange={() => setForm((c) => ({ ...c, bookingPaymentMode: "" }))}
                disabled={!canManage} />
              <span>No payment required at booking</span>
            </label>
            <label className="svc-selection-opt" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input type="radio" name="bookingPaymentMode" value="full"
                checked={form.bookingPaymentMode === "full"}
                onChange={() => setForm((c) => ({ ...c, bookingPaymentMode: "full" }))}
                disabled={!canManage} />
              <span>Full payment</span>
            </label>
            <label className="svc-selection-opt" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input type="radio" name="bookingPaymentMode" value="partial_percent"
                checked={form.bookingPaymentMode === "partial_percent"}
                onChange={() => setForm((c) => ({ ...c, bookingPaymentMode: "partial_percent" }))}
                disabled={!canManage} />
              <span>Partial payment —</span>
              <input type="number" className="svc-input" min="0" max="100"
                value={form.bookingPaymentPercent}
                onChange={(e) => setForm((c) => ({ ...c, bookingPaymentPercent: e.target.value, bookingPaymentMode: "partial_percent" }))}
                disabled={!canManage || form.bookingPaymentMode !== "partial_percent"}
                style={{ width: "60px", textAlign: "center" }}
                onFocus={() => { if (form.bookingPaymentMode !== "partial_percent") setForm((c) => ({ ...c, bookingPaymentMode: "partial_percent" })); }}
              />
              <span>%</span>
            </label>
            <label className="svc-selection-opt" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input type="radio" name="bookingPaymentMode" value="partial_flat"
                checked={form.bookingPaymentMode === "partial_flat"}
                onChange={() => setForm((c) => ({ ...c, bookingPaymentMode: "partial_flat" }))}
                disabled={!canManage} />
              <span>Partial payment — $</span>
              <input type="text" className="svc-input"
                value={form.bookingPaymentValueAmount}
                onChange={(e) => setForm((c) => ({ ...c, bookingPaymentValueAmount: e.target.value, bookingPaymentMode: "partial_flat" }))}
                disabled={!canManage || form.bookingPaymentMode !== "partial_flat"}
                style={{ width: "80px" }}
                placeholder="0.00"
                onFocus={() => { if (form.bookingPaymentMode !== "partial_flat") setForm((c) => ({ ...c, bookingPaymentMode: "partial_flat" })); }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Create dialog
// ===========================================================================

function CreateServiceDialog({
  tenantSlug,
  defaultDepositCents,
  categories,
  locations,
  initialCategoryId,
  onClose,
  onCreated,
}: {
  tenantSlug: string;
  defaultDepositCents: number;
  categories: ServiceCategorySummary[];
  locations: LocationSummary[];
  initialCategoryId: string | null;
  onClose: () => void;
  onCreated: (service: ServiceSummary) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [setupBufferMinutes, setSetupBufferMinutes] = useState("0");
  const [cleanupBufferMinutes, setCleanupBufferMinutes] = useState("0");
  const [priceAmount, setPriceAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState(
    (defaultDepositCents / 100).toFixed(2),
  );
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? "");
  const [locationIds, setLocationIds] = useState<string[]>(() =>
    locations.length > 0 ? [locations[0].id] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    const duration = Number(durationMinutes);
    const priceCents = parseMoneyInput(priceAmount);
    const depositCents = parseMoneyInput(depositAmount);
    if (
      !trimmedName ||
      !Number.isInteger(duration) ||
      duration < 15 ||
      priceCents === null ||
      depositCents === null
    ) {
      setError("Enter a name, duration ≥ 15 minutes, and valid price/deposit.");
      return;
    }
    if (locationIds.length === 0) {
      setError("Select at least one location.");
      return;
    }
    const body: CreateServiceRequest = {
      name: trimmedName,
      description: description.trim() || undefined,
      durationMinutes: duration,
      setupBufferMinutes: Number(setupBufferMinutes) || 0,
      cleanupBufferMinutes: Number(cleanupBufferMinutes) || 0,
      priceCents,
      depositCents,
      locationIds,
      categoryId: categoryId || undefined,
    };
    setSaving(true);
    try {
      const created = await platformApi.createService(tenantSlug, body);
      await onCreated(created);
    } catch (err) {
      setError(readErrorMessage(err, "Unable to create service."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Add service">
      <div className="modal-panel">
        <header className="modal-header">
          <h4>Add service</h4>
          <button type="button" className="ghost-action" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="modal-form" onSubmit={handleSubmit}>
          {error ? (
            <div className="message-banner message-banner--error">{error}</div>
          ) : null}
          <div className="form-grid">
            <label>
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              <span>Category</span>
              <select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">Uncategorized</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Duration (minutes)</span>
              <input
                type="number"
                min={15}
                step={15}
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Setup buffer (minutes)</span>
              <input
                type="number"
                min={0}
                step={5}
                value={setupBufferMinutes}
                onChange={(event) => setSetupBufferMinutes(event.target.value)}
              />
              <small className="field-help">Time blocked before the appointment for room prep.</small>
            </label>
            <label>
              <span>Cleanup buffer (minutes)</span>
              <input
                type="number"
                min={0}
                step={5}
                value={cleanupBufferMinutes}
                onChange={(event) => setCleanupBufferMinutes(event.target.value)}
              />
              <small className="field-help">Time blocked after the appointment for turnover.</small>
            </label>
            <label>
              <span>Price</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={priceAmount}
                onChange={(event) => setPriceAmount(event.target.value)}
                placeholder="185.00"
                required
              />
            </label>
            <label>
              <span>Deposit due today</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
                required
              />
            </label>
            <label className="form-grid__full">
              <span>Description</span>
              <textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <fieldset className="form-grid__full service-locations-fieldset">
              <legend>Locations</legend>
              {locations.length === 0 ? (
                <p className="settings-form-help">No active locations.</p>
              ) : (
                <ul className="service-location-checks">
                  {locations.map((location) => {
                    const checked = locationIds.includes(location.id);
                    return (
                      <li key={location.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const next = event.target.checked;
                              setLocationIds((current) =>
                                next
                                  ? [...current, location.id]
                                  : current.filter((id) => id !== location.id),
                              );
                            }}
                          />
                          <span>{location.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>
          </div>
          <div className="inline-meta">
            <button type="button" className="ghost-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={saving}>
              {saving ? "Creating…" : "Create service"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Add category">
      <div className="modal-panel">
        <header className="modal-header">
          <h4>Add category</h4>
          <button type="button" className="ghost-action" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="modal-form" onSubmit={handleSubmit}>
          {error ? (
            <div className="message-banner message-banner--error">{error}</div>
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
          <div className="modal-actions">
            <button type="button" className="ghost-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={saving}>
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
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Rename category">
      <div className="modal-panel">
        <header className="modal-header">
          <h4>Rename category</h4>
          <button type="button" className="ghost-action" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="modal-form" onSubmit={handleSubmit}>
          {error ? (
            <div className="message-banner message-banner--error">{error}</div>
          ) : null}
          <label>
            <span>Category name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="ghost-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={saving}>
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
  onClose,
  onDeleted,
  onStatus,
}: {
  tenantSlug: string;
  category: ServiceCategorySummary;
  onClose: () => void;
  onDeleted: (name: string, categoryId: string) => Promise<void> | void;
  onStatus: (message: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await platformApi.deleteServiceCategory(tenantSlug, category.id);
      await onDeleted(category.name, category.id);
    } catch (err) {
      onStatus(readErrorMessage(err, "Unable to delete category."));
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Delete category">
      <div className="modal-panel">
        <header className="modal-header">
          <h4>Delete category</h4>
          <button type="button" className="ghost-action" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="modal-form">
          <p>
            Delete category <strong>{category.name}</strong>? Services in this
            category will become uncategorized.
          </p>
          <div className="modal-actions">
            <button type="button" className="ghost-action" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-action"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
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
  canManage,
  onChanged,
  onStatus,
}: {
  tenantSlug: string;
  category: ServiceCategorySummary;
  canManage: boolean;
  onChanged: (status?: string | null) => Promise<void>;
  onStatus: (msg: string) => void;
}) {
  const [form, setForm] = useState<CategoryFormState>(() => categoryToFormState(category));
  const [saving, setSaving] = useState(false);
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

  return (
    <form className="service-detail-panel category-detail-panel" onSubmit={handleSave}>
      <header className="service-detail-header">
        <div>
          <p className="eyebrow">Category</p>
          <h4>{category.name}</h4>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.isActive}
            disabled={!canManage}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, isActive: event.target.checked }))
            }
          />
          <span>{form.isActive ? "Active" : "Hidden"}</span>
        </label>
      </header>

      <fieldset disabled={!canManage}>
        <legend>Basics</legend>
        <label className="field">
          <span>Category name</span>
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
        </label>
        <label className="field">
          <span>URL slug</span>
          <input
            type="text"
            value={form.slug}
            placeholder="auto-generated from name when blank"
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                slug: event.target.value.toLowerCase().replace(/\s+/g, "-"),
              }))
            }
          />
          <small className="field-help">
            Lowercase letters, numbers, and hyphens only. Leave blank to regenerate from the name.
          </small>
        </label>
        {landingHref ? (
          <div className="inline-link">
            <span>
              Landing page:&nbsp;
              <a href={landingHref} target="_blank" rel="noreferrer">
                {landingHref}
              </a>
            </span>
            <button type="button" className="ghost-action" onClick={handleCopyLink}>
              Copy
            </button>
            {copyHint ? <span className="copy-hint">{copyHint}</span> : null}
          </div>
        ) : (
          <p className="field-help">Save with a slug to publish a public landing page.</p>
        )}
        <label className="field">
          <span>Featured label</span>
          <select
            value={form.featuredLabel}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                featuredLabel: event.target.value as "" | CategoryFeaturedLabel,
              }))
            }
          >
            {FEATURED_LABEL_OPTIONS.map((opt) => (
              <option key={opt.value || "none"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset disabled={!canManage}>
        <legend>Hero</legend>
        <label className="field">
          <span>Outcome headline</span>
          <input
            type="text"
            value={form.outcomeHeadline}
            placeholder="The result your customer wants in one line"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, outcomeHeadline: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Subheadline</span>
          <textarea
            value={form.subheadline}
            rows={2}
            placeholder="One or two sentences expanding on the outcome."
            onChange={(event) =>
              setForm((prev) => ({ ...prev, subheadline: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Hero image URL</span>
          <input
            type="url"
            value={form.heroImageUrl}
            placeholder="https://…"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, heroImageUrl: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Hero image alt text</span>
          <input
            type="text"
            value={form.heroImageAlt}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, heroImageAlt: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Scarcity hint</span>
          <input
            type="text"
            value={form.scarcityHint}
            placeholder="e.g. Only 3 slots left this week"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, scarcityHint: event.target.value }))
            }
          />
        </label>
      </fieldset>

      <ValueStackEditor
        legend="Value stack"
        help="Itemize what the customer is actually getting and what each piece is worth."
        items={form.valueStack}
        disabled={!canManage}
        onChange={(next) => setForm((prev) => ({ ...prev, valueStack: next }))}
      />

      <ValueStackEditor
        legend="Bonuses"
        help="Extras included at no additional charge — risk reducers and surprise-and-delight items."
        items={form.bonuses}
        disabled={!canManage}
        onChange={(next) => setForm((prev) => ({ ...prev, bonuses: next }))}
      />

      <fieldset disabled={!canManage}>
        <legend>Guarantee</legend>
        <label className="field">
          <span>Guarantee text</span>
          <textarea
            value={form.guaranteeText}
            rows={3}
            placeholder="The reversal: what you promise the customer if they're not happy."
            onChange={(event) =>
              setForm((prev) => ({ ...prev, guaranteeText: event.target.value }))
            }
          />
        </label>
      </fieldset>

      <fieldset disabled={!canManage}>
        <legend>Social proof</legend>
        <label className="field">
          <span>Quote</span>
          <textarea
            value={form.socialQuote}
            rows={3}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, socialQuote: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Author</span>
          <input
            type="text"
            value={form.socialAuthor}
            placeholder="First name + last initial works great"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, socialAuthor: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Author photo URL</span>
          <input
            type="url"
            value={form.socialImageUrl}
            placeholder="https://…"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, socialImageUrl: event.target.value }))
            }
          />
        </label>
      </fieldset>

      <FaqEditor
        items={form.faqs}
        disabled={!canManage}
        onChange={(next) => setForm((prev) => ({ ...prev, faqs: next }))}
      />

      <fieldset disabled={!canManage}>
        <legend>SEO</legend>
        <label className="field">
          <span>Meta description</span>
          <textarea
            value={form.metaDescription}
            rows={2}
            placeholder="Used for search engine snippets and social previews."
            onChange={(event) =>
              setForm((prev) => ({ ...prev, metaDescription: event.target.value }))
            }
          />
        </label>
      </fieldset>

      {canManage ? (
        <div className="service-detail-actions">
          <button type="submit" className="primary-action" disabled={saving}>
            {saving ? "Saving…" : "Save category"}
          </button>
        </div>
      ) : (
        <p className="service-detail-locked">
          You don't have permission to edit categories.
        </p>
      )}
    </form>
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
      <p className="field-help">{help}</p>
      <ul className="stack-editor">
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
              className="ghost-action"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="ghost-action"
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
      <p className="field-help">
        Address the friction points and objections customers raise before booking.
      </p>
      <ul className="faq-editor">
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
              className="ghost-action"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="ghost-action"
        onClick={() => onChange([...items, { question: "", answer: "" }])}
      >
        + Add question
      </button>
    </fieldset>
  );
}
