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

export async function sendBookingReminderEmail(opts: {
  to: string;
  customerName: string;
  tenantName: string;
  tenantTimeZone: string;
  serviceName: string;
  providerName?: string | null;
  startsAt: string;
  endsAt: string;
  cancelUrl: string;
}): Promise<string> {
  const from = process.env.RESEND_FROM_EMAIL || "hello@bookingsite.local";
  const when = formatWhen(opts.startsAt, opts.endsAt, opts.tenantTimeZone);
  const providerLine = opts.providerName ? `<p>Provider: <strong>${escape(opts.providerName)}</strong></p>` : "";

  const result = await getResend().emails.send({
    from,
    to: opts.to,
    subject: `Reminder: ${opts.serviceName} tomorrow`,
    html: `
      <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h1 style="font-size: 20px; margin: 0 0 12px;">Appointment reminder</h1>
        <p>Hi ${escape(opts.customerName)},</p>
        <p>This is a reminder about your upcoming appointment with <strong>${escape(opts.tenantName)}</strong>.</p>
        <div style="border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 4px;"><strong>${escape(opts.serviceName)}</strong></p>
          <p style="margin: 0 0 4px; color: #555;">${escape(when)}</p>
          ${providerLine}
        </div>
        <p>If you need to cancel, use your secure link here: <a href="${opts.cancelUrl}">Manage your booking</a>.</p>
        <p style="color: #888; font-size: 12px; margin-top: 32px;">— ${escape(opts.tenantName)}</p>
      </div>
    `,
  });

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "Failed to send reminder email");
  }

  return result.data.id;
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

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}