import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBookingReminderEmail } from "@/lib/emails/booking-reminder";
import { sendBookingReminderSms } from "@/lib/sms/booking-reminder";
import { isTwilioConfigured } from "@/lib/sms/twilio";

export const dynamic = "force-dynamic";

type ReminderBooking = {
  id: string;
  tenant_id: string;
  starts_at: string;
  ends_at: string;
  cancel_token: string;
  customers: { name: string; email: string | null; phone: string | null } | { name: string; email: string | null; phone: string | null }[] | null;
  services: { name: string } | { name: string }[] | null;
  providers: { name: string | null } | { name: string | null }[] | null;
  tenants:
    | {
        name: string;
        slug: string;
        timezone: string;
        settings_json: { reminder_hours_before?: number } | null;
      }
    | {
        name: string;
        slug: string;
        timezone: string;
        settings_json: { reminder_hours_before?: number } | null;
      }[]
    | null;
};

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function recordNotificationLog(input: {
  admin: ReturnType<typeof createAdminClient>;
  tenantId: string;
  bookingId: string;
  kind: string;
  channel: "email" | "sms";
  recipient: string | null;
  status: "sent" | "failed";
  providerMessageId?: string | null;
  error?: string | null;
}) {
  await input.admin.from("notification_log").insert({
    tenant_id: input.tenantId,
    booking_id: input.bookingId,
    kind: input.kind,
    channel: input.channel,
    recipient: input.recipient,
    status: input.status,
    provider_message_id: input.providerMessageId ?? null,
    error: input.error ?? null,
    sent_at: input.status === "sent" ? new Date().toISOString() : null,
  });
}

async function handleReminders(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const admin = createAdminClient();
  const now = new Date();
  const reminderKind = "reminder_24h";
  const lookbackMs = 6 * 60 * 60 * 1000;
  const horizonMs = 72 * 60 * 60 * 1000;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const smsEnabled = isTwilioConfigured();

  const { data: bookingsData, error } = await admin
    .from("bookings")
    .select(
      `id, tenant_id, starts_at, ends_at, cancel_token,
       customers(name, email, phone),
       services(name),
       providers(name),
       tenants(name, slug, timezone, settings_json)`
    )
    .eq("status", "confirmed")
    .gt("starts_at", now.toISOString())
    .lt("starts_at", new Date(now.getTime() + horizonMs).toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const candidates = ((bookingsData ?? []) as ReminderBooking[]).filter((booking) => {
    const tenant = normalizeRelation(booking.tenants);
    const reminderHours = tenant?.settings_json?.reminder_hours_before ?? 24;
    const scheduledAt = new Date(new Date(booking.starts_at).getTime() - reminderHours * 60 * 60 * 1000);
    return scheduledAt <= now && scheduledAt.getTime() > now.getTime() - lookbackMs;
  });

  const sentKeys = new Set<string>();
  if (candidates.length > 0) {
    const { data: sentLogs } = await admin
      .from("notification_log")
      .select("booking_id, channel")
      .eq("kind", reminderKind)
      .eq("status", "sent")
      .in(
        "booking_id",
        candidates.map((candidate) => candidate.id)
      );
    for (const log of sentLogs ?? []) {
      sentKeys.add(`${log.booking_id}:${log.channel}`);
    }
  }

  let emailSent = 0;
  let smsSent = 0;
  let failed = 0;

  for (const booking of candidates) {
    const customer = normalizeRelation(booking.customers);
    const service = normalizeRelation(booking.services);
    const provider = normalizeRelation(booking.providers);
    const tenant = normalizeRelation(booking.tenants);
    if (!customer || !service || !tenant) continue;

    const cancelUrl = `${appUrl}/cancel/${booking.cancel_token}`;

    if (customer.email && !sentKeys.has(`${booking.id}:email`)) {
      try {
        const emailId = await sendBookingReminderEmail({
          to: customer.email,
          customerName: customer.name,
          tenantName: tenant.name,
          tenantTimeZone: tenant.timezone,
          serviceName: service.name,
          providerName: provider?.name ?? null,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          cancelUrl,
        });
        await recordNotificationLog({
          admin,
          tenantId: booking.tenant_id,
          bookingId: booking.id,
          kind: reminderKind,
          channel: "email",
          recipient: customer.email,
          status: "sent",
          providerMessageId: emailId,
        });
        sentKeys.add(`${booking.id}:email`);
        emailSent += 1;
      } catch (err) {
        failed += 1;
        await recordNotificationLog({
          admin,
          tenantId: booking.tenant_id,
          bookingId: booking.id,
          kind: reminderKind,
          channel: "email",
          recipient: customer.email,
          status: "failed",
          error: err instanceof Error ? err.message : "Failed to send email reminder",
        });
      }
    }

    if (smsEnabled && customer.phone && !sentKeys.has(`${booking.id}:sms`)) {
      try {
        const smsId = await sendBookingReminderSms({
          to: customer.phone,
          tenantName: tenant.name,
          tenantTimeZone: tenant.timezone,
          serviceName: service.name,
          providerName: provider?.name ?? null,
          startsAt: booking.starts_at,
          cancelUrl,
        });
        await recordNotificationLog({
          admin,
          tenantId: booking.tenant_id,
          bookingId: booking.id,
          kind: reminderKind,
          channel: "sms",
          recipient: customer.phone,
          status: "sent",
          providerMessageId: smsId,
        });
        sentKeys.add(`${booking.id}:sms`);
        smsSent += 1;
      } catch (err) {
        failed += 1;
        await recordNotificationLog({
          admin,
          tenantId: booking.tenant_id,
          bookingId: booking.id,
          kind: reminderKind,
          channel: "sms",
          recipient: customer.phone,
          status: "failed",
          error: err instanceof Error ? err.message : "Failed to send SMS reminder",
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    considered: candidates.length,
    email_sent: emailSent,
    sms_sent: smsSent,
    failed,
    sms_enabled: smsEnabled,
  });
}

export async function GET(req: Request) {
  return handleReminders(req);
}

export async function POST(req: Request) {
  return handleReminders(req);
}