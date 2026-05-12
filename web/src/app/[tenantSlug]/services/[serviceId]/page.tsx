/**
 * Public service page.
 *
 * Businesses can optionally show a provider-selection step before the calendar.
 * Provider-specific price and duration overrides are read from provider_services.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyProviderServiceOverrides } from "@/lib/services/provider-service";
import { SlotPicker } from "./slot-picker";

type Params = { tenantSlug: string; serviceId: string };
type SearchParams = Record<string, string | string[] | undefined>;

type ProviderSelectionOption = {
  id: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  sort_order: number;
  price_cents: number;
  deposit_cents: number;
  duration_minutes: number;
  schedule_days: number[];
};

type ServiceFlowConfig = {
  providerSelectionStepEnabled: boolean;
};

const ANY_PROVIDER_PARAM = "__no_preference__";
const MONDAY_FIRST_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_LABELS: Record<number, string> = {
  0: "SUN",
  1: "MON",
  2: "TUE",
  3: "WED",
  4: "THU",
  5: "FRI",
  6: "SAT",
};

async function loadServiceContext(slug: string, serviceId: string) {
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug, timezone, branding_json")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) return null;

  const { data: service } = await admin
    .from("services")
    .select("id, name, description, duration_minutes, price_cents, deposit_cents, is_active, tenant_id")
    .eq("id", serviceId)
    .maybeSingle();
  if (!service || service.tenant_id !== tenant.id || !service.is_active) return null;

  const { data: providerLinks } = await admin
    .from("provider_services")
    .select(
      "provider_id, price_cents_override, deposit_cents_override, duration_minutes_override, providers!inner(id, name, bio, avatar_url, is_active, sort_order)"
    )
    .eq("service_id", serviceId)
    .eq("tenant_id", tenant.id);

  const activeLinks = (providerLinks ?? []).filter((row) => {
    const provider = row.providers as
      | {
          id: string;
          name: string;
          bio: string | null;
          avatar_url: string | null;
          is_active: boolean;
          sort_order: number;
        }
      | null;
    return Boolean(provider?.is_active);
  });

  const providerIds = activeLinks.map((row) => row.provider_id);
  let scheduleRows: { provider_id: string; weekday: number }[] = [];
  if (providerIds.length > 0) {
    const { data } = await admin
      .from("provider_schedules")
      .select("provider_id, weekday")
      .in("provider_id", providerIds);
    scheduleRows = data ?? [];
  }

  const weekdaysByProvider = new Map<string, Set<number>>();
  for (const row of scheduleRows) {
    const weekdays = weekdaysByProvider.get(row.provider_id) ?? new Set<number>();
    weekdays.add(row.weekday);
    weekdaysByProvider.set(row.provider_id, weekdays);
  }

  const providers = activeLinks
    .map((row) => {
      const provider = row.providers as {
        id: string;
        name: string;
        bio: string | null;
        avatar_url: string | null;
        is_active: boolean;
        sort_order: number;
      };

      const effectiveService = applyProviderServiceOverrides(service, {
        price_cents_override:
          typeof row.price_cents_override === "number" ? row.price_cents_override : null,
        deposit_cents_override:
          typeof row.deposit_cents_override === "number" ? row.deposit_cents_override : null,
        duration_minutes_override:
          typeof row.duration_minutes_override === "number" ? row.duration_minutes_override : null,
      });

      return {
        id: provider.id,
        name: provider.name,
        bio: provider.bio,
        avatar_url: provider.avatar_url,
        sort_order: provider.sort_order,
        price_cents: effectiveService.price_cents,
        deposit_cents: effectiveService.deposit_cents,
        duration_minutes: effectiveService.duration_minutes,
        schedule_days: Array.from(weekdaysByProvider.get(provider.id) ?? []).sort((a, b) => a - b),
      } satisfies ProviderSelectionOption;
    })
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));

  return {
    tenant,
    service,
    providers,
    flowConfig: normalizeServiceFlowConfig(
      (tenant.branding_json ?? null) as Partial<Record<string, unknown>> | null
    ),
  };
}

export default async function ServiceBookingPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams?: Promise<SearchParams>;
}) {
  const { tenantSlug, serviceId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const data = await loadServiceContext(tenantSlug, serviceId);
  if (!data) notFound();

  const { tenant, service, providers, flowConfig } = data;
  const providerQuery = firstQueryValue(resolvedSearchParams.provider);
  const hasSpecificProvider = providers.some((provider) => provider.id === providerQuery);
  const hasValidProviderSelection = providerQuery === ANY_PROVIDER_PARAM || hasSpecificProvider;
  const showProviderSelectionStep =
    flowConfig.providerSelectionStepEnabled && providers.length > 1 && !hasValidProviderSelection;

  const selectedProvider = hasSpecificProvider
    ? providers.find((provider) => provider.id === providerQuery) ?? null
    : null;
  const showingNoPreference = providerQuery === ANY_PROVIDER_PARAM || (!selectedProvider && providers.length <= 1);

  if (providers.length === 0) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-10 lg:px-8 lg:py-12">
        <div className="rounded-[1.75rem] border border-neutral-200 bg-neutral-50 p-8 text-center text-neutral-600">
          No providers are available for this service.
        </div>
      </div>
    );
  }

  if (showProviderSelectionStep) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10 lg:px-8 lg:py-12">
        <header className="mb-8 overflow-hidden rounded-[2rem] border border-stone-200 bg-[linear-gradient(180deg,#fffdf9_0%,#f6efe6_100%)] shadow-[0_22px_65px_rgba(41,24,12,0.08)]">
          <div className="px-6 py-7 sm:px-8 sm:py-8">
            <Link
              href={`/${tenant.slug}`}
              className="text-sm text-stone-500 transition hover:text-stone-950"
            >
              ← Back to {tenant.name}
            </Link>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
              Step 2 of 3
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-5xl">
              Choose who you&apos;d like to book for {service.name}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-stone-600">
              Providers can have different pricing and timing for this service. Choose a specific provider or continue with no preference.
            </p>
          </div>
        </header>

        <div className="overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-[0_22px_65px_rgba(41,24,12,0.08)]">
          <ul className="divide-y divide-stone-200">
            <li>
              <ProviderRow
                href={`/${tenant.slug}/services/${service.id}?provider=${ANY_PROVIDER_PARAM}`}
                name="Anyone"
                priceLabel={formatMoneyRange(providers.map((provider) => provider.price_cents))}
                scheduleLabel={summarizeWeekdays(collectUniqueWeekdays(providers.flatMap((provider) => provider.schedule_days)))}
                subtitle="See availability across the full team"
                monogram="Any"
              />
            </li>
            {providers.map((provider) => (
              <li key={provider.id}>
                <ProviderRow
                  href={`/${tenant.slug}/services/${service.id}?provider=${provider.id}`}
                  name={provider.name}
                  priceLabel={formatMoney(provider.price_cents)}
                  scheduleLabel={summarizeWeekdays(provider.schedule_days)}
                  subtitle={provider.bio?.trim() || null}
                  avatarUrl={provider.avatar_url}
                  monogram={getInitials(provider.name)}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const summaryDuration = selectedProvider
    ? `${selectedProvider.duration_minutes} min`
    : formatDurationRange(providers.map((provider) => provider.duration_minutes));
  const summaryPrice = selectedProvider
    ? formatMoney(selectedProvider.price_cents)
    : formatMoneyRange(providers.map((provider) => provider.price_cents));
  const summaryDeposit = selectedProvider
    ? formatDepositSummary(selectedProvider.deposit_cents)
    : formatDepositRange(providers.map((provider) => provider.deposit_cents));
  const topLinkHref =
    flowConfig.providerSelectionStepEnabled && providers.length > 1
      ? `/${tenant.slug}/services/${service.id}`
      : `/${tenant.slug}`;
  const topLinkLabel =
    flowConfig.providerSelectionStepEnabled && providers.length > 1
      ? "Change provider"
      : tenant.name;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10 lg:px-8 lg:py-12">
      <header className="mb-8 overflow-hidden rounded-[2rem] border border-stone-200 bg-[linear-gradient(180deg,#fffdf9_0%,#f6efe6_100%)] shadow-[0_22px_65px_rgba(41,24,12,0.08)]">
        <div className="grid gap-6 px-6 py-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] lg:px-8 lg:py-8">
          <div>
            <Link href={topLinkHref} className="text-sm text-stone-500 transition hover:text-stone-950">
              ← {topLinkLabel}
            </Link>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
              Step 3 of 3
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-5xl">
              {selectedProvider ? `Choose a date with ${selectedProvider.name}` : `Choose a date for ${service.name}`}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-stone-600">
              {showingNoPreference
                ? "Review the calendar and pick a time across the full team."
                : `Review ${selectedProvider?.name ?? "the provider"}'s availability and hold a time before entering your details or payment.`}
            </p>
            {service.description ? (
              <p className="mt-4 max-w-2xl text-sm leading-6 text-stone-600">{service.description}</p>
            ) : null}
          </div>

          <div className="rounded-[1.75rem] border border-stone-200 bg-white/85 px-5 py-5 shadow-[0_16px_45px_rgba(41,24,12,0.08)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
              Booking summary
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-sm text-stone-700">
              <SummaryChip>{summaryDuration}</SummaryChip>
              <SummaryChip>{summaryPrice}</SummaryChip>
              <SummaryChip>{summaryDeposit}</SummaryChip>
            </div>
            <p className="mt-4 text-sm leading-6 text-stone-600">
              {showingNoPreference
                ? "Choose a provider-specific or team-wide time, then continue into details and payment once the slot is held."
                : `${selectedProvider?.name ?? "This provider"} can have service-specific pricing and timing. The held slot will use the values shown for this provider.`}
            </p>
          </div>
        </div>
      </header>

      <SlotPicker
        tenantId={tenant.id}
        tenantSlug={tenant.slug}
        timeZone={tenant.timezone}
        serviceId={service.id}
        providers={providers.map((provider) => ({ id: provider.id, name: provider.name }))}
        initialProviderId={selectedProvider?.id}
        showProviderSelector={!flowConfig.providerSelectionStepEnabled}
      />
    </div>
  );
}

function ProviderRow({
  href,
  name,
  priceLabel,
  scheduleLabel,
  subtitle,
  avatarUrl,
  monogram,
}: {
  href: string;
  name: string;
  priceLabel: string;
  scheduleLabel: string;
  subtitle: string | null;
  avatarUrl?: string | null;
  monogram: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-4 px-6 py-5 transition hover:bg-stone-50 sm:px-8 sm:py-6"
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-stone-300 bg-stone-50 text-sm font-semibold uppercase tracking-[0.08em] text-stone-700 shadow-sm">
          {avatarUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
            </>
          ) : (
            monogram
          )}
        </div>

        <div className="min-w-0">
          <p className="text-2xl font-semibold tracking-[-0.03em] text-stone-950">{name}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            {scheduleLabel}
          </p>
          {subtitle ? (
            <p className="mt-2 max-w-xl truncate text-sm text-stone-500">{subtitle}</p>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-2xl font-semibold tracking-[-0.03em] text-stone-950">{priceLabel}</p>
        <p className="mt-2 text-sm text-stone-500 transition group-hover:text-stone-700">View dates</p>
      </div>
    </Link>
  );
}

function SummaryChip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-full border border-stone-200 bg-stone-50 px-3 py-2 shadow-sm">
      {children}
    </div>
  );
}

function normalizeServiceFlowConfig(
  brandingJson: Partial<Record<string, unknown>> | null | undefined
): ServiceFlowConfig {
  const raw = toRecord(brandingJson);
  const flow = toRecord(raw.booking_flow ?? raw.bookingFlow ?? raw.service_flow ?? raw.serviceFlow);

  const explicit = booleanValue(
    flow.provider_selection_step_enabled ??
      flow.providerSelectionStepEnabled ??
      raw.provider_selection_step_enabled ??
      raw.providerSelectionStepEnabled
  );

  if (explicit !== null) {
    return { providerSelectionStepEnabled: explicit };
  }

  const mode = stringValue(
    flow.provider_selection_mode ??
      flow.providerSelectionMode ??
      raw.provider_selection_mode ??
      raw.providerSelectionMode
  );

  if (mode === "calendar" || mode === "skip") {
    return { providerSelectionStepEnabled: false };
  }

  return { providerSelectionStepEnabled: true };
}

function firstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? undefined;
  return value;
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

function formatMoneyRange(values: number[]) {
  if (values.length === 0) return "$0";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? formatMoney(min) : `${formatMoney(min)} - ${formatMoney(max)}`;
}

function formatDurationRange(values: number[]) {
  if (values.length === 0) return "Varies";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `${min} min` : `${min}-${max} min`;
}

function formatDepositSummary(depositCents: number) {
  return depositCents > 0 ? `${formatMoney(depositCents)} deposit` : "Pay in checkout";
}

function formatDepositRange(values: number[]) {
  if (values.length === 0) return "Pay in checkout";
  const positiveValues = values.filter((value) => value > 0);
  if (positiveValues.length === 0) return "Pay in checkout";
  const min = Math.min(...positiveValues);
  const max = Math.max(...positiveValues);
  return min === max ? `${formatMoney(min)} deposit` : `${formatMoney(min)} - ${formatMoney(max)} deposit`;
}

function collectUniqueWeekdays(values: number[]) {
  return Array.from(new Set(values)).sort((left, right) => sortWeekday(left) - sortWeekday(right));
}

function summarizeWeekdays(days: number[]) {
  const orderedDays = collectUniqueWeekdays(days);
  if (orderedDays.length === 0) return "Schedule varies";
  if (orderedDays.length === 7) return "MON-SUN";

  const ranges: string[] = [];
  let index = 0;

  while (index < orderedDays.length) {
    const start = orderedDays[index];
    let end = start;

    while (
      index + 1 < orderedDays.length &&
      sortWeekday(orderedDays[index + 1]) === sortWeekday(end) + 1
    ) {
      end = orderedDays[index + 1];
      index += 1;
    }

    if (start === end) {
      ranges.push(WEEKDAY_LABELS[start]);
    } else {
      ranges.push(`${WEEKDAY_LABELS[start]}-${WEEKDAY_LABELS[end]}`);
    }

    index += 1;
  }

  return ranges.join(", ");
}

function sortWeekday(weekday: number) {
  const position = MONDAY_FIRST_WEEKDAYS.indexOf(weekday as (typeof MONDAY_FIRST_WEEKDAYS)[number]);
  return position >= 0 ? position : weekday;
}

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "SP"
  );
}

function toRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  return null;
}
