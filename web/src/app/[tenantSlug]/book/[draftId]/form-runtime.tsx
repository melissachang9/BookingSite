"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitFormResponseAction } from "./actions";
import {
  validateAnswers,
  type FormField,
  type FormSchema,
} from "@/lib/forms/schema";

/**
 * Renders a single intake form requirement and submits answers.
 * After a successful submit we refresh the page so the next requirement (or contact
 * details form) renders.
 */
export function FormRuntime({
  draftId,
  requirement,
  totalPending,
}: {
  draftId: string;
  requirement: {
    id: string;
    formName: string;
    schema: FormSchema;
  };
  totalPending: number;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setAnswer(id: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    if (errors[id]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    const v = validateAnswers(requirement.schema, answers);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    startTransition(async () => {
      const res = await submitFormResponseAction({
        draftId,
        requirementId: requirement.id,
        answersJson: JSON.stringify(answers),
      });
      if (!res.ok) {
        setServerError(res.error ?? "Failed to submit form");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-neutral-200 bg-white p-5">
      <div className="border-b border-neutral-200 pb-3">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Step {totalPending > 1 ? `1 of ${totalPending} forms` : "Required form"}
        </p>
        <h2 className="mt-1 text-lg font-semibold">{requirement.formName}</h2>
      </div>

      {requirement.schema.fields.map((field) => (
        <FieldRenderer
          key={field.id}
          field={field}
          value={answers[field.id]}
          error={errors[field.id]}
          onChange={(v) => setAnswer(field.id, v)}
        />
      ))}

      {serverError ? <p className="text-sm text-red-600">{serverError}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Submit form"}
      </button>
    </form>
  );
}

function FieldRenderer({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const labelEl = (
    <span className="mb-1 block text-sm font-medium text-neutral-700">
      {field.label}
      {field.required ? <span className="ml-0.5 text-red-600">*</span> : null}
    </span>
  );
  const errorEl = error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null;

  switch (field.type) {
    case "short_text":
      return (
        <label className="block">
          {labelEl}
          <input
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          {errorEl}
        </label>
      );
    case "long_text":
      return (
        <label className="block">
          {labelEl}
          <textarea
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          {errorEl}
        </label>
      );
    case "select":
      return (
        <label className="block">
          {labelEl}
          <select
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">— Select —</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {errorEl}
        </label>
      );
    case "checkbox":
      return (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-1"
          />
          <span>
            {field.label}
            {field.required ? <span className="ml-0.5 text-red-600">*</span> : null}
          </span>
          {errorEl}
        </label>
      );
  }
}
