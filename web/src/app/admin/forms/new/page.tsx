/**
 * New form page — uses the same builder as edit, but with no initial schema.
 */
import Link from "next/link";
import { requireTenant } from "@/lib/admin/require-tenant";
import { FormBuilder } from "../form-builder";
import { FORM_TEMPLATES, getFormTemplate } from "@/lib/forms/templates";

export default async function NewFormPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  await requireTenant();
  const { template: templateSlug } = await searchParams;
  const template = getFormTemplate(templateSlug);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New intake form</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Start blank or load a starter template. Your first save publishes version 1.
        </p>
      </div>
      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
        <p className="text-sm font-medium text-neutral-900">Starter templates</p>
        <p className="mt-1 text-sm text-neutral-600">
          Choose a template to prefill the builder with a common med-spa workflow.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Link
            href="/admin/forms/new"
            className={`rounded-lg border px-4 py-3 text-left transition hover:bg-neutral-50 ${
              template ? "border-neutral-200" : "border-neutral-900 bg-neutral-50"
            }`}
          >
            <p className="text-sm font-medium text-neutral-900">Blank form</p>
            <p className="mt-1 text-xs text-neutral-600">Start from scratch.</p>
          </Link>
          {FORM_TEMPLATES.map((item) => {
            const active = template?.slug === item.slug;
            return (
              <Link
                key={item.slug}
                href={`/admin/forms/new?template=${item.slug}`}
                className={`rounded-lg border px-4 py-3 text-left transition hover:bg-neutral-50 ${
                  active ? "border-neutral-900 bg-neutral-50" : "border-neutral-200"
                }`}
              >
                <p className="text-sm font-medium text-neutral-900">{item.name}</p>
                <p className="mt-1 text-xs text-neutral-600">{item.summary}</p>
              </Link>
            );
          })}
        </div>
      </div>
      <FormBuilder
        defaultName={template?.name ?? ""}
        defaultDescription={template?.description ?? ""}
        defaultFields={template?.schema.fields ?? []}
      />
    </div>
  );
}
