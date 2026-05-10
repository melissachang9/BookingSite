/**
 * New form page — uses the same builder as edit, but with no initial schema.
 */
import { requireTenant } from "@/lib/admin/require-tenant";
import { FormBuilder } from "../form-builder";

export default async function NewFormPage() {
  await requireTenant();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New intake form</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Add fields, then save. Your first save publishes version 1.
        </p>
      </div>
      <FormBuilder />
    </div>
  );
}
