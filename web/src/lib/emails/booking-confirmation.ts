/**
 * Booking confirmation email (Resend).
 */
import "server-only";
import { Resend } from "resend";

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
  serviceName: string;
  startsAt: string;
  endsAt: string;
  cancelUrl: string;
}) {
  const from = process.env.RESEND_FROM_EMAIL || "hello@bookingsite.local";
  const when = formatWhen(opts.startsAt, opts.endsAt);

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 20px; margin: 0 0 12px;">Your booking is confirmed</h1>
      <p>Hi ${escape(opts.customerName)},</p>
      <p>Your appointment with <strong>${escape(opts.tenantName)}</strong> is confirmed.</p>
      <div style="border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 4px;"><strong>${escape(opts.serviceName)}</strong></p>
        <p style="margin: 0; color: #555;">${escape(when)}</p>
      </div>
      <p>Need to cancel or reschedule? <a href="${opts.cancelUrl}">Manage your booking</a>.</p>
      <p style="color: #888; font-size: 12px; margin-top: 32px;">— ${escape(opts.tenantName)}</p>
    </div>
  `;

  await getResend().emails.send({
    from,
    to: opts.to,
    subject: `Booking confirmed — ${opts.serviceName}`,
    html,
  });
}

function formatWhen(starts: string, ends: string) {
  const s = new Date(starts);
  const e = new Date(ends);
  const day = s.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const t1 = s.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const t2 = e.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t1} – ${t2}`;
}

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
