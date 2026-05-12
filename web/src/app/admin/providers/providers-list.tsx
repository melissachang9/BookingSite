"use client";

import { useState } from "react";
import { archiveProviderAction, restoreProviderAction } from "./actions";
import {
  ProviderForm,
  ScheduleEditor,
  type LocationOption,
  type ProviderRow,
  type ServiceOption,
} from "./provider-form";

export function ProvidersList({
  providers,
  services,
  locations,
}: {
  providers: ProviderRow[];
  services: ServiceOption[];
  locations: LocationOption[];
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [openScheduleId, setOpenScheduleId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Providers ({providers.length})</h2>
        <button
          type="button"
          onClick={() => setEditingId(editingId === "new" ? null : "new")}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {editingId === "new" ? "Close" : "Add provider"}
        </button>
      </div>

      {editingId === "new" && (
        <ProviderForm services={services} locations={locations} onDone={() => setEditingId(null)} />
      )}

      {providers.length === 0 && editingId !== "new" && (
        <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No providers yet. Add the people who perform services.
        </p>
      )}

      <ul className="space-y-3">
        {providers.map((p) => (
          <li key={p.id} className="rounded-md border border-neutral-200 dark:border-neutral-800">
            {editingId === p.id ? (
              <div className="p-2">
                <ProviderForm
                  provider={p}
                  services={services}
                  locations={locations}
                  onDone={() => setEditingId(null)}
                />
              </div>
            ) : (
              <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{p.name}</span>
                      {!p.is_active && (
                        <span className="text-xs rounded bg-neutral-200 px-1.5 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          archived
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-neutral-600 dark:text-neutral-400">
                      {p.email ?? "—"} · {p.location_ids.length} location{p.location_ids.length === 1 ? "" : "s"} · {p.service_ids.length} service{p.service_ids.length === 1 ? "" : "s"} · {p.schedules.length} schedule block{p.schedules.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenScheduleId(openScheduleId === p.id ? null : p.id)
                      }
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                    >
                      Schedule
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(p.id)}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                    >
                      Edit
                    </button>
                    <form action={p.is_active ? archiveProviderAction : restoreProviderAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                      >
                        {p.is_active ? "Archive" : "Restore"}
                      </button>
                    </form>
                  </div>
                </div>
                {openScheduleId === p.id && <ScheduleEditor provider={p} locations={locations} />}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
