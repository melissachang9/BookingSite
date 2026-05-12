import Link from "next/link";
import { requireTenant } from "@/lib/admin/require-tenant";

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const metadata = { title: "Customers — BookingSite" };

export default async function CustomersPage() {
  const { supabase, tenantId } = await requireTenant();

  const [customersRes, bookingsRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, email, phone, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("bookings")
      .select("id, customer_id, starts_at, status")
      .eq("tenant_id", tenantId)
      .order("starts_at", { ascending: false }),
  ]);

  const customers = customersRes.data ?? [];
  const bookings = bookingsRes.data ?? [];
  const now = new Date();

  const metricsByCustomer = new Map<
    string,
    { count: number; latestAt: string | null; nextUpcomingAt: string | null }
  >();

  for (const booking of bookings) {
    const current = metricsByCustomer.get(booking.customer_id) ?? {
      count: 0,
      latestAt: null,
      nextUpcomingAt: null,
    };
    current.count += 1;
    if (!current.latestAt || new Date(booking.starts_at) > new Date(current.latestAt)) {
      current.latestAt = booking.starts_at;
    }
    if (
      booking.status === "confirmed" &&
      new Date(booking.starts_at) >= now &&
      (!current.nextUpcomingAt || new Date(booking.starts_at) < new Date(current.nextUpcomingAt))
    ) {
      current.nextUpcomingAt = booking.starts_at;
    }
    metricsByCustomer.set(booking.customer_id, current);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Browse customer records and open their profile pages.
        </p>
      </div>

      {customersRes.error ? (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {customersRes.error.message}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Bookings</th>
              <th className="px-3 py-2">Last booking</th>
              <th className="px-3 py-2">Next upcoming</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                  No customers yet.
                </td>
              </tr>
            ) : (
              customers.map((customer) => {
                const metrics = metricsByCustomer.get(customer.id);
                return (
                  <tr
                    key={customer.id}
                    className="border-t border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                  >
                    <td className="px-3 py-2">
                      <Link href={`/admin/customers/${customer.id}`} className="font-medium hover:underline">
                        {customer.name}
                      </Link>
                      <div className="text-xs text-neutral-500">{customer.email}</div>
                    </td>
                    <td className="px-3 py-2">{customer.phone ?? "—"}</td>
                    <td className="px-3 py-2">{metrics?.count ?? 0}</td>
                    <td className="px-3 py-2 text-neutral-600">
                      {metrics?.latestAt ? fmtDateTime(metrics.latestAt) : "—"}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">
                      {metrics?.nextUpcomingAt ? fmtDateTime(metrics.nextUpcomingAt) : "—"}
                    </td>
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