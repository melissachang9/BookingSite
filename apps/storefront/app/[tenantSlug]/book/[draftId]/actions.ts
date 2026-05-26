"use server";

import { redirect } from "next/navigation";

import type { FormAnswers, FormField, FormSchema, IntakeCompletionTiming } from "@booking/shared-types";

import { storefrontApi } from "../../../lib/storefront-api";

const readRequiredField = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${key}`);
  }

  return value.trim();
};

const readIntakeTiming = (formData: FormData): IntakeCompletionTiming => {
  const value = readRequiredField(formData, "intakeCompletionTiming");
  if (value !== "before_booking" && value !== "before_visit") {
    throw new Error("Missing required field: intakeCompletionTiming");
  }

  return value;
};

const readRequirementSchema = (formData: FormData): FormSchema => {
  const rawSchema = readRequiredField(formData, "schemaJson");
  const parsedSchema = JSON.parse(rawSchema);
  if (!parsedSchema || typeof parsedSchema !== "object" || !Array.isArray((parsedSchema as FormSchema).fields)) {
    throw new Error("Missing required field: schemaJson");
  }

  return parsedSchema as FormSchema;
};

const readFieldAnswer = (formData: FormData, field: FormField) => {
  if (field.type === "section" || field.type === "static_text") {
    return undefined;
  }

  if (field.type === "yes_no") {
    const value = formData.get(field.id);
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return undefined;
  }

  if (field.type === "checkbox") {
    return formData.get(field.id) === "on";
  }

  const value = formData.get(field.id);
  return typeof value === "string" ? value.trim() : undefined;
};

const readRequirementAnswers = (formData: FormData): FormAnswers => {
  const schema = readRequirementSchema(formData);
  const answers: FormAnswers = {};

  for (const field of schema.fields) {
    const value = readFieldAnswer(formData, field);
    if (value !== undefined) {
      answers[field.id] = value;
    }
  }

  return answers;
};

export async function saveContactDetailsAction(formData: FormData) {
  const tenantSlug = readRequiredField(formData, "tenantSlug");
  const bookingDraftId = readRequiredField(formData, "bookingDraftId");

  await storefrontApi.updateBookingDraft(tenantSlug, bookingDraftId, {
    customer: {
      name: readRequiredField(formData, "name"),
      email: readRequiredField(formData, "email"),
      phone: readRequiredField(formData, "phone"),
    },
    intakeCompletionTiming: readIntakeTiming(formData),
  });

  redirect(`/${tenantSlug}/book/${bookingDraftId}`);
}

export async function confirmBookingDraftAction(formData: FormData) {
  const tenantSlug = readRequiredField(formData, "tenantSlug");
  const bookingDraftId = readRequiredField(formData, "bookingDraftId");

  const booking = await storefrontApi.confirmBookingDraft(tenantSlug, bookingDraftId);

  redirect(`/${tenantSlug}/book/${bookingDraftId}/success?bookingId=${booking.id}`);
}

export async function startDepositCheckoutAction(formData: FormData) {
  const tenantSlug = readRequiredField(formData, "tenantSlug");
  const bookingDraftId = readRequiredField(formData, "bookingDraftId");

  const checkoutSession = await storefrontApi.createCheckoutSession({
    tenantSlug,
    bookingDraftId,
    kind: "deposit",
    successUrl: `/${tenantSlug}/book/${bookingDraftId}/success?sessionId={CHECKOUT_SESSION_ID}`,
    cancelUrl: `/${tenantSlug}/book/${bookingDraftId}`,
  });

  redirect(checkoutSession.checkoutUrl);
}

export async function completeDepositCheckoutAction(formData: FormData) {
  const tenantSlug = readRequiredField(formData, "tenantSlug");
  const bookingDraftId = readRequiredField(formData, "bookingDraftId");
  const sessionId = readRequiredField(formData, "sessionId");

  const booking = await storefrontApi.completeCheckoutSession(tenantSlug, sessionId);

  redirect(`/${tenantSlug}/book/${bookingDraftId}/success?bookingId=${booking.id}`);
}

export async function submitBookingRequirementAction(formData: FormData) {
  const tenantSlug = readRequiredField(formData, "tenantSlug");
  const bookingDraftId = readRequiredField(formData, "bookingDraftId");
  const requirementId = readRequiredField(formData, "requirementId");

  await storefrontApi.submitBookingFormRequirement(tenantSlug, bookingDraftId, requirementId, {
    answers: readRequirementAnswers(formData),
  });

  redirect(`/${tenantSlug}/book/${bookingDraftId}`);
}