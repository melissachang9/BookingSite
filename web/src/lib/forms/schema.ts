/**
 * Shared form-schema types for the intake form builder + runtime.
 */

export type FormFieldType = "short_text" | "long_text" | "select" | "checkbox";

export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  /** Only used when type === "select". */
  options?: string[];
  help_text?: string;
};

export type FormSchema = {
  fields: FormField[];
};

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  select: "Dropdown",
  checkbox: "Checkbox",
};

/** Generate a stable-ish id for a new field. */
export function newFieldId() {
  return "f_" + Math.random().toString(36).slice(2, 10);
}

/**
 * Validate a customer's answers against a form schema.
 * Returns { ok, errors } where errors maps field_id -> message.
 */
export function validateAnswers(
  schema: FormSchema,
  answers: Record<string, unknown>
): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  for (const f of schema.fields) {
    const v = answers[f.id];
    if (f.required) {
      if (f.type === "checkbox") {
        if (v !== true) errors[f.id] = "Required";
      } else if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
        errors[f.id] = "Required";
      }
    }
    if (f.type === "select" && v !== undefined && v !== null && v !== "") {
      if (!f.options?.includes(String(v))) {
        errors[f.id] = "Invalid option";
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
