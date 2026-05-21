"use server";

import { redirect } from "next/navigation";

import { storefrontApi } from "../../../lib/storefront-api";

const readRequiredField = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required field: ${key}`);
  }

  return value;
};

export async function startBookingDraftAction(formData: FormData) {
  const tenantSlug = readRequiredField(formData, "tenantSlug");
  const serviceId = readRequiredField(formData, "serviceId");
  const providerId = readRequiredField(formData, "providerId");
  const startsAt = readRequiredField(formData, "startsAt");
  const returnToValue = formData.get("returnTo");
  const returnTo = typeof returnToValue === "string" && returnToValue.startsWith(`/${tenantSlug}/`) ? returnToValue : `/${tenantSlug}/services/${serviceId}`;
  const locationIdValue = formData.get("locationId");
  const locationId = typeof locationIdValue === "string" && locationIdValue.length > 0 ? locationIdValue : undefined;

  let draftId: string;

  try {
    const draft = await storefrontApi.createBookingDraft({
      tenantSlug,
      serviceId,
      providerId,
      startsAt,
      locationId,
    });

    draftId = draft.id;
  } catch {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=slot-unavailable`);
  }

  redirect(`/${tenantSlug}/book/${draftId}`);
}
