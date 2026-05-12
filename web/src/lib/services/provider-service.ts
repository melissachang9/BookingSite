export type ProviderServiceOverrides = {
  price_cents_override?: number | null;
  deposit_cents_override?: number | null;
  duration_minutes_override?: number | null;
};

type ServicePricingShape = {
  price_cents: number;
  deposit_cents: number;
  duration_minutes: number;
};

export function applyProviderServiceOverrides<T extends ServicePricingShape>(
  service: T,
  overrides: ProviderServiceOverrides | null | undefined
) {
  const priceCents = normalizePositiveInteger(
    overrides?.price_cents_override,
    service.price_cents
  );
  const durationMinutes = normalizePositiveInteger(
    overrides?.duration_minutes_override,
    service.duration_minutes
  );
  const requestedDepositCents = normalizePositiveInteger(
    overrides?.deposit_cents_override,
    service.deposit_cents
  );

  return {
    ...service,
    price_cents: priceCents,
    deposit_cents: Math.min(priceCents, requestedDepositCents),
    duration_minutes: durationMinutes,
  } satisfies T;
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
}