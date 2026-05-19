"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/admin/action-state";
import { setServiceFormsAction } from "../forms/actions";

/**
 * Inline editor for the set of customer-facing forms required for a service.
 * Submits a multipart form with form_ids[] checkboxes.
 */
export function ServiceFormsEditor({
  serviceId,
  forms,
  initialFormIds,
}: {
  serviceId: string;
  forms: { id: string; name: string }[];
  initialFormIds: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialFormIds));
  const [state, formAction, pending] = useActionState(setServiceFormsAction, initialActionState);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (forms.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        No active forms.{" "}
        <Link href="/admin/forms/new" className="underline">
          Create a customer form
        </Link>{" "}
        to require it before booking this service.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="service_id" value={serviceId} />
      <p className="text-sm font-medium">Required customer forms before booking</p>
      <ul className="space-y-1">
        {forms.map((f) => (
          <li key={f.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="form_ids"
                value={f.id}
                checked={selected.has(f.id)}
                onChange={() => toggle(f.id)}
              />
              {f.name}
            </label>
          </li>
        ))}
      </ul>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700">{state.success}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
