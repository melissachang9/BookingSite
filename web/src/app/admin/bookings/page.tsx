import Link from "next/link";
import { requireTenant } from "@/lib/admin/require-tenant";

export const metadata = { title: "Bookings — BookingSite" };

const STATUS_OPTIONS = ["upcoming", "all", "confirmed", "completed", "canceled", "no_show"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

function isStatus(v: string | undefined): v is StatusFilter {
  return !!v && (STATUS_OPTIONS as readonly string[]).includes(v);
}

function fmtMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; provider?: string; q?: string }>;
}) {
  const params = await searchParams;
  const { supabase, tenantId } = await requireTenant();

  const status: StatusFilter = isStatus(params.status) ? params.status : "upcoming";
  const providerId = params.provider && params.provider !== "all" ? params.provider : null;
  const q = (params.q ?? "").trim();

  let query = supabase
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, price_cents, deposit_cents, provider_id, customer_id, service_id, providers(name), services(name), customers(name, email)"
    )
    .eq("tenant_id", tenantId)
    .order("starts_at", { ascending: status === "upcoming" || status === "confirmed" })
    .limit(200);

  if (status === "upcoming") {
    query = query.gte("starts_at", new Date().toISOString()).in("status", ["confirmed"]);
  } else if (status !== "all") {
    query = query.eq("status", status);
  }

  if (providerId) query = query.eq("provider_id", providerId);

  const [bookingsRes, providersRes] = await Promise.all([
    query,
    supabase
      .from("providers")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name"),
  ]);

  let rows = bookingsRes.data ?? [];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => {
      const c = Array.isArray(r.customers) ? r.customers[0] : r.customers;
      return (
        c?.name?.toLowerCase().includes(needle) ||
        c?.email?.toLowerCase().includes(needle)
      );
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            All confirmed appointments for your tenant.
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Status</span>
          <select
            name="status"
            defaultValue={status}
            className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-950"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Provider</span>
          <select
            name="provider"
            defaultValue={providerId ?? "all"}
            className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-950"
          >
            <option value="all">All</option>
            {(providersRes.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Search (name or email)</span>
          <input
            name="q"
            defaultValue={q}
            className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="ada@example.com"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Apply
        </button>
      </form>

      {bookingsRes.error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {bookingsRes.error.message}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Service</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                  No bookings.
                </td>
              </tr>
            ) : (
              rows.map((b) => {
                const c = Array.isArray(b.customers) ? b.customers[0] : b.customers;
                const s = Array.isArray(b.services) ? b.services[0] : b.services;
                const p = Array.isArray(b.providers) ? b.providers[0] : b.providers;
                return (
                  <tr
                    key={b.id}
                    className="border-t border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                  >
                    <td className="px-3 py-2">
                      <Link href={`/admin/bookings/${b.id}`} className="hover:underline">
                        {fmtDateTime(b.starts_at)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        {c?.name ? (
                          <Link href={`/admin/customers/${b.customer_id}`} className="hover:underline">
                            {c.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </div>
                      <div className="text-xs text-neutral-500">{c?.email}</div>
                    </td>
                    <td className="px-3 py-2">{s?.name ?? "—"}</td>
                    <td className="px-3 py-2">{p?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs " +
                          (b.status === "confirmed"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                            : b.status === "canceled"
                              ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                              : b.status === "completed"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                                : b.status === "no_show"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                  : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300")
                        }
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(b.price_cents)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
