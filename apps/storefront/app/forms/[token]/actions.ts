"use server";

import { redirect } from "next/navigation";

import type { FormAnswers, FormAttachment, FormField, FormSchema } from "@booking/shared-types";

import { storefrontApi, uploadFormFile } from "../../lib/storefront-api";

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

const readFieldAnswer = async (formData: FormData, field: FormField, tenantId: string) => {
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

  if (field.type === "file_upload") {
    const files = formData.getAll(field.id).filter(
      (entry): entry is File => entry instanceof File && entry.size > 0,
    );
    if (files.length === 0) return undefined;

    const attachments: FormAttachment[] = [];
    for (const file of files) {
      const attachment = await uploadFormFile(file, tenantId);
      attachments.push(attachment);
    }
    return attachments;
  }

  const value = formData.get(field.id);
  return typeof value === "string" ? value.trim() : undefined;
};

const readRequirementAnswers = async (formData: FormData, tenantId: string): Promise<FormAnswers> => {
  const schema = readRequirementSchema(formData);
  const answers: FormAnswers = {};

  for (const field of schema.fields) {
    const value = await readFieldAnswer(formData, field, tenantId);
    if (value !== undefined) {
      answers[field.id] = value;
    }
  }

  return answers;
};

export async function submitManageBookingFormRequirementAction(formData: FormData) {
  const token = readRequiredField(formData, "token");
  const requirementId = readRequiredField(formData, "requirementId");
  const tenantId = readRequiredField(formData, "tenantId");

  await storefrontApi.submitManageBookingFormRequirement(token, requirementId, {
    answers: await readRequirementAnswers(formData, tenantId),
  });

  redirect(`/forms/${token}?submitted=1`);
}
