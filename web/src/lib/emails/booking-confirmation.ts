/**
 * Booking confirmation email (Resend).
 */
import "server-only";
import { Resend } from "resend";
import { formatInTimeZone } from "@/lib/datetime/timezone";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not configured");
  _resend = new Resend(key);
  return _resend;
}

export async function sendBookingConfirmationEmail(opts: {
  to: string;
  customerName: string;
  tenantName: string;
  tenantTimeZone: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  cancelUrl: string;
}): Promise<string> {
  const from = process.env.RESEND_FROM_EMAIL || "hello@bookingsite.local";
  const when = formatWhen(opts.startsAt, opts.endsAt, opts.tenantTimeZone);
  const calendarInvite = buildCalendarInvite(opts);

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 20px; margin: 0 0 12px;">Your booking is confirmed</h1>
      <p>Hi ${escape(opts.customerName)},</p>
      <p>Your appointment with <strong>${escape(opts.tenantName)}</strong> is confirmed.</p>
      <div style="border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 4px;"><strong>${escape(opts.serviceName)}</strong></p>
        <p style="margin: 0; color: #555;">${escape(when)}</p>
      </div>
      <p>A calendar invite is attached so you can save this appointment.</p>
      <p>Use your secure link here to manage your booking, complete any pending forms, or cancel if needed: <a href="${opts.cancelUrl}">Manage your booking</a>.</p>
      <p style="color: #888; font-size: 12px; margin-top: 32px;">— ${escape(opts.tenantName)}</p>
    </div>
  `;

  const result = await getResend().emails.send({
    from,
    to: opts.to,
    subject: `Booking confirmed — ${opts.serviceName}`,
    html,
    attachments: [calendarInvite],
  });

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "Failed to send confirmation email");
  }

  return result.data.id;
}

function buildCalendarInvite(opts: {
  customerName: string;
  tenantName: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  cancelUrl: string;
}) {
  const filename = `${slugify(`${opts.tenantName}-${opts.serviceName}`)}.ics`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BookingSite//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(`${opts.cancelUrl}|${opts.startsAt}`)}`,
    `DTSTAMP:${formatIcsDate(new Date().toISOString())}`,
    `DTSTART:${formatIcsDate(opts.startsAt)}`,
    `DTEND:${formatIcsDate(opts.endsAt)}`,
    `SUMMARY:${escapeIcsText(`${opts.tenantName} - ${opts.serviceName}`)}`,
      `DESCRIPTION:${escapeIcsText(
      `Booking confirmed for ${opts.customerName} with ${opts.tenantName}. Manage link: ${opts.cancelUrl}`
    )}`,
    `LOCATION:${escapeIcsText(opts.tenantName)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return {
    filename,
    content: Buffer.from(lines.join("\r\n"), "utf8"),
    contentType: "text/calendar; charset=utf-8; method=PUBLISH",
  };
}

function formatWhen(starts: string, ends: string, timeZone: string) {
  const day = formatInTimeZone(starts, timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }, "en-US");
  const t1 = formatInTimeZone(starts, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  }, "en-US");
  const t2 = formatInTimeZone(ends, timeZone, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }, "en-US");
  return `${day} · ${t1} – ${t2}`;
}

function formatIcsDate(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "booking";
}

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
