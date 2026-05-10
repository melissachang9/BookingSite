"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitBookingDetailsAction } from "../../services/[serviceId]/actions";

export function BookingDetailsForm({
  draftId,
  defaultName,
  defaultEmail,
  defaultPhone,
  hasPendingForms,
}: {
  draftId: string;
  defaultName: string;
  defaultEmail: string;
  defaultPhone: string;
  hasPendingForms: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState(defaultPhone);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await submitBookingDetailsAction({ draftId, name, email, phone });
      if (!res.ok) setError(res.error ?? "Failed to save details");
      else router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
      <div className="border-b border-neutral-200 pb-3">
        <h2 className="text-lg font-semibold">Your details</h2>
        {hasPendingForms ? (
          <p className="mt-1 text-sm text-neutral-600">
            Next, you&apos;ll fill out a quick intake form.
          </p>
        ) : null}
      </div>

      <Field label="Your name">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Email">
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Phone">
        <input
          required
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}
