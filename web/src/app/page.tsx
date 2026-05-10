import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          BookingSite
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400">
          Modern booking + intake for beauty studios, med spas, and wellness
          businesses. One flow for booking, intake forms, and deposits.
        </p>
        <div className="flex items-center justify-center gap-3 pt-4">
          <Link
            href="/admin/login"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Operator login
          </Link>
          <Link
            href="/brow-beauty-lab"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            View demo tenant
          </Link>
        </div>
        <p className="text-xs text-neutral-500 pt-8">
          Phase 0 — foundations. First tenant: Brow Beauty Lab.
        </p>
      </div>
    </main>
  );
}
