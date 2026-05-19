
export type TenantSettings = {
  cancellation_window_hours: number;
  refund_inside_window: boolean;
  default_deposit_cents: number;
  reminder_hours_before: number;
  no_show_fee_cents: number;
  min_lead_time_minutes: number;
  max_advance_booking_days: number;
  auto_charge_no_show_fee: boolean;
  payment_link_expiry_minutes: number;
  tax_rate_percent: number;
};

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  cancellation_window_hours: 24,
  refund_inside_window: false,
  default_deposit_cents: 2500,
  reminder_hours_before: 24,
  no_show_fee_cents: 0,
  min_lead_time_minutes: 60,
  max_advance_booking_days: 90,
  auto_charge_no_show_fee: false,
  payment_link_expiry_minutes: 45,
  tax_rate_percent: 0,
};

function numberSetting(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeTenantSettings(
  settingsJson: Partial<Record<keyof TenantSettings, unknown>> | null | undefined
): TenantSettings {
  const raw = settingsJson ?? {};
  return {
    cancellation_window_hours: Math.max(
      0,
      Math.round(numberSetting(raw.cancellation_window_hours, DEFAULT_TENANT_SETTINGS.cancellation_window_hours))
    ),
    refund_inside_window:
      typeof raw.refund_inside_window === "boolean"
        ? raw.refund_inside_window
        : DEFAULT_TENANT_SETTINGS.refund_inside_window,
    default_deposit_cents: Math.max(
      0,
      Math.round(numberSetting(raw.default_deposit_cents, DEFAULT_TENANT_SETTINGS.default_deposit_cents))
    ),
    reminder_hours_before: Math.max(
      1,
      Math.round(numberSetting(raw.reminder_hours_before, DEFAULT_TENANT_SETTINGS.reminder_hours_before))
    ),
    no_show_fee_cents: Math.max(
      0,
      Math.round(numberSetting(raw.no_show_fee_cents, DEFAULT_TENANT_SETTINGS.no_show_fee_cents))
    ),
    min_lead_time_minutes: Math.max(
      0,
      Math.round(numberSetting(raw.min_lead_time_minutes, DEFAULT_TENANT_SETTINGS.min_lead_time_minutes))
    ),
    max_advance_booking_days: Math.max(
      1,
      Math.round(numberSetting(raw.max_advance_booking_days, DEFAULT_TENANT_SETTINGS.max_advance_booking_days))
    ),
    auto_charge_no_show_fee:
      typeof raw.auto_charge_no_show_fee === "boolean"
        ? raw.auto_charge_no_show_fee
        : DEFAULT_TENANT_SETTINGS.auto_charge_no_show_fee,
    payment_link_expiry_minutes: Math.max(
      5,
      Math.round(
        numberSetting(
          raw.payment_link_expiry_minutes,
          DEFAULT_TENANT_SETTINGS.payment_link_expiry_minutes
        )
      )
    ),
    tax_rate_percent: Math.min(
      100,
      Math.max(
        0,
        numberSetting(raw.tax_rate_percent, DEFAULT_TENANT_SETTINGS.tax_rate_percent)
      )
    ),
  };
}

export function isInsideCancellationWindow(
  startsAt: string,
  cancellationWindowHours: number,
  referenceTime: string | Date
) {
  if (cancellationWindowHours <= 0) return false;
  const startsAtMs = new Date(startsAt).getTime();
  const referenceMs = new Date(referenceTime).getTime();
  return referenceMs >= startsAtMs - cancellationWindowHours * 60 * 60 * 1000;
}