"use client";

import { useState } from "react";
import { archiveServiceAction, restoreServiceAction } from "./actions";
import { ServiceForm, type LocationOption, type ServiceRow } from "./service-form";
import { ServiceFormsEditor } from "./service-forms-editor";

type ServiceWithForms = ServiceRow & { form_ids: string[] };

export function ServicesList({
  services,
  forms,
  defaultDepositCents,
  locations,
}: {
  services: ServiceWithForms[];
  forms: { id: string; name: string }[];
  defaultDepositCents: number;
  locations: LocationOption[];
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [formsOpenId, setFormsOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Services ({services.length})</h2>
        <button
          type="button"
          onClick={() => setEditingId(editingId === "new" ? null : "new")}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {editingId === "new" ? "Close" : "Add service"}
        </button>
      </div>

      {editingId === "new" && (
        <ServiceForm
          defaultDepositCents={defaultDepositCents}
          locations={locations}
          onDone={() => setEditingId(null)}
        />
      )}

      {services.length === 0 && editingId !== "new" && (
        <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No services yet. Add your first one to get started.
        </p>
      )}

      <ul className="space-y-3">
        {services.map((s) => (
          <li
            key={s.id}
            className="rounded-md border border-neutral-200 dark:border-neutral-800"
          >
            {editingId === s.id ? (
              <div className="p-2">
                <ServiceForm service={s} locations={locations} onDone={() => setEditingId(null)} />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{s.name}</span>
                    {!s.is_active && (
                      <span className="text-xs rounded bg-neutral-200 px-1.5 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                        archived
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400">
                    {s.duration_minutes} min · ${(s.price_cents / 100).toFixed(2)}
                    {s.deposit_cents > 0 && ` · $${(s.deposit_cents / 100).toFixed(2)} deposit`}
                    {` · ${s.location_ids.length} location${s.location_ids.length === 1 ? "" : "s"}`}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setFormsOpenId(formsOpenId === s.id ? null : s.id);
                      setEditingId(null);
                    }}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Forms ({s.form_ids.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(s.id);
                      setFormsOpenId(null);
                    }}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Edit
                  </button>
                  <form action={s.is_active ? archiveServiceAction : restoreServiceAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                    >
                      {s.is_active ? "Archive" : "Restore"}
                    </button>
                  </form>
                </div>
              </div>
            )}
            {formsOpenId === s.id && editingId !== s.id ? (
              <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
                <ServiceFormsEditor
                  serviceId={s.id}
                  forms={forms}
                  initialFormIds={s.form_ids}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
