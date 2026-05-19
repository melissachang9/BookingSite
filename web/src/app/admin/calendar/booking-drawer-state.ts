export type ProviderOption = {
  id: string;
  name: string;
  locationIds: string[];
  serviceIds: string[];
  serviceOverrides: Record<
    string,
    {
      priceCentsOverride: number | null;
      depositCentsOverride: number | null;
      durationMinutesOverride: number | null;
    }
  >;
};

export type ServiceOption = {
  id: string;
  name: string;
  locationIds: string[];
  priceCents: number;
  depositCents: number;
  durationMinutes: number;
  requiresPreBookingForms: boolean;
};

export type LocationOption = {
  id: string;
  name: string;
};

export function deriveCalendarDrawerState({
  providers,
  services,
  locations,
  locationId,
  providerId,
  serviceId,
  startLocal,
}: {
  providers: ProviderOption[];
  services: ServiceOption[];
  locations: LocationOption[];
  locationId: string;
  providerId: string;
  serviceId: string;
  startLocal: string;
}) {
  const providerOptions = providers.filter(
    (provider) =>
      (!locationId || provider.locationIds.includes(locationId)) &&
      (!serviceId || provider.serviceIds.includes(serviceId))
  );
  const providerValue = providerOptions.some((provider) => provider.id === providerId)
    ? providerId
    : "";
  const selectedProvider = providers.find((provider) => provider.id === providerValue) ?? null;

  const serviceOptions = services.filter(
    (service) =>
      (!locationId || service.locationIds.includes(locationId)) &&
      (!providerValue || selectedProvider?.serviceIds.includes(service.id))
  );
  const serviceValue = serviceOptions.some((service) => service.id === serviceId)
    ? serviceId
    : "";
  const selectedService = services.find((service) => service.id === serviceValue) ?? null;

  const startsAtIso = toIsoOrEmpty(startLocal);
  const durationMinutes =
    selectedService && selectedProvider
      ? selectedProvider.serviceOverrides[selectedService.id]?.durationMinutesOverride ??
        selectedService.durationMinutes
      : selectedService?.durationMinutes ?? 0;
  const priceCents =
    selectedService && selectedProvider
      ? selectedProvider.serviceOverrides[selectedService.id]?.priceCentsOverride ??
        selectedService.priceCents
      : selectedService?.priceCents ?? 0;
  const depositCents =
    selectedService && selectedProvider
      ? selectedProvider.serviceOverrides[selectedService.id]?.depositCentsOverride ??
        selectedService.depositCents
      : selectedService?.depositCents ?? 0;
  const canSubmit = Boolean(startsAtIso && locationId && providerValue && serviceValue);
  const canOpenCheckout = Boolean(
    canSubmit && !selectedService?.requiresPreBookingForms && priceCents > 0
  );
  const setupComplete = providers.length > 0 && services.length > 0 && locations.length > 0;

  return {
    providerOptions,
    providerValue,
    selectedProvider,
    serviceOptions,
    serviceValue,
    selectedService,
    startsAtIso,
    durationMinutes,
    priceCents,
    depositCents,
    canSubmit,
    canOpenCheckout,
    setupComplete,
  };
}

function toIsoOrEmpty(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}