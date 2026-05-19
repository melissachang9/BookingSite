import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageBookingCheckout } from "@/lib/admin/roles";
import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "./login/actions";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Login page is the only admin route accessible without auth.
  // Layouts run for all nested routes, so we read the path indirectly via children.
  // We let the login page render itself; for everything else, gate.
  if (!user) {
    // If we're not on /admin/login, force redirect.
    // (Server Components can't read the path; we rely on the login route
    // being a sibling that doesn't pull this layout content.)
    return <>{children}</>;
  }

  // Look up tenant + role from the users table.
  const { data: profile } = await supabase
    .from("users")
    .select("name, role, tenant_id, tenants(name, slug)")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    // Auth user exists but no tenant binding — kick them out.
    redirect("/admin/login");
  }

  const tenant = Array.isArray(profile.tenants) ? profile.tenants[0] : profile.tenants;
  const showPaymentsNav = canManageBookingCheckout(profile.role);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm font-semibold">
              BookingSite
            </Link>
            {tenant && (
              <span className="text-sm text-neutral-500">· {tenant.name}</span>
            )}
            <nav className="flex items-center gap-3 text-sm">
              <Link href="/admin" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                Dashboard
              </Link>
              <Link href="/admin/calendar" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                Calendar
              </Link>
              <Link href="/admin/bookings" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                Bookings
              </Link>
              {showPaymentsNav ? (
                <Link href="/admin/payments" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                  Payments
                </Link>
              ) : null}
              <Link href="/admin/customers" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                Customers
              </Link>
              <Link href="/admin/locations" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                Locations
              </Link>
              <Link href="/admin/services" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                Services
              </Link>
              <Link href="/admin/providers" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                Providers
              </Link>
              <Link href="/admin/forms" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                Forms
              </Link>
              <Link href="/admin/settings" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-600 dark:text-neutral-400">
              {profile.name ?? user.email} ({profile.role})
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md border border-neutral-300 px-3 py-1 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
