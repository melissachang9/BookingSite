"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteFormAttachmentAction,
  saveFormDraftProgressAction,
  submitFormResponseAction,
  uploadFormAttachmentAction,
} from "./actions";
import {
  DEFAULT_MAX_UPLOAD_FILES,
  normalizeFileUploadConfig,
  normalizeAttachmentAnswers,
  type AttachmentAnswer,
  type FileUploadAnswer,
  validateAnswers,
  type FormField,
  type FormSchema,
} from "@/lib/forms/schema";

const DISPLAY_FONT_STYLE = {
  fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
};

const FIELD_SURFACE_CLASS =
  "rounded-[1.5rem] border border-stone-200 bg-stone-50/80 p-5 shadow-sm";

const INPUT_CLASS =
  "mt-3 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 shadow-[0_12px_24px_rgba(40,23,9,0.06)] outline-none transition placeholder:text-stone-400 focus:border-stone-900";

/**
 * Renders a single intake form requirement and submits answers.
 * After a successful submit we refresh the page so the next requirement (or contact
 * details form) renders.
 */
export function FormRuntime({
  draftId,
  requirement,
  initialAnswers,
  initialSavedAt,
  totalPending,
}: {
  draftId: string;
  requirement: {
    id: string;
    formName: string;
    schema: FormSchema;
  };
  initialAnswers: Record<string, unknown>;
  initialSavedAt: string | null;
  totalPending: number;
}) {
  const router = useRouter();
  const initialAnswersJson = serializeAnswers(initialAnswers);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [draftSaveState, setDraftSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    initialSavedAt ? "saved" : "idle"
  );
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialSavedAt);
  const [pending, startTransition] = useTransition();
  const lastSavedAnswersRef = useRef(initialAnswersJson);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveRequestRef = useRef(0);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const answersJson = serializeAnswers(answers);

    if (answersJson === lastSavedAnswersRef.current || pending) {
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const requestId = ++autosaveRequestRef.current;
    saveTimeoutRef.current = setTimeout(async () => {
      setDraftSaveState("saving");
      const res = await saveFormDraftProgressAction({
        draftId,
        requirementId: requirement.id,
        answersJson,
      });

      if (requestId !== autosaveRequestRef.current) {
        return;
      }

      if (!res.ok) {
        setDraftSaveState("error");
        setDraftSaveError(res.error ?? "Could not save your progress");
        return;
      }

      lastSavedAnswersRef.current = answersJson;
      setDraftSaveError(null);
      setDraftSaveState("saved");
      setLastSavedAt(res.savedAt ?? new Date().toISOString());
    }, 600);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [answers, draftId, pending, requirement.id]);

  function setAnswer(id: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setDraftSaveError(null);
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
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const validation = validateAnswers(requirement.schema, answers);
    if (!validation.ok) {
      setErrors(validation.errors);
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
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            {totalPending > 1 ? `Form 1 of ${totalPending}` : "Required intake"}
          </p>
          <h2 className="mt-2 text-3xl tracking-[-0.03em] text-stone-950" style={DISPLAY_FONT_STYLE}>
            {requirement.formName}
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600 sm:text-base">
            Complete this intake before checkout so the provider has everything they need ahead of your appointment.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600 shadow-sm">
          <p>{totalPending > 1 ? `${totalPending} forms still pending` : "Submit once to continue"}</p>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            {draftSaveState === "saving"
              ? "Saving your progress..."
              : draftSaveState === "saved" && lastSavedAt
                ? `Saved ${formatDraftSavedAt(lastSavedAt)}`
                : draftSaveState === "error"
                  ? draftSaveError ?? "Could not save your progress"
                  : "Your answers will still be here if you refresh."}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {requirement.schema.fields.map((field) => (
          <FieldRenderer
            key={field.id}
            field={field}
            value={answers[field.id]}
            error={errors[field.id]}
            onChange={(nextValue) => setAnswer(field.id, nextValue)}
            draftId={draftId}
            requirementId={requirement.id}
          />
        ))}
      </div>

      {serverError ? <p className="text-sm text-red-600">{serverError}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-stone-900 px-5 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-stone-800 disabled:opacity-50"
      >
        {pending ? "Submitting..." : "Submit intake"}
      </button>
    </form>
  );
}

function serializeAnswers(value: Record<string, unknown>) {
  return JSON.stringify(value);
}

function formatDraftSavedAt(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function FieldRenderer({
  field,
  value,
  error,
  onChange,
  draftId,
  requirementId,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  draftId: string;
  requirementId: string;
}) {
  const labelEl = (
    <span className="block text-sm font-semibold text-stone-900">
      {field.label}
      {field.required ? <span className="ml-1 text-red-600">*</span> : null}
    </span>
  );
  const helpEl = field.help_text ? (
    <p className="mt-3 text-xs leading-5 text-stone-500">{field.help_text}</p>
  ) : null;
  const errorEl = error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null;

  switch (field.type) {
    case "section":
      return (
        <div className="rounded-[1.5rem] border border-stone-200 bg-stone-950 px-5 py-5 text-stone-100">
          <h3 className="text-xl tracking-[-0.03em]" style={DISPLAY_FONT_STYLE}>
            {field.label}
          </h3>
          {field.body ? <p className="mt-2 text-sm leading-6 text-stone-300">{field.body}</p> : null}
        </div>
      );
    case "static_text":
      return (
        <div className="rounded-[1.5rem] border border-stone-200 bg-white px-5 py-4 text-sm leading-7 whitespace-pre-wrap text-stone-600 shadow-sm">
          {field.body}
        </div>
      );
    case "short_text":
      return (
        <label className={FIELD_SURFACE_CLASS}>
          {labelEl}
          <input
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={INPUT_CLASS}
          />
          {helpEl}
          {errorEl}
        </label>
      );
    case "long_text":
      return (
        <label className={FIELD_SURFACE_CLASS}>
          {labelEl}
          <textarea
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            className={INPUT_CLASS}
          />
          {helpEl}
          {errorEl}
        </label>
      );
    case "number":
      return (
        <label className={FIELD_SURFACE_CLASS}>
          {labelEl}
          <input
            type="number"
            value={(value as string | number | undefined) ?? ""}
            min={field.min}
            max={field.max}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            className={INPUT_CLASS}
          />
          {helpEl}
          {errorEl}
        </label>
      );
    case "date":
      return (
        <label className={FIELD_SURFACE_CLASS}>
          {labelEl}
          <input
            type="date"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={INPUT_CLASS}
          />
          {helpEl}
          {errorEl}
        </label>
      );
    case "select":
      return (
        <label className={FIELD_SURFACE_CLASS}>
          {labelEl}
          <select
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">- Select -</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {helpEl}
          {errorEl}
        </label>
      );
    case "multi_select": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className={FIELD_SURFACE_CLASS}>
          <legend className="block text-sm font-semibold text-stone-900">
            {field.label}
            {field.required ? <span className="ml-1 text-red-600">*</span> : null}
          </legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {field.options?.map((opt) => {
              const checked = arr.includes(opt);
              return (
                <label
                  key={opt}
                  className={
                    "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition " +
                    (checked
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 bg-white text-stone-700 hover:border-stone-400")
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...arr, opt]
                        : arr.filter((item) => item !== opt);
                      onChange(next);
                    }}
                    className="mt-1 accent-stone-900"
                  />
                  <span>{opt}</span>
                </label>
              );
            })}
          </div>
          {helpEl}
          {errorEl}
        </fieldset>
      );
    }
    case "checkbox":
      return (
        <div className={FIELD_SURFACE_CLASS}>
          <label className="flex items-start gap-3 text-sm leading-6 text-stone-700">
            <input
              type="checkbox"
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              className="mt-1 accent-stone-900"
            />
            <span>
              <span className="font-semibold text-stone-900">{field.label}</span>
              {field.required ? <span className="ml-1 text-red-600">*</span> : null}
            </span>
          </label>
          {helpEl}
          {errorEl}
        </div>
      );
    case "yes_no":
      return (
        <fieldset className={FIELD_SURFACE_CLASS}>
          <legend className="block text-sm font-semibold text-stone-900">
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
                    "flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition " +
                    (checked
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 bg-white text-stone-700 hover:border-stone-400")
                  }
                >
                  <input
                    type="radio"
                    name={field.id}
                    checked={checked}
                    onChange={() => onChange(choice)}
                    className="accent-stone-900"
                  />
                  {choice === "yes" ? "Yes" : "No"}
                </label>
              );
            })}
          </div>
          {helpEl}
          {errorEl}
        </fieldset>
      );
    case "file_upload":
      return (
        <div className={FIELD_SURFACE_CLASS}>
          {labelEl}
          <div className="mt-3">
            <FileUploadField
              field={field}
              value={normalizeAttachmentAnswers(value)}
              onChange={onChange}
              draftId={draftId}
              requirementId={requirementId}
            />
          </div>
          {helpEl}
          {errorEl}
        </div>
      );
    case "signature":
      return (
        <div className={FIELD_SURFACE_CLASS}>
          {labelEl}
          <div className="mt-3">
            <SignatureField
              field={field}
              value={normalizeAttachmentAnswers(value)[0]}
              onChange={onChange}
              draftId={draftId}
              requirementId={requirementId}
            />
          </div>
          {helpEl}
          {errorEl}
        </div>
      );
  }
}

type SignatureValue = AttachmentAnswer | undefined;

function FileUploadField({
  field,
  value,
  onChange,
  draftId,
  requirementId,
}: {
  field: FormField;
  value: FileUploadAnswer;
  onChange: (v: unknown) => void;
  draftId: string;
  requirementId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadKind, maxFiles } = normalizeFileUploadConfig(field);
  const remainingSlots = Math.max(0, maxFiles - value.length);
  const accept =
    uploadKind === "document"
      ? "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
      : "image/jpeg,image/png,image/webp,image/heic,image/heif";

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    if (files.length > remainingSlots) {
      setErr(
        remainingSlots > 0
          ? `You can add ${remainingSlots} more file${remainingSlots === 1 ? "" : "s"} to this field.`
          : `You can upload up to ${maxFiles} file${maxFiles === 1 ? "" : "s"} for this field.`
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setErr(null);
    setUploading(true);
    const uploaded: AttachmentAnswer[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("draftId", draftId);
      fd.append("requirementId", requirementId);
      fd.append("fieldId", field.id);
      fd.append("kind", "file");
      fd.append("file", file);
      const res = await uploadFormAttachmentAction(fd);
      if (!res.ok || !res.attachment) {
        setUploading(false);
        setErr(res.error ?? "Upload failed");
        if (uploaded.length > 0) onChange([...value, ...uploaded]);
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      uploaded.push({ attachment_id: res.attachment.id, filename: res.attachment.filename });
    }
    setUploading(false);
    onChange([...value, ...uploaded]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function removeAttachment(attachmentId: string) {
    setErr(null);
    const fd = new FormData();
    fd.append("attachmentId", attachmentId);
    fd.append("draftId", draftId);
    const res = await deleteFormAttachmentAction(fd);
    if (!res.ok) {
      setErr(res.error ?? "Could not remove file");
      return;
    }
    onChange(value.filter((item) => item.attachment_id !== attachmentId));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-white px-4 py-4 text-sm shadow-sm">
      {value.length > 0 ? (
        <div className="mb-3 space-y-2">
          {value.map((attachment, index) => (
            <div
              key={attachment.attachment_id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"
            >
              <span className="truncate text-stone-700">
                {attachment.filename ?? `Upload ${index + 1}`}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(attachment.attachment_id)}
                disabled={uploading}
                className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600 hover:underline"
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
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) handleFiles(files);
        }}
        className="block w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700"
      />
      <p className="mt-2 text-xs leading-5 text-stone-500">
        {uploadKind === "document" ? "Images or PDF" : "Images only"}. Up to {maxFiles || DEFAULT_MAX_UPLOAD_FILES} file{maxFiles === 1 ? "" : "s"}.
      </p>
      {uploading ? <p className="mt-2 text-xs text-stone-500">Uploading...</p> : null}
      {err ? <p className="mt-2 text-xs text-red-600">{err}</p> : null}
    </div>
  );
}

function SignatureField({
  field,
  value,
  onChange,
  draftId,
  requirementId,
}: {
  field: FormField;
  value: SignatureValue;
  onChange: (v: unknown) => void;
  draftId: string;
  requirementId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (value?.attachment_id) return;
    const ctx = canvasRef.current?.getContext("2d");
    const point = getPoint(e);

    if (ctx) {
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    drawingRef.current = true;
    lastRef.current = point;
    setErr(null);
    if (empty) setEmpty(false);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !lastRef.current) return;
    const point = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastRef.current = point;
    if (empty) setEmpty(false);
  }

  function end() {
    drawingRef.current = false;
    lastRef.current = null;
  }

  function clearCanvas() {
    void clearSavedSignature();
  }

  async function clearSavedSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (value?.attachment_id) {
      const fd = new FormData();
      fd.append("attachmentId", value.attachment_id);
      fd.append("draftId", draftId);
      const res = await deleteFormAttachmentAction(fd);
      if (!res.ok) {
        setErr(res.error ?? "Could not remove signature");
        return;
      }
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    setEmpty(true);
    setErr(null);
    onChange(undefined);
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas || empty) {
      setErr("Please sign first");
      return;
    }
    setErr(null);
    setUploading(true);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((capturedBlob) => resolve(capturedBlob), "image/png")
    );
    if (!blob) {
      setUploading(false);
      setErr("Could not capture signature");
      return;
    }
    const file = new File([blob], "signature.png", { type: "image/png" });
    const fd = new FormData();
    fd.append("draftId", draftId);
    fd.append("requirementId", requirementId);
    fd.append("fieldId", field.id);
    fd.append("kind", "signature_png");
    fd.append("file", file);
    const res = await uploadFormAttachmentAction(fd);
    setUploading(false);
    if (!res.ok || !res.attachment) {
      setErr(res.error ?? "Upload failed");
      return;
    }
    onChange({ attachment_id: res.attachment.id, filename: res.attachment.filename });
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
        className={`h-40 w-full rounded-[1.5rem] border bg-white shadow-sm ${
          locked ? "border-stone-300 opacity-70" : "border-stone-400"
        }`}
      />
      <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
        Draw with your finger or mouse, then save the signature.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {locked ? (
          <>
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold uppercase tracking-[0.16em] text-emerald-800">
              Signature saved
            </span>
            <button
              type="button"
              onClick={clearCanvas}
              className="rounded-full border border-red-200 px-3 py-1 font-semibold uppercase tracking-[0.16em] text-red-700 hover:bg-red-50"
            >
              Re-sign
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={save}
              disabled={uploading || empty}
              className="rounded-full bg-stone-900 px-4 py-2 font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-50"
            >
              {uploading ? "Saving..." : "Save signature"}
            </button>
            <button
              type="button"
              onClick={clearCanvas}
              disabled={empty}
              className="rounded-full border border-stone-200 px-4 py-2 font-semibold uppercase tracking-[0.16em] text-stone-600 hover:bg-stone-50 disabled:opacity-50"
            >
              Clear
            </button>
          </>
        )}
      </div>
      {err ? <p className="text-xs text-red-600">{err}</p> : null}
    </div>
  );
}
