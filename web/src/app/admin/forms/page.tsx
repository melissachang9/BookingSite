/**
 * Forms list — shows all intake forms for this tenant, with quick actions.
 */
import Link from "next/link";
import { requireTenant } from "@/lib/admin/require-tenant";
import { archiveFormAction, restoreFormAction } from "./actions";

export default async function FormsPage() {
  const { supabase, tenantId } = await requireTenant();
  const { data: forms } = await supabase
    .from("forms")
    .select(
      "id, name, description, scope, customer_prompt_timing, is_archived, updated_at, current_version_id"
    )
    .eq("tenant_id", tenantId)
    .order("is_archived", { ascending: true })
    .order("updated_at", { ascending: false });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Forms</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Build customer-facing and internal forms from the same versioned builder.
          </p>
        </div>
        <Link
          href="/admin/forms/new"
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          New form
        </Link>
      </div>

      {!forms || forms.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-600">
          No forms yet. Create one to start collecting customer or staff form data.
        </div>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {forms.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div>
                <Link
                  href={`/admin/forms/${f.id}`}
                  className="font-medium hover:underline"
                >
                  {f.name}
                </Link>
                {f.description ? (
                  <p className="mt-0.5 text-sm text-neutral-600">{f.description}</p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5">
                    {f.scope === "internal" ? "Internal-only" : "Customer-facing"}
                  </span>
                  {f.scope === "customer" && f.customer_prompt_timing ? (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5">
                      {formatCustomerPromptTiming(f.customer_prompt_timing)}
                    </span>
                  ) : null}
                </div>
                {!f.current_version_id ? (
                  <p className="mt-1 text-xs text-amber-600">No published version yet</p>
                ) : null}
                {f.is_archived ? (
                  <p className="mt-1 text-xs text-neutral-500">Archived</p>
                ) : null}
              </div>
              <form action={f.is_archived ? restoreFormAction : archiveFormAction}>
                <input type="hidden" name="id" value={f.id} />
                <button
                  type="submit"
                  className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
                >
                  {f.is_archived ? "Restore" : "Archive"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatCustomerPromptTiming(value: string) {
  if (value === "pre_visit") return "Pre-visit";
  if (value === "post_visit") return "Post-visit";
  return "Pre-booking gate";
}
