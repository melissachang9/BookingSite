import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  AuthenticatedUser,
  CreateServiceCategoryRequest,
  CreateServiceRequest,
  LocationSummary,
  ProviderServiceVariantEntry,
  ProviderSummary,
  ReorderRequest,
  ReplaceProviderServiceVariantsRequest,
  ServiceCategorySummary,
  ServiceSummary,
  TenantSummary,
  UpdateServiceCategoryRequest,
  UpdateServiceRequest,
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
  const [showCreate, setShowCreate] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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
  const selectedService =
    selection.kind === "service"
      ? services.find((s) => s.id === selection.serviceId) ?? null
      : null;
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

  const handleCreateCategory = async () => {
    if (!canManage) return;
    const raw = window.prompt("New category name");
    if (!raw) return;
    const name = raw.trim();
    if (!name) return;
    try {
      const body: CreateServiceCategoryRequest = { name };
      await platformApi.createServiceCategory(tenantSlug, body);
      await refreshCategories();
      setStatus(`Category "${name}" created.`);
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to create category."));
    }
  };

  const handleRenameCategory = async (category: ServiceCategorySummary) => {
    if (!canManage) return;
    const raw = window.prompt("Rename category", category.name);
    if (raw === null) return;
    const name = raw.trim();
    if (!name || name === category.name) return;
    try {
      const body: UpdateServiceCategoryRequest = { name };
      await platformApi.updateServiceCategory(tenantSlug, category.id, body);
      await refreshCategories();
      setStatus(`Renamed to "${name}".`);
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to rename category."));
    }
  };

  const handleDeleteCategory = async (category: ServiceCategorySummary) => {
    if (!canManage) return;
    if (
      !window.confirm(
        `Delete category "${category.name}"? Services in this category will become uncategorized.`,
      )
    ) {
      return;
    }
    try {
      await platformApi.deleteServiceCategory(tenantSlug, category.id);
      await Promise.all([refreshCategories(), refreshServices()]);
      if (selection.kind === "category" && selection.categoryId === category.id) {
        setSelection({ kind: "none" });
      }
      setStatus(`Category "${category.name}" deleted.`);
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to delete category."));
    }
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

  const handleReorderServicesAcrossCategories = async (
    targetCategoryKey: string,
    movedServiceId: string,
    targetServiceId: string | null,
  ) => {
    if (!canManage) return;
    const movedService = services.find((s) => s.id === movedServiceId);
    if (!movedService) return;

    // If moving across categories, first patch service.categoryId.
    const newCategoryId =
      targetCategoryKey === UNCATEGORIZED_KEY ? null : targetCategoryKey;
    const currentCategoryId = movedService.categoryId ?? null;
    let updatedServices = services;
    if (newCategoryId !== currentCategoryId) {
      try {
        const body: UpdateServiceRequest =
          newCategoryId === null
            ? { clearCategory: true }
            : { categoryId: newCategoryId };
        await platformApi.updateService(tenantSlug, movedServiceId, body);
        const resp = await platformApi.listServices(tenantSlug);
        updatedServices = resp.services;
        setServices(resp.services);
      } catch (error) {
        setStatus(readErrorMessage(error, "Unable to move service."));
        return;
      }
    }

    // Build new ordered list of service IDs within the target category.
    const inCategory = updatedServices
      .filter((s) => (s.categoryId ?? UNCATEGORIZED_KEY) === targetCategoryKey)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => s.id);

    const filtered = inCategory.filter((id) => id !== movedServiceId);
    let insertIndex = filtered.length;
    if (targetServiceId) {
      const idx = filtered.indexOf(targetServiceId);
      if (idx >= 0) insertIndex = idx;
    }
    filtered.splice(insertIndex, 0, movedServiceId);

    // The reorder endpoint expects the full ordered list of service ids globally.
    // We only ship the IDs within the affected category plus other services
    // preserved in their existing relative order.
    const others = updatedServices
      .filter((s) => (s.categoryId ?? UNCATEGORIZED_KEY) !== targetCategoryKey)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => s.id);

    const orderedIds = [...filtered, ...others];
    try {
      const resp = await platformApi.reorderServices(tenantSlug, {
        orderedIds,
      });
      setServices(resp.services);
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to reorder services."));
    }
  };

  return (
    <main className="ops-page-stack">
      <section className="ops-hero ops-hero--compact">
        <div className="ops-hero-copy">
          <p className="eyebrow">{definition.eyebrow}</p>
          <h3>{definition.title}</h3>
          <p>{definition.description}</p>
        </div>
        <div className="ops-hero-panel">
          <p className="eyebrow">Catalog state</p>
          <strong>{services.length} services</strong>
          <span>
            {categories.length} categor{categories.length === 1 ? "y" : "ies"}
          </span>
        </div>
      </section>

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
              return (
                <li
                  key={category.id}
                  draggable={canManage}
                  onDragStart={() =>
                    setDrag({ kind: "category", categoryId: category.id })
                  }
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
                    <span>{category.name}</span>
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

          {renderGroupedServices({
            orderedCategories,
            servicesByCategory,
            selection,
            canManage,
            onSelectService: (id) =>
              setSelection({ kind: "service", serviceId: id }),
            onDuplicate: handleDuplicateService,
            onDragStartService: (serviceId, fromCategoryKey) =>
              setDrag({
                kind: "service",
                serviceId,
                fromCategoryKey,
              }),
            onDropOnService: (targetCategoryKey, targetServiceId) => {
              if (drag.kind !== "service") return;
              const movedId = drag.serviceId;
              setDrag({ kind: "none" });
              void handleReorderServicesAcrossCategories(
                targetCategoryKey,
                movedId,
                targetServiceId,
              );
            },
            onDropOnCategory: (targetCategoryKey) => {
              if (drag.kind !== "service") return;
              const movedId = drag.serviceId;
              setDrag({ kind: "none" });
              void handleReorderServicesAcrossCategories(
                targetCategoryKey,
                movedId,
                null,
              );
            },
          })}
        </section>

        <aside className="services-detail" aria-label="Service detail">
          {selectedService ? (
            <ServiceDetailPanel
              key={selectedService.id}
              tenantSlug={tenantSlug}
              tenant={tenant}
              service={selectedService}
              categories={orderedCategories}
              locations={locations}
              providers={providers}
              canManage={canManage}
              onChanged={async (msg) => {
                await refreshServices();
                if (msg) setStatus(msg);
              }}
              onDeselect={() => setSelection({ kind: "none" })}
              onStatus={setStatus}
            />
          ) : (
            <div className="services-detail-empty">
              <p>Select a service to edit pricing, description, locations, and per-provider variants.</p>
            </div>
          )}
        </aside>
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
    </main>
  );
}

// ===========================================================================
// Grouped list
// ===========================================================================

function renderGroupedServices({
  orderedCategories,
  servicesByCategory,
  selection,
  canManage,
  onSelectService,
  onDuplicate,
  onDragStartService,
  onDropOnService,
  onDropOnCategory,
}: {
  orderedCategories: ServiceCategorySummary[];
  servicesByCategory: Map<string, ServiceSummary[]>;
  selection: SelectionState;
  canManage: boolean;
  onSelectService: (serviceId: string) => void;
  onDuplicate: (service: ServiceSummary) => void;
  onDragStartService: (serviceId: string, fromCategoryKey: string) => void;
  onDropOnService: (targetCategoryKey: string, targetServiceId: string) => void;
  onDropOnCategory: (targetCategoryKey: string) => void;
}) {
  const groupsToShow: Array<{ key: string; label: string; list: ServiceSummary[] }> = [];
  if (selection.kind === "category") {
    const key = selection.categoryId;
    const label =
      key === UNCATEGORIZED_KEY
        ? "Uncategorized"
        : orderedCategories.find((c) => c.id === key)?.name ?? "Category";
    groupsToShow.push({ key, label, list: servicesByCategory.get(key) ?? [] });
  } else {
    for (const category of orderedCategories) {
      groupsToShow.push({
        key: category.id,
        label: category.name,
        list: servicesByCategory.get(category.id) ?? [],
      });
    }
    groupsToShow.push({
      key: UNCATEGORIZED_KEY,
      label: "Uncategorized",
      list: servicesByCategory.get(UNCATEGORIZED_KEY) ?? [],
    });
  }

  return (
    <div className="services-groups">
      {groupsToShow.map((group) => (
        <section
          key={group.key}
          className="services-group"
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            onDropOnCategory(group.key);
          }}
        >
          <header className="services-group-header">
            <h5>{group.label}</h5>
            <span className="services-category-count">{group.list.length}</span>
          </header>
          {group.list.length === 0 ? (
            <p className="services-group-empty">No services yet.</p>
          ) : (
            <ul className="services-row-list">
              {group.list.map((service) => {
                const isSelected =
                  selection.kind === "service" &&
                  selection.serviceId === service.id;
                return (
                  <li
                    key={service.id}
                    draggable={canManage}
                    onDragStart={() =>
                      onDragStartService(service.id, group.key)
                    }
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDropOnService(group.key, service.id);
                    }}
                  >
                    <button
                      type="button"
                      className={
                        isSelected
                          ? "services-row-btn is-selected"
                          : "services-row-btn"
                      }
                      onClick={() => onSelectService(service.id)}
                    >
                      <span className="services-row-name">
                        <span className="services-row-handle" aria-hidden="true">
                          ⋮⋮
                        </span>
                        {service.name}
                      </span>
                      <span className="services-row-meta">
                        {service.durationMinutes} min · {formatMoney(service.priceCents)}
                      </span>
                    </button>
                    {canManage ? (
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() => onDuplicate(service)}
                      >
                        Duplicate
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

// ===========================================================================
// Detail panel
// ===========================================================================

type ServiceFormState = {
  name: string;
  description: string;
  durationMinutes: string;
  priceAmount: string;
  depositAmount: string;
  categoryId: string;
  locationIds: string[];
  isActive: boolean;
};

function toFormState(service: ServiceSummary): ServiceFormState {
  return {
    name: service.name,
    description: service.description ?? "",
    durationMinutes: String(service.durationMinutes),
    priceAmount: (service.priceCents / 100).toFixed(2),
    depositAmount: (service.depositCents / 100).toFixed(2),
    categoryId: service.categoryId ?? "",
    locationIds: [...service.locationIds],
    isActive: service.isActive,
  };
}

function ServiceDetailPanel({
  tenantSlug,
  tenant,
  service,
  categories,
  locations,
  providers,
  canManage,
  onChanged,
  onDeselect,
  onStatus,
}: {
  tenantSlug: string;
  tenant: TenantSummary | null;
  service: ServiceSummary;
  categories: ServiceCategorySummary[];
  locations: LocationSummary[];
  providers: ProviderSummary[];
  canManage: boolean;
  onChanged: (status?: string | null) => Promise<void>;
  onDeselect: () => void;
  onStatus: (msg: string) => void;
}) {
  const [form, setForm] = useState<ServiceFormState>(() => toFormState(service));
  const [saving, setSaving] = useState(false);
  const [variants, setVariants] = useState<ProviderServiceVariantEntry[]>([]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);
  const [variantsSaving, setVariantsSaving] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setForm(toFormState(service));
  }, [service]);

  useEffect(() => {
    let cancelled = false;
    setVariantsLoaded(false);
    void platformApi
      .getServiceProviderVariants(tenantSlug, service.id)
      .then((resp) => {
        if (cancelled) return;
        setVariants(resp.variants);
        setVariantsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setVariantsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, service.id]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
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
    if (!name) {
      onStatus("Service name is required.");
      return;
    }
    const durationMinutes = Number(form.durationMinutes);
    const priceCents = parseMoneyInput(form.priceAmount);
    const depositCents = parseMoneyInput(form.depositAmount);
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 15 ||
      priceCents === null ||
      depositCents === null
    ) {
      onStatus("Enter a valid duration, price, and deposit.");
      return;
    }
    if (form.locationIds.length === 0) {
      onStatus("Select at least one location.");
      return;
    }

    const body: UpdateServiceRequest = {
      name,
      durationMinutes,
      priceCents,
      depositCents,
      locationIds: form.locationIds,
      isActive: form.isActive,
    };
    const desc = form.description.trim();
    if (desc) {
      body.description = desc;
    } else if (service.description) {
      body.clearDescription = true;
    }
    if (form.categoryId) {
      body.categoryId = form.categoryId;
    } else if (service.categoryId) {
      body.clearCategory = true;
    }

    setSaving(true);
    try {
      await platformApi.updateService(tenantSlug, service.id, body);
      await onChanged(`Service "${name}" saved.`);
    } catch (error) {
      onStatus(readErrorMessage(error, "Unable to save service."));
    } finally {
      setSaving(false);
    }
  };

  // Variants: union of providers offering the service + providers in tenant.
  const variantByProvider = useMemo(() => {
    const map = new Map<string, ProviderServiceVariantEntry>();
    for (const entry of variants) map.set(entry.providerId, entry);
    return map;
  }, [variants]);

  const updateVariant = (
    providerId: string,
    patch: Partial<ProviderServiceVariantEntry>,
  ) => {
    setVariants((current) => {
      const existing = current.find((v) => v.providerId === providerId);
      if (!existing) {
        const created: ProviderServiceVariantEntry = {
          providerId,
          priceCents: null,
          durationMinutes: null,
          depositCents: null,
          ...patch,
        };
        return [...current, created];
      }
      return current.map((v) =>
        v.providerId === providerId ? { ...v, ...patch } : v,
      );
    });
  };

  const removeVariantOverrides = (providerId: string) => {
    setVariants((current) =>
      current.map((v) =>
        v.providerId === providerId
          ? {
              providerId,
              priceCents: null,
              durationMinutes: null,
              depositCents: null,
            }
          : v,
      ),
    );
  };

  const handleSaveVariants = async () => {
    if (!canManage) return;
    const payload: ProviderServiceVariantEntry[] = variants
      .filter(
        (v) =>
          v.priceCents != null ||
          v.durationMinutes != null ||
          v.depositCents != null,
      )
      .map((v) => ({
        providerId: v.providerId,
        priceCents: v.priceCents ?? null,
        durationMinutes: v.durationMinutes ?? null,
        depositCents: v.depositCents ?? null,
      }));
    const body: ReplaceProviderServiceVariantsRequest = { variants: payload };
    setVariantsSaving(true);
    try {
      const resp = await platformApi.replaceServiceProviderVariants(
        tenantSlug,
        service.id,
        body,
      );
      setVariants(resp.variants);
      onStatus("Per-provider variants saved.");
    } catch (error) {
      onStatus(readErrorMessage(error, "Unable to save variants."));
    } finally {
      setVariantsSaving(false);
    }
  };

  const eligibleProviders = providers.filter((p) => p.isActive);

  return (
    <div className="service-detail-panel">
      <div className="service-detail-header">
        <div>
          <p className="eyebrow">{service.isActive ? "Active" : "Inactive"}</p>
          <h4>{service.name}</h4>
        </div>
        <button type="button" className="ghost-action" onClick={onDeselect}>
          Close
        </button>
      </div>

      <div className="service-scheduling-link">
        <span className="eyebrow">Direct scheduling link</span>
        <div className="service-scheduling-row">
          <input
            type="text"
            readOnly
            value={schedulingHref}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="button" className="secondary-action" onClick={handleCopyLink}>
            Copy
          </button>
        </div>
        {copyHint ? <span className="settings-form-help">{copyHint}</span> : null}
      </div>

      <form className="service-detail-form" onSubmit={handleSave}>
        <fieldset disabled={!canManage || saving}>
          <div className="form-grid">
            <label>
              <span>Name</span>
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </label>
            <label>
              <span>Category</span>
              <select
                value={form.categoryId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    categoryId: event.target.value,
                  }))
                }
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
                value={form.durationMinutes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    durationMinutes: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label>
              <span>Price</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.priceAmount}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    priceAmount: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label>
              <span>Deposit due today</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.depositAmount}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    depositAmount: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label className="form-grid__full">
              <span>Description</span>
              <textarea
                rows={4}
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="What customers see when they pick this service."
              />
            </label>
            <fieldset className="form-grid__full service-locations-fieldset">
              <legend>Locations</legend>
              {locations.length === 0 ? (
                <p className="settings-form-help">No active locations.</p>
              ) : (
                <ul className="service-location-checks">
                  {locations.map((location) => {
                    const checked = form.locationIds.includes(location.id);
                    return (
                      <li key={location.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const next = event.target.checked;
                              setForm((current) => ({
                                ...current,
                                locationIds: next
                                  ? [...current.locationIds, location.id]
                                  : current.locationIds.filter(
                                      (id) => id !== location.id,
                                    ),
                              }));
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
            <label className="service-active-toggle">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
              />
              <span>Active and bookable</span>
            </label>
          </div>
        </fieldset>
        <div className="inline-meta">
          <span>Deposit cannot exceed the service price.</span>
          {canManage ? (
            <button type="submit" className="primary-action" disabled={saving}>
              {saving ? "Saving…" : "Save service"}
            </button>
          ) : null}
        </div>
      </form>

      <section className="service-variants">
        <header className="service-variants-header">
          <h5>Per-provider variants</h5>
          <span className="settings-form-help">
            Override price, duration, or deposit per provider. Leave blank to use the base values.
          </span>
        </header>
        {!variantsLoaded ? (
          <div className="calendar-state">Loading variants…</div>
        ) : eligibleProviders.length === 0 ? (
          <p className="settings-form-help">No active providers.</p>
        ) : (
          <table className="service-variants-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Price ($)</th>
                <th>Duration (min)</th>
                <th>Deposit ($)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {eligibleProviders.map((provider) => {
                const entry = variantByProvider.get(provider.id) ?? {
                  providerId: provider.id,
                  priceCents: null,
                  durationMinutes: null,
                  depositCents: null,
                };
                return (
                  <tr key={provider.id}>
                    <td>{provider.name}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canManage}
                        value={
                          entry.priceCents == null
                            ? ""
                            : (entry.priceCents / 100).toFixed(2)
                        }
                        onChange={(event) => {
                          const raw = event.target.value;
                          if (!raw) {
                            updateVariant(provider.id, { priceCents: null });
                            return;
                          }
                          const cents = parseMoneyInput(raw);
                          updateVariant(provider.id, {
                            priceCents: cents,
                          });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={15}
                        max={480}
                        step={15}
                        disabled={!canManage}
                        value={entry.durationMinutes ?? ""}
                        onChange={(event) => {
                          const raw = event.target.value;
                          if (!raw) {
                            updateVariant(provider.id, {
                              durationMinutes: null,
                            });
                            return;
                          }
                          const n = Number(raw);
                          updateVariant(provider.id, {
                            durationMinutes: Number.isFinite(n) ? n : null,
                          });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canManage}
                        value={
                          entry.depositCents == null
                            ? ""
                            : (entry.depositCents / 100).toFixed(2)
                        }
                        onChange={(event) => {
                          const raw = event.target.value;
                          if (!raw) {
                            updateVariant(provider.id, {
                              depositCents: null,
                            });
                            return;
                          }
                          const cents = parseMoneyInput(raw);
                          updateVariant(provider.id, {
                            depositCents: cents,
                          });
                        }}
                      />
                    </td>
                    <td>
                      {canManage ? (
                        <button
                          type="button"
                          className="ghost-action"
                          onClick={() => removeVariantOverrides(provider.id)}
                        >
                          Reset
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {canManage ? (
          <div className="inline-meta">
            <button
              type="button"
              className="primary-action"
              onClick={handleSaveVariants}
              disabled={variantsSaving}
            >
              {variantsSaving ? "Saving…" : "Save variants"}
            </button>
          </div>
        ) : null}
      </section>
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
