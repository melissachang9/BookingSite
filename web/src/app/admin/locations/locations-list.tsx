"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { initialActionState } from "@/lib/admin/action-state";
import {
  archiveLocationAction,
  restoreLocationAction,
  setDefaultLocationAction,
  upsertLocationAction,
} from "./actions";

export type LocationRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country_code: string | null;
  sort_order: number;
  is_active: boolean;
};

export function LocationsList({
  locations,
  defaultLocationId,
  canManage,
}: {
  locations: LocationRow[];
  defaultLocationId: string | null;
  canManage: boolean;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Locations ({locations.length})</h2>
          {!canManage ? (
            <p className="text-sm text-neutral-500">Your role can view locations, but cannot edit them.</p>
          ) : null}
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setEditingId(editingId === "new" ? null : "new")}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {editingId === "new" ? "Close" : "Add location"}
          </button>
        ) : null}
      </div>

      {editingId === "new" ? <LocationForm onDone={() => setEditingId(null)} /> : null}

      {locations.length === 0 && editingId !== "new" ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No locations yet. Add your first location before wiring providers and services across locations.
        </p>
      ) : null}

      <ul className="space-y-3">
        {locations.map((location) => {
          const isDefault = location.id === defaultLocationId;

          return (
            <li key={location.id} className="rounded-md border border-neutral-200 dark:border-neutral-800">
              {editingId === location.id ? (
                <div className="p-2">
                  <LocationForm location={location} onDone={() => setEditingId(null)} />
                </div>
              ) : (
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{location.name}</span>
                        {isDefault ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                            default
                          </span>
                        ) : null}
                        {!location.is_active ? (
                          <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                            archived
                          </span>
                        ) : null}
                      </div>
                      <div className="text-sm text-neutral-600 dark:text-neutral-400">
                        {location.slug} · {location.timezone} · sort {location.sort_order}
                      </div>
                      <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        {formatLocationSummary(location)}
                      </div>
                    </div>

                    {canManage ? (
                      <div className="flex shrink-0 gap-2">
                        {!isDefault ? (
                          <form action={setDefaultLocationAction}>
                            <input type="hidden" name="id" value={location.id} />
                            <button
                              type="submit"
                              disabled={!location.is_active}
                              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                            >
                              Set default
                            </button>
                          </form>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setEditingId(location.id)}
                          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                        >
                          Edit
                        </button>
                        <form action={location.is_active ? archiveLocationAction : restoreLocationAction}>
                          <input type="hidden" name="id" value={location.id} />
                          <button
                            type="submit"
                            disabled={isDefault && location.is_active}
                            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                          >
                            {location.is_active ? "Archive" : "Restore"}
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LocationForm({
  location,
  onDone,
}: {
  location?: LocationRow;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(upsertLocationAction, initialActionState);
  const lastSuccess = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      onDone?.();
    }
  }, [state.success, onDone]);

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      {location?.id ? <input type="hidden" name="id" value={location.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="name" defaultValue={location?.name} required maxLength={120} />
        <Field
          label="Slug"
          name="slug"
          defaultValue={location?.slug ?? ""}
          maxLength={120}
          placeholder="main-studio"
        />
        <Field
          label="Timezone"
          name="timezone"
          defaultValue={location?.timezone ?? "America/Los_Angeles"}
          required
          maxLength={120}
        />
        <Field
          label="Sort order"
          name="sort_order"
          type="number"
          min={0}
          max={9999}
          defaultValue={location?.sort_order ?? 0}
        />
        <Field label="Phone" name="phone" defaultValue={location?.phone ?? ""} maxLength={40} />
        <Field label="Email" name="email" type="email" defaultValue={location?.email ?? ""} maxLength={120} />
        <Field
          label="Address line 1"
          name="address_line1"
          defaultValue={location?.address_line1 ?? ""}
          maxLength={200}
        />
        <Field
          label="Address line 2"
          name="address_line2"
          defaultValue={location?.address_line2 ?? ""}
          maxLength={200}
        />
        <Field label="City" name="city" defaultValue={location?.city ?? ""} maxLength={120} />
        <Field
          label="State / region"
          name="state_region"
          defaultValue={location?.state_region ?? ""}
          maxLength={120}
        />
        <Field
          label="Postal code"
          name="postal_code"
          defaultValue={location?.postal_code ?? ""}
          maxLength={40}
        />
        <Field
          label="Country code"
          name="country_code"
          defaultValue={location?.country_code ?? ""}
          maxLength={2}
          placeholder="US"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_active" defaultChecked={location?.is_active ?? true} />
        Active
      </label>

      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-green-600">{state.success}</p> : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {pending ? "Saving..." : location?.id ? "Save changes" : "Create location"}
        </button>
        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

function Field({ label, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        {...rest}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
    </label>
  );
}

function formatLocationSummary(location: LocationRow) {
  const locality = [location.city, location.state_region].filter(Boolean).join(", ");
  const address = [location.address_line1, locality || null, location.country_code].filter(Boolean).join(" · ");
  const contact = [location.phone, location.email].filter(Boolean).join(" · ");

  if (address && contact) return `${address} · ${contact}`;
  if (address) return address;
  if (contact) return contact;
  return "No address or contact details yet.";
}