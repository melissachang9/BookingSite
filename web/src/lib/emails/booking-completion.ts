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

export async function sendBookingCompletionEmail(opts: {
  to: string;
  customerName: string;
  tenantName: string;
  tenantTimeZone: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  subtotalCents: number;
  taxCents: number;
  totalWithTaxCents: number;
  tipCents?: number;
  walletAppliedCents?: number;
  paymentOutcomeLabel: string;
  amountOwingAtCheckoutCents: number;
  amountRecordedCents: number;
  reviewUrl?: string | null;
  manageUrl?: string | null;
}): Promise<string> {
  const from = process.env.RESEND_FROM_EMAIL || "hello@bookingsite.local";
  const when = formatWhen(opts.startsAt, opts.endsAt, opts.tenantTimeZone);

  const reviewCta =
    opts.reviewUrl && opts.reviewUrl.trim().length > 0
      ? `<p style="margin-top: 24px;">If you have a moment, we'd love your feedback: <a href="${opts.reviewUrl}">Leave a review</a>.</p>`
      : "";
  const manageCta =
    opts.manageUrl && opts.manageUrl.trim().length > 0
      ? `<p style="margin-top: 24px;">Need your appointment details or any follow-up forms? <a href="${opts.manageUrl}">Manage your booking</a>.</p>`
      : "";
  const tipCents = Math.max(opts.tipCents ?? 0, 0);
  const walletAppliedCents = Math.max(opts.walletAppliedCents ?? 0, 0);
  const totalAtRegisterCents = opts.totalWithTaxCents + tipCents;
  const tipLine =
    tipCents > 0
      ? `<p style="margin: 4px 0 0;">Tip: <strong>${formatDollars(tipCents)}</strong></p>`
      : "";
  const totalAtRegisterLine =
    tipCents > 0
      ? `<p style="margin: 4px 0 0;">Total at register: <strong>${formatDollars(totalAtRegisterCents)}</strong></p>`
      : "";
  const walletLine =
    walletAppliedCents > 0
      ? `<p style="margin: 4px 0 0;">Wallet applied: <strong>${formatDollars(walletAppliedCents)}</strong></p>`
      : "";

  const result = await getResend().emails.send({
    from,
    to: opts.to,
    subject: `Appointment complete — ${opts.serviceName}`,
    html: `
      <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h1 style="font-size: 20px; margin: 0 0 12px;">Appointment complete</h1>
        <p>Hi ${escape(opts.customerName)},</p>
        <p>Thanks for visiting <strong>${escape(opts.tenantName)}</strong>. Here is your checkout summary.</p>

        <div style="border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 4px;"><strong>${escape(opts.serviceName)}</strong></p>
          <p style="margin: 0 0 12px; color: #555;">${escape(when)}</p>
          <p style="margin: 0;">Subtotal: <strong>${formatDollars(opts.subtotalCents)}</strong></p>
          <p style="margin: 4px 0 0;">Tax: <strong>${formatDollars(opts.taxCents)}</strong></p>
          <p style="margin: 4px 0 0;">Total with tax: <strong>${formatDollars(opts.totalWithTaxCents)}</strong></p>
          ${tipLine}
          ${totalAtRegisterLine}
          ${walletLine}
          <p style="margin: 12px 0 0;">Checkout outcome: <strong>${escape(opts.paymentOutcomeLabel)}</strong></p>
          <p style="margin: 4px 0 0;">Amount owing at checkout: <strong>${formatDollars(opts.amountOwingAtCheckoutCents)}</strong></p>
          <p style="margin: 4px 0 0;">Amount recorded now: <strong>${formatDollars(opts.amountRecordedCents)}</strong></p>
        </div>

        ${manageCta}
        ${reviewCta}
        <p style="color: #888; font-size: 12px; margin-top: 32px;">— ${escape(opts.tenantName)}</p>
      </div>
    `,
  });

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "Failed to send completion email");
  }

  return result.data.id;
}

function formatWhen(starts: string, ends: string, timeZone: string) {
  const day = formatInTimeZone(
    starts,
    timeZone,
    {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    },
    "en-US"
  );
  const t1 = formatInTimeZone(
    starts,
    timeZone,
    {
      hour: "numeric",
      minute: "2-digit",
    },
    "en-US"
  );
  const t2 = formatInTimeZone(
    ends,
    timeZone,
    {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    },
    "en-US"
  );
  return `${day} · ${t1} - ${t2}`;
}

function formatDollars(cents: number) {
  return `$${(Math.max(cents, 0) / 100).toFixed(2)}`;
}

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}
