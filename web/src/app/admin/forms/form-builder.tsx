"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/admin/action-state";
import { upsertFormAction } from "./actions";
import {
  FIELD_TYPE_LABELS,
  type FormField,
  type FormFieldType,
  newFieldId,
} from "@/lib/forms/schema";

export function FormBuilder({
  formId,
  defaultName = "",
  defaultDescription = "",
  defaultFields = [],
}: {
  formId?: string;
  defaultName?: string;
  defaultDescription?: string;
  defaultFields?: FormField[];
}) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription);
  const [fields, setFields] = useState<FormField[]>(defaultFields);
  const [state, formAction, pending] = useActionState(upsertFormAction, initialActionState);

  function addField(type: FormFieldType) {
    setFields((prev) => [
      ...prev,
      {
        id: newFieldId(),
        type,
        label: "",
        required: false,
        ...(type === "select" ? { options: ["Option 1"] } : {}),
      },
    ]);
  }

  function updateField(id: string, patch: Partial<FormField>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }

  function moveField(id: string, dir: -1 | 1) {
    setFields((prev) => {
      const i = prev.findIndex((f) => f.id === id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-6">
      {formId ? <input type="hidden" name="id" value={formId} /> : null}
      <input type="hidden" name="fields_json" value={JSON.stringify(fields)} />

      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Form name</span>
          <input
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            placeholder="e.g. Brow Lamination Intake"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Description (optional)</span>
          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-5 py-3">
          <p className="text-sm font-medium">Fields</p>
        </div>
        {fields.length === 0 ? (
          <p className="px-5 py-6 text-sm text-neutral-500">
            No fields yet. Add one below.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {fields.map((f, i) => (
              <li key={f.id} className="space-y-3 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2 text-xs text-neutral-500">
                      <span className="rounded bg-neutral-100 px-2 py-0.5 font-medium">
                        {FIELD_TYPE_LABELS[f.type]}
                      </span>
                    </div>
                    <input
                      value={f.label}
                      onChange={(e) => updateField(f.id, { label: e.target.value })}
                      placeholder="Field label"
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    />
                    {f.type === "select" ? (
                      <SelectOptionsEditor
                        options={f.options ?? []}
                        onChange={(options) => updateField(f.id, { options })}
                      />
                    ) : null}
                    <label className="flex items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={f.required}
                        onChange={(e) => updateField(f.id, { required: e.target.checked })}
                      />
                      Required
                    </label>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => moveField(f.id, -1)}
                      disabled={i === 0}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(f.id, 1)}
                      disabled={i === fields.length - 1}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeField(f.id)}
                      className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 border-t border-neutral-200 px-5 py-3">
          {(Object.keys(FIELD_TYPE_LABELS) as FormFieldType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => addField(t)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
            >
              + {FIELD_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700">{state.success}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save form"}
      </button>
    </form>
  );
}

function SelectOptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-xs font-medium text-neutral-600">Options</p>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={opt}
            onChange={(e) => {
              const next = [...options];
              next[i] = e.target.value;
              onChange(next);
            }}
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => onChange(options.filter((_, j) => j !== i))}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-100"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...options, ""])}
        className="rounded border border-neutral-300 bg-white px-3 py-1 text-xs hover:bg-neutral-100"
      >
        + Add option
      </button>
    </div>
  );
}
