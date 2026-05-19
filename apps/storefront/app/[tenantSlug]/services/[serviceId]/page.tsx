import Link from "next/link";
import { notFound } from "next/navigation";
import type { SlotAvailability } from "@booking/shared-types";

import { startBookingDraftAction } from "./actions";
import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../lib/storefront-api";
import {
  formatCurrency,
  formatDateInTenantTime,
  formatDuration,
  formatInTenantTime,
  isoDateForTimeZone,
  slugify,
} from "../../../lib/storefront-shell";

type ServicePageProps = {
  params: Promise<{ tenantSlug: string; serviceId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

type AvailabilityGroup = {
  date: string;
  slots: SlotAvailability[];
};

async function loadUpcomingAvailability(tenantSlug: string, serviceId: string, timeZone: string) {
  const groups: AvailabilityGroup[] = [];

  for (let offset = 0; offset < 14 && groups.length < 4; offset += 1) {
    const date = isoDateForTimeZone(timeZone, offset);
    const availability = await storefrontApi.getAvailability({
      tenantSlug,
      serviceId,
      date,
    });

    if (availability.slots.length > 0) {
      groups.push({ date, slots: availability.slots.slice(0, 6) });
    }
  }

  return groups;
}

export default async function ServiceRoutePage({ params, searchParams }: ServicePageProps) {
  const { tenantSlug, serviceId } = await params;
  const { error } = await searchParams;

  try {
    const [tenant, serviceResponse] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.listServices(tenantSlug),
    ]);
    const service = serviceResponse.services.find(
      (entry) => entry.id === serviceId || slugify(entry.name) === serviceId,
    );

    if (!service) {
      notFound();
    }

    const availabilityGroups = await loadUpcomingAvailability(tenantSlug, service.id, tenant.timezone);
    const totalSlots = availabilityGroups.reduce((total, group) => total + group.slots.length, 0);

    return (
      <main className="page-stack">
        <section className="service-hero">
          <div>
            <Link href={`/${tenantSlug}`} className="back-link">
              Services
            </Link>
            <p className="store-eyebrow">Choose a time</p>
            <h2>{service.name}</h2>
            <p>{service.description ?? "A focused studio appointment with live availability and a protected hold."}</p>
          </div>
          <aside className="service-summary-panel">
            <dl className="summary-list">
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(service.durationMinutes)}</dd>
              </div>
              <div>
                <dt>Price</dt>
                <dd>{formatCurrency(service.priceCents)}</dd>
              </div>
              <div>
                <dt>Deposit</dt>
                <dd>{service.depositCents > 0 ? formatCurrency(service.depositCents) : "Not required"}</dd>
              </div>
              <div>
                <dt>Openings</dt>
                <dd>{totalSlots}</dd>
              </div>
            </dl>
          </aside>
        </section>

        {error === "slot-unavailable" ? (
          <section className="status-banner" aria-live="polite">
            <strong>That opening is no longer available.</strong>
            <span>Please choose another time.</span>
          </section>
        ) : null}

        <section className="availability-layout">
          <aside className="booking-note-panel">
            <p className="store-eyebrow">Studio policy</p>
            <h3>Your appointment hold</h3>
            <p>
              After selecting a time, the studio temporarily protects the opening while details, intake, and payment are completed.
            </p>
            <div className="note-list">
              <span>{tenant.settings.minLeadTimeMinutes} minute lead time</span>
              <span>{tenant.settings.maxAdvanceBookingDays} day booking window</span>
              <span>{tenant.timezone}</span>
            </div>
          </aside>

          <section className="store-section availability-section">
            <div className="section-header">
              <div>
                <p className="store-eyebrow">Upcoming openings</p>
                <h2>Select your appointment time</h2>
              </div>
              <span className="panel-badge">{tenant.timezone}</span>
            </div>

            {availabilityGroups.length > 0 ? (
              <div className="availability-stack">
                {availabilityGroups.map((group) => (
                  <section key={group.date} className="availability-day">
                    <header className="availability-day__header">
                      <div>
                        <p className="store-eyebrow">{group.slots.length} openings</p>
                        <h3>{formatDateInTenantTime(`${group.date}T12:00:00Z`, tenant.timezone)}</h3>
                      </div>
                    </header>

                    <div className="slot-grid">
                      {group.slots.map((slot) => (
                        <form key={`${slot.providerId}-${slot.startAt}`} action={startBookingDraftAction}>
                          <input type="hidden" name="tenantSlug" value={tenantSlug} />
                          <input type="hidden" name="serviceId" value={service.id} />
                          <input type="hidden" name="providerId" value={slot.providerId} />
                          <input type="hidden" name="startsAt" value={slot.startAt} />
                          <input type="hidden" name="locationId" value={slot.locationId ?? ""} />
                          <button type="submit" className="slot-button">
                            <span>{formatInTenantTime(slot.startAt, tenant.timezone)}</span>
                            <strong>{slot.providerName}</strong>
                          </button>
                        </form>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="empty-panel">
                <strong>No online openings in the next two weeks.</strong>
                <span>Check back soon or contact the studio directly.</span>
              </div>
            )}
          </section>
        </section>
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const detail = isApiClientError(error) ? error.message : "Live openings could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Service unavailable</p>
          <h2>We could not load this service.</h2>
          <p>{detail}</p>
          <Link href={`/${tenantSlug}`} className="ghost-link">
            Back to services
          </Link>
        </section>
      </main>
    );
  }
}
