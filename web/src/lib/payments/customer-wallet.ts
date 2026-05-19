import { createAdminClient } from "@/lib/supabase/admin";

export type CustomerWalletLedgerReason =
  | "manual_credit"
  | "checkout_applied"
  | "refund_credit"
  | "gift_card"
  | "membership_credit"
  | "package_credit"
  | "referral_credit";

type WalletAdminClient = ReturnType<typeof createAdminClient>;

export async function getCustomerWalletBalanceCents(input: {
  tenantId: string;
  customerId: string;
  admin?: WalletAdminClient;
}) {
  const admin = input.admin ?? createAdminClient();
  const { data, error } = await admin
    .from("customer_wallet_ledger")
    .select("amount_cents")
    .eq("tenant_id", input.tenantId)
    .eq("customer_id", input.customerId);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).reduce((sum, entry) => sum + entry.amount_cents, 0);
}

export async function appendCustomerWalletLedgerEntry(input: {
  tenantId: string;
  customerId: string;
  bookingId?: string | null;
  amountCents: number;
  reason: CustomerWalletLedgerReason;
  note?: string | null;
  createdByUserId?: string | null;
  admin?: WalletAdminClient;
}) {
  if (input.amountCents === 0) {
    return null;
  }

  const admin = input.admin ?? createAdminClient();
  const { data, error } = await admin
    .from("customer_wallet_ledger")
    .insert({
      tenant_id: input.tenantId,
      customer_id: input.customerId,
      booking_id: input.bookingId ?? null,
      amount_cents: input.amountCents,
      reason: input.reason,
      note: input.note ?? null,
      created_by_user_id: input.createdByUserId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data.id;
}