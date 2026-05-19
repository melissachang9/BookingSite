"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createCheckoutSessionAction } from "@/app/[tenantSlug]/book/[draftId]/actions";
import {
  filterServiceCustomerFormsByTiming,
  loadServiceCustomerForms,
  toBookingFormRequirementRows,
} from "@/lib/forms/service-customer-forms";
import { requireTenant } from "@/lib/admin/require-tenant";
import { formatInTimeZone } from "@/lib/datetime/timezone";
import { sendBookingConfirmationEmail } from "@/lib/emails/booking-confirmation";
import { applyProviderServiceOverrides } from "@/lib/services/provider-service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CreateCalendarBookingState } from "./create-booking-state";

const createCalendarBookingSchema = z.object({
  startsAt: z.string().datetime(),
  locationId: z.string().uuid(),
  providerId: z.string().uuid(),
  serviceId: z.string().uuid(),
  customerName: z.string().trim().min(1).max(120),
  customerEmail: z.string().trim().email().max(320),
  customerPhone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
  confirmationRequested: z.boolean(),
  mode: z.enum(["confirm", "checkout"]),
});

export async function createCalendarBookingAction(
  _prev: CreateCalendarBookingState,
  formData: FormData
): Promise<CreateCalendarBookingState> {
  const parsed = createCalendarBookingSchema.safeParse({
    startsAt: formData.get("startsAt"),
    locationId: formData.get("locationId"),
    providerId: formData.get("providerId"),
    serviceId: formData.get("serviceId"),
    customerName: formData.get("customerName"),
    customerEmail: formData.get("customerEmail"),
    customerPhone: emptyToUndefined(formData.get("customerPhone")),
    notes: emptyToUndefined(formData.get("notes")),
    confirmationRequested: formData.get("confirmationRequested") === "true",
    mode: formData.get("mode"),
  });

  if (!parsed.success) {
    return { error: "Enter a valid time, service, provider, and customer." };
  }

  const { tenantId, user } = await requireTenant();
  const admin = createAdminClient();
  const customerEmail = parsed.data.customerEmail.trim().toLowerCase();

  const [serviceRes, providerRes, locationRes, providerServiceRes, serviceLocationRes, providerLocationRes, tenantRes] =
    await Promise.all([
      admin
        .from("services")
        .select(
          "id, tenant_id, name, price_cents, deposit_cents, duration_minutes, buffer_before_minutes, buffer_after_minutes, is_active"
        )
        .eq("id", parsed.data.serviceId)
        .maybeSingle(),
      admin
        .from("providers")
        .select("id, tenant_id, name, is_active")
        .eq("id", parsed.data.providerId)
        .maybeSingle(),
      admin
        .from("locations")
        .select("id, tenant_id, name, is_active")
        .eq("id", parsed.data.locationId)
        .maybeSingle(),
      admin
        .from("provider_services")
        .select(
          "provider_id, service_id, price_cents_override, deposit_cents_override, duration_minutes_override"
        )
        .eq("tenant_id", tenantId)
        .eq("provider_id", parsed.data.providerId)
        .eq("service_id", parsed.data.serviceId)
        .maybeSingle(),
      admin
        .from("service_locations")
        .select("service_id")
        .eq("tenant_id", tenantId)
        .eq("service_id", parsed.data.serviceId)
        .eq("location_id", parsed.data.locationId)
        .maybeSingle(),
      admin
        .from("provider_locations")
        .select("provider_id")
        .eq("tenant_id", tenantId)
        .eq("provider_id", parsed.data.providerId)
        .eq("location_id", parsed.data.locationId)
        .maybeSingle(),
      admin.from("tenants").select("name, timezone, slug").eq("id", tenantId).maybeSingle(),
    ]);

  const service = serviceRes.data;
  const provider = providerRes.data;
  const location = locationRes.data;
  const providerService = providerServiceRes.data;

  if (serviceRes.error || !service || service.tenant_id !== tenantId || !service.is_active) {
    return { error: "That service is unavailable." };
  }
  if (providerRes.error || !provider || provider.tenant_id !== tenantId || !provider.is_active) {
    return { error: "That provider is unavailable." };
  }
  if (locationRes.error || !location || location.tenant_id !== tenantId || !location.is_active) {
    return { error: "That location is unavailable." };
  }
  if (providerServiceRes.error || !providerService) {
    return { error: "That provider does not offer the selected service." };
  }
  if (serviceLocationRes.error || !serviceLocationRes.data) {
    return { error: "That service is not available at the selected location." };
  }
  if (providerLocationRes.error || !providerLocationRes.data) {
    return { error: "That provider is not assigned to the selected location." };
  }

  const effectiveService = applyProviderServiceOverrides(service, providerService);
  const startsAt = new Date(parsed.data.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "Choose a valid start time." };
  }

  const endsAt = new Date(startsAt.getTime() + effectiveService.duration_minutes * 60_000);
  const startsAtIso = startsAt.toISOString();
  const endsAtIso = endsAt.toISOString();

  const [overlapRes, holdRes] = await Promise.all([
    admin
      .from("bookings")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("provider_id", parsed.data.providerId)
      .eq("status", "confirmed")
      .lt("starts_at", endsAtIso)
      .gt("ends_at", startsAtIso)
      .limit(1),
    admin
      .from("slot_holds")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("provider_id", parsed.data.providerId)
      .gt("expires_at", new Date().toISOString())
      .lt("starts_at", endsAtIso)
      .gt("ends_at", startsAtIso)
      .limit(1),
  ]);

  if ((overlapRes.data?.length ?? 0) > 0) {
    return { error: "That provider is already booked for the selected time." };
  }
  if ((holdRes.data?.length ?? 0) > 0) {
    return { error: "That time is currently being held by another booking flow." };
  }

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .upsert(
      {
        tenant_id: tenantId,
        email: customerEmail,
        name: parsed.data.customerName,
        phone: parsed.data.customerPhone ?? null,
      },
      { onConflict: "tenant_id,email" }
    )
    .select("id, email, name")
    .single();

  if (customerError || !customer) {
    return { error: customerError?.message ?? "Failed to prepare the customer record." };
  }

  let customerForms;
  try {
    customerForms = await loadServiceCustomerForms(admin, {
      tenantId,
      serviceId: parsed.data.serviceId,
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to load service forms.",
    };
  }

  const preBookingForms = filterServiceCustomerFormsByTiming(customerForms, "pre_booking");
  const scheduledBookingForms = filterServiceCustomerFormsByTiming(customerForms, [
    "pre_visit",
    "post_visit",
  ]);

  const confirmationRequested = parsed.data.confirmationRequested;
  if (parsed.data.mode === "checkout") {
    if (effectiveService.price_cents <= 0) {
      return { error: "Free services cannot open hosted checkout yet." };
    }
    if (preBookingForms.length > 0) {
      return {
        error:
          "This service has pre-booking forms attached. Create it as an unpaid booking for now; hosted checkout from the calendar drawer only supports services without pre-booking gates.",
      };
    }
    if (!tenantRes.data?.slug) {
      return { error: "Tenant booking URL is not configured." };
    }

    const holdMinutes = 15;
    const expiresAt = new Date(Date.now() + holdMinutes * 60_000);
    const outerStart = new Date(
      startsAt.getTime() - effectiveService.buffer_before_minutes * 60_000
    );
    const outerEnd = new Date(endsAt.getTime() + effectiveService.buffer_after_minutes * 60_000);

    const { data: draft, error: draftError } = await admin
      .from("booking_drafts")
      .insert({
        tenant_id: tenantId,
        location_id: parsed.data.locationId,
        service_id: parsed.data.serviceId,
        provider_id: parsed.data.providerId,
        customer_id: customer.id,
        customer_name: parsed.data.customerName,
        customer_email: customerEmail,
        customer_phone: parsed.data.customerPhone ?? null,
        starts_at: startsAtIso,
        ends_at: endsAtIso,
        status: "draft",
        price_cents: effectiveService.price_cents,
        deposit_cents: effectiveService.deposit_cents,
        duration_minutes: effectiveService.duration_minutes,
        booking_method: "staff_entered",
        source_channel: "admin_calendar",
        deposit_status: "unpaid",
        confirmation_requested: confirmationRequested,
        created_by_user_id: user.id,
        expires_at: expiresAt.toISOString(),
      })
      .select("id")
      .single();

    if (draftError || !draft) {
      return { error: draftError?.message ?? "Failed to create checkout draft." };
    }

    const { error: holdError } = await admin.from("slot_holds").insert({
      tenant_id: tenantId,
      location_id: parsed.data.locationId,
      provider_id: parsed.data.providerId,
      booking_draft_id: draft.id,
      starts_at: outerStart.toISOString(),
      ends_at: outerEnd.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    if (holdError) {
      await admin.from("booking_drafts").delete().eq("id", draft.id);
      return { error: holdError.message };
    }

    const checkoutResult = await createCheckoutSessionAction({
      draftId: draft.id,
      tenantSlug: tenantRes.data.slug,
    });

    if (!checkoutResult.ok || !checkoutResult.url) {
      await admin.from("booking_drafts").delete().eq("id", draft.id);
      return { error: checkoutResult.error ?? "Failed to open checkout." };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/calendar");
    revalidatePath("/admin/payments");
    revalidatePath("/admin/customers");
    revalidatePath(`/admin/customers/${customer.id}`);

    return {
      success: "Checkout is opening for this booking draft.",
      createdDraftId: draft.id,
      checkoutUrl: checkoutResult.url,
    };
  }

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .insert({
      tenant_id: tenantId,
      location_id: parsed.data.locationId,
      customer_id: customer.id,
      service_id: parsed.data.serviceId,
      provider_id: parsed.data.providerId,
      starts_at: startsAtIso,
      ends_at: endsAtIso,
      status: "confirmed",
      price_cents: effectiveService.price_cents,
      deposit_cents: effectiveService.deposit_cents,
      deposit_status: "unpaid",
      booking_method: "staff_entered",
      source_channel: "admin_calendar",
      confirmation_requested: confirmationRequested,
      confirmation_delivery_status: confirmationRequested ? "unknown" : "not_requested",
      created_by_user_id: user.id,
      notes: parsed.data.notes ?? null,
    })
    .select("id, cancel_token")
    .single();

  if (bookingError || !booking) {
    return {
      error:
        bookingError?.message === "time conflicts with existing booking"
          ? "That provider is already booked for the selected time."
          : bookingError?.message ?? "Failed to create booking.",
    };
  }

  const requirementRows = toBookingFormRequirementRows(scheduledBookingForms, {
    tenantId,
    bookingId: booking.id,
  });

  if (requirementRows.length > 0) {
    const { error: requirementError } = await admin
      .from("booking_form_requirements")
      .insert(requirementRows);

    if (requirementError) {
      await admin.from("bookings").delete().eq("id", booking.id);
      return { error: requirementError.message };
    }
  }

  let success = `Booked ${customer.name} for ${service.name} with ${provider.name} on ${formatInTimeZone(
    startsAtIso,
    tenantRes.data?.timezone ?? "America/Los_Angeles",
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    },
    "en-US"
  )}.`;

  if (confirmationRequested) {
    try {
      await sendBookingConfirmationEmail({
        to: customerEmail,
        customerName: customer.name,
        tenantName: tenantRes.data?.name ?? "BookingSite",
        tenantTimeZone: tenantRes.data?.timezone ?? "America/Los_Angeles",
        serviceName: service.name,
        startsAt: startsAtIso,
        endsAt: endsAtIso,
        cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/cancel/${booking.cancel_token}`,
      });

      await admin
        .from("bookings")
        .update({
          confirmation_delivery_status: "sent",
          confirmation_sent_at: new Date().toISOString(),
          confirmation_send_count: 1,
          confirmation_last_error: null,
        })
        .eq("id", booking.id);

      success += " Confirmation email sent.";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send confirmation email";
      await admin
        .from("bookings")
        .update({
          confirmation_delivery_status: "failed",
          confirmation_last_error: message,
        })
        .eq("id", booking.id);
      success += ` Confirmation email failed: ${message}.`;
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${booking.id}`);
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${customer.id}`);

  return {
    success,
    createdBookingId: booking.id,
  };
}

function emptyToUndefined(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}