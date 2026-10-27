import Link from "next/link";
import { notFound } from "next/navigation";
import type { SlotAvailability } from "@booking/shared-types";

import { BookingSteps } from "../../../../components/booking-steps";
import { startBookingDraftAction } from "../actions";
import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../../lib/storefront-api";
import {
  findServiceByRouteKey,
  formatCurrency,
  formatDuration,
  isoDateForTimeZone,
  isoDateFromValueInTimeZone,
  pathWithQuery,
  slugify,
} from "../../../../lib/storefront-shell";

type AvailabilityPageProps = {
  params: Promise<{ tenantSlug: string; serviceId: string }>;
  searchParams: Promise<{
    providerId?: string;
    locationId?: string;
    screening?: string;
    date?: string;
    month?: string;
    error?: string;
    // Chosen add-ons: `addOns=a,b` in links, `addOn=a&addOn=b` from the picker form.
    addOns?: string;
    addOn?: string | string[];
  }>;
};

type MonthCell = {
  date: string;
  dayNumber: number;
  slotCount: number;
  isSelected: boolean;
  isPast: boolean;
};

type SlotGroup = {
  key: "morning" | "afternoon" | "evening";
  label: string;
  slots: SlotAvailability[];
};

export const dynamic = "force-dynamic";

const monthKeyFromDate = (dateText: string) => dateText.slice(0, 7);

const monthStartFromKey = (monthKey: string) => `${monthKey}-01`;

const daysInMonth = (monthKey: string) => {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
};

const shiftMonth = (monthKey: string, offset: number) => {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
};

const addDays = (dateText: string, offset: number) => {
  const [year, month, day] = dateText.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
};

const monthTitle = (monthKey: string) => {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
};

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dateTitle = (dateText: string) => {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
};

const timeTitle = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const hourInTimeZone = (value: string, timeZone: string) => {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  })
    .formatToParts(new Date(value))
    .find((part) => part.type === "hour")?.value;

  return Number(hourPart ?? 0);
};

const groupSlotsByDaypart = (slots: SlotAvailability[], timeZone: string): SlotGroup[] => {
  const groups: SlotGroup[] = [
    { key: "morning", label: "Morning", slots: [] },
    { key: "afternoon", label: "Afternoon", slots: [] },
    { key: "evening", label: "Evening", slots: [] },
  ];

  for (const slot of slots) {
    const hour = hourInTimeZone(slot.startAt, timeZone);
    if (hour < 12) {
      groups[0].slots.push(slot);
    } else if (hour < 16) {
      groups[1].slots.push(slot);
    } else {
      groups[2].slots.push(slot);
    }
  }

  return groups.filter((group) => group.slots.length > 0);
};

export default async function AvailabilityPage({ params, searchParams }: AvailabilityPageProps) {
  const { tenantSlug, serviceId } = await params;
  const { providerId, locationId, screening, date, month, error, addOns, addOn } = await searchParams;

  try {
    const [tenant, serviceResponse, locationResponse] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.listServices(tenantSlug),
      storefrontApi.listLocations(tenantSlug),
    ]);
    const service = findServiceByRouteKey(serviceResponse.services, serviceId);

    if (!service) {
      notFound();
    }

    const activeLocations = locationResponse.locations.filter((location) => location.isActive);
    const selectedLocation = locationId ? activeLocations.find((location) => location.id === locationId) : undefined;
    if (locationId && (!selectedLocation || !service.locationIds.includes(locationId))) {
      notFound();
    }

    const [providerResponse, addOnResponse] = await Promise.all([
      storefrontApi.listServiceProviders(tenantSlug, service.id, { locationId: selectedLocation?.id }),
      storefrontApi.listServiceAddOns(tenantSlug, service.id),
    ]);
    const availableAddOns = addOnResponse.items;
    const requestedAddOnIds = [
      ...(addOns ? addOns.split(",") : []),
      ...(Array.isArray(addOn) ? addOn : addOn ? [addOn] : []),
    ];
    // Only add-ons this service offers; anything else in the URL is ignored.
    const selectedAddOns = availableAddOns.filter((item) => requestedAddOnIds.includes(item.id));
    const selectedAddOnIds = selectedAddOns.map((item) => item.id);
    const selectedProvider = providerId
      ? providerResponse.providers.find((provider) => provider.id === providerId)
      : undefined;
    if (providerId && !selectedProvider) {
      notFound();
    }

    const today = isoDateForTimeZone(tenant.timezone);
    const activeMonth = month ?? monthKeyFromDate(date ?? today);
    const monthStart = monthStartFromKey(activeMonth);
    const monthDays = daysInMonth(activeMonth);
    const monthlyAvailability = await storefrontApi.getAvailability({
      tenantSlug,
      serviceId: service.id,
      providerId,
      locationId: selectedLocation?.id,
      date: monthStart,
      windowDays: monthDays,
      addOnIds: selectedAddOnIds,
    });
    const firstAvailableDate = monthlyAvailability.days.find((day) => (day.openingCount ?? day.slotCount) > 0)?.date;
    const selectedDate = date ?? firstAvailableDate ?? monthStart;
    const selectedAvailability = await storefrontApi.getAvailability({
      tenantSlug,
      serviceId: service.id,
      providerId,
      locationId: selectedLocation?.id,
      date: selectedDate,
      windowDays: 1,
      addOnIds: selectedAddOnIds,
    });
    const nextAvailabilitySearch = await storefrontApi.getAvailability({
      tenantSlug,
      serviceId: service.id,
      providerId,
      locationId: selectedLocation?.id,
      date: addDays(selectedDate, selectedAvailability.slots.length > 0 ? 1 : 0),
      windowDays: 62,
      addOnIds: selectedAddOnIds,
    });
    const appointmentStepNumber = (screening ? 1 : 0) + (selectedLocation ? 1 : 0) + 3 + (availableAddOns.length > 0 ? 1 : 0);
    const availabilityPath = `/${tenantSlug}/services/${slugify(service.name)}/availability`;
    const baseQuery = {
      locationId: selectedLocation?.id,
      screening,
      providerId,
      addOns: selectedAddOnIds.length > 0 ? selectedAddOnIds.join(",") : undefined,
    };
    const returnTo = pathWithQuery(availabilityPath, { ...baseQuery, month: activeMonth, date: selectedDate });
    const dayMap = new Map(monthlyAvailability.days.map((day) => [day.date, day.openingCount ?? day.slotCount]));
    const monthCells: MonthCell[] = Array.from({ length: monthDays }, (_, index) => {
      const cellDate = addDays(monthStart, index);
      return {
        date: cellDate,
        dayNumber: index + 1,
        slotCount: dayMap.get(cellDate) ?? 0,
        isSelected: cellDate === selectedDate,
        isPast: cellDate < today,
      };
    });
    const leadingBlankCount = new Date(`${monthStart}T12:00:00Z`).getUTCDay();
    const nextAvailable = nextAvailabilitySearch.nextAvailableSlot;
    const nextAvailableDate = nextAvailable ? isoDateFromValueInTimeZone(nextAvailable.startAt, tenant.timezone) : undefined;
    const locationById = new Map(activeLocations.map((location) => [location.id, location.name]));
    // With no location chosen, a service offered at only one place still has a definite location to show.
    const serviceLocations = activeLocations.filter(
      (location) =>
        (service.locationIds.length === 0 || service.locationIds.includes(location.id)) &&
        (!selectedProvider || selectedProvider.locationIds.length === 0 || selectedProvider.locationIds.includes(location.id)),
    );
    const onlyLocation = serviceLocations.length === 1 ? serviceLocations[0] : undefined;
    // One card per start time and location: with "any provider" the first free provider is offered.
    const seenTimes = new Set<string>();
    const pickableSlots = selectedAvailability.slots.filter((slot) => {
      const key = `${slot.startAt}|${slot.locationId ?? ""}`;
      if (seenTimes.has(key)) {
        return false;
      }
      seenTimes.add(key);
      return true;
    });
    const slotGroups = groupSlotsByDaypart(pickableSlots, tenant.timezone);
    const previousMonth = shiftMonth(activeMonth, -1);
    const nextMonth = shiftMonth(activeMonth, 1);
    const nextAvailabilityLink = nextAvailableDate
      ? pathWithQuery(availabilityPath, { ...baseQuery, month: monthKeyFromDate(nextAvailableDate), date: nextAvailableDate })
      : undefined;

    // Days before the last open day with nothing left read "Full"; days past it just stay quiet.
    const lastOpenDate = [...monthlyAvailability.days].reverse().find((day) => (day.openingCount ?? day.slotCount) > 0)?.date;
    const helpPhone = (selectedLocation ?? (activeLocations.length === 1 ? activeLocations[0] : undefined))?.phone;
    const providerStepHref = pathWithQuery(`/${tenantSlug}/services/${slugify(service.name)}`, {
      locationId: selectedLocation?.id,
      screening,
    });

    return (
      <main className="sf-flow">
        <BookingSteps current={3} />

        <header className="sf-head sf-head--stack">
          <div>
            <p className="sf-eyebrow">Step {appointmentStepNumber}</p>
            <h1 className="sf-title sf-title--page">Your appointment</h1>
          </div>
          <div className="sf-chips" aria-label="Selected appointment filters">
            <Link href={providerStepHref} className="sf-pill sf-pill--link">{selectedProvider?.name ?? "Any provider"}</Link>
            <span className="sf-pill">{(selectedLocation ?? onlyLocation)?.name ?? "Any location"}</span>
            <span className="sf-pill sf-pill--rose">
              {service.name} · {formatDuration(service.durationMinutes + selectedAddOns.reduce((sum, item) => sum + item.durationMinutes, 0))}
            </span>
            {selectedAddOns.map((item) => <span key={item.id} className="sf-pill">+ {item.name}</span>)}
          </div>
        </header>

        {serviceLocations.length > 1 ? (
          <nav className="sf-filters" aria-label="Location">
            <Link
              href={pathWithQuery(availabilityPath, { ...baseQuery, locationId: undefined, month: activeMonth, date: selectedDate })}
              className={`sf-filter${selectedLocation ? "" : " is-active"}`}
              aria-current={selectedLocation ? undefined : "true"}
            >
              All locations
            </Link>
            {serviceLocations.map((location) => (
              <Link
                key={location.id}
                href={pathWithQuery(availabilityPath, { ...baseQuery, locationId: location.id, month: activeMonth, date: selectedDate })}
                className={`sf-filter${selectedLocation?.id === location.id ? " is-active" : ""}`}
                aria-current={selectedLocation?.id === location.id ? "true" : undefined}
              >
                {location.name}
              </Link>
            ))}
          </nav>
        ) : null}

        {error === "slot-unavailable" ? (
          <section className="status-banner" aria-live="polite">
            <strong>That opening is no longer available.</strong>
            <span>Please choose another time.</span>
          </section>
        ) : null}

        <div className="sf-scheduler">
          <section className="sf-card sf-calendar" aria-labelledby="calendar-title">
            <div className="sf-calendar__head">
              <h2 id="calendar-title" className="sf-card__title">Select a date</h2>
              <div className="sf-month-nav">
                <Link href={pathWithQuery(availabilityPath, { ...baseQuery, month: previousMonth })} aria-label="Previous month" className="sf-month-nav__btn">
                  ‹
                </Link>
                <strong>{monthTitle(activeMonth)}</strong>
                <Link href={pathWithQuery(availabilityPath, { ...baseQuery, month: nextMonth })} aria-label="Next month" className="sf-month-nav__btn">
                  ›
                </Link>
              </div>
            </div>

            <div className="sf-month" aria-label={`Availability for ${monthTitle(activeMonth)}`}>
              {weekdayLabels.map((weekday) => (
                <span key={weekday} className="sf-weekday">{weekday}</span>
              ))}
              {Array.from({ length: leadingBlankCount }, (_, index) => (
                <span key={`blank-${index}`} className="sf-day sf-day--blank" />
              ))}
              {monthCells.map((cell) => {
                const isToday = cell.date === today;
                if (cell.isPast) {
                  return (
                    <span key={cell.date} className="sf-day sf-day--quiet" aria-label={`${cell.date}, past`}>
                      <strong>{cell.dayNumber}</strong>
                    </span>
                  );
                }
                if (cell.slotCount === 0) {
                  const full = lastOpenDate !== undefined && cell.date < lastOpenDate;
                  return (
                    <span
                      key={cell.date}
                      className={`sf-day sf-day--quiet${isToday ? " sf-day--today" : ""}`}
                      aria-label={`${cell.date}, ${full ? "fully booked" : "no openings"}`}
                    >
                      <strong>{cell.dayNumber}</strong>
                      {full ? <small>Full</small> : null}
                    </span>
                  );
                }
                return (
                  <Link
                    key={cell.date}
                    href={pathWithQuery(availabilityPath, { ...baseQuery, month: activeMonth, date: cell.date })}
                    className={[
                      "sf-day",
                      "sf-day--open",
                      isToday ? "sf-day--today" : "",
                      cell.isSelected ? "sf-day--selected" : "",
                    ].filter(Boolean).join(" ")}
                    aria-label={`${cell.date}, ${cell.slotCount} openings`}
                    aria-current={cell.isSelected ? "date" : undefined}
                  >
                    <strong>{cell.dayNumber}</strong>
                    <small>{cell.slotCount} open</small>
                  </Link>
                );
              })}
            </div>

            <p className="sf-legend">
              <span><i className="sf-legend__dot" aria-hidden="true" /> Today</span>
              <span>Number under date = openings</span>
            </p>
          </section>

          <section className="sf-card sf-times" aria-labelledby="times-title">
            <div className="sf-times__head">
              <div>
                <p className="sf-eyebrow">{pickableSlots.length} {pickableSlots.length === 1 ? "opening" : "openings"}</p>
                <h2 id="times-title" className="sf-card__title sf-card__title--lg">Select a time for {dateTitle(selectedDate)}</h2>
              </div>
              {nextAvailabilityLink ? (
                <Link href={nextAvailabilityLink} className="sf-btn">Show next availability</Link>
              ) : null}
            </div>

            {slotGroups.length > 0 ? (
              <div className="sf-slot-groups">
                {slotGroups.map((group) => (
                  <section key={group.key} className="sf-slot-group">
                    <h3>{group.label}</h3>
                    <div className="sf-slots">
                      {group.slots.map((slot) => {
                        const slotLocationName = slot.locationId ? locationById.get(slot.locationId) : undefined;
                        return (
                          <form key={`${slot.providerId}-${slot.locationId ?? "no-location"}-${slot.startAt}`} action={startBookingDraftAction}>
                            <input type="hidden" name="tenantSlug" value={tenantSlug} />
                            <input type="hidden" name="serviceId" value={service.id} />
                            <input type="hidden" name="providerId" value={slot.providerId} />
                            <input type="hidden" name="startsAt" value={slot.startAt} />
                            <input type="hidden" name="locationId" value={slot.locationId ?? onlyLocation?.id ?? ""} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            {selectedAddOnIds.map((id) => <input key={id} type="hidden" name="addOnId" value={id} />)}
                            <button type="submit" className="sf-slot" data-provider-name={slot.providerName}>
                              <strong>{timeTitle(slot.startAt, tenant.timezone)}</strong>
                              <span>{slot.providerName}</span>
                              <small>{slotLocationName ?? onlyLocation?.name ?? "Location to confirm"}</small>
                            </button>
                          </form>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="sf-empty sf-empty--flat">
                <strong>No openings on this date.</strong>
                <span>Choose a date with openings or use Show next availability.</span>
              </div>
            )}

            <p className="sf-help">
              {helpPhone ? (
                <>Need help scheduling? Call the studio on <a href={`tel:${helpPhone.replace(/[^+\d]/g, "")}`}>{helpPhone}</a>.</>
              ) : (
                "Need help scheduling your appointment? Contact the studio directly."
              )}
            </p>
          </section>
        </div>
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const detail = isApiClientError(error) ? error.message : "Availability could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Availability unavailable</p>
          <h2>We could not load appointment times.</h2>
          <p>{detail}</p>
          <Link href={`/${tenantSlug}/services/${serviceId}`} className="ghost-link">
            Back to provider preference
          </Link>
        </section>
      </main>
    );
  }
}