"use server";

import { redirect } from "next/navigation";

import type { FormAnswers, FormField, FormSchema } from "@booking/shared-types";

import { storefrontApi } from "../../lib/storefront-api";

const readRequiredField = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${key}`);
  }

  return value.trim();
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

export async function submitManageBookingFormRequirementAction(formData: FormData) {
  const token = readRequiredField(formData, "token");
  const requirementId = readRequiredField(formData, "requirementId");

  await storefrontApi.submitManageBookingFormRequirement(token, requirementId, {
    answers: readRequirementAnswers(formData),
  });

  redirect(`/forms/${token}?submitted=1`);
}
