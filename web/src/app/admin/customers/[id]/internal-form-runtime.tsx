"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteInternalCustomerFormAttachmentAction,
  submitInternalCustomerFormResponseAction,
  uploadInternalCustomerFormAttachmentAction,
} from "./internal-form-actions";
import {
  DEFAULT_MAX_UPLOAD_FILES,
  normalizeAttachmentAnswers,
  normalizeFileUploadConfig,
  validateAnswers,
  type AttachmentAnswer,
  type FileUploadAnswer,
  type FormField,
  type FormSchema,
} from "@/lib/forms/schema";

const FIELD_SURFACE_CLASS = "rounded-md border border-neutral-200 bg-white p-4";
const INPUT_CLASS =
  "mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-neutral-900";

export function InternalCustomerFormRuntime({
  customerId,
  customerName,
  form,
}: {
  customerId: string;
  customerName: string;
  form: {
    id: string;
    versionId: string;
    name: string;
    description: string | null;
    schema: FormSchema;
  };
}) {
  const router = useRouter();
  const [uploadSessionId] = useState(() => crypto.randomUUID());
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setAnswer(id: string, value: unknown) {
    setAnswers((current) => ({ ...current, [id]: value }));
    if (errors[id]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);

    const validation = validateAnswers(form.schema, answers);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }

    startTransition(async () => {
      const result = await submitInternalCustomerFormResponseAction({
        customerId,
        formId: form.id,
        formVersionId: form.versionId,
        uploadSessionId,
        answersJson: JSON.stringify(answers),
      });

      if (!result.ok) {
        setServerError(result.error ?? "Failed to save form");
        return;
      }

      router.replace(`/admin/customers/${customerId}`);
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-5">
      <div className="flex flex-col gap-3 border-b border-neutral-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Internal form</p>
          <h2 className="mt-1 text-xl font-semibold text-neutral-950">{form.name}</h2>
          <p className="mt-1 text-sm text-neutral-600">
            {form.description?.trim()
              ? form.description
              : `Fill this staff-only form for ${customerName}. Responses stay on the customer profile.`}
          </p>
        </div>
        <Link
          href={`/admin/customers/${customerId}`}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-white"
        >
          Cancel
        </Link>
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {form.schema.fields.map((field) => (
          <FieldRenderer
            key={field.id}
            field={field}
            value={answers[field.id]}
            error={errors[field.id]}
            onChange={(nextValue) => setAnswer(field.id, nextValue)}
            customerId={customerId}
            formId={form.id}
            formVersionId={form.versionId}
            uploadSessionId={uploadSessionId}
          />
        ))}

        {serverError ? <p className="text-sm text-red-600">{serverError}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save to customer profile"}
          </button>
          <p className="text-xs text-neutral-500">Only staff can see internal forms and their responses.</p>
        </div>
      </form>
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  error,
  onChange,
  customerId,
  formId,
  formVersionId,
  uploadSessionId,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  customerId: string;
  formId: string;
  formVersionId: string;
  uploadSessionId: string;
}) {
  const label = (
    <span className="block text-sm font-medium text-neutral-900">
      {field.label}
      {field.required ? <span className="ml-1 text-red-600">*</span> : null}
    </span>
  );

  const helpText = field.help_text ? (
    <p className="mt-2 text-xs leading-5 text-neutral-500">{field.help_text}</p>
  ) : null;

  const errorText = error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null;

  switch (field.type) {
    case "section":
      return (
        <div className="rounded-md border border-neutral-900 bg-neutral-900 px-4 py-4 text-white">
          <h3 className="text-lg font-semibold">{field.label}</h3>
          {field.body ? <p className="mt-2 text-sm leading-6 text-neutral-300">{field.body}</p> : null}
        </div>
      );
    case "static_text":
      return (
        <div className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-neutral-600">
          {field.body}
        </div>
      );
    case "short_text":
      return (
        <label className={FIELD_SURFACE_CLASS}>
          {label}
          <input
            type="text"
            value={(value as string) ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className={INPUT_CLASS}
          />
          {helpText}
          {errorText}
        </label>
      );
    case "long_text":
      return (
        <label className={FIELD_SURFACE_CLASS}>
          {label}
          <textarea
            value={(value as string) ?? ""}
            onChange={(event) => onChange(event.target.value)}
            rows={5}
            className={INPUT_CLASS}
          />
          {helpText}
          {errorText}
        </label>
      );
    case "number":
      return (
        <label className={FIELD_SURFACE_CLASS}>
          {label}
          <input
            type="number"
            value={(value as string | number | undefined) ?? ""}
            min={field.min}
            max={field.max}
            onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
            className={INPUT_CLASS}
          />
          {helpText}
          {errorText}
        </label>
      );
    case "date":
      return (
        <label className={FIELD_SURFACE_CLASS}>
          {label}
          <input
            type="date"
            value={(value as string) ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className={INPUT_CLASS}
          />
          {helpText}
          {errorText}
        </label>
      );
    case "select":
      return (
        <label className={FIELD_SURFACE_CLASS}>
          {label}
          <select
            value={(value as string) ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">- Select -</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {helpText}
          {errorText}
        </label>
      );
    case "multi_select": {
      const values = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className={FIELD_SURFACE_CLASS}>
          <legend className="block text-sm font-medium text-neutral-900">
            {field.label}
            {field.required ? <span className="ml-1 text-red-600">*</span> : null}
          </legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {field.options?.map((option) => {
              const checked = values.includes(option);
              return (
                <label
                  key={option}
                  className={
                    "flex items-start gap-3 rounded-md border px-3 py-3 text-sm transition " +
                    (checked
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400")
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const nextValues = event.target.checked
                        ? [...values, option]
                        : values.filter((entry) => entry !== option);
                      onChange(nextValues);
                    }}
                    className="mt-1 accent-neutral-900"
                  />
                  <span>{option}</span>
                </label>
              );
            })}
          </div>
          {helpText}
          {errorText}
        </fieldset>
      );
    }
    case "checkbox":
      return (
        <div className={FIELD_SURFACE_CLASS}>
          <label className="flex items-start gap-3 text-sm leading-6 text-neutral-700">
            <input
              type="checkbox"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
              className="mt-1 accent-neutral-900"
            />
            <span>
              <span className="font-medium text-neutral-900">{field.label}</span>
              {field.required ? <span className="ml-1 text-red-600">*</span> : null}
            </span>
          </label>
          {helpText}
          {errorText}
        </div>
      );
    case "yes_no":
      return (
        <fieldset className={FIELD_SURFACE_CLASS}>
          <legend className="block text-sm font-medium text-neutral-900">
            {field.label}
            {field.required ? <span className="ml-1 text-red-600">*</span> : null}
          </legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(["yes", "no"] as const).map((choice) => {
              const checked = value === choice;
              return (
                <label
                  key={choice}
                  className={
                    "flex items-center gap-3 rounded-md border px-3 py-3 text-sm transition " +
                    (checked
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400")
                  }
                >
                  <input
                    type="radio"
                    name={field.id}
                    checked={checked}
                    onChange={() => onChange(choice)}
                    className="accent-neutral-900"
                  />
                  {choice === "yes" ? "Yes" : "No"}
                </label>
              );
            })}
          </div>
          {helpText}
          {errorText}
        </fieldset>
      );
    case "file_upload":
      return (
        <div className={FIELD_SURFACE_CLASS}>
          {label}
          <div className="mt-2">
            <FileUploadField
              field={field}
              value={normalizeAttachmentAnswers(value)}
              onChange={onChange}
              customerId={customerId}
              formId={formId}
              formVersionId={formVersionId}
              uploadSessionId={uploadSessionId}
            />
          </div>
          {helpText}
          {errorText}
        </div>
      );
    case "signature":
      return (
        <div className={FIELD_SURFACE_CLASS}>
          {label}
          <div className="mt-2">
            <SignatureField
              field={field}
              value={normalizeAttachmentAnswers(value)[0]}
              onChange={onChange}
              customerId={customerId}
              formId={formId}
              formVersionId={formVersionId}
              uploadSessionId={uploadSessionId}
            />
          </div>
          {helpText}
          {errorText}
        </div>
      );
  }
}

function FileUploadField({
  field,
  value,
  onChange,
  customerId,
  formId,
  formVersionId,
  uploadSessionId,
}: {
  field: FormField;
  value: FileUploadAnswer;
  onChange: (value: unknown) => void;
  customerId: string;
  formId: string;
  formVersionId: string;
  uploadSessionId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadKind, maxFiles } = normalizeFileUploadConfig(field);
  const remainingSlots = Math.max(0, maxFiles - value.length);
  const accept =
    uploadKind === "document"
      ? "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
      : "image/jpeg,image/png,image/webp,image/heic,image/heif";

  async function handleFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    if (files.length > remainingSlots) {
      setError(
        remainingSlots > 0
          ? `You can add ${remainingSlots} more file${remainingSlots === 1 ? "" : "s"} to this field.`
          : `You can upload up to ${maxFiles} file${maxFiles === 1 ? "" : "s"} for this field.`
      );
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      return;
    }

    setError(null);
    setUploading(true);
    const uploaded: AttachmentAnswer[] = [];

    for (const file of files) {
      const formData = new FormData();
      formData.append("customerId", customerId);
      formData.append("formId", formId);
      formData.append("formVersionId", formVersionId);
      formData.append("uploadSessionId", uploadSessionId);
      formData.append("fieldId", field.id);
      formData.append("kind", "file");
      formData.append("file", file);

      const result = await uploadInternalCustomerFormAttachmentAction(formData);
      if (!result.ok || !result.attachment) {
        setUploading(false);
        setError(result.error ?? "Upload failed");
        if (uploaded.length > 0) {
          onChange([...value, ...uploaded]);
        }
        if (inputRef.current) {
          inputRef.current.value = "";
        }
        return;
      }

      uploaded.push({
        attachment_id: result.attachment.id,
        filename: result.attachment.filename,
      });
    }

    setUploading(false);
    onChange([...value, ...uploaded]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  async function removeAttachment(attachmentId: string) {
    setError(null);
    const formData = new FormData();
    formData.append("attachmentId", attachmentId);
    formData.append("customerId", customerId);
    formData.append("uploadSessionId", uploadSessionId);

    const result = await deleteInternalCustomerFormAttachmentAction(formData);
    if (!result.ok) {
      setError(result.error ?? "Could not remove file");
      return;
    }

    onChange(value.filter((entry) => entry.attachment_id !== attachmentId));
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-md border border-dashed border-neutral-300 bg-white px-4 py-4 text-sm">
      {value.length > 0 ? (
        <div className="mb-3 space-y-2">
          {value.map((attachment, index) => (
            <div
              key={attachment.attachment_id}
              className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-3"
            >
              <span className="truncate text-neutral-700">
                {attachment.filename ?? `Upload ${index + 1}`}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(attachment.attachment_id)}
                disabled={uploading}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple={maxFiles > 1}
        accept={accept}
        disabled={uploading || remainingSlots <= 0}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) {
            void handleFiles(files);
          }
        }}
        className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700"
      />

      <p className="mt-2 text-xs leading-5 text-neutral-500">
        {uploadKind === "document" ? "Images or PDF" : "Images only"}. Up to {maxFiles || DEFAULT_MAX_UPLOAD_FILES} file{maxFiles === 1 ? "" : "s"}.
      </p>
      {uploading ? <p className="mt-2 text-xs text-neutral-500">Uploading...</p> : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function SignatureField({
  field,
  value,
  onChange,
  customerId,
  formId,
  formVersionId,
  uploadSessionId,
}: {
  field: FormField;
  value: AttachmentAnswer | undefined;
  onChange: (value: unknown) => void;
  customerId: string;
  formId: string;
  formVersionId: string;
  uploadSessionId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.strokeStyle = "#111";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, rect.width, rect.height);
  }, []);

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();

    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (value?.attachment_id) {
      return;
    }

    const context = canvasRef.current?.getContext("2d");
    const point = getPoint(event);
    if (context) {
      context.fillStyle = "#111";
      context.beginPath();
      context.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
      context.fill();
    }

    drawingRef.current = true;
    lastPointRef.current = point;
    setError(null);
    if (empty) {
      setEmpty(false);
    }
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) {
      return;
    }

    const context = canvasRef.current?.getContext("2d");
    if (!context || !lastPointRef.current) {
      return;
    }

    const point = getPoint(event);
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
    if (empty) {
      setEmpty(false);
    }
  }

  function end() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  async function clearSavedSignature() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    if (value?.attachment_id) {
      const formData = new FormData();
      formData.append("attachmentId", value.attachment_id);
      formData.append("customerId", customerId);
      formData.append("uploadSessionId", uploadSessionId);
      const result = await deleteInternalCustomerFormAttachmentAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Could not remove signature");
        return;
      }
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    context.fillStyle = "#fff";
    context.fillRect(0, 0, rect.width, rect.height);
    setEmpty(true);
    setError(null);
    onChange(undefined);
  }

  async function saveSignature() {
    const canvas = canvasRef.current;
    if (!canvas || empty) {
      setError("Please sign first");
      return;
    }

    setError(null);
    setUploading(true);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((capturedBlob) => resolve(capturedBlob), "image/png")
    );
    if (!blob) {
      setUploading(false);
      setError("Could not capture signature");
      return;
    }

    const file = new File([blob], "signature.png", { type: "image/png" });
    const formData = new FormData();
    formData.append("customerId", customerId);
    formData.append("formId", formId);
    formData.append("formVersionId", formVersionId);
    formData.append("uploadSessionId", uploadSessionId);
    formData.append("fieldId", field.id);
    formData.append("kind", "signature_png");
    formData.append("file", file);

    const result = await uploadInternalCustomerFormAttachmentAction(formData);
    setUploading(false);
    if (!result.ok || !result.attachment) {
      setError(result.error ?? "Upload failed");
      return;
    }

    onChange({ attachment_id: result.attachment.id, filename: result.attachment.filename });
  }

  const locked = Boolean(value?.attachment_id);

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{ width: "100%", height: 160, touchAction: "none" }}
        className={`h-40 w-full rounded-md border bg-white ${
          locked ? "border-neutral-300 opacity-70" : "border-neutral-400"
        }`}
      />

      <p className="text-xs text-neutral-500">Draw with your finger or mouse, then save the signature.</p>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {locked ? (
          <span className="rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-800">Saved</span>
        ) : null}

        <button
          type="button"
          onClick={() => void saveSignature()}
          disabled={uploading || locked}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {uploading ? "Saving..." : locked ? "Saved" : "Save signature"}
        </button>

        <button
          type="button"
          onClick={() => void clearSavedSignature()}
          disabled={uploading}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}