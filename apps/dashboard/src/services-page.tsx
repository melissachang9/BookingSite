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
      <h3>{definition.title}</h3>

      {status ? (
        <div className="message-banner" role="status">
          {status}
          <button type="button" className="ghost-action" onClick={() => setStatus(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="services-layout">
        <aside className="services-sidebar" aria-label="Service categories">
          <div className="services-sidebar-header">
            <h4>Categories</h4>
            {canManage ? (
              <button
                type="button"
                className="ghost-action"
                onClick={handleCreateCategory}
              >
                + Add category
              </button>
            ) : null}
          </div>
          <ul className="services-category-list">
            <li>
              <button
                type="button"
                className={
                  selection.kind === "none"
                    ? "services-category-btn is-active"
                    : "services-category-btn"
                }
                onClick={() => setSelection({ kind: "none" })}
              >
                <span>All services</span>
                <span className="services-category-count">{services.length}</span>
              </button>
            </li>
            {orderedCategories.map((category) => {
              const count = (servicesByCategory.get(category.id) ?? []).length;
              const isActive =
                selection.kind === "category" &&
                selection.categoryId === category.id;
              const isDragOver =
                dragOverTarget.kind === "category" &&
                dragOverTarget.categoryId === category.id;
              const isDragging =
                drag.kind === "category" && drag.categoryId === category.id;
              return (
                <li
                  key={category.id}
                  className={[
                    isDragging ? "services-category-dragging" : "",
                    isDragOver ? "services-category-drop-target" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable={canManage}
                  onDragStart={() =>
                    setDrag({ kind: "category", categoryId: category.id })
                  }
                  onDragEnd={() => {
                    setDrag({ kind: "none" });
                    setDragOverTarget({ kind: "none" });
                  }}
                  onDragEnter={() => {
                    if (drag.kind === "category") {
                      setDragOverTarget({ kind: "category", categoryId: category.id });
                    }
                  }}
                  onDragLeave={(event) => {
                    if (
                      drag.kind === "category" &&
                      !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)
                    ) {
                      setDragOverTarget({ kind: "none" });
                    }
                  }}
                  onDragOver={(event) => {
                    if (drag.kind === "category") event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (drag.kind !== "category") return;
                    event.preventDefault();
                    if (drag.categoryId === category.id) return;
                    const ids = orderedCategories.map((c) => c.id);
                    const moved = ids.filter((id) => id !== drag.categoryId);
                    const idx = moved.indexOf(category.id);
                    moved.splice(idx, 0, drag.categoryId);
                    setDrag({ kind: "none" });
                    setDragOverTarget({ kind: "none" });
                    void handleReorderCategories(moved);
                  }}
                >
                  <button
                    type="button"
                    className={
                      isActive
                        ? "services-category-btn is-active"
                        : "services-category-btn"
                    }
                    onClick={() =>
                      setSelection({ kind: "category", categoryId: category.id })
                    }
                  >
                    <span className="services-category-btn__text">
                      <span className="services-category-btn__name">
                        <span className="services-category-handle" aria-hidden="true">
                          ⋮⋮
                        </span>
                        {category.name}
                      </span>
                      {category.subheadline ? (
                        <span className="services-category-btn__subheadline">
                          {category.subheadline}
                        </span>
                      ) : null}
                      {category.featuredLabel ? (
                        <span className={`services-category-badge services-category-badge--${category.featuredLabel}`}>
                          {FEATURED_LABEL_DISPLAY[category.featuredLabel] ?? category.featuredLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="services-category-count">{count}</span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                className={
                  selection.kind === "category" &&
                  selection.categoryId === UNCATEGORIZED_KEY
                    ? "services-category-btn is-active"
                    : "services-category-btn"
                }
                onClick={() =>
                  setSelection({
                    kind: "category",
                    categoryId: UNCATEGORIZED_KEY,
                  })
                }
              >
                <span>Uncategorized</span>
                <span className="services-category-count">
                  {(servicesByCategory.get(UNCATEGORIZED_KEY) ?? []).length}
                </span>
              </button>
            </li>
          </ul>
        </aside>

        <section className="services-main">
          <div className="services-main-header">
            <h4>
              {selection.kind === "category"
                ? selection.categoryId === UNCATEGORIZED_KEY
                  ? "Uncategorized"
                  : categories.find((c) => c.id === selection.categoryId)?.name ??
                    "Category"
                : "All services"}
            </h4>
            {canManage ? (
              <div className="services-main-actions">
                {selection.kind === "category" &&
                selection.categoryId !== UNCATEGORIZED_KEY &&
                selectedCategory ? (
                  <>
                    <button
                      type="button"
                      className="ghost-action"
                      onClick={() => handleRenameCategory(selectedCategory)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="ghost-action"
                      onClick={() => handleDeleteCategory(selectedCategory)}
                    >
                      Delete
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => setShowCreate(true)}
                >
                  + Add service
                </button>
              </div>
            ) : null}
          </div>

          {renderServiceCards({
            orderedCategories,
            servicesByCategory,
            selection,
            canManage,
            tenantSlug,
            locations,
            providers,
            onSaved: async (msg) => {
              await refreshServices();
              if (msg) setStatus(msg);
            },
            onDuplicate: handleDuplicateService,
          })}
        </section>
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
  };
}

function ServiceCard({
  service,
  categories,
  locations,
  providers,
  canManage,
  tenantSlug,
  onSaved,
  onDuplicate,
}: {
  service: ServiceSummary;
  categories: ServiceCategorySummary[];
  locations: LocationSummary[];
  providers: ProviderSummary[];
  canManage: boolean;
  tenantSlug: string;
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

  useEffect(() => {
    setForm(toCardState(service));
  }, [service]);

  useEffect(() => {
    let cancelled = false;
    setVariantsLoaded(false);
    void platformApi
      .getServiceProviderVariants(tenantSlug, service.id)
      .then((resp) => {
        if (cancelled) return;
        setVariants(resp.variants);
        setSavedVariants(resp.variants);
        setVariantsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setVariantsLoaded(true);
      });
    return () => { cancelled = true; };
  }, [tenantSlug, service.id]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const schedulingHref = `${storefrontBaseUrl}/${tenantSlug}?serviceId=${service.id}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(schedulingHref);
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
    if (!name) { onSaved("Service name is required."); return; }
    const durationMinutes = Number(form.durationMinutes);
    const priceCents = parseMoneyInput(form.priceAmount);
    const depositCents = parseMoneyInput(form.depositAmount);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || priceCents === null || depositCents === null) {
      onSaved("Enter a valid duration, price, and deposit.");
      return;
    }
    if (form.locationIds.length === 0) {
      onSaved("Select at least one location.");
      return;
    }
    const body: UpdateServiceRequest = {
      name,
      durationMinutes,
      setupBufferMinutes: Number(form.setupBufferMinutes) || 0,
      cleanupBufferMinutes: Number(form.cleanupBufferMinutes) || 0,
      priceCents,
      depositCents,
      locationIds: form.locationIds,
      isActive: form.isActive,
    };
    const desc = form.description.trim();
    if (desc) body.description = desc;
    else if (service.description) body.clearDescription = true;
    if (form.categoryId) body.categoryId = form.categoryId;
    else if (service.categoryId) body.clearCategory = true;
    setSaving(true);
    try {
      await platformApi.updateService(tenantSlug, service.id, body);
      onSaved(`"${name}" saved.`);
    } catch (error) {
      onSaved(readErrorMessage(error, "Unable to save service."));
    } finally { setSaving(false); }
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
      if (!existing) {
        return [...current, { providerId, priceCents: null, durationMinutes: null, depositCents: null, ...patch }];
      }
      return current.map((v) => v.providerId === providerId ? { ...v, ...patch } : v);
    });
  };

  const removeVariantOverrides = (providerId: string) => {
    setVariants((current) =>
      current.map((v) =>
        v.providerId === providerId
          ? { providerId, priceCents: null, durationMinutes: null, depositCents: null }
          : v,
      ),
    );
  };

  const handleSaveVariants = async () => {
    if (!canManage) return;
    const payload: ProviderServiceVariantEntry[] = variants
      .filter((v) => v.priceCents != null || v.durationMinutes != null || v.depositCents != null)
      .map((v) => ({ providerId: v.providerId, priceCents: v.priceCents ?? null, durationMinutes: v.durationMinutes ?? null, depositCents: v.depositCents ?? null }));
    setVariantsSaving(true);
    try {
      const resp = await platformApi.replaceServiceProviderVariants(tenantSlug, service.id, { variants: payload });
      setVariants(resp.variants);
      setSavedVariants(resp.variants);
      onSaved("Per-provider pricing saved.");
    } catch (error) {
      onSaved(readErrorMessage(error, "Unable to save variants."));
    } finally { setVariantsSaving(false); }
  };

  const eligibleProviders = useMemo(
    () => providers.filter((p) => p.isActive && p.serviceIds.includes(service.id)),
    [providers, service.id],
  );

  const isVariantsDirty = useMemo(() => {
    const normalize = (entries: ProviderServiceVariantEntry[]) => {
      const map = new Map<string, string>();
      for (const entry of entries) {
        const p = entry.priceCents ?? null;
        const d = entry.durationMinutes ?? null;
        const dp = entry.depositCents ?? null;
        if (p == null && d == null && dp == null) continue;
        map.set(entry.providerId, `${p}|${d}|${dp}`);
      }
      return map;
    };
    const current = normalize(variants);
    const saved = normalize(savedVariants);
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

  return (
    <article className="service-card">
      <form className="service-card__form" onSubmit={handleSave}>
        <fieldset disabled={!canManage || saving}>
          <div className="service-card__header">
            <div className="service-card__title-row">
              <input
                className="service-card__name"
                value={form.name}
                onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                placeholder="Service name"
                required
              />
              <span className={`service-card__status${form.isActive ? " is-active" : ""}`}>
                {form.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            {service.description || form.description ? (
              <textarea
                className="service-card__desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
                placeholder="What customers see when they pick this service."
              />
            ) : null}
          </div>

          <div className="service-card__rows">
            <div className="service-card__row">
              <div className="service-card__row-label">
                <span>Duration</span>
                <span className="service-card__row-hint">{formatDurationMinutes(service.durationMinutes)} default</span>
              </div>
              <div className="service-card__row-control">
                <div className="service-card__input-group">
                  <input type="number" min={15} step={15} value={form.durationMinutes}
                    onChange={(e) => setForm((c) => ({ ...c, durationMinutes: e.target.value }))} required />
                  <span className="service-card__unit">min</span>
                </div>
              </div>
            </div>

            <div className="service-card__row">
              <div className="service-card__row-label">
                <span>Price</span>
                <span className="service-card__row-hint">{formatMoney(service.priceCents)} default</span>
              </div>
              <div className="service-card__row-control">
                <div className="service-card__input-group">
                  <span className="service-card__prefix">$</span>
                  <input type="number" min={0} step="0.01" value={form.priceAmount}
                    onChange={(e) => setForm((c) => ({ ...c, priceAmount: e.target.value }))} required />
                </div>
              </div>
            </div>

            <div className="service-card__row">
              <div className="service-card__row-label">
                <span>Deposit</span>
                <span className="service-card__row-hint">{formatMoney(service.depositCents)} default</span>
              </div>
              <div className="service-card__row-control">
                <div className="service-card__input-group">
                  <span className="service-card__prefix">$</span>
                  <input type="number" min={0} step="0.01" value={form.depositAmount}
                    onChange={(e) => setForm((c) => ({ ...c, depositAmount: e.target.value }))} required />
                </div>
              </div>
            </div>

            <div className="service-card__row">
              <div className="service-card__row-label"><span>Category</span></div>
              <div className="service-card__row-control">
                <select value={form.categoryId}
                  onChange={(e) => setForm((c) => ({ ...c, categoryId: e.target.value }))}>
                  <option value="">Uncategorized</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="service-card__row">
              <div className="service-card__row-label"><span>Locations</span></div>
              <div className="service-card__row-control">
                <div className="service-card__chips">
                  {locations.map((loc) => {
                    const checked = form.locationIds.includes(loc.id);
                    return (
                      <label key={loc.id} className={`service-card__chip${checked ? " is-active" : ""}`}>
                        <input type="checkbox" checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setForm((c) => ({ ...c, locationIds: next ? [...c.locationIds, loc.id] : c.locationIds.filter((id) => id !== loc.id) }));
                          }} />
                        <span>{loc.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="service-card__row">
              <div className="service-card__row-label"><span>Online booking</span></div>
              <div className="service-card__row-control">
                <label className="settings-toggle">
                  <input type="checkbox" checked={form.isActive}
                    onChange={(e) => setForm((c) => ({ ...c, isActive: e.target.checked }))} />
                  <span>Enable in online booking</span>
                </label>
              </div>
            </div>
          </div>
        </fieldset>

        <div className="service-card__actions">
          <div className="service-card__actions-left">
            {canManage ? (
              <button type="button" className="ghost-action" onClick={() => onDuplicate(service)}>
                Duplicate
              </button>
            ) : null}
          </div>
          <div className="service-card__actions-right">
            {canManage ? (
              <button type="submit" className="primary-action" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            ) : null}
          </div>
        </div>
      </form>

      <div className="service-card__link">
        <span className="eyebrow">Direct link</span>
        <div className="service-card__link-row">
          <input type="text" readOnly value={schedulingHref}
            onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="secondary-action" onClick={handleCopyLink}>Copy</button>
        </div>
        {copyHint ? <span className="settings-form-help">{copyHint}</span> : null}
      </div>

      {eligibleProviders.length > 0 ? (
        <div className="service-card__providers">
          <div className="service-card__providers-header">
            <span className="eyebrow">Per-provider pricing</span>
            {canManage && isVariantsDirty ? (
              <button type="button" className="primary-action" onClick={handleSaveVariants}
                disabled={variantsSaving}>
                {variantsSaving ? "Saving…" : "Save variants"}
              </button>
            ) : null}
          </div>
          {!variantsLoaded ? (
            <div className="calendar-state">Loading…</div>
          ) : (
            <div className="service-card__provider-list">
              {eligibleProviders.map((provider) => {
                const entry = variantByProvider.get(provider.id) ?? { providerId: provider.id, priceCents: null, durationMinutes: null, depositCents: null };
                const hasAnyOverride = entry.priceCents != null || entry.durationMinutes != null || entry.depositCents != null;
                const providerLink = `${storefrontBaseUrl}/${tenantSlug}?serviceId=${service.id}&staffId=${provider.id}`;
                return (
                  <div key={provider.id} className={`service-card__provider${hasAnyOverride ? " is-customized" : ""}`}>
                    <div className="service-card__provider-header">
                      <strong>{provider.name}</strong>
                      {hasAnyOverride ? (
                        <span className="service-card__provider-badge">Custom pricing</span>
                      ) : null}
                    </div>
                    <div className="service-card__provider-rows">
                      <div className="service-card__provider-row">
                        <span className="service-card__provider-label">Duration</span>
                        <div className="service-card__provider-control">
                          <div className="service-card__input-group">
                            <input type="number" min={15} max={480} step={15} disabled={!canManage}
                              placeholder={String(baseDurationMinutes)} value={entry.durationMinutes ?? ""}
                              onChange={(e) => { const raw = e.target.value; if (!raw) { updateVariant(provider.id, { durationMinutes: null }); return; } const n = Number(raw); updateVariant(provider.id, { durationMinutes: Number.isFinite(n) ? n : null }); }} />
                            <span className="service-card__unit">min</span>
                          </div>
                          {entry.durationMinutes != null && canManage ? (
                            <button type="button" className="text-action"
                              onClick={() => updateVariant(provider.id, { durationMinutes: null })}>
                              Reset to default
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="service-card__provider-row">
                        <span className="service-card__provider-label">Price</span>
                        <div className="service-card__provider-control">
                          <div className="service-card__input-group">
                            <span className="service-card__prefix">$</span>
                            <input type="number" min={0} step="0.01" disabled={!canManage}
                              placeholder={(basePriceCents / 100).toFixed(2)}
                              value={entry.priceCents == null ? "" : (entry.priceCents / 100).toFixed(2)}
                              onChange={(e) => { const raw = e.target.value; if (!raw) { updateVariant(provider.id, { priceCents: null }); return; } const cents = parseMoneyInput(raw); updateVariant(provider.id, { priceCents: cents }); }} />
                          </div>
                          {entry.priceCents != null && canManage ? (
                            <button type="button" className="text-action"
                              onClick={() => updateVariant(provider.id, { priceCents: null })}>
                              Reset to default
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="service-card__provider-row">
                        <span className="service-card__provider-label">Deposit</span>
                        <div className="service-card__provider-control">
                          <div className="service-card__input-group">
                            <span className="service-card__prefix">$</span>
                            <input type="number" min={0} step="0.01" disabled={!canManage}
                              placeholder={(baseDepositCents / 100).toFixed(2)}
                              value={entry.depositCents == null ? "" : (entry.depositCents / 100).toFixed(2)}
                              onChange={(e) => { const raw = e.target.value; if (!raw) { updateVariant(provider.id, { depositCents: null }); return; } const cents = parseMoneyInput(raw); updateVariant(provider.id, { depositCents: cents }); }} />
                          </div>
                          {entry.depositCents != null && canManage ? (
                            <button type="button" className="text-action"
                              onClick={() => updateVariant(provider.id, { depositCents: null })}>
                              Reset to default
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="service-card__provider-link">
                      <span className="eyebrow">Direct link</span>
                      <div className="service-card__link-row">
                        <input type="text" readOnly value={providerLink}
                          onFocus={(e) => e.currentTarget.select()} />
                        <button type="button" className="secondary-action"
                          onClick={async () => {
                            try { await navigator.clipboard.writeText(providerLink); setCopyHint("Link copied!"); }
                            catch { setCopyHint("Copy failed."); }
                            if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
                            copyTimerRef.current = window.setTimeout(() => setCopyHint(null), 2000);
                          }}>Copy</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

function renderServiceCards({
  orderedCategories,
  servicesByCategory,
  selection,
  canManage,
  tenantSlug,
  locations,
  providers,
  onSaved,
  onDuplicate,
}: {
  orderedCategories: ServiceCategorySummary[];
  servicesByCategory: Map<string, ServiceSummary[]>;
  selection: SelectionState;
  canManage: boolean;
  tenantSlug: string;
  locations: LocationSummary[];
  providers: ProviderSummary[];
  onSaved: (msg?: string) => void;
  onDuplicate: (service: ServiceSummary) => void;
}) {
  const groupsToShow: Array<{ key: string; label: string; list: ServiceSummary[] }> = [];
  if (selection.kind === "category") {
    const key = selection.categoryId;
    const label = key === UNCATEGORIZED_KEY ? "Uncategorized" : orderedCategories.find((c) => c.id === key)?.name ?? "Category";
    groupsToShow.push({ key, label, list: servicesByCategory.get(key) ?? [] });
  } else {
    for (const category of orderedCategories) {
      groupsToShow.push({ key: category.id, label: category.name, list: servicesByCategory.get(category.id) ?? [] });
    }
    groupsToShow.push({ key: UNCATEGORIZED_KEY, label: "Uncategorized", list: servicesByCategory.get(UNCATEGORIZED_KEY) ?? [] });
  }

  return (
    <div className="services-groups">
      {groupsToShow.map((group) => (
        <section key={group.key} className="services-group">
          <header className="services-group-header">
            <h5>{group.label}</h5>
            <span className="services-category-count">{group.list.length}</span>
          </header>
          {group.list.length === 0 ? (
            <p className="services-group-empty">No services yet.</p>
          ) : (
            <div className="service-card-grid">
              {group.list.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  categories={orderedCategories}
                  locations={locations}
                  providers={providers}
                  canManage={canManage}
                  tenantSlug={tenantSlug}
                  onSaved={onSaved}
                  onDuplicate={onDuplicate}
                />
              ))}
            </div>
          )}
        </section>
      ))}
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
