/**
 * Shared form-schema types for the intake form builder + runtime.
 */

export type FormFieldType =
  | "short_text"
  | "long_text"
  | "select"
  | "multi_select"
  | "checkbox"
  | "yes_no"
  | "date"
  | "number"
  | "file_upload"
  | "signature"
  | "section"
  | "static_text";

export type FileUploadKind = "photo" | "document";

export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  /** Used by select / multi_select. */
  options?: string[];
  /** Help text shown beneath the label. */
  help_text?: string;
  /** Number-only constraints. */
  min?: number;
  max?: number;
  /** File-upload field mode. `photo` allows images only, `document` also allows PDF. */
  upload_kind?: FileUploadKind;
  /** File-upload field max number of attachments allowed. */
  max_files?: number;
  /** Static body — used by `section` (heading) and `static_text` (paragraph). */
  body?: string;
};

export type FormSchema = {
  fields: FormField[];
};

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  select: "Dropdown",
  multi_select: "Multi-select",
  checkbox: "Checkbox",
  yes_no: "Yes / No",
  date: "Date",
  number: "Number",
  file_upload: "File / photo upload",
  signature: "Signature",
  section: "Section heading",
  static_text: "Static text",
};

export const FILE_UPLOAD_KIND_LABELS: Record<FileUploadKind, string> = {
  photo: "Photo field",
  document: "Document field",
};

export const DEFAULT_FILE_UPLOAD_KIND: FileUploadKind = "photo";
export const DEFAULT_MAX_UPLOAD_FILES = 5;

/** Answer shape for a single uploaded file or signature asset. */
export type AttachmentAnswer = { attachment_id: string; filename?: string };

/** File upload fields can now store multiple uploaded assets. */
export type FileUploadAnswer = AttachmentAnswer[];

function isAttachmentAnswer(value: unknown): value is AttachmentAnswer {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { attachment_id?: unknown; filename?: unknown };
  return (
    typeof candidate.attachment_id === "string" &&
    (candidate.filename === undefined || typeof candidate.filename === "string")
  );
}

export function normalizeAttachmentAnswers(value: unknown): AttachmentAnswer[] {
  if (Array.isArray(value)) return value.filter(isAttachmentAnswer);
  return isAttachmentAnswer(value) ? [value] : [];
}

export function normalizeFileUploadConfig(field: FormField) {
  return {
    uploadKind:
      field.upload_kind === "document" ? field.upload_kind : DEFAULT_FILE_UPLOAD_KIND,
    maxFiles:
      typeof field.max_files === "number" && Number.isInteger(field.max_files) && field.max_files > 0
        ? field.max_files
        : DEFAULT_MAX_UPLOAD_FILES,
  };
}

/** Field types that do not capture an answer. */
export const DISPLAY_ONLY_TYPES: ReadonlySet<FormFieldType> = new Set<FormFieldType>([
  "section",
  "static_text",
]);

/** Generate a stable-ish id for a new field. */
export function newFieldId() {
  return "f_" + Math.random().toString(36).slice(2, 10);
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
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
    if (DISPLAY_ONLY_TYPES.has(f.type)) continue;
    const v = answers[f.id];

    if (f.required) {
      if (f.type === "checkbox") {
        if (v !== true) errors[f.id] = "Required";
      } else if (f.type === "multi_select") {
        if (!Array.isArray(v) || v.length === 0) errors[f.id] = "Required";
      } else if (f.type === "yes_no") {
        if (v !== "yes" && v !== "no") errors[f.id] = "Required";
      } else if (f.type === "file_upload" || f.type === "signature") {
        if (normalizeAttachmentAnswers(v).length === 0) errors[f.id] = "Required";
      } else if (isBlank(v)) {
        errors[f.id] = "Required";
      }
    }

    if (errors[f.id]) continue;

    if (f.type === "select" && !isBlank(v)) {
      if (!f.options?.includes(String(v))) errors[f.id] = "Invalid option";
    }
    if (f.type === "multi_select" && Array.isArray(v)) {
      const allowed = new Set(f.options ?? []);
      if (v.some((x) => !allowed.has(String(x)))) errors[f.id] = "Invalid option";
    }
    if (f.type === "yes_no" && !isBlank(v)) {
      if (v !== "yes" && v !== "no") errors[f.id] = "Invalid value";
    }
    if (f.type === "date" && !isBlank(v)) {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) errors[f.id] = "Invalid date";
    }
    if ((f.type === "file_upload" || f.type === "signature") && !isBlank(v)) {
      const attachments = normalizeAttachmentAnswers(v);
      if (attachments.length === 0) {
        errors[f.id] = "Invalid attachment";
      } else if (f.type === "signature" && attachments.length > 1) {
        errors[f.id] = "Only one signature is allowed";
      } else if (f.type === "file_upload") {
        const { maxFiles } = normalizeFileUploadConfig(f);
        if (attachments.length > maxFiles) {
          errors[f.id] = `You can upload up to ${maxFiles} file${maxFiles === 1 ? "" : "s"}`;
        }
      }
    }
    if (f.type === "number" && !isBlank(v)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(n)) {
        errors[f.id] = "Must be a number";
      } else {
        if (typeof f.min === "number" && n < f.min) errors[f.id] = `Must be ≥ ${f.min}`;
        else if (typeof f.max === "number" && n > f.max) errors[f.id] = `Must be ≤ ${f.max}`;
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Human-readable answer for admin views. */
export function formatAnswer(field: FormField, value: unknown): string {
  if (DISPLAY_ONLY_TYPES.has(field.type)) return "";
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "checkbox":
      return value === true ? "Yes" : "No";
    case "yes_no":
      return value === "yes" ? "Yes" : value === "no" ? "No" : "—";
    case "multi_select":
      return Array.isArray(value) ? value.map(String).join(", ") : "—";
    case "date":
      return new Date(String(value)).toLocaleDateString();
    case "file_upload": {
      const attachments = normalizeAttachmentAnswers(value);
      if (attachments.length === 0) return "—";
      return attachments.map((attachment) => attachment.filename ?? "Attachment").join(", ");
    }
    case "signature": {
      const attachment = normalizeAttachmentAnswers(value)[0];
      if (!attachment?.attachment_id) return "—";
      return attachment.filename ?? "Signature";
    }
    default:
      return String(value);
  }
}
