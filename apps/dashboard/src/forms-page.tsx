import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AuthenticatedUser,
  CreateFormRequest,
  CustomerPromptTiming,
  FormField,
  FormFieldType,
  FormListResponse,
  FormSchema,
  FormScope,
  FormSummaryResponse,
  ServiceCategorySummary,
  ServiceSummary,
  UpdateFormRequest,
} from "@booking/shared-types";

import { categoryColor } from "./category-colors";
import { platformApi } from "./platform-api";

type RouteDefinitionLike = {
  title: string;
  eyebrow: string;
  description: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

type EditorStep = "details" | "fields" | "preview" | "advanced";

type FormTabKey = "details" | "fields" | "preview" | "advanced";

type BuilderModal =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; form: FormSummaryResponse; initialStep?: EditorStep };

const SCOPE_LABELS: Record<string, string> = {
  customer: "Customer-facing",
  internal: "Internal",
};

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  select: "Single select",
  multi_select: "Multi select",
  checkbox: "Checkbox",
  yes_no: "Yes / No",
  date: "Date",
  number: "Number",
  file_upload: "File upload",
  signature: "Signature",
  section: "Section header",
  static_text: "Static text",
};

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((p) => p.key === key && p.allowed);
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function generateFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatCategoryTitle(raw: string): string {
  const compact = raw.trim().replace(/\s+/g, " ");
  if (!compact) {
    return "";
  }

  if (compact === compact.toLowerCase()) {
    if (/^[a-z]{1,5}$/.test(compact)) {
      return compact.toUpperCase();
    }
    return compact
      .split(/([\s\-/&]+)/)
      .map((part) => (/^[\s\-/&]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join("");
  }

  return compact;
}

function normalizeFormCategory(category: string | null | undefined): string {
  const normalized = formatCategoryTitle(category ?? "");
  return normalized.length > 0 ? normalized : "Uncategorized";
}

function groupFormsByCategory(forms: FormSummaryResponse[]): Array<{ category: string; items: FormSummaryResponse[] }> {
  const groups = new Map<string, FormSummaryResponse[]>();
  for (const form of forms) {
    const category = normalizeFormCategory(form.category);
    const next = groups.get(category) ?? [];
    next.push(form);
    groups.set(category, next);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => {
      if (left === "Uncategorized") {
        return 1;
      }
      if (right === "Uncategorized") {
        return -1;
      }
      return left.localeCompare(right);
    })
    .map(([category, items]) => ({
      category,
      items: items.sort((left, right) => left.name.localeCompare(right.name)),
    }));
}

const CATEGORY_FILTER_ALL = "__all__";

export function FormsPage({
  definition,
  currentUser,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser | null;
}) {
  const tenantSlug = currentUser?.tenantSlug ?? "";
  const canManage = currentUser !== null && hasPermission(currentUser, "settings.manage");
  const canView = currentUser !== null && hasPermission(currentUser, "settings.view");

  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [forms, setForms] = useState<FormSummaryResponse[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [builder, setBuilder] = useState<BuilderModal>({ kind: "none" });
  const [status, setStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FormTabKey>("details");
  const [categoryFilter, setCategoryFilter] = useState<string>(CATEGORY_FILTER_ALL);

  const loadForms = async () => {
    try {
      const response: FormListResponse = await platformApi.listForms(tenantSlug);
      setForms(response.items);
      setLoadState({ kind: "ready" });
    } catch (error) {
      setLoadState({ kind: "error", message: readErrorMessage(error, "Unable to load forms.") });
    }
  };

  useEffect(() => {
    if (!canView || !tenantSlug) return;
    void loadForms();
  }, [tenantSlug, canView]);

  const selectedForm = forms.find((f) => f.id === selectedFormId) ?? null;
  const groupedForms = groupFormsByCategory(forms);
  const categorySuggestions = groupedForms.map((group) => group.category).filter((name) => name !== "Uncategorized");
  const categoryFilterOptions = [CATEGORY_FILTER_ALL, ...groupedForms.map((group) => group.category)];
  const filteredForms =
    categoryFilter === CATEGORY_FILTER_ALL
      ? forms
      : forms.filter((form) => normalizeFormCategory(form.category) === categoryFilter);
  const groupedFilteredForms = groupFormsByCategory(filteredForms);

  useEffect(() => {
    if (selectedFormId === null) {
      return;
    }
    const stillVisible = filteredForms.some((form) => form.id === selectedFormId);
    if (!stillVisible) {
      setSelectedFormId(filteredForms[0]?.id ?? null);
    }
  }, [filteredForms, selectedFormId]);

  if (!currentUser) {
    return <main className="cs-page-stack"><p className="cs-empty">Sign in required</p></main>;
  }
  if (!canView) {
    return <main className="cs-page-stack"><p className="cs-empty">You do not have permission to view forms.</p></main>;
  }
  if (loadState.kind === "error") {
    return <main className="cs-page-stack"><div className="cs-banner cs-banner--error" role="alert">{loadState.message}</div></main>;
  }

  const visibleForm = selectedForm;

  return (
    <main className="cs-page-stack fm-page">
      {status ? (
        <div className="cs-banner" role="status">
          {status}
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={() => setStatus(null)}>Dismiss</button>
        </div>
      ) : null}

      {builder.kind !== "none" ? (
        <FormBuilderEditor
          key={builder.kind === "edit" ? `${builder.form.id}-${builder.initialStep ?? "details"}` : "new"}
          tenantSlug={tenantSlug}
          builder={builder}
          onClose={() => setBuilder({ kind: "none" })}
          categorySuggestions={categorySuggestions}
          onSaved={async (msg, savedFormId) => {
            if (savedFormId) setSelectedFormId(savedFormId);
            await loadForms();
            setStatus(msg);
          }}
          onStatus={setStatus}
        />
      ) : (
        <section className="fm-shell">
          <aside className="fm-rail" aria-label="Form list">
            <div className="fm-rail__head">
              <h2 className="fm-rail__title">Forms</h2>
              {canManage ? (
                <button type="button" className="fm-btn fm-btn--primary fm-btn--build" onClick={() => setBuilder({ kind: "add" })}>
                  Build form <span className="fm-btn__plus" aria-hidden="true">+</span>
                </button>
              ) : null}
            </div>
            <label className="fm-rail__filter">
              <span className="fm-eyebrow">Category filter</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                {categoryFilterOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === CATEGORY_FILTER_ALL ? "All categories" : option}
                  </option>
                ))}
              </select>
            </label>
            {forms.length === 0 ? (
              <p className="cs-empty">No forms yet. Click "Build form" to create one.</p>
            ) : groupedFilteredForms.length === 0 ? (
              <p className="cs-empty">No forms in this category.</p>
            ) : (
              <div className="fm-rail__groups">
                {groupedFilteredForms.map((group) => (
                  <section key={group.category} className="fm-group">
                    <h3 className="fm-eyebrow fm-group__label">
                      {group.category} ({group.items.length})
                    </h3>
                    <ul className="fm-group__list">
                      {group.items.map((form) => {
                        const fieldCount = form.schema?.fields.length ?? 0;
                        return (
                          <li key={form.id}>
                            <button
                              type="button"
                              className={`fm-item${selectedFormId === form.id ? " is-active" : ""}${!form.isActive ? " is-inactive" : ""}`}
                              onClick={() => setSelectedFormId(form.id)}
                            >
                              <span className="fm-item__avatar" aria-hidden="true">{form.name.charAt(0).toUpperCase()}</span>
                              <span className="fm-item__meta">
                                <span className="fm-item__name">{form.name}</span>
                                <span className="fm-item__sub">
                                  {fieldCount} field{fieldCount !== 1 ? "s" : ""}
                                  {form.scope === "internal" ? " · staff" : ""}
                                  {!form.isActive ? " · Inactive" : ""}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </aside>

          <div className="fm-detail">
            {visibleForm ? (
              <FormDetail
                form={visibleForm}
                categorySuggestions={categorySuggestions}
                tenantSlug={tenantSlug}
                canManage={canManage}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onToggleActive={() => handleToggleActive(visibleForm)}
                onFormPatched={handleFormPatched}
                onStatus={setStatus}
                onDelete={() => {
                  if (window.confirm(`Delete "${visibleForm.name}"? This cannot be undone.`)) {
                    handleDeleteForm(visibleForm);
                  }
                }}
              />
            ) : (
              <p className="fm-empty">Select a form to view details, or click "Build form" to create one.</p>
            )}
          </div>
        </section>
      )}
    </main>
  );

  async function handleToggleActive(form: FormSummaryResponse) {
    if (!canManage) return;
    try {
      await platformApi.updateForm(tenantSlug, form.id, { isActive: !form.isActive });
      setStatus(`"${form.name}" ${form.isActive ? "deactivated" : "activated"}.`);
      await loadForms();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to update form."));
    }
  }

  async function handleDeleteForm(form: FormSummaryResponse) {
    if (!canManage) return;
    try {
      await platformApi.deleteForm(tenantSlug, form.id);
      setStatus(`"${form.name}" deleted.`);
      if (selectedFormId === form.id) {
        setSelectedFormId(null);
      }
      await loadForms();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to delete form."));
    }
  }

  function handleFormPatched(updatedForm: FormSummaryResponse) {
    setForms((current) => current.map((form) => (form.id === updatedForm.id ? updatedForm : form)));
  }
}

// ===========================================================================
// Shared: tab strip, option cards, question cards
// ===========================================================================

function TabStrip({
  label,
  tabs,
  active,
  onChange,
}: {
  label: string;
  tabs: Array<{ key: string; label: string; disabled?: boolean; muted?: boolean }>;
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <nav className="fm-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          disabled={tab.disabled}
          className={`fm-tab${active === tab.key ? " is-active" : ""}${tab.muted ? " is-muted" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function OptionCard({
  name,
  checked,
  onSelect,
  disabled,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title: string;
  description: string;
}) {
  return (
    <label className={`fm-option${checked ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} disabled={disabled} />
      <span className="fm-option__dot" aria-hidden="true" />
      <span className="fm-option__text">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function QuestionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="fm-question">
      <h3 className="fm-question__title">{title}</h3>
      <div className="fm-question__body">{children}</div>
    </section>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label className={`cs-switch${checked ? "" : " cs-switch--off"}`} aria-label={label}>
      <input
        type="checkbox"
        className="cs-switch__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

// ===========================================================================
// Details questions (shared by the detail view and the builder)
// ===========================================================================

type DetailsValue = {
  scope: FormScope;
  timing: CustomerPromptTiming | "";
  reviewRequired: boolean;
  serviceIds: string[];
  category: string;
};

function DetailsQuestions({
  value,
  onChange,
  disabled,
  services,
  categories,
  servicesLoaded,
  idPrefix,
}: {
  value: DetailsValue;
  onChange: (patch: Partial<DetailsValue>) => void;
  disabled?: boolean;
  services: ServiceSummary[];
  categories: ServiceCategorySummary[];
  servicesLoaded: boolean;
  idPrefix: string;
}) {
  const [specific, setSpecific] = useState(value.serviceIds.length > 0);
  const [showAll, setShowAll] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (value.serviceIds.length > 0) setSpecific(true);
  }, [value.serviceIds.length]);

  const categoryIndex = useMemo(() => new Map(categories.map((cat, index) => [cat.id, index])), [categories]);
  const selectedServices = services.filter((svc) => value.serviceIds.includes(svc.id));
  const visibleSelected = showAll ? selectedServices : selectedServices.slice(0, 4);
  const hiddenCount = selectedServices.length - visibleSelected.length;
  const tintFor = (svc: ServiceSummary) =>
    categoryColor(svc.categoryId ? categoryIndex.get(svc.categoryId) ?? categories.length : categories.length);

  const removeService = (id: string) => onChange({ serviceIds: value.serviceIds.filter((sid) => sid !== id) });
  const unselected = services.filter((svc) => !value.serviceIds.includes(svc.id));

  return (
    <div className="fm-questions">
      <QuestionCard title="Who fills out this form?">
        <OptionCard
          name={`${idPrefix}-scope`}
          checked={value.scope === "customer"}
          onSelect={() => onChange({ scope: "customer" })}
          disabled={disabled}
          title="Clients who book an appointment"
          description="A link will be included in reminders and other automated messages"
        />
        <OptionCard
          name={`${idPrefix}-scope`}
          checked={value.scope === "internal"}
          onSelect={() => onChange({ scope: "internal" })}
          disabled={disabled}
          title="Staff members"
          description="For internal forms related to an appointment"
        />
      </QuestionCard>

      <QuestionCard title="How often do clients need to fill it out?">
        <OptionCard
          name={`${idPrefix}-timing`}
          checked={value.timing === "pre_booking"}
          onSelect={() => onChange({ timing: "pre_booking" })}
          disabled={disabled}
          title="Every time they book an appointment"
          description="Clients will be asked to submit the form every time they book"
        />
        <OptionCard
          name={`${idPrefix}-timing`}
          checked={value.timing === ""}
          onSelect={() => onChange({ timing: "" })}
          disabled={disabled}
          title="Only once for each client"
          description="Once the form has been submitted, clients will not be asked again"
        />
        <div className="fm-timing-extra" role="group" aria-label="Other timing">
          <span className="fm-eyebrow">Or ask</span>
          {([
            ["pre_visit", "Before the appointment"],
            ["post_visit", "After the appointment"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`fm-chip fm-chip--toggle${value.timing === key ? " is-on" : ""}`}
              aria-pressed={value.timing === key}
              disabled={disabled}
              onClick={() => onChange({ timing: value.timing === key ? "" : key })}
            >
              {label}
            </button>
          ))}
        </div>
      </QuestionCard>

      <QuestionCard title="Which appointments is it for?">
        <OptionCard
          name={`${idPrefix}-services`}
          checked={!specific}
          onSelect={() => { setSpecific(false); onChange({ serviceIds: [] }); }}
          disabled={disabled}
          title="For all appointments"
          description="Regardless of which services were booked"
        />
        <OptionCard
          name={`${idPrefix}-services`}
          checked={specific}
          onSelect={() => setSpecific(true)}
          disabled={disabled}
          title="Only for appointments with specific services"
          description="Select the services this form needs to be filled out for"
        />
        {specific ? (
          !servicesLoaded ? (
            <p className="fm-help">Loading services…</p>
          ) : (
            <div className="fm-services">
              {categories.length > 0 ? (
                <div className="fm-services__cats">
                  <span className="fm-eyebrow">All services in category</span>
                  <div className="fm-chiprow">
                    {categories.map((cat) => {
                      const catServices = services.filter((svc) => svc.categoryId === cat.id);
                      if (catServices.length === 0) return null;
                      const allSelected = catServices.every((svc) => value.serviceIds.includes(svc.id));
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          disabled={disabled}
                          className={`fm-chip fm-chip--toggle${allSelected ? " is-on" : ""}`}
                          aria-pressed={allSelected}
                          onClick={() => {
                            const ids = catServices.map((svc) => svc.id);
                            onChange({
                              serviceIds: allSelected
                                ? value.serviceIds.filter((sid) => !ids.includes(sid))
                                : [...new Set([...value.serviceIds, ...ids])],
                            });
                          }}
                        >
                          {allSelected ? "✓" : "+"} {cat.name} ({catServices.length})
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {selectedServices.length === 0 ? (
                <p className="fm-help">No services selected yet.</p>
              ) : (
                <ul className="fm-services__list">
                  {visibleSelected.map((svc) => (
                    <li key={svc.id} className="fm-service" style={{ background: tintFor(svc) }}>
                      <span>{svc.name}</span>
                      <button type="button" className="fm-icon-btn" aria-label={`Remove ${svc.name}`} disabled={disabled} onClick={() => removeService(svc.id)}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
              {hiddenCount > 0 ? (
                <button type="button" className="fm-link fm-link--muted" onClick={() => setShowAll(true)}>
                  + {hiddenCount} more selected
                </button>
              ) : null}
              {!disabled && unselected.length > 0 ? (
                <button type="button" className="fm-link" onClick={() => setPickerOpen((open) => !open)} aria-expanded={pickerOpen}>
                  + Add a service
                </button>
              ) : null}
              {pickerOpen && !disabled ? (
                <ul className="fm-picker">
                  {unselected.map((svc) => (
                    <li key={svc.id}>
                      <button
                        type="button"
                        className="fm-picker__row"
                        onClick={() => onChange({ serviceIds: [...value.serviceIds, svc.id] })}
                      >
                        + {svc.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )
        ) : null}
      </QuestionCard>

      <QuestionCard title="Does this form require review?">
        <OptionCard
          name={`${idPrefix}-review`}
          checked={!value.reviewRequired}
          onSelect={() => onChange({ reviewRequired: false })}
          disabled={disabled}
          title="No review needed"
          description="Most common, for forms that don't need additional review"
        />
        <OptionCard
          name={`${idPrefix}-review`}
          checked={value.reviewRequired}
          onSelect={() => onChange({ reviewRequired: true })}
          disabled={disabled}
          title="Review required"
          description="For forms that need to be reviewed by certain staff members"
        />
      </QuestionCard>
    </div>
  );
}

function CategoryField({
  value,
  onChange,
  suggestions,
  disabled,
  listId,
}: {
  value: string;
  onChange: (next: string) => void;
  suggestions: string[];
  disabled?: boolean;
  listId: string;
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const query = value.trim().toLowerCase();
  const matches = suggestions.filter((name) => name.toLowerCase().includes(query));
  const options = typing ? matches : suggestions;
  const isNew = query !== "" && !suggestions.some((name) => name.toLowerCase() === query);

  return (
    <div className="fm-field" ref={rootRef}>
      <label className="fm-field__label" htmlFor={`${listId}-input`}>Category</label>
      <div className="fm-combo">
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          onChange={(event) => { onChange(event.target.value); setTyping(true); setOpen(true); }}
          onFocus={() => { setTyping(false); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") setOpen(true);
          }}
          placeholder="Choose or type a category"
          disabled={disabled}
        />
        <button
          type="button"
          className="fm-combo__toggle"
          aria-label={open ? "Hide categories" : "Show categories"}
          tabIndex={-1}
          disabled={disabled}
          onClick={() => { setTyping(false); setOpen((current) => !current); }}
        >
          ▾
        </button>
        {open && !disabled ? (
          <ul className="fm-combo__menu" id={listId} role="listbox">
            {options.map((name) => (
              <li key={name} role="option" aria-selected={name === value}>
                <button
                  type="button"
                  className={`fm-combo__option${name === value ? " is-selected" : ""}`}
                  onClick={() => { onChange(name); setOpen(false); }}
                >
                  {name}
                </button>
              </li>
            ))}
            {isNew ? (
              <li role="option" aria-selected="false">
                <button type="button" className="fm-combo__option fm-combo__option--new" onClick={() => setOpen(false)}>
                  Use new category “{value.trim()}”
                </button>
              </li>
            ) : null}
            {options.length === 0 && !isNew ? <li className="fm-combo__empty">No categories yet — type to add one.</li> : null}
          </ul>
        ) : null}
      </div>
      <small className="fm-field__hint">Pick an existing category or type a new one, e.g. XERF, Injectables, Pre-care</small>
    </div>
  );
}

function useServiceCatalog(tenantSlug: string) {
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [categories, setCategories] = useState<ServiceCategorySummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      platformApi.listServices(tenantSlug),
      platformApi.listServiceCategories(tenantSlug).catch(() => ({ categories: [] as ServiceCategorySummary[] })),
    ])
      .then(([serviceResp, catResp]) => {
        if (cancelled) return;
        setServices(serviceResp.services.filter((svc) => svc.isActive));
        setCategories(catResp.categories);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  return { services, categories, loaded };
}

// ===========================================================================
// Form detail (selected form)
// ===========================================================================

function FormDetail({
  form,
  tenantSlug,
  categorySuggestions,
  canManage,
  activeTab,
  onTabChange,
  onToggleActive,
  onDelete,
  onFormPatched,
  onStatus,
}: {
  form: FormSummaryResponse;
  tenantSlug: string;
  categorySuggestions: string[];
  canManage: boolean;
  activeTab: FormTabKey;
  onTabChange: (tab: FormTabKey) => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onFormPatched: (form: FormSummaryResponse) => void;
  onStatus: (message: string | null) => void;
}) {
  const [details, setDetails] = useState<DetailsValue>(() => detailsFromForm(form));
  const [localFields, setLocalFields] = useState<FormField[]>(form.schema?.fields ?? []);
  const [tabSaving, setTabSaving] = useState(false);
  const { services, categories, loaded } = useServiceCatalog(tenantSlug);

  useEffect(() => {
    setDetails(detailsFromForm(form));
    setLocalFields(form.schema?.fields ?? []);
  }, [form]);

  const saveCurrentTab = async (tab: FormTabKey) => {
    if (!canManage || tabSaving) return;
    setTabSaving(true);
    onStatus(null);
    try {
      let body: UpdateFormRequest;
      if (tab === "details") {
        body = {
          category: details.category.trim() || null,
          scope: details.scope,
          customerPromptTiming: details.timing || null,
          reviewRequired: details.reviewRequired,
          serviceIds: details.serviceIds,
        };
      } else {
        const schema: FormSchema = {
          title: form.schema?.title ?? form.name,
          description: form.schema?.description ?? undefined,
          fields: localFields,
        };
        body = { schema };
      }
      const updated = await platformApi.updateForm(tenantSlug, form.id, body);
      onFormPatched(updated);
      onStatus(
        tab === "details"
          ? `Saved details for "${updated.name}".`
          : tab === "fields"
            ? `Saved field changes for "${updated.name}".`
            : `Saved "${updated.name}".`,
      );
    } catch (error) {
      onStatus(readErrorMessage(error, "Unable to save form changes."));
    } finally {
      setTabSaving(false);
    }
  };

  const tabs: Array<{ key: FormTabKey; label: string }> = [
    { key: "details", label: "Details" },
    { key: "fields", label: "Form Fields" },
    { key: "preview", label: "Preview" },
    { key: "advanced", label: "Advanced" },
  ];

  const saveLabel = activeTab === "details" ? "Save details" : activeTab === "fields" ? "Save fields" : "Save form";

  return (
    <div className="fm-detail__inner">
      <header className="fm-head">
        <div className="fm-head__titles">
          <p className="fm-eyebrow">Form</p>
          <h2 className="fm-head__title">{form.name}</h2>
          <div className="fm-chiprow">
            {form.category ? <span className="fm-chip fm-chip--category">{form.category}</span> : null}
            <span className="fm-chip">{SCOPE_LABELS[form.scope] ?? form.scope}</span>
            {form.currentVersionNumber ? <span className="fm-chip">Version {form.currentVersionNumber}</span> : null}
          </div>
        </div>
        {canManage ? (
          <div className="fm-head__actions">
            <label className="fm-toggle-label">
              <Switch checked={form.isActive} onChange={onToggleActive} label="Active toggle" />
              <span>{form.isActive ? "Enabled" : "Disabled"}</span>
            </label>
            <button type="button" className="fm-btn fm-btn--soft" onClick={onDelete}>Delete</button>
          </div>
        ) : null}
      </header>

      <TabStrip label="Form sections" tabs={tabs} active={activeTab} onChange={(key) => onTabChange(key as FormTabKey)} />

      <div className="fm-panel">
        {activeTab === "details" ? (
          <section className="fm-card fm-basics fm-basics--single">
            <CategoryField
              value={details.category}
              onChange={(category) => setDetails((current) => ({ ...current, category }))}
              suggestions={categorySuggestions}
              disabled={!canManage || tabSaving}
              listId={`fm-cats-${form.id}`}
            />
          </section>
        ) : null}

        {activeTab === "details" ? (
          <DetailsQuestions
            value={details}
            onChange={(patch) => setDetails((current) => ({ ...current, ...patch }))}
            disabled={!canManage || tabSaving}
            services={services}
            categories={categories}
            servicesLoaded={loaded}
            idPrefix={`detail-${form.id}`}
          />
        ) : null}

        {activeTab === "fields" ? (
          form.schema ? (
            <FieldsEditor fields={localFields} setFields={setLocalFields} canEdit={canManage} />
          ) : (
            <p className="fm-empty">No schema defined.</p>
          )
        ) : null}

        {activeTab === "preview" ? (
          <FormPreviewCard name={form.name} description={form.schema?.description ?? ""} fields={localFields} />
        ) : null}

        {activeTab === "advanced" ? <p className="fm-empty">Advanced settings coming soon.</p> : null}
      </div>

      {canManage && activeTab !== "advanced" ? (
        <div className="fm-actions">
          <button type="button" className="fm-btn fm-btn--primary" disabled={tabSaving} onClick={() => { void saveCurrentTab(activeTab); }}>
            {tabSaving ? "Saving..." : saveLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function detailsFromForm(form: FormSummaryResponse): DetailsValue {
  return {
    scope: form.scope,
    timing: form.customerPromptTiming ?? "",
    reviewRequired: form.reviewRequired ?? false,
    serviceIds: form.serviceIds ?? [],
    category: form.category ?? "",
  };
}

// ===========================================================================
// Form builder (full page: new form / edit form)
// ===========================================================================

function FormBuilderEditor({
  tenantSlug,
  builder,
  categorySuggestions,
  onClose,
  onSaved,
  onStatus,
}: {
  tenantSlug: string;
  builder: BuilderModal;
  categorySuggestions: string[];
  onClose: () => void;
  onSaved: (msg: string, savedFormId?: string) => Promise<void>;
  onStatus: (msg: string) => void;
}) {
  const isEdit = builder.kind === "edit";
  const existingForm = isEdit ? builder.form : null;
  const [formId, setFormId] = useState<string | null>(existingForm?.id ?? null);

  const [name, setName] = useState(existingForm?.name ?? "");
  const [description, setDescription] = useState(existingForm?.schema?.description ?? "");
  const [details, setDetails] = useState<DetailsValue>(() =>
    existingForm
      ? detailsFromForm(existingForm)
      : { scope: "customer", timing: "", reviewRequired: false, serviceIds: [], category: "" },
  );
  const [fields, setFields] = useState<FormField[]>(existingForm?.schema?.fields ?? []);
  const { services, categories, loaded } = useServiceCatalog(tenantSlug);

  const [step, setStep] = useState<EditorStep>(isEdit ? (builder.initialStep ?? "details") : "details");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveForm = async (msg: string) => {
    setError(null);
    setSaving(true);
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Form name is required."); setSaving(false); return; }

    const schema: FormSchema = {
      title: trimmedName,
      description: description.trim() || undefined,
      fields,
    };

    try {
      if (formId) {
        const body: UpdateFormRequest = {
          name: trimmedName,
          category: details.category.trim() || null,
          scope: details.scope,
          customerPromptTiming: details.timing || null,
          reviewRequired: details.reviewRequired,
          schema,
          serviceIds: details.serviceIds,
        };
        await platformApi.updateForm(tenantSlug, formId, body);
        await onSaved(msg, formId);
        onClose();
        return;
      } else {
        const body: CreateFormRequest = {
          name: trimmedName,
          category: details.category.trim() || null,
          scope: details.scope,
          customerPromptTiming: details.timing || undefined,
          reviewRequired: details.reviewRequired,
          schema,
          serviceIds: details.serviceIds,
        };
        const created = await platformApi.createForm(tenantSlug, body);
        setFormId(created.id);
        await onSaved(msg, created.id);
        setStep("fields");
        return;
      }
    } catch (err) {
      onStatus(readErrorMessage(err, "Unable to save form."));
    } finally {
      setSaving(false);
    }
  };

  const saveLabel = step === "details" ? "Save details" : step === "fields" ? "Save fields" : "Save form";

  const saveMessage =
    formId
      ? step === "details"
        ? `"${name.trim()}" details updated.`
        : step === "fields"
          ? `"${name.trim()}" fields updated.`
          : `"${name.trim()}" updated.`
      : `"${name.trim()}" created.`;

  const steps = [
    { key: "details", label: "1 · Details" },
    { key: "fields", label: formId ? "2 · Form Fields" : "2 · Form Fields — create form first", disabled: !formId },
    { key: "preview", label: "3 · Preview" },
    { key: "advanced", label: "Advanced — coming soon", disabled: true, muted: true },
  ];

  return (
    <div className="fm-builder">
      <header className="fm-head">
        <div className="fm-head__titles">
          <p className="fm-eyebrow">{isEdit ? "Edit form" : "New form"}</p>
          <h2 className="fm-head__title">{name.trim() || "Untitled form"}</h2>
        </div>
        <div className="fm-head__actions">
          <button type="button" className="fm-btn fm-btn--soft" onClick={onClose}>{formId ? "Close" : "Cancel"}</button>
        </div>
      </header>

      <TabStrip label="Form editor sections" tabs={steps} active={step} onChange={(key) => setStep(key as EditorStep)} />

      <div className="fm-panel">
        {step === "details" ? (
          <>
            <section className="fm-card fm-basics">
              <label className="fm-field">
                <span className="fm-field__label">Form name <em>— required</em></span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Health History, Consent Form" autoFocus />
              </label>
              <CategoryField
                value={details.category}
                onChange={(category) => setDetails((d) => ({ ...d, category }))}
                suggestions={categorySuggestions}
                listId="fm-cats-builder"
              />
              <label className="fm-field fm-basics__description">
                <span className="fm-field__label">Description <em>— shown to the client at the top of the form</em></span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Instructions shown at the top of the form" />
              </label>
            </section>
            <DetailsQuestions
              value={details}
              onChange={(patch) => setDetails((current) => ({ ...current, ...patch }))}
              services={services}
              categories={categories}
              servicesLoaded={loaded}
              idPrefix="builder"
            />
          </>
        ) : null}

        {step === "fields" ? <FieldsEditor fields={fields} setFields={setFields} canEdit /> : null}

        {step === "preview" ? <FormPreviewCard name={name} description={description} fields={fields} /> : null}

        {error ? <div className="cs-banner cs-banner--error" role="alert">{error}</div> : null}
      </div>

      <div className="fm-actions">
        {step === "preview" ? (
          <button type="button" className="fm-btn fm-btn--soft" onClick={() => setStep("fields")} disabled={!formId}>
            Back to fields
          </button>
        ) : (
          <button type="button" className="fm-btn fm-btn--soft" onClick={() => setStep("preview")}>
            Preview
          </button>
        )}
        <button
          type="button"
          className="fm-btn fm-btn--primary"
          disabled={saving || !name.trim()}
          onClick={() => saveForm(saveMessage)}
        >
          {saving ? "Saving..." : formId ? saveLabel : "Create form"}
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// Fields editor (list + inline editing + "Add a field" panel)
// ===========================================================================

const QUESTION_TYPES: FormFieldType[] = [
  "short_text", "long_text", "select", "multi_select", "checkbox", "yes_no", "date", "number", "file_upload", "signature",
];
const LAYOUT_TYPES: FormFieldType[] = ["section", "static_text"];

function FieldsEditor({
  fields,
  setFields,
  canEdit,
}: {
  fields: FormField[];
  setFields: (next: FormField[]) => void;
  canEdit: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const addField = (type: FormFieldType) => {
    const newField: FormField = { id: generateFieldId(), type, label: "", required: false };
    if (type === "select" || type === "multi_select") newField.options = [];
    setFields([...fields, newField]);
    setEditingId(newField.id);
    setPaletteOpen(false);
  };

  const updateField = (id: string, patch: Partial<FormField>) =>
    setFields(fields.map((field) => (field.id === id ? { ...field, ...patch } : field)));

  const removeField = (id: string) => {
    setFields(fields.filter((field) => field.id !== id));
    setEditingId(null);
  };

  const duplicateField = (id: string) => {
    const index = fields.findIndex((field) => field.id === id);
    if (index < 0) return;
    const copy: FormField = {
      ...fields[index]!,
      id: generateFieldId(),
      options: fields[index]!.options?.map((option) => ({ ...option })),
    };
    setFields([...fields.slice(0, index + 1), copy, ...fields.slice(index + 1)]);
    setEditingId(copy.id);
  };

  const moveField = (id: string, direction: -1 | 1) => {
    const index = fields.findIndex((field) => field.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setFields(next);
  };

  return (
    <div className={`fm-fields${paletteOpen ? " has-palette" : ""}`}>
      <div className="fm-fields__main">
        {fields.length === 0 ? (
          <p className="fm-empty">No fields yet. Add your first field below.</p>
        ) : (
          <ul className="fm-fieldlist">
            {fields.map((field, index) =>
              editingId === field.id && canEdit ? (
                <li key={field.id} className="fm-fieldcard is-editing">
                  <FieldEditor
                    field={field}
                    index={index}
                    total={fields.length}
                    onUpdate={(patch) => updateField(field.id, patch)}
                    onDone={() => setEditingId(null)}
                    onDuplicate={() => duplicateField(field.id)}
                    onRemove={() => removeField(field.id)}
                    onMove={(direction) => moveField(field.id, direction)}
                  />
                </li>
              ) : (
                <li key={field.id}>
                  <button
                    type="button"
                    className="fm-fieldrow"
                    disabled={!canEdit}
                    onClick={() => setEditingId(field.id)}
                  >
                    <span className="fm-typechip">{FIELD_TYPE_LABELS[field.type]}</span>
                    <span className="fm-fieldrow__label">{field.label || <em>Untitled</em>}</span>
                    {field.required ? <span className="fm-fieldrow__req">Required</span> : null}
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
        {canEdit ? (
          <button type="button" className="fm-addfield" onClick={() => setPaletteOpen(true)}>
            + Add a field
          </button>
        ) : null}
      </div>

      {paletteOpen ? (
        <aside className="fm-palette" aria-label="Add a field">
          <header className="fm-palette__head">
            <h3>Add a field</h3>
            <button type="button" className="fm-icon-btn" aria-label="Close" onClick={() => setPaletteOpen(false)}>✕</button>
          </header>
          <p className="fm-eyebrow">Questions</p>
          <div className="fm-palette__grid">
            {QUESTION_TYPES.map((type) => (
              <button key={type} type="button" className="fm-palette__item" onClick={() => addField(type)}>
                {FIELD_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
          <p className="fm-eyebrow">Layout</p>
          <div className="fm-palette__grid">
            {LAYOUT_TYPES.map((type) => (
              <button key={type} type="button" className="fm-palette__item" onClick={() => addField(type)}>
                {FIELD_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function FieldEditor({
  field,
  index,
  total,
  onUpdate,
  onDone,
  onDuplicate,
  onRemove,
  onMove,
}: {
  field: FormField;
  index: number;
  total: number;
  onUpdate: (patch: Partial<FormField>) => void;
  onDone: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const isLayout = field.type === "section" || field.type === "static_text";
  const hasOptions = field.type === "select" || field.type === "multi_select";
  const hasPlaceholder = field.type === "short_text" || field.type === "long_text" || field.type === "select" || field.type === "number";

  return (
    <div className="fm-editor">
      <div className="fm-editor__head">
        <span className="fm-typechip fm-typechip--solid">{FIELD_TYPE_LABELS[field.type]}</span>
        <span className="fm-editor__pos">Editing field {index + 1} of {total}</span>
        <button type="button" className="fm-btn fm-btn--soft fm-btn--sm" onClick={onDone}>Done</button>
      </div>

      <label className="fm-field">
        <span className="fm-field__label">{isLayout ? "Heading" : "Question label"}</span>
        <input
          value={field.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder={isLayout ? "Section heading" : "Field label"}
        />
      </label>

      {isLayout ? (
        <label className="fm-field">
          <span className="fm-field__label">Content</span>
          <textarea
            value={field.content ?? ""}
            onChange={(e) => onUpdate({ content: e.target.value })}
            rows={2}
            placeholder={field.type === "section" ? "Optional description below the heading" : "Static text content"}
          />
        </label>
      ) : (
        <label className="fm-field">
          <span className="fm-field__label">Help text</span>
          <input
            value={field.helpText ?? ""}
            onChange={(e) => onUpdate({ helpText: e.target.value || undefined })}
            placeholder="Optional hint"
          />
        </label>
      )}

      {hasPlaceholder ? (
        <label className="fm-field">
          <span className="fm-field__label">Placeholder</span>
          <input
            value={field.placeholder ?? ""}
            onChange={(e) => onUpdate({ placeholder: e.target.value || undefined })}
            placeholder="Placeholder text"
          />
        </label>
      ) : null}

      {hasOptions ? (
        <div className="fm-field">
          <span className="fm-field__label">Options</span>
          <ul className="fm-options">
            {(field.options ?? []).map((opt, optIdx) => (
              <li key={optIdx} className="fm-options__row">
                <input
                  value={opt.label}
                  onChange={(e) => {
                    const next = [...(field.options ?? [])];
                    next[optIdx] = { ...next[optIdx]!, label: e.target.value, value: e.target.value.toLowerCase().replace(/\s+/g, "_") };
                    onUpdate({ options: next });
                  }}
                  placeholder="Option label"
                  aria-label={`Option ${optIdx + 1}`}
                />
                <button
                  type="button"
                  className="fm-icon-btn"
                  aria-label={`Remove option ${optIdx + 1}`}
                  onClick={() => onUpdate({ options: (field.options ?? []).filter((_, i) => i !== optIdx) })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="fm-link"
            onClick={() => onUpdate({ options: [...(field.options ?? []), { label: "", value: "" }] })}
          >
            + Add option
          </button>
        </div>
      ) : null}

      <footer className="fm-editor__foot">
        {!isLayout ? (
          <label className="fm-toggle-label">
            <Switch checked={field.required ?? false} onChange={(next) => onUpdate({ required: next })} label="Required" />
            <span>Required</span>
          </label>
        ) : <span />}
        <div className="fm-editor__links">
          <button type="button" className="fm-link" disabled={index === 0} onClick={() => onMove(-1)}>Move up</button>
          <button type="button" className="fm-link" disabled={index === total - 1} onClick={() => onMove(1)}>Move down</button>
          <button type="button" className="fm-link" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="fm-link" onClick={onRemove}>Remove field</button>
        </div>
      </footer>
    </div>
  );
}

// ===========================================================================
// Preview
// ===========================================================================

function FormPreviewCard({
  name,
  description,
  fields,
}: {
  name: string;
  description: string;
  fields: FormField[];
}) {
  return (
    <article className="fm-preview">
      <h3 className="fm-preview__title">{name || "Untitled form"}</h3>
      {description ? <p className="fm-preview__desc">{description}</p> : null}
      {fields.length === 0 ? (
        <p className="fm-help">No fields defined yet.</p>
      ) : (
        <div className="fm-preview__fields">
          {fields.map((field) => (
            <div key={field.id} className="fm-preview__field">
              <FieldPreview field={field} />
            </div>
          ))}
        </div>
      )}
      <button type="button" className="fm-preview__submit" disabled>Submit — disabled in preview</button>
    </article>
  );
}

function FieldPreview({ field }: { field: FormField }) {
  const label = (
    <span className="fm-preview__label">
      {field.label || FIELD_TYPE_LABELS[field.type]}
      {field.required ? <span className="fm-preview__req"> Required</span> : null}
    </span>
  );
  const help = field.helpText ? <span className="fm-preview__help">{field.helpText}</span> : null;

  switch (field.type) {
    case "section":
      return (
        <div className="fm-preview__section">
          <h4>{field.label || "Section"}</h4>
          {field.content ? <p>{field.content}</p> : null}
        </div>
      );
    case "static_text":
      return (
        <div className="fm-preview__static">
          {field.label ? <h4>{field.label}</h4> : null}
          <p>{field.content || "Static text content"}</p>
        </div>
      );
    case "long_text":
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <textarea disabled rows={3} placeholder={field.placeholder || ""} />
        </label>
      );
    case "select":
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <select disabled>
            <option value="">{field.placeholder || "Select…"}</option>
            {(field.options ?? []).map((opt, i) => (
              <option key={i} value={opt.value}>{opt.label || `Option ${i + 1}`}</option>
            ))}
          </select>
        </label>
      );
    case "multi_select":
      return (
        <fieldset className="fm-preview__group">
          <legend>{label}</legend>
          {help}
          {(field.options ?? []).length === 0 ? (
            <p className="fm-help">No options defined.</p>
          ) : (
            (field.options ?? []).map((opt, i) => (
              <label key={i} className="fm-preview__check">
                <input type="checkbox" disabled />
                <span>{opt.label || `Option ${i + 1}`}</span>
              </label>
            ))
          )}
        </fieldset>
      );
    case "checkbox":
      return (
        <label className="fm-preview__check">
          <input type="checkbox" disabled />
          <span>{field.label || "Checkbox"}{field.required ? " (Required)" : ""}</span>
        </label>
      );
    case "yes_no":
      return (
        <fieldset className="fm-preview__group">
          <legend>{label}</legend>
          {help}
          <div className="fm-preview__pills">
            <span className="fm-preview__pill">Yes</span>
            <span className="fm-preview__pill">No</span>
          </div>
        </fieldset>
      );
    case "date":
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <input type="date" disabled />
        </label>
      );
    case "number":
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <input type="number" disabled placeholder={field.placeholder || "0"} />
        </label>
      );
    case "file_upload":
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <input type="file" disabled />
        </label>
      );
    case "signature":
      return (
        <div className="fm-preview__group">
          {label}
          {help}
          <div className="fm-preview__sign">Sign here</div>
        </div>
      );
    default:
      return (
        <label className="fm-preview__group">
          {label}
          {help}
          <input type="text" disabled placeholder={field.placeholder || ""} />
        </label>
      );
  }
}
