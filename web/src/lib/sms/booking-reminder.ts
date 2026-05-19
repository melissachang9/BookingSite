import "server-only";

import { getTwilioClient, getTwilioFromNumber } from "./twilio";
import { formatInTimeZone } from "@/lib/datetime/timezone";

export async function sendBookingReminderSms(opts: {
  to: string;
  tenantName: string;
  tenantTimeZone: string;
  serviceName: string;
  providerName?: string | null;
  startsAt: string;
  cancelUrl: string;
}): Promise<string> {
  const provider = opts.providerName ? ` with ${opts.providerName}` : "";
  const body = `Reminder: ${opts.serviceName}${provider} at ${opts.tenantName} on ${formatWhen(
    opts.startsAt,
    opts.tenantTimeZone
  )}. Manage booking or forms: ${opts.cancelUrl}`;

  const result = await getTwilioClient().messages.create({
    to: opts.to,
    from: getTwilioFromNumber(),
    body,
  });

  return result.sid;
}

function formatWhen(startsAt: string, timeZone: string) {
  return formatInTimeZone(startsAt, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }, "en-US");
}