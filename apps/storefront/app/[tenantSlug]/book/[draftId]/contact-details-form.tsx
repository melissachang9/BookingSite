"use client";

import { useRef } from "react";

import { saveContactDetailsAction } from "./actions";

type ContactDetailsFormProps = {
  tenantSlug: string;
  bookingDraftId: string;
  initial?: { firstName: string; lastName: string; email: string; phone: string; smsConsent: boolean } | null;
};

/**
 * Contact fields save themselves once all four are filled in and the client moves on,
 * so the forms below unlock without a separate "Continue" step.
 */
export default function ContactDetailsForm({ tenantSlug, bookingDraftId, initial }: ContactDetailsFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const lastSaved = useRef<string>("");

  const snapshot = (form: HTMLFormElement) => JSON.stringify(Array.from(new FormData(form).entries()));

  if (initial && !lastSaved.current) {
    lastSaved.current = JSON.stringify([
      ["tenantSlug", tenantSlug],
      ["bookingDraftId", bookingDraftId],
      ["firstName", initial.firstName],
      ["lastName", initial.lastName],
      ["email", initial.email],
      ["phone", initial.phone],
      ...(initial.smsConsent ? [["smsConsent", "on"]] : []),
      ["intakeCompletionTiming", "before_visit"],
    ]);
  }

  const saveIfReady = () => {
    const form = formRef.current;
    if (!form || !form.checkValidity()) return;
    const next = snapshot(form);
    if (next === lastSaved.current) return;
    lastSaved.current = next;
    form.requestSubmit();
  };

  return (
    <form ref={formRef} action={saveContactDetailsAction} className="sf-details__form" onBlur={saveIfReady}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="bookingDraftId" value={bookingDraftId} />
      <input type="hidden" name="intakeCompletionTiming" value="before_visit" />
      <div className="sf-fields">
        <label className="sf-field">
          <span>First name</span>
          <input name="firstName" type="text" autoComplete="given-name" required defaultValue={initial?.firstName} />
        </label>
        <label className="sf-field">
          <span>Last name</span>
          <input name="lastName" type="text" autoComplete="family-name" required defaultValue={initial?.lastName} />
        </label>
        <label className="sf-field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required defaultValue={initial?.email} />
        </label>
        <label className="sf-field">
          <span>Mobile</span>
          <input name="phone" type="tel" autoComplete="tel" required defaultValue={initial?.phone} />
        </label>
      </div>
      <label className="sf-check">
        <input name="smsConsent" type="checkbox" defaultChecked={initial?.smsConsent} onChange={saveIfReady} />
        <span>Text me appointment reminders</span>
      </label>
      <noscript>
        <button type="submit" className="sf-btn sf-btn--peach">Save details</button>
      </noscript>
    </form>
  );
}
