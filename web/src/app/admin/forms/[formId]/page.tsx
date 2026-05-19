/**
 * Edit form page — loads current_version_id schema and renders the builder.
 */
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/admin/require-tenant";
import { FormBuilder } from "../form-builder";
import type { FormSchema } from "@/lib/forms/schema";

type Params = { formId: string };

export default async function EditFormPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { formId } = await params;
  const { supabase, tenantId } = await requireTenant();

  const { data: form } = await supabase
    .from("forms")
    .select("id, name, description, scope, customer_prompt_timing, current_version_id, tenant_id")
    .eq("id", formId)
    .maybeSingle();
  if (!form || form.tenant_id !== tenantId) notFound();

  let schema: FormSchema = { fields: [] };
  if (form.current_version_id) {
    const { data: version } = await supabase
      .from("form_versions")
      .select("schema_json, version_number")
      .eq("id", form.current_version_id)
      .maybeSingle();
    if (version?.schema_json) {
      schema = version.schema_json as FormSchema;
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{form.name}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Saving creates a new version. Past responses keep their original schema.
        </p>
      </div>
      <FormBuilder
        formId={form.id}
        defaultName={form.name}
        defaultDescription={form.description ?? ""}
        defaultScope={form.scope === "internal" ? "internal" : "customer"}
        defaultCustomerPromptTiming={
          form.customer_prompt_timing === "pre_visit" ||
          form.customer_prompt_timing === "post_visit"
            ? form.customer_prompt_timing
            : "pre_booking"
        }
        defaultFields={schema.fields}
      />
    </div>
  );
}
