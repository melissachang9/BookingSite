import Link from "next/link";
import { notFound } from "next/navigation";
import type { SlotAvailability } from "@booking/shared-types";

import { startBookingDraftAction } from "../actions";
import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../../lib/storefront-api";
import {
  isoDateForTimeZone,
  isoDateFromValueInTimeZone,
  pathWithQuery,
  slugify,
} from "../../../../lib/storefront-shell";

type AvailabilityPageProps = {
  params: Promise<{ tenantSlug: string; serviceId: string }>;
  searchParams: Promise<{ providerId?: string; locationId?: string; screening?: string; date?: string; month?: string; error?: string }>;
};

type MonthCell = {
  date: string;
  dayNumber: number;
  slotCount: number;
  isSelected: boolean;
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
  const { providerId, locationId, screening, date, month, error } = await searchParams;

  try {
    const [tenant, serviceResponse, locationResponse] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.listServices(tenantSlug),
      storefrontApi.listLocations(tenantSlug),
    ]);
    const service = serviceResponse.services.find(
      (entry) => entry.id === serviceId || slugify(entry.name) === serviceId,
    );

    if (!service) {
      notFound();
    }

    const activeLocations = locationResponse.locations.filter((location) => location.isActive);
    const selectedLocation = locationId ? activeLocations.find((location) => location.id === locationId) : undefined;
    if (locationId && (!selectedLocation || !service.locationIds.includes(locationId))) {
      notFound();
    }

    const providerResponse = await storefrontApi.listServiceProviders(tenantSlug, service.id, {
      locationId: selectedLocation?.id,
    });
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
    });
    const firstAvailableDate = monthlyAvailability.days.find((day) => day.slotCount > 0)?.date;
    const selectedDate = date ?? firstAvailableDate ?? monthStart;
    const selectedAvailability = await storefrontApi.getAvailability({
      tenantSlug,
      serviceId: service.id,
      providerId,
      locationId: selectedLocation?.id,
      date: selectedDate,
      windowDays: 1,
    });
    const nextAvailabilitySearch = await storefrontApi.getAvailability({
      tenantSlug,
      serviceId: service.id,
      providerId,
      locationId: selectedLocation?.id,
      date: addDays(selectedDate, selectedAvailability.slots.length > 0 ? 1 : 0),
      windowDays: 62,
    });
    const availabilityPath = `/${tenantSlug}/services/${slugify(service.name)}/availability`;
    const baseQuery = { locationId: selectedLocation?.id, screening, providerId };
    const returnTo = pathWithQuery(availabilityPath, { ...baseQuery, month: activeMonth, date: selectedDate });
    const dayMap = new Map(monthlyAvailability.days.map((day) => [day.date, day.slotCount]));
    const monthCells: MonthCell[] = Array.from({ length: monthDays }, (_, index) => {
      const cellDate = addDays(monthStart, index);
      return {
        date: cellDate,
        dayNumber: index + 1,
        slotCount: dayMap.get(cellDate) ?? 0,
        isSelected: cellDate === selectedDate,
      };
    });
    const leadingBlankCount = new Date(`${monthStart}T12:00:00Z`).getUTCDay();
    const nextAvailable = nextAvailabilitySearch.nextAvailableSlot;
    const nextAvailableDate = nextAvailable ? isoDateFromValueInTimeZone(nextAvailable.startAt, tenant.timezone) : undefined;
    const locationById = new Map(activeLocations.map((location) => [location.id, location.name]));
    const slotGroups = groupSlotsByDaypart(selectedAvailability.slots, tenant.timezone);
    const nextAvailabilityLink = nextAvailableDate
      ? pathWithQuery(availabilityPath, { ...baseQuery, month: monthKeyFromDate(nextAvailableDate), date: nextAvailableDate })
      : undefined;

    return (
      <main className="appointment-page">
        <Link href={pathWithQuery(`/${tenantSlug}/services/${slugify(service.name)}`, { locationId: selectedLocation?.id, screening })} className="appointment-back-link">
          Provider preference
        </Link>

        <section className="appointment-heading">
          <p className="store-eyebrow">Your appointment</p>
          <h2>Your Appointment</h2>
          <div className="appointment-filters" aria-label="Selected appointment filters">
            <span>{selectedProvider?.name ?? "Any Provider"}</span>
            <span>{selectedLocation?.name ?? "Any Location"}</span>
            <span>{service.name}</span>
          </div>
        </section>

        {error === "slot-unavailable" ? (
          <section className="status-banner" aria-live="polite">
            <strong>That opening is no longer available.</strong>
            <span>Please choose another time.</span>
          </section>
        ) : null}

        <section className="appointment-scheduler">
          <section className="appointment-calendar-panel">
            <div className="appointment-panel-header">
              <h3>Select a date</h3>
              <div className="appointment-month-nav">
                <strong>{monthTitle(activeMonth)}</strong>
                <Link href={pathWithQuery(availabilityPath, { ...baseQuery, month: shiftMonth(activeMonth, 1) })} aria-label="Next month">
                  ›
                </Link>
              </div>
            </div>

            <div className="appointment-month-grid" aria-label={`Availability for ${monthTitle(activeMonth)}`}>
              {weekdayLabels.map((weekday) => (
                <span key={weekday} className="appointment-weekday">
                  {weekday}
                </span>
              ))}
              {Array.from({ length: leadingBlankCount }, (_, index) => (
                <span key={`blank-${index}`} className="appointment-day appointment-day--blank" />
              ))}
              {monthCells.map((cell) => (
                <Link
                  key={cell.date}
                  href={pathWithQuery(availabilityPath, { ...baseQuery, month: activeMonth, date: cell.date })}
                  className={[
                    "appointment-day",
                    cell.slotCount > 0 ? "appointment-day--available" : "",
                    cell.isSelected ? "appointment-day--selected" : "",
                  ].filter(Boolean).join(" ")}
                  aria-label={`${cell.date}, ${cell.slotCount} openings`}
                >
                  <strong>{cell.dayNumber}</strong>
                  <span>{cell.slotCount > 0 ? `${cell.slotCount}` : ""}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="appointment-times-panel">
            <div className="appointment-times-header">
              <div>
                <p className="store-eyebrow">{selectedAvailability.slots.length} openings</p>
                <h3>Select a time for {dateTitle(selectedDate)}</h3>
              </div>
              {nextAvailabilityLink ? (
                <Link href={nextAvailabilityLink} className="ghost-link appointment-next-link">
                  Show next availability
                </Link>
              ) : null}
            </div>

            {slotGroups.length > 0 ? (
              <div className="appointment-slot-groups">
                {slotGroups.map((group) => (
                  <section key={group.key} className="appointment-slot-group">
                    <h4>{group.label}</h4>
                    <div className="appointment-slot-list">
                      {group.slots.map((slot) => {
                        const slotLocationName = slot.locationId ? locationById.get(slot.locationId) : undefined;
                        return (
                          <form key={`${slot.providerId}-${slot.locationId ?? "no-location"}-${slot.startAt}`} action={startBookingDraftAction}>
                            <input type="hidden" name="tenantSlug" value={tenantSlug} />
                            <input type="hidden" name="serviceId" value={service.id} />
                            <input type="hidden" name="providerId" value={slot.providerId} />
                            <input type="hidden" name="startsAt" value={slot.startAt} />
                            <input type="hidden" name="locationId" value={slot.locationId ?? ""} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <button type="submit" className="slot-button appointment-slot-button" data-provider-name={slot.providerName}>
                              <span>{timeTitle(slot.startAt, tenant.timezone)}</span>
                              <strong>{slot.providerName}</strong>
                              <small>{slotLocationName ?? "Location to confirm"}</small>
                            </button>
                          </form>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="empty-panel appointment-empty-panel">
                <strong>No openings on this date.</strong>
                <span>Choose a highlighted date or use Show next availability.</span>
              </div>
            )}

            <p className="appointment-help-text">Need help scheduling your appointment? Contact the studio directly.</p>
          </section>
        </section>
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