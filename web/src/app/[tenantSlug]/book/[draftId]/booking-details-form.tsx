"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveBookingDetailsDraftAction,
  submitBookingDetailsAction,
} from "../../services/[serviceId]/actions";

export function BookingDetailsForm({
  draftId,
  defaultName,
  defaultEmail,
  defaultPhone,
  initialSavedAt,
  hasPendingForms,
}: {
  draftId: string;
  defaultName: string;
  defaultEmail: string;
  defaultPhone: string;
  initialSavedAt: string | null;
  hasPendingForms: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState(defaultPhone);
  const [error, setError] = useState<string | null>(null);
  const [draftSaveState, setDraftSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    initialSavedAt ? "saved" : "idle"
  );
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialSavedAt);
  const [pending, startTransition] = useTransition();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRequestRef = useRef(0);
  const lastSavedDetailsRef = useRef(serializeContactDetails(defaultName, defaultEmail, defaultPhone));

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const detailsJson = serializeContactDetails(name, email, phone);

    if (detailsJson === lastSavedDetailsRef.current || pending) {
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const requestId = ++saveRequestRef.current;
    saveTimeoutRef.current = setTimeout(async () => {
      setDraftSaveState("saving");
      const res = await saveBookingDetailsDraftAction({
        draftId,
        name,
        email,
        phone,
      });

      if (requestId !== saveRequestRef.current) {
        return;
      }

      if (!res.ok) {
        setDraftSaveState("error");
        setDraftSaveError(res.error ?? "Could not save your progress");
        return;
      }

      lastSavedDetailsRef.current = detailsJson;
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
  }, [draftId, email, name, pending, phone]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    startTransition(async () => {
      const res = await submitBookingDetailsAction({ draftId, name, email, phone });
      if (!res.ok) setError(res.error ?? "Failed to save details");
      else router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            Contact details
          </p>
          <h2
            className="mt-2 text-3xl tracking-[-0.03em] text-stone-950"
            style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif' }}
          >
            Where should the studio send updates?
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600 sm:text-base">
            These details power confirmations, reminders, and any last-minute booking updates.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600 shadow-sm">
          <p>{hasPendingForms ? "Intake comes next." : "Payment comes next."}</p>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            {draftSaveState === "saving"
              ? "Saving your progress..."
              : draftSaveState === "saved" && lastSavedAt
                ? `Saved ${formatSavedAt(lastSavedAt)}`
                : draftSaveState === "error"
                  ? draftSaveError ?? "Could not save your progress"
                  : "Your details will still be here if you refresh."}
          </p>
        </div>
      </div>

      <Field label="Your name" hint="This appears on the confirmation and the customer record.">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 shadow-[0_12px_24px_rgba(40,23,9,0.06)] outline-none transition placeholder:text-stone-400 focus:border-stone-900"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" hint="Used for confirmations, receipts, and reminder emails.">
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 shadow-[0_12px_24px_rgba(40,23,9,0.06)] outline-none transition placeholder:text-stone-400 focus:border-stone-900"
          />
        </Field>
        <Field label="Phone" hint="Used only if the business needs to reach you quickly.">
          <input
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 555-5555"
            className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 shadow-[0_12px_24px_rgba(40,23,9,0.06)] outline-none transition placeholder:text-stone-400 focus:border-stone-900"
          />
        </Field>
      </div>

      <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/80 p-4 text-sm leading-6 text-stone-600">
        This booking keeps moving as soon as you continue. We only use these details for appointment communication and business records.
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-stone-900 px-5 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-stone-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : hasPendingForms ? "Continue to intake" : "Continue to payment"}
      </button>
    </form>
  );
}

function serializeContactDetails(name: string, email: string, phone: string) {
  return JSON.stringify({ name, email, phone });
}

function formatSavedAt(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block rounded-[1.5rem] border border-stone-200 bg-stone-50/80 p-4 shadow-sm">
      <span className="block text-sm font-semibold text-stone-900">{label}</span>
      {hint ? <span className="mt-1 block text-xs leading-5 text-stone-500">{hint}</span> : null}
      <div className="mt-3">{children}</div>
    </label>
  );
}
